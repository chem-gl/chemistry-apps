"""apps.py: Configuración Django de la app calculadora modular."""

from django.apps import AppConfig


class CalculatorConfig(AppConfig):
    """Configura y registra el plugin calculadora durante el arranque."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.calculator"

    def ready(self) -> None:
        """Importa el plugin para registrar su ejecución en el registry central."""
        from . import plugin  # noqa: F401
