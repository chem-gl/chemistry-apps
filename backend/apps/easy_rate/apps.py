"""apps.py: Configuración Django de la app científica Easy-rate.

Objetivo del archivo:
- Registrar identidad de app y activar plugin desacoplado en startup.

Cómo se usa:
- `ready()` publica `ScientificAppDefinition` y carga el registro del plugin.
"""

import logging

from django.apps import AppConfig

from apps.core.app_registry import ScientificAppDefinition, ScientificAppRegistry

from .definitions import (
    APP_API_BASE_PATH,
    APP_CONFIG_NAME,
    APP_ROUTE_BASENAME,
    APP_ROUTE_PREFIX,
    PLUGIN_NAME,
)

logger = logging.getLogger(__name__)


class EasyRateConfig(AppConfig):
    """Configura el ciclo de vida de la app Easy-rate en Django."""

    default_auto_field = "django.db.models.BigAutoField"
    name = APP_CONFIG_NAME

    def ready(self) -> None:
        """Registra la app en el core y activa el plugin Easy-rate."""
        app_definition: ScientificAppDefinition = ScientificAppDefinition(
            app_config_name=self.name,
            plugin_name=PLUGIN_NAME,
            api_route_prefix=APP_ROUTE_PREFIX,
            api_base_path=APP_API_BASE_PATH,
            route_basename=APP_ROUTE_BASENAME,
            supports_pause_resume=False,
        )
        ScientificAppRegistry.register(app_definition)

        try:
            from . import plugin  # noqa: F401
        except ModuleNotFoundError as exc:
            if not str(exc.name).startswith("libs"):
                raise
            logger.warning(
                "No se registró plugin Easy-rate porque falta dependencia local '%s'. "
                "Los comandos de administración seguirán funcionando.",
                exc.name,
            )
