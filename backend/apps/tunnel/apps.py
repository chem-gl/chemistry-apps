"""apps.py: Configuración Django de la app científica Tunnel.

Objetivo del archivo:
- Registrar la app y su plugin de cálculo de efecto túnel en el startup.

Cómo se usa:
- En `ready()` se publica `ScientificAppDefinition`.
- Se importa `plugin.py` para activar `@PluginRegistry.register(...)`.
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


class TunnelConfig(AppConfig):
    """Registra la app Tunnel dentro del ecosistema científico modular."""

    default_auto_field = "django.db.models.BigAutoField"
    name = APP_CONFIG_NAME

    def ready(self) -> None:
        """Publica definición de app y activa registro del plugin Tunnel."""
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
                "No se registró plugin Tunnel porque falta dependencia local '%s'. "
                "Los comandos de administración seguirán funcionando.",
                exc.name,
            )
