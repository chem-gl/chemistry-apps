---
applyTo: "backend/apps/**/*.py"
---

# Manual de Integración de Nueva App Científica

Este manual define el proceso obligatorio para conectar una nueva app científica al backend desacoplado basado en core, plugins y jobs asíncronos.

## 1. Objetivo de la integración

Una app científica nueva debe:

- exponer su lógica de dominio como plugin reutilizable
- publicar endpoints HTTP desacoplados
- usar el ciclo de vida estándar de ScientificJob
- documentarse en OpenAPI con contrato estricto
- quedar cubierta con pruebas de contrato y de ejecución

## 2. Estructura mínima esperada

Crear una carpeta nueva bajo `backend/apps/<nombre_app>/` con exactamente estos archivos:

```
backend/apps/<nombre_app>/
├── __init__.py        # vacío
├── apps.py            # AppConfig: registra app y plugin en startup
├── definitions.py     # Constantes de identidad y dominio
├── types.py           # TypedDicts de entrada, salida y estados intermedios
├── schemas.py         # Serializers DRF alineados con types.py
├── plugin.py          # Función de dominio registrada en PluginRegistry
├── routers.py         # ViewSet HTTP que delega al core
├── contract.py        # Contrato declarativo para registro interno
└── tests.py           # Tests unitarios e integración
```

Cada archivo debe incluir encabezado de módulo con:
- propósito del archivo
- forma de uso (quién lo importa y para qué)
- relación con el flujo de integración del core

Si la app crece (física, engines, sub-módulos), se pueden crear ficheros adicionales con prefijo `_` para internos: `_physics.py`, `_engine.py`, `_validators.py`, etc. La API pública de la app (lo que importan otros módulos) queda en los archivos sin prefijo.

## 3. Paso a paso de conexión

### Paso 1: Definir identidad de app

En `definitions.py` definir todas las constantes de identidad y de dominio de la app:

```python
# definitions.py
APP_CONFIG_NAME = "apps.nombre_app"
APP_ROUTE_PREFIX = "nombre-app"          # prefijo de URL HTTP: /api/nombre-app/
APP_ROUTE_BASENAME = "nombre-app"        # basename del DefaultRouter Django
APP_API_BASE_PATH = "/api/nombre-app/"   # path base para registro en ScientificAppRegistry
PLUGIN_NAME = "nombre_app"               # clave en PluginRegistry (snake_case)
DEFAULT_ALGORITHM_VERSION = "1.0"        # versión para invalidación de caché

# Constantes de dominio propias (límites, modos, valores por defecto)
MAX_INPUT_VALUES = 100
DEFAULT_MODE = "range"
```

Reglas:
- `PLUGIN_NAME` en snake_case y único en todo el sistema. Verificar contra los `PLUGIN_NAME` de las apps existentes.
- `APP_ROUTE_PREFIX` en kebab-case. Debe coincidir con la ruta del router en `config/urls.py`.
- `DEFAULT_ALGORITHM_VERSION` cambia solo cuando la lógica del plugin produce resultados diferentes para los mismos inputs. Un cambio de versión invalida la caché para esa app.

### Paso 2: Registrar app en startup

En `apps.py` crear el `AppConfig` y conectar plugin y registro en `ready()`:

```python
# apps.py
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
    name = APP_CONFIG_NAME

    def ready(self) -> None:
        from . import plugin  # activa @PluginRegistry.register(PLUGIN_NAME)

        ScientificAppRegistry.register(
            ScientificAppDefinition(
                app_config_name=self.name,
                plugin_name=PLUGIN_NAME,
                api_route_prefix=APP_ROUTE_PREFIX,
                api_base_path=APP_API_BASE_PATH,
                route_basename=APP_ROUTE_BASENAME,
                supports_pause_resume=False,  # True si el plugin implementa pausa cooperativa
            )
        )
```

Añadir en `backend/config/settings.py`:
```python
INSTALLED_APPS = [
    ...
    "apps.nombre_app",  # NombreApp
]
```

Añadir en `backend/config/urls.py`:
```python
from apps.nombre_app.routers import NombreAppViewSet
router.register(APP_ROUTE_PREFIX, NombreAppViewSet, basename=APP_ROUTE_BASENAME)
```

El `ScientificAppRegistry` valida en startup que no existan colisiones de `plugin_name`, `api_route_prefix` ni `api_base_path`. Si hay colisión, Django falla con `ImproperlyConfigured` antes de atender ningún request.

### Paso 3: Implementar tipos estrictos

En `types.py` definir los contratos de datos en orden: tipos auxiliares, input, metadata, result. Estos tipos son la fuente de verdad del contrato: `schemas.py` y `plugin.py` deben alinearse con ellos.

```python
# types.py
from typing import TypeAlias
from typing_extensions import TypedDict

from apps.core.types import JSONMap

# Alias para valores enumerados o acotados
NombreAppMode: TypeAlias = str  # "single" | "range"


class NombreAppInput(TypedDict):
    """Parámetros de entrada validados que el plugin recibe como JSONMap."""

    field_one: float
    field_two: list[float]
    mode: NombreAppMode


class NombreAppMetadata(TypedDict):
    """Contexto del cálculo persistido junto al resultado para trazabilidad."""

    mode_used: NombreAppMode
    input_count: int
    computed_at: str


class NombreAppResult(TypedDict):
    """Payload retornado por el plugin y almacenado en ScientificJob.results."""

    values: list[float]
    metadata: NombreAppMetadata
```

Reglas obligatorias:
- No usar `Any`. Si un campo puede ser de tipos mixtos, usar `JSONMap` de `apps.core.types` o un `Union` explícito.
- Tipar explícitamente listas y dicts: `list[float]` no `list`, `dict[str, float]` no `dict`.
- El `NombreAppResult` debe ser directamente serializable a JSON sin conversiones en el plugin.
- Los `TypedDict` son inmutables como contrato: si cambia la estructura del resultado, incrementar `DEFAULT_ALGORITHM_VERSION` en `definitions.py`.

### Paso 4: Implementar plugin desacoplado

En `plugin.py` la función de dominio es pura: sin imports de `Request`, `Response`, modelos Django ni llamadas a `JobService`. Toda interacción con el sistema de trazabilidad ocurre a través de los callbacks.

```python
# plugin.py
import logging

from apps.core.processing import PluginRegistry
from apps.core.types import JSONMap, PluginLogCallback, PluginProgressCallback

from .definitions import PLUGIN_NAME
from .types import NombreAppInput, NombreAppResult

logger = logging.getLogger(__name__)
PLUGIN_LOG_SOURCE = "nombre_app.plugin"


def _build_input(parameters: JSONMap) -> NombreAppInput:
    """Valida y normaliza parámetros de entrada al TypedDict tipado."""
    raw_values = parameters.get("field_two")
    if not isinstance(raw_values, list):
        raise ValueError("field_two debe ser una lista de números.")
    return NombreAppInput(
        field_one=float(parameters["field_one"]),
        field_two=[float(v) for v in raw_values],
        mode=str(parameters.get("mode", "range")),
    )


@PluginRegistry.register(PLUGIN_NAME)
def nombre_app_plugin(
    parameters: JSONMap,
    report_progress: PluginProgressCallback,
    emit_log: PluginLogCallback,
) -> JSONMap:
    """Lógica de dominio de nombre_app. Sin dependencias HTTP ni ORM."""
    report_progress(0, "running", "Iniciando cálculo.")
    emit_log("info", PLUGIN_LOG_SOURCE, "Parámetros recibidos", {"count": len(parameters)})

    validated_input = _build_input(parameters)

    # ... lógica científica ...
    computed_values: list[float] = []

    report_progress(100, "completed", "Cálculo finalizado.")
    result: NombreAppResult = {
        "values": computed_values,
        "metadata": {
            "mode_used": validated_input["mode"],
            "input_count": len(validated_input["field_two"]),
            "computed_at": "...",
        },
    }
    return dict(result)
```

Reglas estrictas:
- Los errores de validación de parámetros lanzan `ValueError` con mensaje descriptivo.
- Los errores inesperados de ejecución burbujean como `RuntimeError` para que el core los capture en `error_trace`.
- El resultado retornado debe ser un dict de primitivos JSON (str, int, float, bool, list, dict). Sin objetos Python no serializables.
- Los helpers internos tienen prefijo `_` para dejar claro que no son parte de la API pública del módulo.
- Si el cálculo tiene múltiples etapas, emitir progreso en cada transición con porcentaje creciente.

**Si el plugin soporta pausa cooperativa** (requiere `supports_pause_resume=True` en `apps.py`):

```python
from apps.core.exceptions import JobPauseRequested
from apps.core.types import PluginControlCallback

@PluginRegistry.register(PLUGIN_NAME)
def nombre_app_plugin(
    parameters: JSONMap,
    report_progress: PluginProgressCallback,
    emit_log: PluginLogCallback,
    request_control_action: PluginControlCallback,
) -> JSONMap:
    # Antes de cada operación costosa, consultar la señal de control:
    if request_control_action() == "pause":
        raise JobPauseRequested(
            checkpoint={"processed_so_far": current_list, "index": current_index}
        )
```

El checkpoint debe contener únicamente primitivos JSON. `RuntimeJobService` lo persiste en `runtime_state` del job y lo inyecta en `parameters` al reanudar.

### Paso 5: Definir contrato OpenAPI por app

En `schemas.py` crear los serializers DRF alineados con `types.py`. El contrato define qué acepta la API de creación y qué devuelve el endpoint de resultado.

```python
# schemas.py
from drf_spectacular.utils import OpenApiExample, extend_schema_serializer
from rest_framework import serializers


@extend_schema_serializer(
    examples=[
        OpenApiExample(
            "Ejemplo válido",
            value={"field_one": 7.4, "field_two": [4.1, 9.3], "mode": "range"},
        )
    ]
)
class NombreAppJobCreateSerializer(serializers.Serializer):
    """Serializer de creación: valida el payload HTTP antes de llegar al plugin."""

    field_one = serializers.FloatField(help_text="Descripción del campo.")
    field_two = serializers.ListField(
        child=serializers.FloatField(),
        min_length=1,
        help_text="Lista de valores de entrada.",
    )
    mode = serializers.ChoiceField(
        choices=["single", "range"],
        default="range",
        help_text="Modo de cálculo.",
    )


class NombreAppParametersSerializer(serializers.Serializer):
    """Serializer de parámetros persistidos: representa ScientificJob.parameters."""

    field_one = serializers.FloatField()
    field_two = serializers.ListField(child=serializers.FloatField())
    mode = serializers.CharField()


class NombreAppMetadataSerializer(serializers.Serializer):
    """Serializer de metadatos del resultado."""

    mode_used = serializers.CharField()
    input_count = serializers.IntegerField()
    computed_at = serializers.CharField()


class NombreAppResultSerializer(serializers.Serializer):
    """Serializer del payload de resultados: representa ScientificJob.results."""

    values = serializers.ListField(child=serializers.FloatField())
    metadata = NombreAppMetadataSerializer()


class NombreAppJobResponseSerializer(serializers.Serializer):
    """Serializer de respuesta completa del job para el endpoint de retrieve."""

    id = serializers.UUIDField()
    status = serializers.CharField()
    plugin_name = serializers.CharField()
    parameters = NombreAppParametersSerializer()
    results = NombreAppResultSerializer(allow_null=True)
    progress_percentage = serializers.IntegerField()
    progress_message = serializers.CharField()
```

Reglas:
- El serializer de creación (`JobCreateSerializer`) es la primera línea de validación. Si falla, el router devuelve 400 antes de tocar el servicio.
- El serializer de respuesta debe reflejar exactamente la estructura del `NombreAppResult` en `types.py`.
- Usar `OpenApiExample` con valores realistas, no con datos genéricos. Esto mejora significativamente la documentación generada.
- No incluir campos que no estén en `types.py` ni en el modelo `ScientificJob`.

### Paso 6: Exponer router dedicado

En `routers.py` el `ViewSet` hereda de `ScientificAppViewSetMixin` para obtener los endpoints comunes (`retrieve`, `report-csv`, `report-log`, `report-error`) sin duplicar código. Solo implementa `create()` y `build_csv_content()`:

```python
# routers.py
from drf_spectacular.utils import extend_schema
from rest_framework import status, viewsets
from rest_framework.request import Request
from rest_framework.response import Response

from apps.core.base_router import ScientificAppViewSetMixin
from apps.core.services import JobService
from apps.core.tasks import dispatch_scientific_job

from .definitions import DEFAULT_ALGORITHM_VERSION, PLUGIN_NAME
from .schemas import NombreAppJobCreateSerializer, NombreAppJobResponseSerializer


@extend_schema(tags=["NombreApp"])
class NombreAppViewSet(ScientificAppViewSetMixin, viewsets.ViewSet):
    plugin_name = PLUGIN_NAME
    response_serializer_class = NombreAppJobResponseSerializer

    @extend_schema(
        summary="Crear job de NombreApp",
        request=NombreAppJobCreateSerializer,
        responses={202: NombreAppJobResponseSerializer},
    )
    def create(self, request: Request) -> Response:
        serializer = NombreAppJobCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        job = JobService.create_job(
            plugin_name=PLUGIN_NAME,
            version=DEFAULT_ALGORITHM_VERSION,
            parameters=serializer.validated_data,
        )
        was_dispatched = dispatch_scientific_job(str(job.id))
        JobService.register_dispatch_result(str(job.id), was_dispatched)

        response_serializer = NombreAppJobResponseSerializer(job)
        return Response(response_serializer.data, status=status.HTTP_202_ACCEPTED)

    def build_csv_content(self, job: object) -> str:
        """Genera contenido CSV a partir del resultado del job para report-csv."""
        # Acceder a job.results y construir el CSV como string
        return "col1,col2\nval1,val2\n"
```

Reglas de routers:
- El router no contiene lógica científica. Solo valida, delega y responde.
- `create()` siempre: valida con serializer → crea job → intenta encolar → registra resultado de dispatch → devuelve 202.
- El código de respuesta de creación es 202 (Accepted), no 200 ni 201, porque el job puede no estar completado aún.
- `build_csv_content` se usa solo para la acción `report-csv` heredada del mixin.

### Paso 6.1: Endpoints adicionales sin trazabilidad

Algunas apps necesitan endpoints auxiliares que no crean un `ScientificJob` nuevo ni forman parte del ciclo de vida de ejecución. Ejemplos válidos:

- `report-csv`
- `report-log`
- `report-error`
- descargas o vistas derivadas a partir de `results`, `parameters`, `error_trace` o logs ya persistidos

Reglas obligatorias para estos endpoints:

- exponerlos como acciones adicionales del `ViewSet` de la app cuando dependen de un job existente
- no llamar `dispatch_scientific_job`
- no cambiar `status`, `progress`, `runtime_state` ni otra trazabilidad del job
- validar precondiciones de negocio y responder `409` cuando el estado del job no permita la operación
- documentarlos con `extend_schema`; usar `OpenApiTypes.BINARY` si retornan archivos descargables
- devolver `Content-Type` y `Content-Disposition` consistentes para consumo por frontend o clientes externos

Patrón recomendado:

1. resolver el job filtrando por `plugin_name`
2. validar si el endpoint aplica al estado actual
3. construir el contenido derivado en una función auxiliar o helper compartido
4. retornar `HttpResponse` descargable sin crear un nuevo job

Buenas prácticas:

- reutilizar helpers compartidos del core cuando exista un patrón transversal de reportes
- mantener la transformación de contenido fuera de la acción HTTP cuando la lógica crezca
- cubrir pruebas de `200`, `404`, `409`, `Content-Type`, `Content-Disposition` y contenido esperado

### Paso 7: Publicar contrato declarativo

En `contract.py` exponer la función `get_<nombre>_contract()` que describe completamente la app para integración programatíca:

```python
# contract.py
from dataclasses import dataclass
from typing import Any

from apps.core.types import JSONMap

from .definitions import DEFAULT_ALGORITHM_VERSION, PLUGIN_NAME
from .plugin import nombre_app_plugin
from .schemas import NombreAppJobCreateSerializer
from .types import NombreAppInput, NombreAppMetadata, NombreAppResult


@dataclass(frozen=True)
class NombreAppContract:
    plugin_name: str
    version: str
    supports_pause_resume: bool
    input_type: type
    result_type: type
    metadata_type: type
    execute: Any
    validate_input: Any


def get_nombre_app_contract() -> NombreAppContract:
    """Retorna el contrato declarativo de NombreApp para registro interno."""
    return NombreAppContract(
        plugin_name=PLUGIN_NAME,
        version=DEFAULT_ALGORITHM_VERSION,
        supports_pause_resume=False,
        input_type=NombreAppInput,
        result_type=NombreAppResult,
        metadata_type=NombreAppMetadata,
        execute=nombre_app_plugin,
        validate_input=lambda parameters: NombreAppJobCreateSerializer(
            data=parameters
        ).is_valid(raise_exception=True),
    )
```

El contrato declarativo permite que el sistema pueda introspectar la app sin instanciarla ni hacer requests HTTP. Es especialmente útil para herramientas de generación automática de contratos y para pruebas de consistencia entre `types.py` y `schemas.py`.

### Paso 8: Conectar rutas y settings

Actualizar dos archivos en `backend/config/`:

**`settings.py`** — añadir el `AppConfig` al final de `INSTALLED_APPS`:
```python
INSTALLED_APPS = [
    # ... apps existentes ...
    "apps.nombre_app",  # NombreApp: [descripción breve de la capacidad]
]
```

**`urls.py`** — importar e incluir en el `DefaultRouter`:
```python
from apps.nombre_app.definitions import APP_ROUTE_BASENAME, APP_ROUTE_PREFIX
from apps.nombre_app.routers import NombreAppViewSet

router.register(APP_ROUTE_PREFIX, NombreAppViewSet, basename=APP_ROUTE_BASENAME)
```

Verificar que no hay colisiones ejecutando `./venv/bin/python manage.py check`.

### Paso 9: Pruebas obligatorias

En `tests.py` cubrir los escenarios mínimos con tests nombrados descriptivamente:

```python
# tests.py
from django.test import TestCase
from apps.core.models import ScientificJob
from apps.core.types import JSONMap

VALID_PAYLOAD: JSONMap = {"field_one": 7.4, "field_two": [4.1, 9.3], "mode": "range"}


class NombreAppRouterTest(TestCase):
    # Verifica que un payload válido crea un job en estado pending y devuelve 202
    def test_create_with_valid_payload_returns_202_and_job_is_pending(self) -> None:
        response = self.client.post("/api/nombre-app/", VALID_PAYLOAD, content_type="application/json")
        self.assertEqual(response.status_code, 202)
        job = ScientificJob.objects.get(id=response.data["id"])
        self.assertIn(job.status, ["pending", "completed"])

    # Verifica que un payload sin campo obligatorio devuelve 400 con mensaje de error
    def test_create_without_required_field_returns_400(self) -> None:
        response = self.client.post("/api/nombre-app/", {}, content_type="application/json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("field_one", response.data)

    # Verifica que retrieve devuelve el job con su estructura completa
    def test_retrieve_existing_job_returns_200_with_job_structure(self) -> None:
        create_response = self.client.post("/api/nombre-app/", VALID_PAYLOAD, content_type="application/json")
        job_id = create_response.data["id"]
        response = self.client.get(f"/api/nombre-app/{job_id}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(str(response.data["id"]), job_id)


class NombreAppPluginTest(TestCase):
    # Verifica que el plugin ejecutado directamente retorna la estructura correcta
    def test_plugin_returns_result_with_expected_structure(self) -> None:
        from apps.nombre_app.plugin import nombre_app_plugin

        progress_events: list = []
        log_events: list = []

        result = nombre_app_plugin(
            VALID_PAYLOAD,
            lambda pct, stage, msg: progress_events.append((pct, stage)),
            lambda lvl, src, msg, payload=None: log_events.append((lvl, msg)),
        )

        # El resultado debe tener la estructura definida en NombreAppResult
        self.assertIn("values", result)
        self.assertIn("metadata", result)
        self.assertIsInstance(result["values"], list)

    # Verifica que un input inválido en el plugin lanza ValueError con mensaje claro
    def test_plugin_raises_value_error_for_invalid_input(self) -> None:
        from apps.nombre_app.plugin import nombre_app_plugin

        with self.assertRaises(ValueError):
            nombre_app_plugin(
                {"field_one": "no_es_numero", "field_two": []},
                lambda *a: None,
                lambda *a: None,
            )

    # Verifica que el progreso se emite correctamente durante la ejecución
    def test_plugin_emits_progress_events(self) -> None:
        from apps.nombre_app.plugin import nombre_app_plugin

        progress_events: list = []
        nombre_app_plugin(
            VALID_PAYLOAD,
            lambda pct, stage, msg: progress_events.append(pct),
            lambda *a: None,
        )

        # Debe emitir al menos el evento de inicio y el de completado
        self.assertGreaterEqual(len(progress_events), 2)
        self.assertEqual(progress_events[-1], 100)
```

Pruebas adicionales si aplica:
- `test_pause_resume`: verifica que `JobPauseRequested` se lanza con checkpoint serializable y que al reanudar el resultado final es correcto.
- `test_report_csv_returns_200_with_csv_content_type`: verifica el endpoint de descarga con `Content-Type: text/csv`.
- `test_report_csv_on_pending_job_returns_409`: verifica que no se puede descargar reporte de un job sin completar.

## 4. Verificación técnica obligatoria

Antes de dar la integración por terminada, ejecutar en orden:

**1. Verificar configuración Django sin errores**:
```bash
cd backend && ./venv/bin/python manage.py check && echo listo
```

**2. Tests de la app nueva**:
```bash
cd backend && ./venv/bin/python manage.py test apps.<nombre_app> --verbosity=2 && echo listo
```

**3. Tests del core para detectar regresiones**:
```bash
cd backend && ./venv/bin/python manage.py test apps.core --verbosity=2 && echo listo
```

**4. Regenerar contrato OpenAPI y cliente frontend**:
```bash
source backend/venv/bin/activate
python scripts/create_openapi.py && echo listo
```
Este paso es crítico. Verifica que:
- Los serializers generan un schema OpenAPI válido sin errores de tipado.
- El cliente TypeScript se regenera correctamente en `frontend/src/app/core/api/generated/`.
- Los tipos de la nueva app quedan disponibles para uso en wrappers del frontend.

**5. Verificar que el frontend compila sin errores**:
```bash
cd frontend && npm run build && echo listo
```

**6. Verificar que los tests del frontend pasan**:
```bash
cd frontend && npm test && echo listo
```

Cualquier error en alguno de estos pasos indica un problema de integración que debe resolverse antes de considerar la app como integrada.

## 5. Criterios de aceptación

Una app nueva se considera completamente integrada cuando:

- Se registra en startup sin colisiones (`manage.py check` pasa limpio).
- El endpoint de creación devuelve 202 con el job creado.
- El endpoint de retrieve devuelve el resultado cuando el job está completado.
- Los tests del plugin ejecutan la lógica científica directamente y verifican la estructura del resultado.
- Los tests de router cubren payload válido, payload inválido y retrieve.
- El schema OpenAPI se genera sin errores y los tipos están correctamente documentados.
- El cliente TypeScript se regenera sin errores de compilación.
- El frontend compila con `npm run build` sin errores ni advertencias de tipo.
- Tipado estricto: sin `Any`, sin `# type: ignore`, sin `@ts-ignore` injustificados.
- Los logs emitidos por el plugin aparecen en el endpoint de logs del job.

## 6. Checklist final

**Backend**:
- [ ] `definitions.py`: `PLUGIN_NAME`, `APP_ROUTE_PREFIX`, `APP_API_BASE_PATH`, `APP_ROUTE_BASENAME`, `DEFAULT_ALGORITHM_VERSION` definidos y sin colisiones.
- [ ] `apps.py`: `AppConfig.ready()` importa el módulo `plugin` y registra `ScientificAppDefinition`.
- [ ] `types.py`: `TypedDict` de input, metadata y result sin uso de `Any`. Colecciones tipadas explícitamente.
- [ ] `plugin.py`: función registrada con `@PluginRegistry.register(PLUGIN_NAME)`. Sin dependencias HTTP ni ORM. Retorna dict serializable.
- [ ] `schemas.py`: serializers alineados con `types.py`. `OpenApiExample` con datos realistas.
- [ ] `routers.py`: `create()` valida → crea job → despacha → registra resultado → devuelve 202.
- [ ] `contract.py`: `get_<nombre>_contract()` expuesta y coherente con `types.py` y `plugin.py`.
- [ ] `settings.py`: `AppConfig` incluido en `INSTALLED_APPS`.
- [ ] `urls.py`: `ViewSet` registrado en `DefaultRouter`.
- [ ] `tests.py`: tests de creación, retrieve, payload inválido, ejecución de plugin y progreso.
- [ ] `manage.py check` pasa sin errores.
- [ ] `manage.py test apps.<nombre_app> apps.core` pasa en verde.

**OpenAPI y frontend**:
- [ ] `python scripts/create_openapi.py` termina sin errores.
- [ ] `frontend/src/app/core/api/generated/` regenerado y commiteable.
- [ ] `npm run build` pasa sin errores ni advertencias de tipo.
- [ ] App añadida a `scientific-apps.config.ts` con `key`, `title`, `description` y `visibleInMenus`.
- [ ] Ruta añadida en `app.routes.ts` con lazy loading al componente standalone.
