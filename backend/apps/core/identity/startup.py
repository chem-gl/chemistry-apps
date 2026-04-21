"""startup.py: Hooks de arranque para inicialización del dominio de identidad."""

from __future__ import annotations

import logging

from django.conf import settings
from django.db.models.signals import post_migrate
from django.dispatch import receiver

from .bootstrap.root_user import ensure_root_user
from .bootstrap.superadmin_group import ensure_superadmin_group

logger = logging.getLogger(__name__)


@receiver(post_migrate)
def ensure_root_user_after_migrate(sender, **kwargs) -> None:
    """Garantiza root y grupo Superadmin al finalizar migraciones."""
    del kwargs
    app_name = getattr(sender, "name", "")
    if app_name != "apps.core":
        return

    root_user, issued_password, user_created = ensure_root_user()
    if user_created:
        configured_password = getattr(settings, "ROOT_PASSWORD", "") or ""
        if configured_password.strip() == "" and issued_password is not None:
            logger.warning(
                "Usuario administrativo inicial creado automáticamente tras migración: username=%s temporary_password=%s",
                getattr(settings, "ROOT_USERNAME", "admin"),
                issued_password,
            )
        else:
            logger.warning(
                "Usuario administrativo inicial creado automáticamente tras migración: username=%s",
                getattr(settings, "ROOT_USERNAME", "admin"),
            )

    _, group_created = ensure_superadmin_group(root_user)
    if group_created:
        logger.warning(
            "Grupo Superadmin con permisos completos creado tras migración.",
        )
