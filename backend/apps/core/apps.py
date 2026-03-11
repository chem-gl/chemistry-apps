"""apps.py: Configuración base de la app core del dominio científico.

La app `core` centraliza contratos y servicios comunes para que el resto de
apps científicas se integren de forma uniforme. No define plugins propios,
pero habilita registro, ejecución y trazabilidad para todos los plugins que
las apps hijas publiquen.
"""

from django.apps import AppConfig


class CoreConfig(AppConfig):
    """Configuración Django de la app core.

    Esta configuración se mantiene mínima por diseño. La integración activa de
    plugins ocurre en los `AppConfig` de cada app consumidora (por ejemplo,
    `apps.calculator.apps.CalculatorConfig`).
    """

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.core"
