"""create_openapi.py: Valida prerequisitos y genera OpenAPI + cliente Angular."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

SCRIPT_PATH = Path(__file__).resolve()

# Literales reutilizadas para rutas de proyecto
MANAGE_PY = "manage.py"
PACKAGE_JSON = "package.json"


@dataclass(frozen=True)
class ProjectPaths:
    """Rutas relevantes del proyecto para generar OpenAPI y cliente Angular."""

    project_root: Path
    backend_path: Path
    frontend_path: Path
    manage_py_path: Path
    openapi_schema_path: Path
    frontend_package_json_path: Path
    frontend_openapitools_config_path: Path
    node_modules_path: Path
    node_modules_bin_path: Path
    angular_cli_package_json_path: Path
    openapi_generator_package_json_path: Path
    openapi_generator_binary_path: Path
    openapi_generator_jar_path: Path


def _resolve_project_root() -> Path:
    """Localiza la raíz del proyecto aunque el script viva en `/scripts`."""
    script_directory: Path = SCRIPT_PATH.parent
    candidate_directories: list[Path] = [script_directory, script_directory.parent]

    for candidate_directory in candidate_directories:
        backend_manage_py_path: Path = candidate_directory / "backend" / MANAGE_PY
        frontend_package_json_path: Path = (
            candidate_directory / "frontend" / PACKAGE_JSON
        )
        if backend_manage_py_path.exists() and frontend_package_json_path.exists():
            return candidate_directory

    raise RuntimeError(
        "No se pudo localizar la raíz del proyecto. "
        "Se esperaba encontrar 'backend/manage.py' y 'frontend/package.json'."
    )


def _build_project_paths(project_root: Path) -> ProjectPaths:
    """Construye objeto tipado con rutas de trabajo derivadas de la raíz."""
    backend_path: Path = project_root / "backend"
    frontend_path: Path = project_root / "frontend"

    return ProjectPaths(
        project_root=project_root,
        backend_path=backend_path,
        frontend_path=frontend_path,
        manage_py_path=backend_path / MANAGE_PY,
        openapi_schema_path=backend_path / "openapi" / "schema.yaml",
        frontend_package_json_path=frontend_path / PACKAGE_JSON,
        frontend_openapitools_config_path=frontend_path / "openapitools.json",
        node_modules_path=frontend_path / "node_modules",
        node_modules_bin_path=frontend_path / "node_modules" / ".bin",
        angular_cli_package_json_path=(
            frontend_path / "node_modules" / "@angular" / "cli" / PACKAGE_JSON
        ),
        openapi_generator_package_json_path=(
            frontend_path
            / "node_modules"
            / "@openapitools"
            / "openapi-generator-cli"
            / PACKAGE_JSON
        ),
        openapi_generator_binary_path=(
            frontend_path / "node_modules" / ".bin" / "openapi-generator"
        ),
        openapi_generator_jar_path=(
            frontend_path
            / "node_modules"
            / "@openapitools"
            / "openapi-generator-cli"
            / "bin"
            / "openapi-generator.jar"
        ),
    )


def _print_info(message: str) -> None:
    """Imprime mensajes informativos del flujo de generacion."""
    print(f"[INFO] {message}")


def _print_error(message: str) -> None:
    """Imprime mensajes de error de validacion o ejecucion."""
    print(f"[ERROR] {message}")


def _is_python_virtual_environment_active() -> bool:
    """Determina si Python se esta ejecutando dentro de un entorno virtual activo."""
    has_virtual_env_variable: bool = bool(os.environ.get("VIRTUAL_ENV"))
    runs_inside_virtual_env: bool = sys.prefix != getattr(
        sys, "base_prefix", sys.prefix
    )
    return has_virtual_env_variable or runs_inside_virtual_env


def _ensure_python_environment_is_ready(project_paths: ProjectPaths) -> None:
    """Valida que el entorno de Python este activo y que Django este disponible."""
    if not _is_python_virtual_environment_active():
        raise RuntimeError(
            "No se detecta entorno virtual de Python activo. "
            "Activalo antes de ejecutar este script."
        )

    if not project_paths.manage_py_path.exists():
        raise RuntimeError(
            f"No se encontro {MANAGE_PY} en: {project_paths.manage_py_path}"
        )

    try:
        __import__("django")
    except ImportError as import_error:
        raise RuntimeError(
            "Django no esta instalado en el entorno de Python activo."
        ) from import_error


def _ensure_frontend_environment_is_ready(project_paths: ProjectPaths) -> None:
    """Valida que Node/npm y Angular esten disponibles para autogenerar cliente."""
    if not project_paths.frontend_package_json_path.exists():
        raise RuntimeError(
            f"No se encontro {PACKAGE_JSON} del frontend en: {project_paths.frontend_package_json_path}"
        )

    npm_binary_path: str | None = shutil.which("npm")
    if npm_binary_path is None:
        raise RuntimeError("No se encontro npm instalado en el sistema.")

    _ensure_frontend_dependencies_installed(project_paths)

    if not project_paths.angular_cli_package_json_path.exists():
        raise RuntimeError(
            "Angular CLI no esta disponible tras instalar dependencias. "
            "Revisa frontend/package.json y ejecuta 'cd frontend && npm install'."
        )

    if not project_paths.openapi_generator_package_json_path.exists():
        raise RuntimeError(
            "No se detecta el paquete @openapitools/openapi-generator-cli tras instalar dependencias. "
            "Revisa frontend/package.json y ejecuta 'cd frontend && npm install'."
        )

    if not project_paths.openapi_generator_binary_path.exists():
        raise RuntimeError(
            "No se detecta el binario openapi-generator en frontend/node_modules/.bin. "
            "Reinstala dependencias con 'cd frontend && npm install'."
        )

    _ensure_openapi_generator_jar_available(project_paths)

    package_data: dict[str, object]
    with project_paths.frontend_package_json_path.open(
        "r", encoding="utf-8"
    ) as package_file:
        package_data = json.load(package_file)

    scripts_section: dict[str, str] = {
        key: value
        for key, value in dict(package_data.get("scripts", {})).items()
        if isinstance(key, str) and isinstance(value, str)
    }

    if "api:generate" not in scripts_section:
        raise RuntimeError(
            "No existe el script npm 'api:generate' en frontend/package.json."
        )


def _ensure_frontend_dependencies_installed(project_paths: ProjectPaths) -> None:
    """Instala dependencias frontend solo cuando faltan binarios esenciales."""
    has_openapi_generator_binary: bool = (
        project_paths.openapi_generator_binary_path.exists()
    )
    has_angular_cli_package: bool = project_paths.angular_cli_package_json_path.exists()

    if has_openapi_generator_binary and has_angular_cli_package:
        return

    _print_info(
        "No se detectaron dependencias frontend completas. Ejecutando npm install..."
    )
    _run_command(["npm", "install"], working_directory=project_paths.frontend_path)


def _get_openapi_generator_version(project_paths: ProjectPaths) -> str:
    """Obtiene version de openapi-generator desde openapitools.json."""
    default_version: str = "7.20.0"
    if not project_paths.frontend_openapitools_config_path.exists():
        return default_version

    try:
        with project_paths.frontend_openapitools_config_path.open(
            "r", encoding="utf-8"
        ) as openapi_tools_file:
            openapi_tools_data: dict[str, object] = json.load(openapi_tools_file)
    except (OSError, json.JSONDecodeError):
        return default_version

    generator_config: object = openapi_tools_data.get("generator-cli")
    if not isinstance(generator_config, dict):
        return default_version

    configured_version: object = generator_config.get("version")
    if not isinstance(configured_version, str) or not configured_version.strip():
        return default_version

    return configured_version.strip()


def _ensure_openapi_generator_jar_available(project_paths: ProjectPaths) -> None:
    """Descarga el JAR del generador cuando el paquete npm no lo incluye."""
    if project_paths.openapi_generator_jar_path.exists():
        return

    generator_version: str = _get_openapi_generator_version(project_paths)
    jar_download_url: str = (
        "https://repo1.maven.org/maven2/org/openapitools/"
        f"openapi-generator-cli/{generator_version}/"
        f"openapi-generator-cli-{generator_version}.jar"
    )

    project_paths.openapi_generator_jar_path.parent.mkdir(parents=True, exist_ok=True)
    _print_info(
        "No se detecto openapi-generator.jar en node_modules. "
        f"Descargando version {generator_version}..."
    )

    try:
        with urllib.request.urlopen(jar_download_url) as response:
            jar_content: bytes = response.read()
        with project_paths.openapi_generator_jar_path.open("wb") as jar_file:
            jar_file.write(jar_content)
    except OSError as download_error:
        raise RuntimeError(
            "No se pudo descargar openapi-generator.jar automaticamente. "
            "Verifica conectividad a Maven Central o reinstala dependencias frontend."
        ) from download_error


def _run_command(command: list[str], working_directory: Path) -> None:
    """Ejecuta comando de sistema y falla con mensaje claro ante errores."""
    _print_info(f"Ejecutando: {' '.join(command)}")
    completed_process = subprocess.run(
        command,
        cwd=working_directory,
        check=False,
        text=True,
        capture_output=True,
    )

    if completed_process.stdout:
        print(completed_process.stdout, end="")
    if completed_process.stderr:
        print(completed_process.stderr, end="", file=sys.stderr)

    combined_output: str = (
        (completed_process.stdout or "") + "\n" + (completed_process.stderr or "")
    ).lower()
    if "unable to access jarfile" in combined_output:
        raise RuntimeError(
            "El generador OpenAPI reporto un error de JAR inaccesible. "
            "Verifica la descarga de openapi-generator.jar o la conectividad de red."
        )

    if completed_process.returncode != 0:
        raise RuntimeError(
            f"Fallo el comando: {' '.join(command)} (codigo {completed_process.returncode})"
        )


def _generate_backend_openapi_schema(project_paths: ProjectPaths) -> None:
    """Genera el schema OpenAPI desde Django usando drf-spectacular."""
    project_paths.openapi_schema_path.parent.mkdir(parents=True, exist_ok=True)
    _run_command(
        [
            sys.executable,
            "manage.py",
            "spectacular",
            "--file",
            str(
                project_paths.openapi_schema_path.relative_to(
                    project_paths.backend_path
                )
            ),
        ],
        working_directory=project_paths.backend_path,
    )


def _generate_frontend_openapi_client(project_paths: ProjectPaths) -> None:
    """Genera el cliente TypeScript Angular a partir del schema OpenAPI."""
    _run_command(
        ["npm", "run", "api:generate"],
        working_directory=project_paths.frontend_path,
    )


def main() -> int:
    """Orquesta validaciones y generacion de artefactos OpenAPI end-to-end."""
    try:
        project_root: Path = _resolve_project_root()
        project_paths: ProjectPaths = _build_project_paths(project_root)

        _print_info("Validando entorno Python...")
        _ensure_python_environment_is_ready(project_paths)

        _print_info("Validando entorno frontend (npm + Angular)...")
        _ensure_frontend_environment_is_ready(project_paths)

        _print_info("Generando schema OpenAPI del backend...")
        _generate_backend_openapi_schema(project_paths)

        _print_info("Generando cliente OpenAPI para Angular...")
        _generate_frontend_openapi_client(project_paths)

        _print_info("Proceso completado correctamente.")
        return 0
    except RuntimeError as runtime_error:
        _print_error(str(runtime_error))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
