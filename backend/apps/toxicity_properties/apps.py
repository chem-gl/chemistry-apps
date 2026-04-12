"""apps.py: Configuración Django de la app Toxicity Properties.

Registra la identidad de la app en ScientificAppRegistry durante startup
para validar colisiones de rutas/plugins y habilitar ejecución declarativa.
"""

from django.apps import AppConfig

from apps.core.app_registry import ScientificAppDefinition, ScientificAppRegistry
from apps.core.types import JSONMap

from .definitions import (
    APP_API_BASE_PATH,
    APP_CONFIG_NAME,
    APP_ROUTE_BASENAME,
    APP_ROUTE_PREFIX,
    PLUGIN_NAME,
)


class ToxicityPropertiesConfig(AppConfig):
    """Registra la app de predicción toxicológica en el ecosistema científico."""

    default_auto_field = "django.db.models.BigAutoField"
    name = APP_CONFIG_NAME

    def ready(self) -> None:
        """Publica metadatos de integración e importa plugin para registro."""
        app_definition: ScientificAppDefinition = ScientificAppDefinition(
            app_config_name=self.name,
            plugin_name=PLUGIN_NAME,
            api_route_prefix=APP_ROUTE_PREFIX,
            api_base_path=APP_API_BASE_PATH,
            route_basename=APP_ROUTE_BASENAME,
            supports_pause_resume=False,
        )
        ScientificAppRegistry.register(app_definition)
        ScientificAppRegistry.register_cache_payload_validator(
            PLUGIN_NAME,
            _is_toxicity_cache_payload_usable,
        )

        from . import plugin  # noqa: F401


def _is_toxicity_cache_payload_usable(payload: JSONMap) -> bool:
    """Descarta payloads totalmente degradados para evitar cache tóxica."""
    molecules_value: object | None = payload.get("molecules")
    if not isinstance(molecules_value, list) or len(molecules_value) == 0:
        return False

    total_rows: int = len(molecules_value)
    rows_with_errors: int = 0

    for row_value in molecules_value:
        if not isinstance(row_value, dict):
            return False
        row_error_message: object | None = row_value.get("error_message")
        if isinstance(row_error_message, str) and row_error_message.strip() != "":
            rows_with_errors += 1

    return rows_with_errors < total_rows
