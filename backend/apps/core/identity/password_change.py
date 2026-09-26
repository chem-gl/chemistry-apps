"""password_change.py: Middleware que exige cambio de contraseña obligatoria.

Bloquea el acceso a `/api/*` cuando el perfil del usuario autenticado tiene
`must_change_password=True`, salvo rutas de la allowlist (login, refresh,
perfil, cambio de password, registro, social, públicas y schema/docs).
"""

from __future__ import annotations

from typing import Callable

from django.http import HttpRequest, JsonResponse

# Prefijos exentos del bloqueo: sesión, cambio de password y rutas públicas.
PASSWORD_CHANGE_ALLOWLIST_PREFIXES: tuple[str, ...] = (
    "/api/auth/password-change/",
    "/api/auth/me/",
    "/api/auth/refresh/",
    "/api/auth/login/",
    "/api/auth/register/",
    "/api/auth/google/",
    "/api/auth/providers/",
    "/api/public/",
    "/api/schema/",
    "/api/docs/",
)


class PasswordChangeEnforcementMiddleware:
    """Exige cambio de contraseña antes de usar la API autenticada."""

    def __init__(self, get_response: Callable[[HttpRequest], object]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> object:
        if self._must_block_request(request):
            return JsonResponse(
                {
                    "detail": "Debes cambiar tu contraseña antes de continuar.",
                    "code": "password_change_required",
                },
                status=403,
            )
        return self.get_response(request)

    def _must_block_request(self, request: HttpRequest) -> bool:
        """Indica si la petición debe bloquearse por password pendiente."""
        path = request.path
        if not path.startswith("/api/"):
            return False
        if any(
            path == prefix or path.startswith(prefix)
            for prefix in PASSWORD_CHANGE_ALLOWLIST_PREFIXES
        ):
            return False
        user = getattr(request, "user", None)
        if user is None or not getattr(user, "is_authenticated", False):
            # El auth JWT de DRF ocurre en la vista, después del middleware:
            # resolver el usuario desde el Bearer token para poder exigir.
            user = self._resolve_jwt_user(request)
        if user is None or not getattr(user, "is_authenticated", False):
            return False
        profile = self._load_profile(user)
        if profile is None:
            return False
        return bool(getattr(profile, "must_change_password", False))

    @staticmethod
    def _resolve_jwt_user(request: HttpRequest):
        """Resuelve el usuario desde el header Authorization Bearer, si existe."""
        try:
            from rest_framework_simplejwt.authentication import JWTAuthentication

            auth_result = JWTAuthentication().authenticate(request)
        except Exception:
            return None
        if auth_result is None:
            return None
        return auth_result[0]

    @staticmethod
    def _load_profile(user):
        """Carga el perfil de identidad tolerando su ausencia."""
        try:
            profile = getattr(user, "identity_profile", None)
        except Exception:
            profile = None
        if profile is not None:
            return profile
        try:
            from apps.core.models import UserIdentityProfile

            return UserIdentityProfile.objects.filter(user_id=user.id).first()
        except Exception:
            return None
