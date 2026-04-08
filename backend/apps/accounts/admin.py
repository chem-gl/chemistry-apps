"""admin.py: Registro administrativo del modelo UserAccount.

Objetivo del archivo:
- Exponer el modelo de usuario personalizado en Django Admin.

Cómo se usa:
- Django carga este módulo al iniciar admin site.
"""

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import UserAccount


@admin.register(UserAccount)
class UserAccountAdmin(UserAdmin):
    """Admin del usuario con campos de identidad de dominio."""

    fieldsets = UserAdmin.fieldsets + (
        (
            "Identidad de Dominio",
            {
                "fields": (
                    "role",
                    "account_status",
                    "avatar",
                    "email_verified",
                )
            },
        ),
    )
    list_display = UserAdmin.list_display + (
        "role",
        "account_status",
        "email_verified",
    )
