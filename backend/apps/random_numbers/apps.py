"""apps.py: Configuración Django de la app random_numbers."""

from apps.core.app_registry import ScientificAppDefinition, ScientificAppRegistry
from django.apps import AppConfig

from .definitions import (
    APP_API_BASE_PATH,
    APP_CONFIG_NAME,
    APP_ROUTE_BASENAME,
    APP_ROUTE_PREFIX,
    PLUGIN_NAME,
)


class RandomNumbersConfig(AppConfig):
    """Registra la app de números aleatorios en el ecosistema científico."""

    default_auto_field = "django.db.models.BigAutoField"
    name = APP_CONFIG_NAME

    def ready(self) -> None:
        """Registra metadatos de la app e importa el plugin de ejecución."""
        app_definition: ScientificAppDefinition = ScientificAppDefinition(
            app_config_name=self.name,
            plugin_name=PLUGIN_NAME,
            api_route_prefix=APP_ROUTE_PREFIX,
            api_base_path=APP_API_BASE_PATH,
            route_basename=APP_ROUTE_BASENAME,
            supports_pause_resume=True,
        )
        ScientificAppRegistry.register(app_definition)

        from . import plugin  # noqa: F401
