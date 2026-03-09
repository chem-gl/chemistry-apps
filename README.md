# Plataforma Científica Modular

Backend Django + frontend Angular para ejecutar trabajos científicos por apps modulares, con contratos estrictos OpenAPI por dominio.

## Estado actual del sistema

- Arquitectura por capas: `routers -> services -> processing/plugins`.
- Ejecución asíncrona con Celery + Redis.
- Caché determinista por hash (`job_hash`) para evitar recomputo.
- OpenAPI-first: los contratos del backend se exportan y el cliente Angular se regenera automáticamente.
- Contrato estricto por app habilitado para `calculator`.

## Rutas principales

Backend (`backend/config/urls.py`):

- `POST /api/calculator/jobs/` crear job de calculadora con payload estricto.
- `GET /api/calculator/jobs/{id}/` consultar estado y resultado estricto de calculadora.
- `POST /api/jobs/` y `GET /api/jobs/{id}/` rutas genéricas de core.
- `GET /api/schema/` contrato OpenAPI.
- `GET /api/docs/` Swagger UI.

Frontend (`frontend/src/app/app.routes.ts`):

- `/calculator` vista principal de calculadora.

## Contratos estrictos por app (Calculator)

Definidos en:

- `backend/apps/calculator/schemas.py`
- `backend/apps/calculator/routers.py`
- `backend/apps/calculator/types.py`

Contrato de creación:

```json
{
	"version": "1.0.0",
	"op": "add",
	"a": 5,
	"b": 3
}
```

Contrato de respuesta (resumen):

- `id`, `status`, `cache_hit`, `cache_miss`
- `parameters` tipado (`op`, `a`, `b`)
- `results` tipado (`final_result`, `metadata`) o `null` cuando aún no termina

## Consumo desde frontend

El frontend consume el contrato autogenerado usando wrapper en:

- `frontend/src/app/core/api/jobs-api.service.ts`

Ese wrapper usa `CalculatorService` generado desde OpenAPI para:

- crear job (`calculatorJobsCreate`)
- consultar job (`calculatorJobsRetrieve`)
- hacer polling hasta `completed` o `failed`

## Generación de OpenAPI y cliente Angular

Script oficial del proyecto:

- `scripts/create_openapi.py`

Qué valida antes de generar:

- entorno virtual de Python activo
- `npm` instalado
- Angular CLI y OpenAPI Generator CLI instalados en `frontend/node_modules`

Qué genera:

- `backend/openapi/schema.yaml`
- cliente Angular en `frontend/src/app/core/api/generated/`

Ejecución recomendada:

```bash
./backend/venv/bin/python scripts/create_openapi.py
```

## Validación rápida

Desde la raíz del repositorio:

```bash
cd backend && ./venv/bin/python manage.py test apps.calculator.tests apps.core.tests -v 1
cd ../frontend && NG_CLI_ANALYTICS=false CI=true npm test -- --no-watch
cd ../frontend && npm run build
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
