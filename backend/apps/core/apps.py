"""apps.py: Configuración base de la app core del dominio científico.

La app `core` centraliza contratos y servicios comunes para que el resto de
apps científicas se integren de forma uniforme. No define plugins propios,
pero habilita registro, ejecución y trazabilidad para todos los plugins que
las apps hijas publiquen.
"""

import os

from django.apps import AppConfig
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

from .runtime_tools import RuntimeToolsError, assert_runtime_tools_ready


def _is_runtime_tools_strict_check_enabled() -> bool:
    """Resuelve si el chequeo estricto de runtime tools debe ejecutarse al arrancar."""
    raw_value: str = os.getenv("RUNTIME_TOOLS_STRICT_CHECK", "").strip().lower()
    if raw_value == "":
        return not settings.DEBUG

    return raw_value in {"1", "true", "yes", "on"}


class CoreConfig(AppConfig):
    """Configuración Django de la app core.

    Esta configuración se mantiene mínima por diseño. La integración activa de
    plugins ocurre en los `AppConfig` de cada app consumidora (por ejemplo,
    `apps.calculator.apps.CalculatorConfig`).
    """

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.core"

    def ready(self) -> None:
        """Valida runtime tools e inicializa hooks del dominio transversal."""
        # Importa señales de startup del dominio de identidad (post_migrate).
        from .identity import startup as _identity_startup  # noqa: F401

        if not _is_runtime_tools_strict_check_enabled():
            return

        try:
            assert_runtime_tools_ready()
        except RuntimeToolsError as exc:
            raise ImproperlyConfigured(str(exc)) from exc
