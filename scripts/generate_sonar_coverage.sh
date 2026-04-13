#!/usr/bin/env bash
# generate_sonar_coverage.sh: Genera reportes de lint y cobertura para backend/frontend con rutas compatibles con Sonar.
# Produce artefactos versionables en backend/ y frontend/coverage/ para análisis posterior en SonarQube o SonarCloud.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKEND_DIR="${REPO_ROOT}/backend"
FRONTEND_DIR="${REPO_ROOT}/frontend"

require_file() {
  local target_path="$1"
  if [[ ! -e "${target_path}" ]]; then
    echo "Falta el recurso requerido: ${target_path}" >&2
    exit 1
  fi
}

require_directory() {
  local target_path="$1"
  if [[ ! -d "${target_path}" ]]; then
    echo "Falta el directorio requerido: ${target_path}" >&2
    exit 1
  fi
}

generate_backend_reports() {
  echo "[backend] Generando ruff.json y coverage.xml..."
  require_directory "${BACKEND_DIR}"
  require_file "${BACKEND_DIR}/pyproject.toml"

  pushd "${BACKEND_DIR}" >/dev/null
  command -v poetry >/dev/null 2>&1 || {
    echo "Poetry no está instalado. Instálalo y ejecuta 'poetry install --with dev' en backend/." >&2
    exit 1
  }

  poetry run python -m pip show coverage >/dev/null 2>&1 || {
    echo "coverage no está disponible en el entorno de Poetry. Ejecuta 'poetry install --with dev' en backend/." >&2
    exit 1
  }
  poetry run ruff check . --fix && echo "[backend] ruff check completado sin issues (fix aplicado)." || echo "[backend] ruff check completado con issues (fix aplicado, exit ignorado)."
  poetry run ruff check . --output-format=sarif > ruff.json
  # Ejecutamos tests con el runner de Django para usar base de test aislada.
  # Esto evita bloqueos de sqlite que pueden aparecer al ejecutar pytest sin pytest-django.
  poetry run python -m coverage erase
  poetry run python -m coverage run --source=apps,config,libs manage.py test
  poetry run python -m coverage xml -o coverage.xml
  popd >/dev/null
}

generate_frontend_reports() {
  echo "[frontend] Generando eslint.json y cobertura Sonar (lcov)..."
  require_directory "${FRONTEND_DIR}"
  require_file "${FRONTEND_DIR}/package.json"
  require_directory "${FRONTEND_DIR}/node_modules"

  pushd "${FRONTEND_DIR}" >/dev/null

  echo "[frontend] Paso 1/3: ejecutando eslint..."
  # eslint retorna exit code 1 cuando hay issues (comportamiento esperado); se ignora para no abortar el script
  npx eslint . -f json -o eslint.json || true
  echo "[frontend] Paso 1/3: eslint.json generado (exit ignorado, puede tener issues)."

  echo "[frontend] Paso 2/3: ejecutando ng test con cobertura..."
  # Angular/Vitest puede escribir shards temporales en coverage/frontend/.tmp.
  # Precrear el directorio evita ENOENT intermitentes en ejecuciones paralelas.
  mkdir -p "${FRONTEND_DIR}/coverage/frontend/.tmp"
  npx ng test --coverage --coverage-reporters=json --coverage-reporters=lcov --watch=false
  echo "[frontend] Paso 2/3: ng test finalizado."

  echo "[frontend] Paso 2.5/3: consolidando lcov para Sonar..."
  cp "${FRONTEND_DIR}/coverage/frontend/lcov.info" "${FRONTEND_DIR}/coverage/frontend/lcov-sonar.info"

  if [[ "${SONAR_INCLUDE_E2E_COVERAGE:-1}" == "1" ]]; then
    echo "[frontend] E2E para Sonar habilitado: ejecutando Playwright con cobertura de navegador..."
    npm run e2e:coverage:sonar
    require_file "${FRONTEND_DIR}/coverage/e2e/lcov.info"
    printf '\n' >> "${FRONTEND_DIR}/coverage/frontend/lcov-sonar.info"
    cat "${FRONTEND_DIR}/coverage/e2e/lcov.info" >> "${FRONTEND_DIR}/coverage/frontend/lcov-sonar.info"
    echo "[frontend] Cobertura E2E agregada a lcov-sonar.info."
  else
    echo "[frontend] E2E para Sonar omitido (define SONAR_INCLUDE_E2E_COVERAGE=0 para deshabilitarlo por defecto)."
  fi

  popd >/dev/null

  echo "[frontend] Paso 3/3: validando generación de lcov.info..."
  require_file "${FRONTEND_DIR}/coverage/frontend/lcov.info"
  require_file "${FRONTEND_DIR}/coverage/frontend/lcov-sonar.info"
  echo "[frontend] Paso 3/3: lcov.info generado."
}

# Verifica si sonar-scanner está disponible y si el servidor responde antes de ejecutar
run_sonar_scanner_if_available() {
  if ! command -v sonar-scanner >/dev/null 2>&1; then
    echo "[sonar] sonar-scanner no está instalado; se omite el análisis." >&2
    return 0
  fi

  local sonar_url
  sonar_url="$(grep -m1 '^sonar.host.url=' "${REPO_ROOT}/sonar-project.properties" | cut -d= -f2)"
  if [[ -n "${sonar_url}" ]] && ! curl --silent --fail --max-time 5 "${sonar_url}/api/system/status" >/dev/null 2>&1; then
    echo "[sonar] El servidor SonarQube (${sonar_url}) no está accesible; se omite el análisis." >&2
    return 0
  fi

  echo "[sonar] Ejecutando sonar-scanner desde el directorio raíz del proyecto..."
  pushd "${REPO_ROOT}" >/dev/null
  # Cargar .env si existe y SONAR_TOKEN no está definido en el entorno
  if [[ -z "${SONAR_TOKEN:-}" && -f "${REPO_ROOT}/.env" ]]; then
    set -o allexport
    # shellcheck source=/dev/null
    source "${REPO_ROOT}/.env"
    set +o allexport
  fi
  sonar-scanner
  popd >/dev/null
}

main() {
  generate_backend_reports
  generate_frontend_reports

  echo
  echo "Reportes generados correctamente:"
  echo "- ${BACKEND_DIR}/ruff.json"
  echo "- ${BACKEND_DIR}/coverage.xml"
  echo "- ${FRONTEND_DIR}/eslint.json"
  echo "- ${FRONTEND_DIR}/coverage/frontend/coverage-final.json"
  echo "- ${FRONTEND_DIR}/coverage/frontend/lcov.info"
  echo "- ${FRONTEND_DIR}/coverage/frontend/lcov-sonar.info"

  run_sonar_scanner_if_available
}

main "$@"
