"""apps.py: Configuración Django de la app científica Server Calc.

Objetivo del archivo:
- Registrar la app y su plugin de suma remota en el startup.

Cómo se usa:
- En `ready()` se publica `ScientificAppDefinition`.
- Se importa `plugin.py` para activar `@PluginRegistry.register(...)`.
"""

import logging

from django.apps import AppConfig
from django.db.models.signals import post_migrate
from django.dispatch import receiver

from apps.core.app_registry import ScientificAppDefinition, ScientificAppRegistry

from .definitions import (
    APP_API_BASE_PATH,
    APP_CONFIG_NAME,
    APP_ROUTE_BASENAME,
    APP_ROUTE_PREFIX,
    PLUGIN_NAME,
)

logger = logging.getLogger(__name__)


class ServerCalcConfig(AppConfig):
    """Registra la app Server Calc dentro del ecosistema científico modular."""

    default_auto_field = "django.db.models.BigAutoField"
    name = APP_CONFIG_NAME

    def ready(self) -> None:
        """Publica definición de app y activa registro del plugin Server Calc."""
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
                "No se registró plugin Server Calc porque falta dependencia local '%s'. "
                "Los comandos de administración seguirán funcionando.",
                exc.name,
            )
        # El receiver post_migrate de este módulo crea el grupo qta-operators.


@receiver(post_migrate)
def ensure_qta_operators_group_after_migrate(sender, **kwargs) -> None:
    """Crea el grupo qta-operators tras migrar server_calc (idempotente)."""
    del kwargs
    if getattr(sender, "name", "") != APP_CONFIG_NAME:
        return

    from .bootstrap_qta import ensure_qta_operators_group

    _, group_created = ensure_qta_operators_group()
    if group_created:
        logger.warning(
            "Grupo qta-operators con acceso a Server Calc creado tras migración.",
        )
