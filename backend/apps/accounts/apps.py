"""apps.py: Configuración Django para el dominio de cuentas de usuario.

Objetivo del archivo:
- Declarar AppConfig para el modelo de usuario personalizado del sistema.

Cómo se usa:
- Se registra en INSTALLED_APPS desde config/settings.py.
"""

from django.apps import AppConfig


class AccountsConfig(AppConfig):
    """Configura la app de cuentas personalizadas para AUTH_USER_MODEL."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.accounts"
