# Apps libres (sin login) — Fase 1: plan de ejecución técnico

Rama de trabajo: `refactor/local-first` (desde `dev`). `main` y el deploy `plata` no se tocan.
Fuente de requisitos: memos `#apps-chemistry #apps-libres #plan` [1/5]..[5/5].

## 1. Alcance

- 7 apps anónimas: `molar-fractions`, `tunnel-effect`, `easy-rate`, `marcus-kinetics`,
  `smileit`, `sa-score`, `toxicity-properties`.
- `cadma-py` sigue con login (sin cambios).
- Fase 1: el cálculo sigue en el backend; el navegador solo persiste resultados en
  `localStorage`. La fase 2 (cálculo local) queda fuera.

## 2. Estado verificado (2026-09-23)

| Punto | Estado |
|---|---|
| `git` | rama `dev` limpia; ramas solo `dev`/`main`; rama `refactor/local-first` creada |
| Backend | Django 6 / DRF 3.18.1 / Celery 5.6.3 / `djangorestframework-simplejwt` 5.5.1 |
| Permiso global | `DEFAULT_PERMISSION_CLASSES = AllowAny` (punto a cerrar) |
| Throttling | no configurado (`REST_FRAMEWORK` sin `DEFAULT_THROTTLE_*`) |
| `ScientificJob.owner` | ya `null=True` (sirve para jobs anónimos) |
| TTL/TTL purge | no existe `expires_at` en `ScientificJob`; beat solo purga artefactos |
| Migraciones core | `0001_initial`, `0002_self_registration_token` |
| `declarative_api.submit_job(owner_id=None, group_id=None)` | ya soporta job sin dueño |
| DNS | `apps-libres.guzman-lopez.com` resuelve correcto |
| TLS | **no**: Nginx sirve cert de `addit.guzman-lopez.com` (expirado 2026-08-18) |
| Frontend | guards `authGuard`+`appAccessGuard` en las 7 apps; i18n en 8 idiomas |

## 3. Contrato de endpoints públicos (nuevos)

Namespace `/api/public/` con las **únicas** rutas anónimas. Por app:

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/public/<app>/jobs/` | Crea job anónimo (sin dueño) y despacha |
| `GET` | `/api/public/<app>/jobs/<uuid>/` | Consulta estado/resultado del propio job |
| `GET` | `/api/public/<app>/jobs/<uuid>/report-csv/` | CSV (solo `completed`) |
| `GET` | `/api/public/catalog/` | Apps disponibles en modo libre + aviso de privacidad |

Slugs públicos: los mismos `APP_ROUTE_PREFIX` sin `/jobs`, bajo `public/`.

Reglas de acceso:

1. `POST` nunca asocia `owner`/`group` (job anónimo).
2. `GET` por UUID solo devuelve jobs **anónimos** (`owner is null`) del plugin correcto.
   Es una *capability URL*: el UUID es el secreto. Nunca listados ni filtros.
3. Sin `pause`/`resume`/`cancel`/`trash`/logs para anónimos. Reintentar = nuevo `POST`.
4. Todo lo demás del API pasa a `IsAuthenticated` por defecto (rutas públicas explícitas).

## 4. Backend — cambios por archivo

| Archivo | Cambio |
|---|---|
| `config/settings.py` | `DEFAULT_PERMISSION_CLASSES = IsAuthenticated`; `DEFAULT_THROTTLE_CLASSES`/`RATES`; TTLs y límites por env |
| `apps/core/models.py` | `ScientificJob.expires_at` (null) + índice; property `is_anonymous` |
| `apps/core/migrations/0003_*.py` | migración del campo/índice |
| `apps/core/public_api/` (nuevo) | mixins/vistas públicas + política de acceso (`owner is null`) |
| `apps/core/throttling.py` (nuevo) | throttles por scope (anónimo por IP, registrado por usuario) + concurrencia por IP |
| `apps/core/anonymous.py` (nuevo) | constantes y helpers de expiración/purga |
| `apps/core/tasks.py` | `purge_expired_anonymous_jobs` (+ entrada en beat) |
| `apps/core/artifacts.py` | tope de tamaño de subida (10 MB anón / 50 MB registrado) → 413 |
| `apps/core/schemas.py` | límite de tamaño de `parameters` (256 KB) → 413/400 |
| `apps/core/routers/*` | cerrar huecos: `list`/`retrieve`/control/stream exigen autenticación |
| `apps/<app>/routers.py` | ViewSet público por app (simple: `create`+`retrieve`; con archivos: multipart) |
| `config/urls.py` | registrar router `public/` |
| `config/celery.py` | ruteo de cola `heavy` para `toxicity-properties` |

## 5. Frontend — cambios por archivo

| Archivo | Cambio |
|---|---|
| `core/shared/local-results.store.ts` (nuevo) | persistencia `localStorage` versionada, FIFO 20 por app |
| `core/api/jobs-api.service.ts` | métodos públicos (dispatch/consulta/reporte) sin token |
| `core/application/*.workflow.service.ts` (7) | usar endpoints anónimos + registrar resultado local |
| `app.routes.ts` | quitar `authGuard`/`appAccessGuard` de las 7 apps |
| `core/i18n/*.json` (8) | textos de modo libre, aviso de privacidad, expiración 24 h, 429/413 |
| página principal | apps visibles sin login + login como opción de registro |

## 6. Infraestructura

1. Compose aislado (BD/Redis/volúmenes/puertos propios) para el subdominio.
2. Nginx del host + `certbot --nginx -d apps-libres.guzman-lopez.com -d back-apps-libres.guzman-lopez.com`.
3. Variables propias: hosts, CORS/CSRF, TTLs, límites, nombre de cola `heavy`.
4. Worker `heavy` con concurrencia 2 para toxicity.
5. Rollback: bajar el compose del subdominio (nada que revertir en `plata`).

## 7. Orden de ejecución y gates

| Paso | Contenido | Gate |
|---|---|---|
| 1 | Fundamentos anónimos: `expires_at`, purga, política de acceso | tests nuevos en verde + suite core |
| 2 | Endpoints públicos por app + throttling + cierre de `AllowAny` | suite backend completa en verde |
| 3 | Topes de tamaño (params/archivos) y errores 429/413 | tests de límites |
| 4 | Frontend: capa local + 7 apps + i18n | tests frontend + build |
| 5 | Infra: compose aislado + SSL + deploy | smoke HTTP 200 con cert correcto |
| 6 | Carga ligera + Sonar + docs | p95 < 2x, 0 5xx, 429 verificado, gate OK |

## 8. Riesgos y decisiones abiertas

- **Cert TLS del subdominio**: bloquea el paso 5; requiere acceso al host.
- **Concurrencia por IP**: DRF no la cubre; se implementa con cache Redis + TTL.
- **`AllowAny` global**: al cerrarlo pueden romperse tests que hoy llaman sin auth;
  se mitiga con las rutas públicas y `force_authenticate` en tests de rutas privadas.
- **Cola `heavy`**: requiere worker propio en el compose aislado; sin él, toxicity
  se degrada a la cola default.

## 9. Progreso de ejecución

### Paso 1 — COMPLETADO (tests: 19 nuevos, core 535 en verde)

| Archivo | Cambio |
|---|---|
| `apps/core/anonymous.py` (nuevo) | TTL configurable, helpers de política, purga por lotes |
| `apps/core/models.py` | `ScientificJob.expires_at` + índice + property `is_anonymous` |
| `apps/core/migrations/0003_scientific_job_expires_at.py` | campo + índice |
| `apps/core/services/runtime.py` | `expires_at` en ambos `create` (caché y pendiente) |
| `apps/core/tasks.py` | tarea `purge_expired_anonymous_jobs` |
| `config/settings.py` | `ANONYMOUS_JOB_TTL_HOURS=24`, `SHARED_CACHE_TTL_DAYS=7`, entrada beat |
| `apps/core/tests/test_anonymous_jobs.py` (nuevo) | 19 tests |

### Paso 2a — COMPLETADO (tests: 14 nuevos, suite backend 1049 en verde)

| Archivo | Cambio |
|---|---|
| `apps/core/public_api.py` (nuevo) | `PublicAppViewSetMixin`: jobs sin dueño, capability URL, allowlist de acciones |
| `apps/core/throttling.py` (nuevo) | `AnonymousDispatchRateThrottle` / `RegisteredDispatchRateThrottle` |
| `apps/core/uuid_utils.py` (nuevo) | UUID inválido → 404 (antes 500) |
| `config/public_urls.py` (nuevo) | 7 ViewSets públicos + router `public/` |
| `config/urls.py` | registra rutas públicas |
| `config/settings.py` | `DEFAULT_THROTTLE_RATES` por entorno + `NUM_PROXIES` |
| `apps/core/base_router.py` | UUID inválido → 404; `retrieve` sin cambios de contrato |
| `apps/smileit/routers/viewset_read.py` | `_get_scoped_job_or_404` delega en el hook base (corrige fuga en modo público) |
| `apps/core/tests/test_public_api.py` (nuevo) | 14 tests |

Rutas públicas resultantes (3 por app, 21 en total): `POST jobs/`, `GET jobs/<uuid>/`,
`GET jobs/<uuid>/report-csv/`. Sin listados, logs, papelera ni acciones de app.

### Paso 2b — COMPLETADO (API cerrado + streaming autenticado)

| Archivo | Cambio |
|---|---|
| `config/settings.py` | `DEFAULT_PERMISSION_CLASSES = IsAuthenticated`; `QueryStringJWTAuthentication` como 3er método de auth |
| `apps/core/identity/routers.py` | `AllowAny` explícito en login y refresh (públicas, igual que registro) |
| `apps/core/routers/viewset.py` | `permission_classes = [IsAuthenticated]` explícito en `JobViewSet` |
| `apps/core/base_router.py` | `permission_classes = [IsAuthenticated]` explícito en `ScientificAppViewSetMixin` |
| `apps/core/identity/authentication.py` (nuevo) | `QueryStringJWTAuthentication`: acepta `?token=<jwt>` (EventSource/WebSocket no admiten cabeceras) |
| `apps/core/identity/ws_auth.py` (nuevo) | `JWTAuthMiddleware`: resuelve `scope["user"]` desde el token del query string |
| `config/asgi.py` | `AuthMiddlewareStack(JWTAuthMiddleware(URLRouter(...)))` |
| `apps/core/consumers.py` | WS exige autenticación (4401), valida alcance (job visible / plugin / global solo root-admin → 4403, job inexistente → 4404) y filtra el snapshot por visibilidad del actor |
| `apps/core/test_utils.py` | `build_authenticated_api_client()`; `ScientificJobTestMixin` autentica por defecto |
| 15 módulos de tests | Cliente autenticado (superusuario) en tests de rutas privadas |
| `apps/core/tests/test_stream_auth.py` (nuevo) | 11 tests (query-token HTTP + reglas del consumer WS) |
| `frontend/.../jobs-streaming-api.service.ts` | Adjunta `?token=` a SSE y a `WebSocket` (+1 test) |

**Decisión abierta**: el catálogo Smile-it (sustituyentes/categorías/patrones) dejó
de ser anónimo. Si la UI anónima necesita esos datos, hay que exponer un endpoint
público de referencia de solo lectura (la superficie pública hoy solo tiene
create/retrieve/report-csv).

### Pasos pendientes

- Throttle de despachos registrados (`RegisteredDispatchRateThrottle` aún sin uso).
- Topes de tamaño: parámetros 256 KB; archivos 10 MB anónimo / 50 MB registrado → 413.
- `/api/public/catalog/` con apps disponibles + aviso de privacidad.
- Concurrencia por IP (leases atómicos en Redis, liberados al terminar el job).
- Cola `heavy` para toxicity.
- Frontend: capa `localStorage` FIFO-20, 7 apps sin guards, i18n (8 idiomas).
- Infra: compose aislado + SSL del subdominio (bloqueado por acceso al host).

