---
applyTo: "**/*"
name: "SonarQube MCP - Chemistry Apps"
description: "Guía práctica para usar SonarQube MCP en este monorepo sin ruido ni falsos positivos."
---

# SONARQUBE MCP — REGLAS PARA CHEMISTRY APPS

Usar SonarQube como apoyo de **calidad**, no como sustituto de pruebas reales, build o revisión arquitectónica.

---

## 1. FLUJO BÁSICO

- Al empezar una tarea, desactivar análisis automático **si la herramienta existe**.
- Al terminar cambios de código, analizar los archivos modificados **si la herramienta existe**.
- Al final, reactivar el análisis automático **si la herramienta existe**.
- No afirmar que un problema quedó resuelto solo por una sugerencia de Sonar: verificar con tests, build o ejecución real.

---

## 2. ALCANCE CORRECTO EN ESTE REPOSITORIO

### Analizar con prioridad

- `backend/apps/`
- `backend/config/`
- `frontend/src/`

### Evitar ruido o edición manual en

- `frontend/src/app/core/api/generated/`
- `backend/apps/**/migrations/`
- `frontend/coverage/`, `frontend/dist/`, `frontend/node_modules/`
- `backend/.venv/`, `backend/media/`
- `tools/`, `deprecated/`, artefactos de build

Si Sonar marca algo en código generado o volátil, **no editarlo manualmente**: corregir la fuente o ajustar exclusiones del análisis cuando corresponda.

---

## 3. REGLAS ESPECÍFICAS DEL PROYECTO

- El proyecto usa el key **`chemistry-apps`**; si el usuario menciona un project key, primero buscarlo, no adivinarlo.
- El backend produce reportes en:
  - `backend/ruff.json`
  - `backend/coverage.xml`
- El frontend produce reportes en:
  - `frontend/eslint.json`
  - `frontend/coverage/frontend/lcov-sonar.info`
- El flujo estándar para preparar Sonar en este repo es ejecutar `scripts/generate_sonar_coverage.sh`.

---

## 4. CÓMO INTERPRETAR HALLAZGOS

### Prioridad alta

- bugs reales
- vulnerabilidades
- problemas de tipado
- duplicación significativa en código fuente real
- validaciones ausentes en endpoints, serializers, plugins o wrappers

### Prioridad baja o a revisar antes de tocar

- hallazgos en archivos generados
- issues sobre HTTP local de desarrollo
- duplicaciones inevitables en tests o fixtures
- reglas que chocan con decisiones conscientes del proyecto ya justificadas

No introducir `NOSONAR`, suppressions o ignores para ocultar problemas reales. Corregir la causa raíz primero.

---

## 5. VERIFICACIÓN DESPUÉS DE CORREGIR

Después de corregir issues:

1. verificar el archivo o módulo real afectado
2. ejecutar los checks relevantes (`manage.py check`, tests, build, lint)
3. solo entonces concluir que la corrección está bien

No usar búsquedas globales de issues del servidor para “confirmar” una corrección recién hecha: el estado puede tardar en reflejarse.

---

## 6. TROUBLESHOOTING

### Not authorized

- usar **USER token**, no project token
- revisar `SONAR_TOKEN`

### Project not found

- buscar primero el proyecto disponible
- no asumir nombres o keys

### Analysis mismatch

- recordar que el análisis de snippet/archivo **no reemplaza** un scan completo del proyecto
- si hace falta contexto, proporcionar el archivo completo o el bloque relevante

---

## 7. REGLA META

Usar SonarQube MCP para mejorar **calidad, seguridad y mantenibilidad** del código fuente real del sistema, sin tocar archivos generados ni crear falsos positivos por falta de contexto.
