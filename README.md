# Plataforma Científica Modular

Backend Django + frontend Angular para ejecutar trabajos científicos por apps modulares, con contratos estrictos OpenAPI por dominio, ejecución asíncrona y progreso en tiempo real.

## Estado actual del sistema

- Arquitectura por capas: `routers → services → ports/adapters → processing/plugins`.
- Ejecución asíncrona con Celery + Redis; jobs persistidos en SQLite (desarrollo).
- Caché determinista por hash (`job_hash`) para evitar recomputo de resultados idénticos.
- Progreso en tiempo real via SSE (`/api/jobs/{id}/events/`) y snapshot de polling (`/api/jobs/{id}/progress/`).
- OpenAPI-first: el contrato del backend genera automáticamente el cliente Angular.
- App `calculator` soporta: `add`, `sub`, `mul`, `div`, `pow`, `factorial`.

## Rutas del backend

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/calculator/jobs/` | Crea job de calculadora (payload estricto) |
| `GET` | `/api/calculator/jobs/{id}/` | Resultado tipado de calculadora |
| `POST` | `/api/jobs/` | Crea job genérico de core |
| `GET` | `/api/jobs/{id}/` | Estado y resultados genérico |
| `GET` | `/api/jobs/{id}/progress/` | Snapshot de progreso (polling) |
| `GET` | `/api/jobs/{id}/events/` | Stream SSE de progreso en tiempo real |
| `GET` | `/api/schema/` | Contrato OpenAPI YAML |
| `GET` | `/api/docs/` | Swagger UI interactivo |

Frontend (`frontend/src/app/app.routes.ts`):

- `/calculator` — vista principal de calculadora científica.

## Contratos estrictos por app (Calculator)

### Crear job — `POST /api/calculator/jobs/`

Operaciones binarias (`add`, `sub`, `mul`, `div`, `pow`): requieren `a` y `b`.

```json
{ "version": "1.0.0", "op": "add", "a": 5, "b": 3 }
{ "version": "1.0.0", "op": "pow", "a": 2, "b": 10 }
```

Factorial: usa solo `a` (entero ≥ 0); enviar `b` es un error de validación.

```json
{ "version": "1.0.0", "op": "factorial", "a": 7 }
```

### Respuesta del job (resumen)

- `id`, `status` (`pending` | `running` | `completed` | `failed`)
- `cache_hit`, `cache_miss`, `job_hash`
- `progress_percentage` (0–100), `progress_stage`, `progress_message`
- `parameters` tipado (`op`, `a`, `b?`)
- `results` tipado (`final_result`, `metadata`) — `null` mientras ejecuta

### Progreso en tiempo real — SSE

```bash
curl -H "Accept: text/event-stream" http://localhost:8000/api/jobs/{id}/events/
```

Cada evento emite:

```
id: 3
event: job.progress
data: {"job_id":"...","status":"running","progress_percentage":60,"progress_stage":"running","progress_message":"Ejecutando operación","progress_event_index":3,"updated_at":"..."}
```

### Snapshot de progreso (polling) — `GET /api/jobs/{id}/progress/`

```json
{
  "job_id": "...",
  "status": "running",
  "progress_percentage": 60,
  "progress_stage": "running",
  "progress_message": "Ejecutando operación",
  "progress_event_index": 3,
  "updated_at": "2026-03-10T20:01:00Z"
}
```

## Consumo desde frontend

El frontend usa el wrapper **`jobs-api.service.ts`** (no modifica código autogenerado):

```typescript
// Operación binaria
this.jobsApi.dispatchCalculatorJob({ op: 'add', a: 5, b: 3 });

// Potencia
this.jobsApi.dispatchCalculatorJob({ op: 'pow', a: 2, b: 10 });

// Factorial (sin b)
this.jobsApi.dispatchCalculatorJob({ op: 'factorial', a: 7 });

// Progreso en tiempo real (SSE — recomendado)
this.jobsApi.streamJobEvents(jobId).subscribe({ next: snap => ..., complete: () => ... });

// Snapshot puntual (polling — fallback)
this.jobsApi.getJobProgress(jobId).subscribe(snap => ...);

// Polling hasta estado terminal
this.jobsApi.pollJobUntilCompleted(jobId, 1000).subscribe(snap => ...);
```

## Generación de OpenAPI y cliente Angular

Script oficial del proyecto:

```bash
./backend/venv/bin/python scripts/create_openapi.py
```

Qué valida y genera:

1. Activa entorno virtual Python y verifica npm.
2. Genera `backend/openapi/schema.yaml` desde las anotaciones del backend.
3. Genera el cliente Angular en `frontend/src/app/core/api/generated/`.

> **Nunca editar archivos en `generated/` manualmente.** Regenerar siempre con el script.

## Puesta en marcha local

```bash
# 1. Backend — levanta Redis (si no está activo), Celery worker y runserver en paralelo
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python manage.py migrate
python manage.py up

# 2. Frontend (terminal separada)
cd frontend
npm install
npm start                    # http://localhost:4200
```

> `manage.py up` detecta si Redis está corriendo; si no, lo inicia automáticamente (`redis-server` o `valkey-server`).
> Usa `--without-celery` para levantar solo Django sin worker ni Redis.

## Validación rápida

```bash
# Tests backend
cd backend && ./venv/bin/python manage.py test apps.calculator.tests apps.core.tests -v 1

# Tests frontend
cd frontend && NG_CLI_ANALYTICS=false CI=true npm test -- --no-watch

# Build de producción Angular
cd frontend && npm run build
```

## Cómo crear una nueva app científica

Referencia base: `backend/apps/calculator/` (plantilla actual).

1. Crear carpeta de app (ejemplo `backend/apps/simulator/`).
2. Definir tipos estrictos en `types.py`.
3. Definir contratos OpenAPI en `schemas.py` (request/response tipados).
4. Implementar plugin en `plugin.py` y registrar en `PluginRegistry`.
5. Exponer endpoints dedicados en `routers.py` con su propio path (`/api/simulator/jobs/`).
6. Crear `apps.py` con `ready()` para auto-registro del plugin.
7. Registrar la app en `INSTALLED_APPS` (`backend/config/settings.py`).
8. Registrar rutas en `backend/config/urls.py`.
9. Agregar tests de contrato y flujo (`tests.py`).
10. Regenerar OpenAPI + cliente Angular:

```bash
./backend/venv/bin/python scripts/create_openapi.py
```

11. Crear/actualizar wrapper frontend para consumir el nuevo servicio generado.
