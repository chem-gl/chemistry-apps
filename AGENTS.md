# Chemistry Apps - Guía para Asistentes IA

Monorepo de aplicaciones científicas de química. Backend Django 6 + DRF + Celery + Channels, Frontend Angular 21 standalone.

---

## Stack

| Capa | Tecnología |
|------|-----------|
| Backend | Python 3.12, Django 6, DRF, Celery, Channels, Daphne |
| Frontend | Angular 21 (standalone, signals, Transloco i18n) |
| BD | SQLite (dev) / PostgreSQL (prod) |
| Cache/Broker | Redis 7 |
| Calidad | Ruff, ESLint, SonarQube (localhost:9000) |
| OpenAPI | drf-spectacular → `scripts/create_openapi.py` |
| Contenedores | Docker solo prod (compose prod + scanner Sonar); dev nativo, si acaso solo redis |

---

## Estructura del monorepo

```
backend/
  apps/
    core/                # Infraestructura transversal (jobs, identidad, RBAC, caché, realtime)
    molar_fractions/     # Fracciones molares ácido-base
    tunnel/              # Corrección efecto túnel Eckart
    easy_rate/           # Constantes velocidad TST + Eckart
    marcus/              # Teoría de Marcus
    smileit/             # Generación combinatoria SMILES
    sa_score/            # Synthetic Accessibility Score
    toxicity_properties/ # Predicciones ADMET-AI
    cadma_py/            # Ranking de compuestos (CADMA Py)
    server_calc/         # Calculadora remota en qta vía SSH (root/admin/qta-operators)
  config/                # settings.py, urls.py, celery.py, asgi.py
  libs/                  # Librerías compartidas entre apps
frontend/
  src/app/
    core/                # API wrappers, auth, i18n, shared components
    dashboard/           # Post-login
    apps-hub/            # Catálogo de apps
    <app>/               # Componente standalone por app
scripts/                 # OpenAPI, Sonar
```

Reglas de dependencias:
- `core/` **nunca importa** apps científicas
- Apps científicas **no se importan entre sí** — lógica compartida va a `backend/libs/`
- Plugins se registran en `PluginRegistry` con nombre único

---

## Backend — Flujo de ejecución completo

```
HTTP POST /api/<app>/jobs/
  → Router (routers.py) valida con serializer
  → DeclarativeJobAPI.submit_job() crea ScientificJob (status=pending)
  → CacheRepositoryPort busca por SHA-256 (plugin + version + parámetros + firmas)
    → Cache hit: copia resultado, job → completed, responde 201
    → Cache miss: dispatch_scientific_job.delay() encola en Celery
  → Worker ejecuta PluginRegistry.execute()
    → Plugin recibe (parameters, progress_cb, log_cb, control_cb)
    → Plugin reporta progreso (0-100%) y logs en cada etapa
    → Si hay excepción: job → failed con error_trace
    → Si hay JobPauseRequested: job → paused con checkpoint
  → Al completar: persiste resultado, verifica límite de caché, guarda en ScientificCacheEntry si cabe
  → Realtime broadcast (WebSocket + SSE) en cada cambio de estado/progreso/log
```

### Estados del job

`pending → running → completed | failed | cancelled`

Con pausa cooperativa: `running → paused → running → completed`

### PluginRegistry (processing.py)

Registro por decorador:
```python
@PluginRegistry.register("molar-fractions")
def my_plugin(parameters, report_progress, emit_log, request_control_action) -> JSONMap:
```

El plugin es una **función pura**: recibe `JSONMap`, retorna `JSONMap`. No accede a HTTP, ORM ni request. La validación de contrato vive en serializers; el plugin valida solo lo necesario para el cálculo.

Callbacks recibidos:
- `report_progress(percent, stage, message)` — publica avance 0-100
- `emit_log(level, source, message, payload)` — eventos trazables
- `request_control_action()` — retorna `"continue"` | `"pause"`

### Puerto-Adaptador (ports/adapters)

RuntimeJobService no depende de ORM ni Celery. Recibe 4 puertos vía dataclass:

| Puerto | Adaptador | Función |
|--------|-----------|---------|
| `CacheRepositoryPort` | `DjangoCacheRepositoryAdapter` | Cache por SHA-256 |
| `PluginExecutionPort` | `DjangoPluginExecutionAdapter` | Ejecuta plugin por nombre |
| `JobProgressPublisherPort` | `DjangoJobProgressPublisherAdapter` | Persiste + broadcast progreso |
| `JobLogPublisherPort` | `DjangoJobLogPublisherAdapter` | Persiste + broadcast logs |

Construcción vía factory singleton:
```python
from apps.core.factory import build_job_service
job_service = build_job_service()  # @lru_cache, misma instancia siempre
```

### Modelo principal: ScientificJob

Campos clave: `id` (UUID), `plugin_name`, `algorithm_version`, `status`, `parameters` (JSON), `results` (JSON), `job_hash` (SHA-256), `cache_hit`, `progress_percentage`, `progress_stage`, `owner` (FK), `group` (FK), `deleted_at` (soft delete), `runtime_state` (checkpoint para pausa).

### Artefactos (archivos subidos)

Apps como `easy_rate` y `marcus` reciben archivos Gaussian:
1. Router recibe `multipart/form-data`
2. `ScientificInputArtifactStorageService` chunktea y persiste en DB
3. Plugin reconstruye con `reconstruct_artifact_bytes()` y procesa en memoria
4. Archivos grandes tienen TTL; chunks expirados se purgan diariamente

### Realtime

WebSocket: `ws://host/ws/jobs/stream/?job_id=&plugin_name=&include_logs=&include_snapshot=&active_only=`

SSE alternativo: `GET /api/jobs/{id}/events/`

Broadcast en 3 grupos simultáneos: global, por plugin, por job.

### Identidad y RBAC

`AuthorizationService` en `core/identity/` centraliza:
- Roles globales: `root`, `admin`, `user`
- Grupos de trabajo (`WorkGroup`) con membresías
- `AppPermission` por grupo o usuario
- Guards: `authGuard`, `adminGuard`, `groupAdminGuard`, `appAccessGuard`

---

## Frontend — Flujo de ejecución

```
Componente (standalone, signals)
  → WorkflowService (core/application/<app>.service.ts)
    → jobs-api.service.ts (wrapper estable)
      → generated/api/*.service.ts (cliente OpenAPI)
        → HTTP / SSE / WebSocket
```

**Nunca** se llama al código generado directamente desde un componente.

### Capas del frontend

| Carpeta | Rol |
|---------|-----|
| `core/api/generated/` | Cliente OpenAPI autogenerado — **NO EDITAR** |
| `core/api/` | Wrappers estables (`JobsApiService`, `SmileitApiService`, etc.) |
| `core/application/` | Workflow services por app (lógica de negocio) |
| `core/auth/` | `IdentitySessionService` (JWT + RBAC visual) + guards |
| `core/i18n/` | `LanguageService`, Transloco, 8 idiomas |
| `core/shared/` | Constantes, config de apps, componentes reutilizables |
| `apps/[name]/` | Componente standalone de cada app científica |

### IdentitySessionService

Gestiona:
- Tokens JWT en localStorage con claves `chemistry-apps.access-token` y `chemistry-apps.refresh-token`
- Sesión: perfil, apps accesibles, grupos, rol
- Grupo activo persistido
- Inicialización idempotente (segunda llamada usa cache en memoria)

**Refresco de token**: El backend usa SimpleJWT con `ACCESS_TOKEN_LIFETIME=30min`, `REFRESH_TOKEN_LIFETIME=7d`, `ROTATE_REFRESH_TOKENS=True` y `BLACKLIST_AFTER_ROTATION=True`. El frontend programa refresco proactivo 1 min antes de expirar vía `setTimeout`. Si falla (red, server), el interceptor `HttpAuthTokenInterceptor` propaga el error sin destruir los tokens en localStorage — así el próximo page load reintenta con los mismos tokens y la sesión se recupera si el error era transitorio.

**Interceptor `HttpAuthTokenInterceptor`**: Adjunta `Bearer` a toda request hacia `API_BASE_URL` excepto `/api/auth/login/` y `/api/auth/refresh/`. Ante 401, serializa refrescos concurrentes con `BehaviorSubject` y reintenta la request original. Nunca llama a `logout()` en errores de refresh — solo propaga el error para que el calling code lo maneje.

**Flow de inicialización**: `authGuard` → `initializeSession()` → si hay tokens en localStorage → `loadRemoteSession()` → `GET /api/auth/me/` → si ok, carga grupos y apps → `scheduleTokenRefresh()`. Si `/api/auth/me/` falla, `fetchSessionPayload()` no ejecuta y el interceptor maneja el 401 automáticamente.

### Workflow Services (core/application/)

Cada app científica tiene su propio `*workflow.service.ts` que extiende `BaseJobWorkflowService<T>`:

```typescript
abstract class BaseJobWorkflowService<TResultData> {
  // Signals de estado
  activeSection = signal<'idle' | 'dispatching' | 'progress' | 'result' | 'error'>('idle')
  currentJobId = signal<string | null>(null)
  progressSnapshot = signal<JobProgressSnapshotView | null>(null)
  resultData = signal<TResultData | null>(null)
  errorMessage = signal<string | null>(null)

  // Derivadas
  isProcessing = computed(() => this.activeSection() === 'dispatching' || 'progress')
  progressPercentage = computed(() => this.progressSnapshot()?.progress_percentage ?? 0)

  // Abstractos: dispatch(), loadHistory(), fetchFinalResult()
}
```

### JobsApiService (core/api/)

Fachada que envuelve todos los servicios generados. Centraliza:
- Creación de jobs para todas las apps (parámetros tipados por app)
- Polling de estado
- Streaming SSE (`streamJobEvents`)
- Cancelación, pausa, reanudación
- Descarga de reportes (CSV, ZIP, logs)
- Lista de jobs con filtros

### Apps-hub

Las apps se registran en `core/shared/scientific-apps.config.ts`:
```typescript
const SCIENTIFIC_APP_DEFINITIONS = [
  { key: 'molar-fractions', pluginName: 'molar-fractions', title: 'Molar Fractions', ... },
  ...
]
```

El orden en este array determina el orden visual en el hub y menús.

### Convenciones frontend

- Standalone components, sin NgModules
- Signals para todo estado reactivo, RxJS solo para streams
- `@if` / `@for` / `@switch`, no `*ngIf` / `*ngFor`
- `input<T>()` / `output<T>()` en lugar de `@Input()` / `@Output()`
- `Result<T, E>` para operaciones que pueden fallar
- Sin `any`, `@ts-ignore` ni acceso directo a `generated/`
- Texto visible en inglés, comentarios en español

---

## Cómo agregar una nueva app científica

### Backend (8 archivos)

```
backend/apps/<nombre>/
  __init__.py
  apps.py          → AppConfig + registro en ScientificAppRegistry + import plugin
  definitions.py   → PLUGIN_NAME, APP_ROUTE_PREFIX, DEFAULT_ALGORITHM_VERSION, constantes
  types.py         → TypedDicts de input, metadata, result
  schemas.py       → Serializers DRF (create, response) con OpenApiExample
  plugin.py        → Función pura con @PluginRegistry.register()
  routers.py       → ViewSet con ScientificAppViewSetMixin + create() + build_csv_content()
  contract.py      → get_<app>_contract()
  tests.py         → Tests de plugin + router
```

Registrar en:
- `backend/config/settings.py` → `INSTALLED_APPS`
- `backend/config/urls.py` → router

### Frontend

1. Agregar definición en `core/shared/scientific-apps.config.ts`
2. Agregar ruta lazy en `app.routes.ts`
3. Crear componente standalone en `apps/<name>/`
4. Usar `JobsApiService` + workflow service, **nunca** `generated/` directo

---

## CI/CD

- `ci-deploy.yml` ("CI / CD") es el gate único: jobs `changes` → `tests` (backend +
  cobertura ≥91%), `i18n` (catálogos), `frontend` (`npm run build` + `ng test`, Node
  siguiendo `frontend/Dockerfile`) → `build` (workflow reutilizable) → `ci-check`.
  Un job que falla **o queda sin correr** sobre código afectado rompe el gate.
- `build.yml` compila y valida las imágenes Docker y crea la release con el bundle
  `git archive` + `docker-compose.libres.yml` (el único stack vivo).
- `deploy-libres.yml` **espera** el run "CI / CD" del mismo SHA (máx. 30 min) antes de
  desplegar: si está `failure`/`cancelled`/`timed_out` o no aparece, aborta. Solo
  `workflow_dispatch` con `skip_ci_wait=true` lo bypasea.
- El modo libre (`/api/public/*`) está **cerrado por default en el código**
  (`OPEN_MODE_ENABLED=False`): se abre explícitamente con `OPEN_MODE_ENABLED=1|True`
  (`backend/.env` en dev). Los tests que lo ejercitan deben poner
  `@override_settings(OPEN_MODE_ENABLED=True)`.

---

## Comandos de referencia

```bash
# Backend
cd backend && poetry run python manage.py check
cd backend && poetry run python manage.py test apps.<app> --verbosity=2
cd backend && poetry run ruff check .
cd backend && poetry run python ../scripts/create_openapi.py

# Frontend
cd frontend && npm run build
cd frontend && npm run test
cd frontend && npx eslint .

# SonarQube
bash scripts/generate_sonar_coverage.sh
docker run --rm --user root --network=host -e SONAR_TOKEN=$TOKEN -v $(pwd):/usr/src sonarsource/sonar-scanner-cli:latest \
  -D sonar.projectBaseDir=/usr/src -D sonar.host.url=http://localhost:9000 \
  -D sonar.scanner.scanAll=false \
  -D sonar.python.coverage.reportPaths=backend/coverage.xml \
  -D sonar.javascript.lcov.reportPaths=frontend/coverage/frontend/lcov-sonar.info

# Regenerar OpenAPI después de cambios en serializers/endpoints
cd backend && poetry run python ../scripts/create_openapi.py
cd frontend && npm run api:generate
```

---

## SonarQube

- Servidor: `http://localhost:9000` (solo local, sin secret en GitHub)
- Token: no se versiona — créalo en SonarQube y expórtalo como `SONAR_TOKEN` en tu `.env` local (gitignored)
- Project key: `chemistry-apps`
- Para cobertura real, generar reportes antes del scan: `bash scripts/generate_sonar_coverage.sh`
- Cobertura local 2026-11-09: backend 95% (`backend/coverage.xml`, line-rate 0.9453, gate `fail_under=91`) con `ruff.json` 0 issues (SARIF: 1 run, 0 vulnerabilidades); frontend 85.2% lcov (`frontend/coverage/frontend/lcov-sonar.info`, 176 entradas SF: 137 de código + 39 e2e) con `eslint.json` 0 errores / 0 warnings
- Suites 2026-11-09: backend 1290 tests OK (`skipped=1`); frontend `ng test` 1190 tests / 92 archivos (ambas en CI: jobs `tests` y `frontend`)
- Sonar server 2026-11-09: coverage global 84.7% (line 88.4%, branch 76.4%), quality gate OK (new_coverage 82.1 ≥ 80, 0 violations, duplicación nueva 0.67%, hotspots revisados 100%), bugs 0, vulns 0, smells 0, hotspots 0, duplicación global 0.7%
- Escáner: el CLI local `/opt/sonar-scanner` (5.0.1.3006) recorre todo el repo y aborta con `java.nio.file.AccessDeniedException` en `.docker/dev/redis/appendonlydir` (volumen del Redis de dev: uid 999, modo 700); `sonar.exclusions` no lo evita y `sonar.scanner.scanAll=false` (ya en `sonar-project.properties`) no lo respeta esa versión → fallback con la imagen oficial y `--user root`:
  `docker run --rm --user root --network=host -e SONAR_TOKEN=$SONAR_TOKEN -v $(pwd):/usr/src sonarsource/sonar-scanner-cli:latest -D sonar.projectBaseDir=/usr/src -D sonar.host.url=http://localhost:9000 -D sonar.scanner.scanAll=false`
- e2e: la cobertura e2e entra por `sonar.javascript.lcov.reportPaths` (ya no rompe el import del lcov JS) y `scripts/generate_sonar_coverage.sh` la genera con `npm run e2e:coverage:sonar` (`SONAR_INCLUDE_E2E_COVERAGE=1` por defecto) y la consolida en `frontend/coverage/frontend/lcov-sonar.info`; tras upgrades de dependencias, `@playwright/test` 1.65.0 exige el build de Chromium 1254 — si no está descargado, todos los specs e2e fallan con `browserType.launch: Executable doesn't exist` (no es regresión de producto): `cd frontend && npx playwright install chromium`

---

## OpenAPI

El contrato se genera automáticamente desde decoradores DRF (`@extend_schema`):

1. Cambiar serializer o endpoint en backend
2. `cd backend && poetry run python ../scripts/create_openapi.py`
3. `cd frontend && npm run api:generate`
4. Adaptar wrappers en `core/api/` si cambió el contrato
5. **No editar** `frontend/src/app/core/api/generated/` manualmente

---

## Apps notables

### CADMA Py (`cadma_py`)

App de scoring de compuestos con wizard de 4 pasos: seleccionar familia de referencia → cargar candidatos (Smile-it, jobs previos o CSV) → configurar fórmula de ranking (pesos, intervalos ADME) → resultados con gráficas y tabla ordenable.

**Backend**: Usa `CadmaReferenceLibrary` como modelo principal para familias de compuestos con trazabilidad (paper, DOI, notas). Las muestras preconstruidas ("neuro", "rett") se definen en `services.py` como `SAMPLE_DEFINITIONS` con `disease_name`, `source_note` etc. El plugin (`plugin.py`) recibe rows de referencia + candidatos y devuelve ranking con score configurable.

**Frontend**: Componente standalone `CadmaPyComponent` con signals para estado del wizard (`activeStep`, `candidatePathway`, `legacyIntervals`). Usa `CadmaPyWorkflowService` que extiende `BaseJobWorkflowService`. El importador CSV (`CadmaPyImporterComponent`) soporta mapeo de columnas, múltiples formatos y preview. Las muestras semilla se muestran como tarjetas (`seed-card`) con preview expandible.

---

## Convenciones de código

- Tipado estricto: sin `Any`, `# type: ignore`, `@ts-ignore` sin justificación
- Manejo de errores: `Result[T, E]` (Ok/Err) para flujo principal
- Comentarios en español, código en inglés
- Archivos: ideal 200-400 líneas, máximo 600
- Funciones: máximo 20-30 líneas, una responsabilidad
- Patrones: ports/adapters, factory, facade, repository, DI
- Frontend: standalone, signals, `@if`/`@for`/`@switch`
- Backend: hexagonal, protocolos en ports, implementaciones en adapters

---

## Puertos y URLs

| Servicio | URL |
|----------|-----|
| Backend API | `http://localhost:8000` |
| Frontend | `http://localhost:4200` |
| SonarQube | `http://localhost:9000` |
| API Schema | `http://localhost:8000/api/schema/` |
| WebSocket | `ws://localhost:8000/ws/jobs/stream/` |
