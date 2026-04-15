"""app_registry.py: Registro global de metadatos para apps científicas.

Este módulo existe para validar, durante el arranque de Django, que cada app
científica registrada en el sistema tenga identidad y rutas únicas.

Cómo se usa desde una app concreta:
1. En el `apps.py` de la app (por ejemplo calculadora), construir una instancia
    `ScientificAppDefinition` con el nombre de configuración, nombre de plugin y
    rutas API.
2. Llamar `ScientificAppRegistry.register(definition)` dentro de `ready()`.
3. Si existe colisión de nombre de plugin o rutas, el sistema falla temprano con
    `ImproperlyConfigured`, evitando errores silenciosos en producción.
"""

from collections.abc import Callable
from dataclasses import dataclass

from django.core.exceptions import ImproperlyConfigured

from .types import JSONMap


@dataclass(frozen=True, slots=True)
class ScientificAppDefinition:
    """Describe metadatos mínimos de una app científica registrada.

    Esta estructura es el contrato entre una app científica y el núcleo `core`.
    Define los campos necesarios para:
    - Resolver colisiones de rutas.
    - Mantener naming consistente entre plugin y endpoints.
    - Facilitar trazabilidad cuando se diagnostican errores de startup.

    `available_features` declara las características opcionales de la app que pueden
    habilitarse o deshabilitarse por grupo vía GroupAppConfig. Permite al frontend
    construir toggles estructurados en el panel de administración de grupos.
    """

    app_config_name: str
    plugin_name: str
    api_route_prefix: str
    api_base_path: str
    route_basename: str
    supports_pause_resume: bool = False
    available_features: tuple[str, ...] = ()

    @property
    def route_key(self) -> str:
        """Retorna la clave de navegación derivada del prefijo API registrado."""
        return self.api_route_prefix.removesuffix("/jobs")


class ScientificAppRegistry:
    """Registry global para validar unicidad de plugins y rutas por app.

    El registro es in-memory y se inicializa durante el arranque de Django.
    No debe usarse como almacenamiento persistente, solo como validación de
    configuración. Su objetivo principal es detectar mala integración entre apps
    antes de que se atiendan requests HTTP.
    """

    _definitions_by_plugin: dict[str, ScientificAppDefinition] = {}
    _definitions_by_route_key: dict[str, ScientificAppDefinition] = {}
    _definitions_by_route_prefix: dict[str, ScientificAppDefinition] = {}
    _definitions_by_api_base_path: dict[str, ScientificAppDefinition] = {}
    _cache_payload_validators_by_plugin: dict[str, Callable[[JSONMap], bool]] = {}

    @classmethod
    def register(cls, definition: ScientificAppDefinition) -> None:
        """Registra una app científica y valida colisiones de configuración.

        Este método debe ejecutarse desde `AppConfig.ready()` de cada app.
        Si la app ya estaba registrada con los mismos datos, la operación es
        idempotente. Si detecta otro origen con los mismos identificadores,
        lanza excepción para forzar corrección inmediata.
        """
        cls._sync_route_key_index()

        cls._validate_unique_plugin(definition)
        cls._validate_unique_route_key(definition)
        cls._validate_unique_route_prefix(definition)
        cls._validate_unique_api_base_path(definition)

        cls._definitions_by_plugin[definition.plugin_name] = definition
        cls._definitions_by_route_prefix[definition.api_route_prefix] = definition
        cls._definitions_by_api_base_path[definition.api_base_path] = definition
        cls._sync_route_key_index()

    @classmethod
    def supports_pause_resume(cls, plugin_name: str) -> bool:
        """Indica si el plugin registrado declara soporte de pausa cooperativa."""
        definition: ScientificAppDefinition | None = cls._definitions_by_plugin.get(
            plugin_name
        )
        if definition is None:
            return False
        return bool(definition.supports_pause_resume)

    @classmethod
    def get_definition_by_plugin(
        cls, plugin_name: str
    ) -> ScientificAppDefinition | None:
        """Obtiene definición de app por nombre de plugin."""
        return cls._definitions_by_plugin.get(plugin_name)

    @classmethod
    def get_definition_by_route_key(
        cls, route_key: str
    ) -> ScientificAppDefinition | None:
        """Obtiene definición de app por clave de ruta de frontend."""
        cls._sync_route_key_index()
        return cls._definitions_by_route_key.get(route_key)

    @classmethod
    def resolve_definition(cls, app_identifier: str) -> ScientificAppDefinition | None:
        """Resuelve una app por plugin_name canónico o por route_key legado."""
        definition = cls.get_definition_by_plugin(app_identifier)
        if definition is not None:
            return definition
        return cls.get_definition_by_route_key(app_identifier)

    @classmethod
    def list_definitions(cls) -> list[ScientificAppDefinition]:
        """Lista definiciones registradas de forma estable para consumo transversal."""
        return sorted(
            cls._definitions_by_plugin.values(),
            key=lambda definition: definition.api_route_prefix,
        )

    @classmethod
    def register_cache_payload_validator(
        cls,
        plugin_name: str,
        validator: Callable[[JSONMap], bool],
    ) -> None:
        """Registra un validador opcional de cache para un plugin específico."""
        cls._cache_payload_validators_by_plugin[plugin_name] = validator

    @classmethod
    def get_cache_payload_validator(
        cls,
        plugin_name: str,
    ) -> Callable[[JSONMap], bool] | None:
        """Obtiene el validador de cache de un plugin, si fue registrado."""
        return cls._cache_payload_validators_by_plugin.get(plugin_name)

    @classmethod
    def _sync_route_key_index(cls) -> None:
        """Reconstruye el índice derivado de route_key desde los prefijos reales.

        Este índice es redundante respecto a `_definitions_by_route_prefix`, por lo que
        se vuelve a generar para evitar estados inconsistentes si algún test o rutina de
        bootstrap limpia parcialmente los diccionarios internos del registry.
        """
        cls._definitions_by_route_key = {
            registered_definition.route_key: registered_definition
            for registered_definition in cls._definitions_by_route_prefix.values()
        }

    @classmethod
    def _validate_unique_plugin(cls, definition: ScientificAppDefinition) -> None:
        existing_definition: ScientificAppDefinition | None = (
            cls._definitions_by_plugin.get(definition.plugin_name)
        )
        if existing_definition is None or existing_definition == definition:
            return

        raise ImproperlyConfigured(
            "Plugin name duplicated during startup: "
            f"'{definition.plugin_name}' in '{definition.app_config_name}' already "
            f"registered by '{existing_definition.app_config_name}'."
        )

    @classmethod
    def _validate_unique_route_key(cls, definition: ScientificAppDefinition) -> None:
        existing_definition: ScientificAppDefinition | None = (
            cls._definitions_by_route_key.get(definition.route_key)
        )
        if existing_definition is None or existing_definition == definition:
            return

        raise ImproperlyConfigured(
            "Route key duplicated during startup: "
            f"'{definition.route_key}' in '{definition.app_config_name}' already "
            f"registered by '{existing_definition.app_config_name}'."
        )

    @classmethod
    def _validate_unique_route_prefix(cls, definition: ScientificAppDefinition) -> None:
        existing_definition: ScientificAppDefinition | None = (
            cls._definitions_by_route_prefix.get(definition.api_route_prefix)
        )
        if existing_definition is None or existing_definition == definition:
            return

        raise ImproperlyConfigured(
            "API route prefix duplicated during startup: "
            f"'{definition.api_route_prefix}' in '{definition.app_config_name}' already "
            f"registered by '{existing_definition.app_config_name}'."
        )

    @classmethod
    def _validate_unique_api_base_path(
        cls, definition: ScientificAppDefinition
    ) -> None:
        existing_definition: ScientificAppDefinition | None = (
            cls._definitions_by_api_base_path.get(definition.api_base_path)
        )
        if existing_definition is None or existing_definition == definition:
            return

        raise ImproperlyConfigured(
            "API base path duplicated during startup: "
            f"'{definition.api_base_path}' in '{definition.app_config_name}' already "
            f"registered by '{existing_definition.app_config_name}'."
        )
