# Instrucciones específicas para el proyecto Chemistry Apps

Estas instrucciones están diseñadas para estandarizar el desarrollo y mantenimiento del proyecto Chemistry Apps.

# Project Rules

## 1. Scientific Accuracy (CRITICAL)
- Never invent chemical data or formulas.
- All chemical calculations must be correct and verifiable.
- Do not assume missing scientific values; ask or state uncertainty.
- Use standard scientific units (SI units).

## 2. Code Quality
- Follow clean code principles.
- Prefer readability over cleverness.
- Keep functions small and focused.
- Use meaningful variable and function names.

## 3. Python Rules
- Use standard libraries unless otherwise required.
- Prefer numpy/pandas for scientific computations.
- Avoid hardcoded values in calculations.
- Validate all inputs before processing.

## 4. Frontend Rules
- UI must clearly represent scientific data.
- Avoid misleading visualizations.
- Ensure accessibility and readability.
- Handle loading and error states properly.

## 5. API Rules
- Validate all incoming data.
- Never trust client input.
- Return structured and consistent responses.
- Handle errors gracefully.

## 6. Testing (MANDATORY)
- All scientific logic must have unit tests.
- Cover edge cases in calculations.
- Tests must be deterministic and reproducible.

## 7. Security
- Never expose secrets or credentials.
- Sanitize all inputs.
- Avoid unsafe code execution.

## 8. Consistency
- Follow existing project structure.
- Do not introduce new patterns without justification.
- Reuse existing utilities when possible.

## 9. Documentation
- Document complex logic clearly.
- Explain scientific formulas when used.
- Keep documentation up to date.

## 10. Copilot Behavior Rules
- Do not hallucinate APIs or libraries.
- If unsure, say it explicitly.
- Prefer safe and well-known approaches.
- Provide explanations when generating complex logic.


## Estructura del proyecto

- **Backend**: Django 6 + DRF + Celery + Django Channels. Toda la lógica del servidor vive en `backend/apps/`, dividida en `apps/core/` (infraestructura transversal) y una carpeta por app científica. La configuración centralizada está en `backend/config/`.
- **Frontend**: Angular 21 con componentes standalone y lazy loading. Ubicado en `frontend/`. El cliente HTTP se genera automáticamente desde el contrato OpenAPI del backend.
- **Scripts**: Automatizaciones en `scripts/`. El más importante es `create_openapi.py`, que genera `backend/openapi/schema.yaml` y regenera el cliente TypeScript en `frontend/src/app/core/api/generated/`.
- **Deprecated**: Código histórico fuera de uso activo, ubicado en `deprecated/`. No editar ni recuperar código de esta carpeta sin revisión explícita. En documentación anterior puede aparecer como `legacy/`.
- **Tools**: Runtimes Java externos para librerías científicas (`tools/java/`). No se modifican manualmente.
- **Libs**: Librerías científicas internas en `backend/libs/` (`gaussian_log_parser`, `admet_ai`, `ambit`, `brsascore`, `rdkit_sa`). El código compartido entre apps que no pertenece a ninguna app específica va aquí.

### Organización interna del backend

```
backend/apps/core/        # Infraestructura transversal: jobs, plugins, realtime, caché
backend/apps/<app>/       # Una carpeta por app científica con estructura estándar
backend/config/           # settings.py, urls.py, celery.py, asgi.py, wsgi.py
backend/libs/             # Librerías científicas internas compartidas
```

Regla fundamental: el core nunca importa de las apps científicas específicas. Las apps importan del core. Los imports entre apps distintas están prohibidos: si se necesita código compartido entre dos apps, moverlo a `backend/libs/`.

### Organización interna del frontend

```
frontend/src/app/core/api/generated/   # NO EDITAR. Código generado por openapi-generator-cli
frontend/src/app/core/api/             # Wrappers estables: jobs-api.service.ts, tipos propios
frontend/src/app/core/shared/          # Constantes, configuración y utilidades compartidas
frontend/src/app/<nombre>/             # Un directorio por app científica (componente standalone)
```

## Convenciones de desarrollo

1. **Comentarios y documentación**:
   - Usar comentarios en español explicando el objetivo y uso de cada archivo.
   - Documentar funciones y clases con docstrings claros y descriptivos.

2. **Nombres descriptivos**:
   - Usar nombres de variables y funciones que describan claramente su propósito.
   - Evitar abreviaturas innecesarias.

3. **Estructura del código**:
   - Mantener el código limpio y organizado.
   - Seguir las mejores prácticas de programación.
   - Evitar el uso de código obsoleto.

4. **Pruebas**:
   - Escribir pruebas unitarias para cada nueva funcionalidad antes de dar la tarea por terminada.
   - Ubicar las pruebas en archivos `tests.py` dentro de cada aplicación o módulo.
   - Cada test debe tener un comentario que explique exactamente qué se está verificando y por qué es importante.
   - Los tests no son pruebas de reacción de código. Cada prueba debe tener un objetivo concreto: validar una precondición, verificar una postcondición o confirmar el comportamiento ante un input inválido.
   - En el backend, los tests del plugin se escriben llamando directamente a la función del plugin con callbacks mock, sin pasar por el ciclo HTTP.
   - En el frontend, los tests de servicios y componentes se escriben con `TestBed` e inputs controlados, verificando el estado resultante, no los detalles de implementación.

5. **Errores**:
   - Manejar errores en la capa correcta: validación de contrato en serializers, errores de dominio en el plugin, errores de infraestructura en adaptadores.
   - No usar variables globales. Las dependencias se pasan por parámetro o por inyección.
   - En plugins, los errores de validación de parámetros de entrada lanzan `ValueError` con mensaje descriptivo. Los errores de ejecución inesperados dejan que burbujeen como `RuntimeError` para que el core los registre en `error_trace`.
   - En el frontend, los errores de HTTP se manejan en los servicios wrapper, nunca en los componentes directamente.

## Backend

- **Framework**: Django 6 + Django REST Framework + drf-spectacular para OpenAPI.
- **Base de datos**: SQLite en desarrollo, PostgreSQL en producción (configurar en `backend/config/settings.py`).
- **Servidor ASGI**: Daphne. En desarrollo el comando `up` lo gestiona automáticamente junto con el worker Celery.

**Ejecución en desarrollo** (arranca API ASGI + worker Celery con auto-reload):

```bash
cd backend
poetry run python manage.py migrate
poetry run python manage.py up
```

**Solo API HTTP sin worker** (cuando no se necesita Redis ni procesamiento asíncrono):

```bash
cd backend
poetry run python manage.py up --without-celery
```

En este modo los jobs quedan en estado `pending` hasta que se levante un worker. Útil para desarrollar routers y serializers sin tener Redis activo.

**Pruebas con cobertura**:

```bash
cd backend
poetry run python manage.py test apps.core apps.<nombre_app> --verbosity=2 && echo listo
# Con reporte de cobertura:
poetry run pytest --cov=apps --cov-report=xml:coverage.xml && echo listo
```

**Lint**:

```bash
cd backend
poetry run ruff check . && echo listo
```

**Verificar integridad de configuración Django**:

```bash
cd backend
poetry run python manage.py check && echo listo
```

**Generar y aplicar migraciones**:

```bash
cd backend
poetry run python manage.py makemigrations
poetry run python manage.py migrate
```

### Registro de apps científicas en Django

Cada nueva app científica requiere tres pasos de configuración:

1. Añadir su `AppConfig` en `INSTALLED_APPS` en `backend/config/settings.py`.
2. Registrar su `ViewSet` en el `DefaultRouter` en `backend/config/urls.py`.
3. El `AppConfig.ready()` debe importar el módulo `plugin` para activar `@PluginRegistry.register(...)` y llamar a `ScientificAppRegistry.register(definition)`.

### Celery y ejecución asíncrona

Los jobs científicos se ejecutan en workers Celery. En desarrollo, `manage.py up` arranca el worker automáticamente. En producción se necesita un proceso separado por cada rol:

```bash
# Worker de tareas
poetry run python -m celery -A config worker -l info --concurrency 4
# Scheduler de tareas periódicas (recuperación activa, purga de artefactos)
poetry run python -m celery -A config beat -l info
```

El broker y backend de resultados es Redis. Si Redis no está disponible al encolar, `dispatch_scientific_job` captura el error sin romper la API: el job queda en `pending` y la tarea periódica `run_active_recovery` lo re-encola cuando el broker vuelve.

## Frontend

- **Framework**: Angular 21 con componentes standalone, Reactive Forms, RxJS 7 y Signals.
- **Testing**: Vitest con `@angular/core/testing`.
- **Generación de cliente**: `openapi-generator-cli` 7.x leyendo `backend/openapi/schema.yaml`.

**Ejecución en desarrollo** (proxy hacia backend en localhost:8000):

```bash
cd frontend
npm install
npm start
```

**Build de producción**:

```bash
cd frontend
npm ci
npm run build && echo listo
```

**Pruebas con cobertura**:

```bash
cd frontend
npm run test:coverage && echo listo
```

**Lint**:

```bash
cd frontend
npx eslint . --format json > eslint.json && echo listo
```

### Separación de responsabilidades en el frontend

Los componentes de app científica no llaman directamente al código generado en `generated/`. El flujo correcto es:

```
Componente → jobs-api.service.ts (wrapper) → generated/ → HTTP
```

`jobs-api.service.ts` centraliza todas las operaciones sobre jobs: crear, listar, cancelar, pausar, reanudar, descargar reportes, hacer polling y streaming. Los componentes reciben datos ya mapeados a tipos de vista definidos en `core/api/types/`.

`jobs-streaming-api.service.ts` encapsula tres patrones de observabilidad:

- **SSE** (`streamJobEvents`): `EventSource` nativo hacia `/api/jobs/{id}/events/`.
- **WebSocket** (`connectToJobsStream`): conecta a `ws/jobs/stream/` con query params de filtro.
- **Polling** (`pollJobProgress`): `interval` RxJS + `switchMap` para casos que prefieren polling explícito.

### Código generado

El directorio `frontend/src/app/core/api/generated/` es código autogenerado. **No se edita manualmente**. Si cambia un serializer en el backend, el flujo correcto es:

1. Actualizar el serializer en Django.
2. Regenerar schema y cliente: `poetry run python ../scripts/create_openapi.py`.
3. Adaptar el wrapper en `core/api/` si la firma cambió.

Nunca parchar el código generado directamente: se sobreescribe en la siguiente regeneración.

## Scripts

- **`create_openapi.py`**: Genera `backend/openapi/schema.yaml` desde Django y regenera el cliente TypeScript en `frontend/src/app/core/api/generated/`. Ejecutar desde la raíz del repositorio con el entorno virtual activado:

  ```bash
  cd backend && poetry install --with dev --no-interaction --no-ansi
  poetry run python ../scripts/create_openapi.py && echo listo || echo error
  ```

- **`generate_sonar_coverage.sh`**: Genera todos los artefactos para análisis SonarQube: cobertura Python (XML), cobertura Angular (lcov), reporte Ruff y reporte ESLint. Ejecutar desde la raíz:
  ```bash
  bash scripts/generate_sonar_coverage.sh && echo listo || echo error
  ```
  Salida esperada: `backend/ruff.json`, `backend/coverage.xml`, `frontend/eslint.json`, `frontend/coverage/frontend/lcov.info`.

Nota: añadir `&& echo listo || echo error` al final de cualquier comando de generación es buena práctica para confirmar que terminó correctamente, especialmente en comandos que no siempre muestran salida al completarse con éxito.

## Estilo de codificación

### Python (backend)

- Ruff como linter y formateador. Configurado en `pyproject.toml`. Ejecutar `ruff check .` antes de cada commit.
- Tipado estricto obligatorio: sin `# type: ignore` salvo justificación explícita en el mismo comentario que explique por qué no se puede resolver con tipos propios.
- Docstrings en español en todos los módulos con: objetivo del archivo, forma de uso y relación con el flujo general.
- Nombres de funciones y variables en inglés descriptivos. Evitar abreviaturas crípticas.
- Archivos entre 200 y 400 líneas. Dividir en módulos especializados si crece más. Máximo absoluto: 600 líneas.
- Los helpers internos (no parte de la API pública del módulo) tienen prefijo `_`.

### TypeScript (frontend)

- ESLint configurado en `eslint.config.mjs`. Ejecutar antes de PR.
- TypeScript en strict mode. Sin `@ts-ignore` ni `as any` salvo justificación documentada en comentario.
- Comentarios en español para lógica compleja. Nombres de variables y funciones en inglés.
- Componentes standalone únicamente. Sin NgModules.
- Todo lo visual en inglés (textos, labels, atributos Angular). La lógica de negocio y comentarios en español.

## Control de versiones

- Usar ramas descriptivas: `feature/nombre-funcionalidad`, `fix/descripcion-error`, `refactor/descripcion`.
- La rama `main` es producción. La rama `dev` es integración. No hacer push directo a `main`.
- Antes de abrir un PR hacia `main` verificar localmente:
  1. `poetry run python manage.py check`
  2. `poetry run python manage.py test`
  3. `cd frontend && npm run build`
  4. `cd frontend && npm test`
- El pipeline CI ejecuta automáticamente tests de backend y frontend en cada push a `main`/`dev` y en PRs hacia `main`.

## Notas adicionales

- El `README.md` es la documentación principal del proyecto. Actualizarlo cuando cambien arquitectura, comandos o el catálogo de apps.
  solo existira un .md, el README.md y los que estan en la carpeta .github/instructions/ con las instrucciones para copilot, no se crearan otros archivos de documentacion .md adicionales no solicitados
- Eliminar código muerto y archivos no utilizados. Si se elimina una funcionalidad completa, eliminar también todos sus archivos relacionados.
- Los jobs en estado `pending` durante el arranque son normales si Redis no estaba disponible. La recuperación activa (`run_active_recovery`) los re-encola automáticamente cuando el broker vuelve.
- El directorio `frontend/src/app/core/api/generated/` es volátil: se sobreescribe con cada ejecución de `create_openapi.py`. No commitear cambios manuales en esos archivos.
- En `backend/libs/gaussian_log_parser/fixtures/` se almacenan logs Gaussian reales para pruebas. Al añadir un nuevo caso de test para `easy_rate` o `marcus`, agregar el fixture correspondiente en lugar de inventar datos inline.

# frontend

- Mantener la lógica de negocio en servicios separados de los componentes (patrón wrapper → servicio → componente).
- Todo lo visual debe estar en inglés (textos, labels, aria-labels, atributos Angular). La lógica de negocio y los comentarios pueden estar en español. Las variables y funciones siempre en inglés.
- Asegurarse de que los componentes visuales no dependan directamente del código generado por
  OpenAPI, usando wrappers para proteger el contrato generado.
- Configurar la base URL del backend de manera centralizada usando environments y constantes compartidas.
- Usar operadores de control de flujo modernos de Angular para evitar duplicación en plantillas.
- Mantener strict mode de TypeScript y tipado estricto de respuestas OpenAPI.
- Priorizar compatibilidad con la versión actual de Angular (21).
- Al integrar una nueva app científica, regenerar el cliente con `poetry run python ../scripts/create_openapi.py` y verificar que el frontend compila sin errores antes de dar la app por integrada.
- Todo endpoint del backend debe consumirse a través del cliente generado por OpenAPI y sus wrappers, nunca directamente desde los componentes. Excepción: los archivos `*.spec.ts` de pruebas unitarias pueden consumir directamente para lograr trazabilidad completa del test.
- Configurar la base URL del backend de manera centralizada en `frontend/src/app/core/shared/constants.ts` usando valores de `environments/`. Nunca hardcodear URLs en componentes ni servicios.
- Usar operadores de control de flujo modernos de Angular (`@if`, `@for`, `@switch`) en lugar de `*ngIf`, `*ngFor`, `[ngSwitch]`.

## Convenciones de pruebas en el frontend

- Cada test tiene un nombre descriptivo que explica el escenario y la expectativa esperada.
- Los tests de servicios verifican el estado resultante (qué valor emite el Observable o Signal), no los detalles de implementación internos.
- Los tests de componentes usan inputs controlados y verifican qué se renderiza o qué métodos del servicio se invocan.
- No escribir tests que solo verifiquen que el componente se instancia sin errores: eso no aporta valor.
- Cada `describe` e `it` tiene su comentario o descripción que explica claramente qué se está probando y por qué importa.

## Convenciones de pruebas en el backend

- Los tests del plugin llaman directamente la función del plugin con callbacks mock, sin pasar por HTTP ni ORM.
- Los tests de router usan el cliente de test de Django para verificar códigos de estado, estructura de respuesta y efectos secundarios en la base de datos.
- Cubrir siempre: payload válido → job creado, payload inválido → 400 con mensaje, ejecución del plugin → resultado correcto, logs y progreso emitidos.
- Cada método de test tiene un nombre descriptivo: `test_create_job_with_valid_payload_returns_202`, no `test_create`.

## Integración de una nueva app científica: pasos mínimos

1. Crear `backend/apps/<nombre>/` con los archivos estándar: `apps.py`, `definitions.py`, `types.py`, `schemas.py`, `plugin.py`, `routers.py`, `contract.py`, `tests.py`.
2. Registrar `AppConfig` en `INSTALLED_APPS` en `backend/config/settings.py`.
3. Registrar `ViewSet` en `DefaultRouter` en `backend/config/urls.py`.
4. El `AppConfig.ready()` debe importar el módulo `plugin` y registrar la `ScientificAppDefinition`.
5. Verificar: `poetry run python manage.py check && echo listo`.
6. Ejecutar tests: `poetry run python manage.py test apps.<nombre> apps.core --verbosity=2`.
7. Regenerar contrato: `poetry run python ../scripts/create_openapi.py && echo listo`.
8. Verificar compilación del frontend: `cd frontend && npm run build && echo listo`.
9. Registrar la app en `frontend/src/app/core/shared/scientific-apps.config.ts`.
10. Añadir ruta con lazy loading en `frontend/src/app/app.routes.ts`.
    El backend tiene su entorno virtual en `backend/.venv/`. Siempre activarlo antes de ejecutar comandos Python: `cd backend && poetry install --with dev --no-interaction --no-ansi`.

El multilenguaje i18n solo es para el frontend.
El backend las variables y lógica van en inglés, los comentarios y docstrings en español. En el frontend todo lo visual (textos, labels, atributos Angular) va en inglés, la lógica de negocio y los comentarios pueden estar en español.
solo centrarse en las vistas que se vean en ingles y su traduccion en español, al final de cada sprint se actualizaran los demas idiomas segun el avance del proyecto. para no saturar el proceso de desarrollo con tareas de traduccion que no aportan valor en las primeras etapas del proyecto.

Si el uso de mónadas o abstracciones funcionales reduce la legibilidad o complica el código innecesariamente, se debe preferir una solución más simple.
Todas las reglas pueden ser ignoradas si se justifica claramente que hacerlo mejora la claridad o la mantenibilidad del código en ese caso específico, pero no se deben ignorar sin una razón de peso y una justificación clara bien comentada en el lugar del código donde se ignore la regla, explicando por qué se decidió ignorar esa regla en ese caso específico, y cómo esa decisión mejora la claridad o la mantenibilidad del código en ese contexto particular.
