---
applyTo: "backend/apps/**/*.py"
name: "Onboarding de Apps Científicas"
description: "Proceso real para integrar una nueva app científica al core desacoplado de Chemistry Apps"
---

# ONBOARDING DE NUEVA APP CIENTÍFICA

Este archivo complementa las guías de backend y del proyecto. Aquí va el flujo real de integración para este monorepo.

---

## 0. REGLAS ABSOLUTAS

1. La lógica científica vive en la app nueva o en `backend/libs/`, nunca en `apps.core/`.
2. Una app científica no importa otra app científica. Lo compartido se mueve a `backend/libs/`.
3. El plugin recibe JSON serializable y retorna JSON serializable.
4. Si cambia el contrato o el resultado para los mismos inputs, subir `DEFAULT_ALGORITHM_VERSION`.
5. Si cambian serializers o endpoints, regenerar OpenAPI y adaptar wrappers del frontend.
6. Nunca editar `frontend/src/app/core/api/generated/` a mano.
7. No inventar datos químicos, fórmulas ni fixtures que parezcan reales sin serlo.

---

## 1. ESTRUCTURA MÍNIMA ESPERADA

Toda app nueva bajo `backend/apps/<nombre_app>/` debe seguir esta base:

```text
__init__.py
apps.py
definitions.py
types.py
schemas.py
plugin.py
routers.py
contract.py
tests.py
```

Se permiten módulos internos extra cuando la app crece, por ejemplo:

```text
_engine.py
_physics.py
_validators.py
computation/
inspection/
engine/
```

Reglas:

- los archivos públicos de integración son los de la raíz de la app
- los helpers internos usan prefijo `_` o submódulos bien nombrados
- cada archivo debe incluir encabezado corto explicando propósito y forma de uso

---

## 2. IDENTIDAD Y NAMING DE INTEGRACIÓN

En `definitions.py` centralizar la identidad de la app y sus límites:

```python
from typing import Final

APP_CONFIG_NAME: Final[str] = "apps.nombre_app"
APP_ROUTE_PREFIX: Final[str] = "nombre-app/jobs"
APP_ROUTE_BASENAME: Final[str] = "nombre-app-job"
APP_API_BASE_PATH: Final[str] = "/api/nombre-app/jobs/"

PLUGIN_NAME: Final[str] = "nombre-app"
DEFAULT_ALGORITHM_VERSION: Final[str] = "1.0.0"
```

Reglas reales del repo:

- `APP_ROUTE_PREFIX` termina en `/jobs`
- el `route_key` usado por frontend sale de `APP_ROUTE_PREFIX.removesuffix("/jobs")`
- `PLUGIN_NAME` es el identificador canónico del runtime; puede coincidir o no con el route key, pero debe ser estable y único
- preferir kebab-case para nombres públicos de rutas y plugins, alineado con las apps actuales
- si la lógica cambia el resultado para la misma entrada, subir versión para invalidar caché

---

## 3. REGISTRO EN STARTUP

En `apps.py` registrar la app en `ScientificAppRegistry` dentro de `ready()` e importar el módulo `plugin` para activar el decorador de registro.

Patrón recomendado:

```python
from django.apps import AppConfig
from apps.core.app_registry import ScientificAppDefinition, ScientificAppRegistry

from .definitions import (
    APP_API_BASE_PATH,
    APP_CONFIG_NAME,
    APP_ROUTE_BASENAME,
    APP_ROUTE_PREFIX,
    PLUGIN_NAME,
)


class NombreAppConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = APP_CONFIG_NAME

    def ready(self) -> None:
        app_definition = ScientificAppDefinition(
            app_config_name=self.name,
            plugin_name=PLUGIN_NAME,
            api_route_prefix=APP_ROUTE_PREFIX,
            api_base_path=APP_API_BASE_PATH,
            route_basename=APP_ROUTE_BASENAME,
            supports_pause_resume=False,
            available_features=(),
        )
        ScientificAppRegistry.register(app_definition)

        from . import plugin  # noqa: F401
```

Además:

- añadir la app a `INSTALLED_APPS` en `backend/config/settings.py`
- registrar el `ViewSet` en `backend/config/urls.py`
- si hay colisión de plugin o ruta, Django debe fallar en startup: eso es correcto

---

## 4. TIPOS Y CONTRATOS

En `types.py` definir el contrato real de la app con `TypedDict`, alias y tipos concretos.

Orden recomendado:

1. aliases de dominio
2. input validado
3. metadata de trazabilidad
4. result serializable

Reglas obligatorias:

- no usar `Any`
- tipar explícitamente listas, dicts y callbacks
- usar `JSONMap` solo cuando la forma sea verdaderamente dinámica
- el resultado final debe ser serializable sin conversión adicional
- `schemas.py` y `plugin.py` deben alinearse con estos tipos

Si cambia la estructura del resultado, actualizar también la versión del algoritmo.

---

## 5. PLUGIN DE DOMINIO

El `plugin.py` implementa la lógica científica pura. No debe importar `Request`, `Response`, ORM ni servicios HTTP.

Responsabilidades del plugin:

- validar y normalizar parámetros
- ejecutar el cálculo científico
- emitir progreso y logs trazables
- retornar un dict JSON serializable

Reglas:

- errores de input → `ValueError` con mensaje claro
- errores inesperados → dejar que el core los capture en `error_trace`
- si el cálculo tiene etapas, emitir progreso creciente hasta `100`
- los logs deben usar una fuente clara y payload pequeño pero útil

Si soporta pausa cooperativa:

- declarar `supports_pause_resume=True` en `apps.py`
- usar `PluginControlCallback`
- lanzar `JobPauseRequested(checkpoint=...)` con checkpoint JSON serializable

Si la app usa archivos de entrada:

- los artefactos se persisten en base de datos mediante el core
- no depender de rutas temporales del sistema como contrato principal
- la reconstrucción y lectura debe ser reproducible

---

## 6. SCHEMAS Y OPENAPI

En `schemas.py` crear:

- serializer de creación
- serializer de parámetros persistidos
- serializer de metadata
- serializer de resultados
- serializer de respuesta completa del job

Reglas:

- el serializer de creación es la primera línea de validación HTTP
- usar `OpenApiExample` con valores realistas
- el serializer de respuesta debe reflejar exactamente el payload real
- no documentar campos que el backend no persiste o no devuelve

Si el request usa archivos, documentar correctamente multipart y restricciones de cantidad/tamaño.

---

## 7. ROUTER REAL DEL REPO

El router debe seguir el patrón actual basado en `ScientificAppViewSetMixin` y `DeclarativeJobAPI`.

Patrón recomendado:

```python
from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.request import Request
from rest_framework.response import Response

from apps.core.base_router import ScientificAppViewSetMixin
from apps.core.declarative_api import DeclarativeJobAPI
from apps.core.models import ScientificJob
from apps.core.tasks import dispatch_scientific_job

from .definitions import DEFAULT_ALGORITHM_VERSION, PLUGIN_NAME
from .schemas import NombreAppJobCreateSerializer, NombreAppJobResponseSerializer


@extend_schema(tags=["NombreApp"])
class NombreAppJobViewSet(ScientificAppViewSetMixin, viewsets.ViewSet):
    plugin_name = PLUGIN_NAME
    response_serializer_class = NombreAppJobResponseSerializer
    queryset = ScientificJob.objects.filter(plugin_name=PLUGIN_NAME)
    lookup_field = "id"

    def create(self, request: Request) -> Response:
        serializer = NombreAppJobCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        owner_id, group_id = self.resolve_actor_job_scope(request)
        submit_result = DeclarativeJobAPI(
            dispatch_callback=dispatch_scientific_job,
        ).submit_job(
            plugin=PLUGIN_NAME,
            version=DEFAULT_ALGORITHM_VERSION,
            parameters=serializer.validated_data,
            owner_id=owner_id,
            group_id=group_id,
        ).run()

        return self.handle_submit_result(
            submit_result,
            NombreAppJobResponseSerializer,
        )

    def build_csv_content(self, job: ScientificJob) -> str:
        return "col1,col2\nvalue1,value2\n"
```

Reglas de router:

- heredar de `ScientificAppViewSetMixin`
- implementar solo `create()` y `build_csv_content()` cuando sea posible
- usar `handle_submit_result()` para mantener el mismo comportamiento HTTP que el resto del repo
- no meter lógica científica en el router
- `retrieve`, `report-csv`, `report-log` y `report-error` se heredan del mixin

Para apps con uploads:

- usar los helpers del mixin para persistir artefactos y luego despachar
- no perder la trazabilidad del job aunque falle la persistencia del archivo

---

## 8. CONTRATO DECLARATIVO

En `contract.py` exponer `get_<nombre>_contract()`.

En este repo, el patrón actual es retornar un `dict` simple con:

- `plugin_name`
- `version`
- `supports_pause_resume`
- `input_type`
- `result_type`
- `metadata_type`
- `validate_input`
- `execute`
- `description`

La validación del contrato debe seguir el mismo builder o serializer usado por la app real.

---

## 9. CONEXIÓN CON EL FRONTEND

Si la app tendrá interfaz de usuario, además del backend hay que integrarla en Angular:

1. añadirla a `frontend/src/app/core/shared/scientific-apps.config.ts`
2. añadir la ruta lazy en `frontend/src/app/app.routes.ts`
3. crear el componente standalone de la app
4. usar wrappers o workflows de `core/api/` y `core/application/`
5. nunca llamar directamente desde el componente al cliente dentro de `generated/`

Reglas:

- `key` del frontend debe coincidir con la ruta navegable
- `pluginName` debe apuntar al plugin real del backend
- usar `authGuard` y `appAccessGuard` para apps científicas protegidas
- todo el texto visible debe estar en inglés

Si la capacidad es solo backend o interna, puede no aparecer en menús, pero el contrato debe seguir siendo coherente.

---

## 10. PRUEBAS OBLIGATORIAS

Cubrir al menos:

### Plugin

- payload válido
- payload inválido
- estructura del resultado
- eventos de progreso
- logs emitidos
- casos límite científicos

### Router

- creación exitosa
- validación 400
- retrieve 200
- reportes 200 o 409 según el estado del job
- permisos/visibilidad si aplica

### Si soporta pausa o archivos

- pausa y reanudación con checkpoint serializable
- persistencia y reconstrucción de artefactos
- fallos de archivo con mensaje claro y trazabilidad preservada

No escribir tests triviales. Verificar comportamiento observable y contratos reales.

---

## 11. VERIFICACIÓN OBLIGATORIA ANTES DE CERRAR

Ejecutar en este orden:

```bash
cd backend && poetry run python manage.py check && echo listo
cd backend && poetry run python manage.py test apps.<nombre_app> apps.core --verbosity=2 && echo listo
cd backend && poetry run python ../scripts/create_openapi.py && echo listo
cd frontend && npm run build && echo listo
```

Si hubo cambios relevantes en frontend, ejecutar también sus pruebas afectadas.

No dar la integración por terminada sin evidencia real de estos checks.

---

## 12. CRITERIO DE ACEPTACIÓN

Una app queda bien integrada cuando:

- registra su `ScientificAppDefinition` sin colisiones
- el plugin aparece en `PluginRegistry`
- el router crea y recupera jobs correctamente
- el resultado es JSON serializable y tipado
- los reportes heredados funcionan para el job correcto
- OpenAPI se genera sin errores
- el frontend compila si la app tiene UI
- no hay `Any`, `# type: ignore` ni `@ts-ignore` injustificados
- la integración respeta RBAC, owner/group y trazabilidad del job

---

## 13. CHECKLIST RÁPIDO

### Backend

- [ ] `definitions.py` completo y coherente con rutas reales
- [ ] `apps.py` registra app y plugin en `ready()`
- [ ] `types.py` modela input, metadata y result
- [ ] `plugin.py` es puro y trazable
- [ ] `schemas.py` documenta el contrato real
- [ ] `routers.py` usa el mixin y la API declarativa del core
- [ ] `contract.py` expone el contrato interno
- [ ] `settings.py` y `urls.py` actualizados
- [ ] tests pasando en la app y en `apps.core`

### Frontend

- [ ] app añadida a la configuración de apps científicas
- [ ] ruta lazy registrada
- [ ] componente standalone integrado
- [ ] wrappers/workflows adaptados sin tocar `generated/`
- [ ] build en verde

> La base de datos de desarrollo es descartable y puede regenerarse si hace falta durante la integración.
