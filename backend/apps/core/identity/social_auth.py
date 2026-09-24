"""social_auth.py: Login con proveedores externos (fase 1: Google).

Diseño desacoplado: todo cuelga de `settings.GOOGLE_CLIENT_ID`. Sin Client ID
(el caso actual, nadie lo ha creado todavía) el endpoint responde 503 y el
frontend oculta el botón. Al configurarlo, el flujo funciona sin más cambios.

Flujo Google (GIS en el frontend):
1. El navegador obtiene un `id_token` firmado por Google (botón GIS).
2. `POST /api/auth/google/` lo verifica (firma, audiencia y expiración) con
   `google-auth`, sin secretos en el backend: el Client ID *es* la audiencia.
3. Se reutiliza la misma respuesta `{user, access, refresh}` del registro con
   token (auto-login inmediato con nuestros JWT de dominio).

Vinculación por email: si el email ya existe en una cuenta activa, se entra a
esa cuenta; si no, se crea (rol `user`, grupo de acogida, `email_verified`
en True porque Google ya lo verificó). No se guarda el `sub` de Google: no
hay migración asociada a este feature.
"""

from __future__ import annotations

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2 import id_token as google_id_token

from ..models import GroupMembership, UserIdentityProfile, WorkGroup


class GoogleAuthError(Exception):
    """El token de Google no es válido (firma, audiencia o expiración)."""


class GoogleNotConfiguredError(Exception):
    """Falta `GOOGLE_CLIENT_ID`: el login social está desactivado."""


def is_google_login_enabled() -> bool:
    """Indica si hay Client ID configurado para el login con Google."""
    return bool(settings.GOOGLE_CLIENT_ID)


def verify_google_id_token(id_token: str) -> dict:
    """Verifica el `id_token` de GIS y retorna sus claims.

    Lanza `GoogleNotConfiguredError` sin Client ID y `GoogleAuthError` si la
    verificación falla. La verificación consulta las claves públicas de Google
    (caché interna de `google-auth`); en tests se mockea `google_id_token`.
    """
    if not is_google_login_enabled():
        raise GoogleNotConfiguredError("Login con Google no configurado.")

    try:
        claims: dict = google_id_token.verify_oauth2_token(
            id_token, GoogleRequest(), settings.GOOGLE_CLIENT_ID
        )
    except ValueError as validation_error:
        raise GoogleAuthError(str(validation_error)) from validation_error

    if not claims.get("email_verified", False):
        raise GoogleAuthError("Google no verificó el email de esta cuenta.")

    if not claims.get("email"):
        raise GoogleAuthError("El token de Google no incluye email.")

    return claims


def resolve_social_username(base_username: str, user_model=None) -> str:
    """Deriva un username único desde la parte local del email."""
    model = user_model or get_user_model()
    candidate = (base_username or "usuario").strip().lower()[:140] or "usuario"

    if not model.objects.filter(username=candidate).exists():
        return candidate

    suffix = 2
    while model.objects.filter(username=f"{candidate}-{suffix}").exists():
        suffix += 1
        if suffix > 1000:
            raise GoogleAuthError("No fue posible generar un username único.")
    return f"{candidate}-{suffix}"


def _is_account_active(user) -> bool:
    """ Activa solo si el usuario Django, el campo de dominio y el perfil coinciden."""
    if not getattr(user, "is_active", True):
        return False
    if getattr(user, "account_status", "active") != "active":
        return False
    profile = UserIdentityProfile.objects.filter(user=user).first()
    if profile is not None and profile.account_status != "active":
        return False
    return True


def get_or_create_google_user(claims: dict):
    """Vincula por email o crea la cuenta para un login válido de Google."""
    user_model = get_user_model()
    email = str(claims["email"]).strip().lower()

    existing_user = (
        user_model.objects.filter(email__iexact=email).order_by("id").first()
    )
    if existing_user is not None:
        if not _is_account_active(existing_user):
            raise GoogleAuthError("La cuenta asociada está desactivada.")
        return existing_user, False

    local_part = email.split("@")[0]
    with transaction.atomic():
        created_user = user_model.objects.create_user(
            username=resolve_social_username(local_part, user_model),
            email=email,
            password=None,
            first_name=str(claims.get("given_name", ""))[:150],
            last_name=str(claims.get("family_name", ""))[:150],
            role=UserIdentityProfile.ROLE_USER,
            account_status=UserIdentityProfile.STATUS_ACTIVE,
            email_verified=True,
        )

        default_group = WorkGroup.objects.filter(
            slug=settings.DEFAULT_REGISTRATION_GROUP_SLUG
        ).first()
        UserIdentityProfile.objects.update_or_create(
            user=created_user,
            defaults={
                "role": UserIdentityProfile.ROLE_USER,
                "account_status": UserIdentityProfile.STATUS_ACTIVE,
                "primary_group_id": default_group.pk if default_group else None,
                "email_verified": True,
            },
        )
        if default_group is not None:
            GroupMembership.objects.update_or_create(
                user=created_user,
                group=default_group,
                defaults={"role_in_group": GroupMembership.ROLE_MEMBER},
            )

    return created_user, True
