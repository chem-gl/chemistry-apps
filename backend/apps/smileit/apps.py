"""apps.py: Configuración Django de la app smileit.

Objetivo del archivo:
- Integrar la app en el startup de Django y registrar su contrato de
  enrutamiento/plugin en `ScientificAppRegistry`.

Cómo se usa:
- Django instancia `SmileitConfig` al cargar `INSTALLED_APPS`.
- En `ready()`, se valida unicidad de plugin/rutas y se importa `plugin.py`
  para activar el decorador `@PluginRegistry.register(...)`.
"""

from django.apps import AppConfig

from apps.core.app_registry import ScientificAppDefinition, ScientificAppRegistry

from .definitions import (
    APP_API_BASE_PATH,
    APP_CONFIG_NAME,
    APP_ROUTE_BASENAME,
    APP_ROUTE_PREFIX,
    PLUGIN_NAME,
)


class SmileitConfig(AppConfig):
    """Registra la app smileit (generador de sustituyentes SMILES) en el ecosistema científico."""

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
            supports_pause_resume=False,
        )
        ScientificAppRegistry.register(app_definition)

        from . import plugin  # noqa: F401
