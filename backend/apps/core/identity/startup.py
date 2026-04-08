"""startup.py: Hooks de arranque para inicialización del dominio de identidad."""

from __future__ import annotations

import logging

from django.conf import settings
from django.db.models.signals import post_migrate
from django.dispatch import receiver

from .bootstrap.root_user import ensure_root_user

logger = logging.getLogger(__name__)


@receiver(post_migrate)
def ensure_root_user_after_migrate(sender, **kwargs) -> None:
    """Garantiza root al finalizar migraciones de forma idempotente."""
    del kwargs
    app_name = getattr(sender, "name", "")
    if app_name != "apps.core":
        return

    _, _, created = ensure_root_user()
    if created:
        logger.warning(
            "Usuario administrativo inicial creado automáticamente tras migración: username=%s",
            getattr(settings, "ROOT_USERNAME", "admin"),
        )
