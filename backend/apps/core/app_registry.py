"""app_registry.py: Registro global de metadatos para apps científicas."""

from dataclasses import dataclass

from django.core.exceptions import ImproperlyConfigured


@dataclass(frozen=True, slots=True)
class ScientificAppDefinition:
    """Describe metadatos mínimos de una app científica registrada."""

    app_config_name: str
    plugin_name: str
    api_route_prefix: str
    api_base_path: str
    route_basename: str


class ScientificAppRegistry:
    """Registry global para validar unicidad de plugins y rutas por app."""

    _definitions_by_plugin: dict[str, ScientificAppDefinition] = {}
    _definitions_by_route_prefix: dict[str, ScientificAppDefinition] = {}
    _definitions_by_api_base_path: dict[str, ScientificAppDefinition] = {}

    @classmethod
    def register(cls, definition: ScientificAppDefinition) -> None:
        """Registra definición y falla temprano cuando detecta colisiones."""
        cls._validate_unique_plugin(definition)
        cls._validate_unique_route_prefix(definition)
        cls._validate_unique_api_base_path(definition)

        cls._definitions_by_plugin[definition.plugin_name] = definition
        cls._definitions_by_route_prefix[definition.api_route_prefix] = definition
        cls._definitions_by_api_base_path[definition.api_base_path] = definition

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
