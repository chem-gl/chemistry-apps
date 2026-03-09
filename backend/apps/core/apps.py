"""apps.py: Configuracion de la app core y registro de plugins al iniciar Django."""

from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.core"

    def ready(self) -> None:
        """Importa plugins para registrarlos en el registry en el arranque."""
        from . import plugins  # noqa: F401
