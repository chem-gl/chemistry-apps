"""root_user.py: Bootstrap idempotente del usuario root inicial.

Se ejecuta en primer arranque para garantizar una cuenta administrativa base.
"""

from __future__ import annotations

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.models import AbstractUser


def ensure_root_user() -> tuple[AbstractUser, str | None, bool]:
    """Garantiza la existencia de un root y retorna (usuario, password, creado)."""
    user_model = get_user_model()
    root_user = user_model.objects.filter(is_superuser=True).first()
    if root_user is not None:
        return root_user, None, False

    root_password = _build_initial_root_password()
    root_user = user_model.objects.create_superuser(
        username=getattr(settings, "ROOT_USERNAME", "admin"),
        email=getattr(settings, "ROOT_BOOTSTRAP_EMAIL", "admin@chemistry.local"),
        password=root_password,
    )
    root_user.is_staff = True
    root_user.is_superuser = True
    root_user.save(update_fields=["is_staff", "is_superuser"])
    return root_user, root_password, True


def _build_initial_root_password() -> str:
    configured_password = getattr(settings, "ROOT_PASSWORD", "") or ""
    if configured_password.strip() != "":
        return configured_password
    return "admin123"
