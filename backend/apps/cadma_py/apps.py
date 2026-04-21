"""apps.py: Configuración Django de CADMA Py.

Registra la app científica en el startup del backend y publica su identidad en
el ScientificAppRegistry para que el frontend pueda descubrirla de forma estable.
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


class CadmaPyConfig(AppConfig):
    """Registra CADMA Py como app científica orientada a selección molecular."""

    default_auto_field = "django.db.models.BigAutoField"
    name = APP_CONFIG_NAME

    def ready(self) -> None:
        from . import plugin  # noqa: F401

        ScientificAppRegistry.register(
            ScientificAppDefinition(
                app_config_name=APP_CONFIG_NAME,
                plugin_name=PLUGIN_NAME,
                api_route_prefix=APP_ROUTE_PREFIX,
                api_base_path=APP_API_BASE_PATH,
                route_basename=APP_ROUTE_BASENAME,
                supports_pause_resume=False,
                available_features=(
                    "reference-libraries",
                    "selection-scores",
                    "chart-exports",
                ),
            )
        )
