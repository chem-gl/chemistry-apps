"""test_password_change.py: Pruebas del cambio obligatorio de contraseña.

Cubre bootstrap root con password configurado/aleatorio, endpoint
`POST /api/auth/password-change/` y middleware de enforcement.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.core.identity.bootstrap.root_user import ensure_root_user
from apps.core.models import UserIdentityProfile


def _make_user(username: str, password: str, must_change: bool = False):
    """Crea un usuario con perfil de identidad y flag indicado."""
    user_model = get_user_model()
    user = user_model.objects.create_user(
        username=username,
        email=f"{username}@example.com",
        password=password,
    )
    UserIdentityProfile.objects.create(
        user=user,
        role=UserIdentityProfile.ROLE_USER,
        account_status=UserIdentityProfile.STATUS_ACTIVE,
        must_change_password=must_change,
    )
    return user


def _bearer_token(user) -> str:
    """Genera un access token JWT real para el usuario indicado."""
    return str(RefreshToken.for_user(user).access_token)


class RootBootstrapPasswordFlagTests(TestCase):
    """Verifica el flag inicial del root según origen del password."""

    def _clear_superusers(self) -> None:
        """Elimina el root creado por post_migrate para probar el bootstrap."""
        get_user_model().objects.filter(is_superuser=True).delete()

    @override_settings(ROOT_PASSWORD="__VG_PASS_7b90d5b167f0__")
    def test_configured_root_password_sets_flag(self) -> None:
        """Con ROOT_PASSWORD configurado el root debe cambiarlo al entrar."""
        self._clear_superusers()
        root_user, _, created = ensure_root_user()
        self.assertTrue(created)
        profile = UserIdentityProfile.objects.get(user=root_user)
        self.assertTrue(profile.must_change_password)

    @override_settings(ROOT_PASSWORD="")
    def test_random_root_password_leaves_flag_false(self) -> None:
        """Con password aleatorio generado no se exige cambio."""
        self._clear_superusers()
        root_user, _, created = ensure_root_user()
        self.assertTrue(created)
        profile = UserIdentityProfile.objects.filter(user=root_user).first()
        if profile is not None:
            self.assertFalse(profile.must_change_password)


class PasswordChangeEndpointTests(TestCase):
    """Cubre el endpoint de cambio de contraseña del usuario autenticado."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.user = _make_user("pwd-user", "old-password-123", must_change=True)

    def test_happy_path_changes_password_and_clears_flag(self) -> None:
        """Cambio válido actualiza password, limpia flag y retorna perfil."""
        self.client.force_authenticate(user=self.user)
        response = self.client.post(
            "/api/auth/password-change/",
            {"current_password": "old-password-123", "new_password": "new-password-456"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data["must_change_password"])
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("new-password-456"))
        profile = UserIdentityProfile.objects.get(user=self.user)
        self.assertFalse(profile.must_change_password)

    def test_wrong_current_password_returns_400(self) -> None:
        """Password actual incorrecto no cambia nada y responde 400."""
        self.client.force_authenticate(user=self.user)
        response = self.client.post(
            "/api/auth/password-change/",
            {"current_password": "wrong-password", "new_password": "new-password-456"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("old-password-123"))

    def test_weak_new_password_returns_400(self) -> None:
        """Password nuevo menor a 8 caracteres responde 400."""
        self.client.force_authenticate(user=self.user)
        response = self.client.post(
            "/api/auth/password-change/",
            {"current_password": "old-password-123", "new_password": "short"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_same_new_password_returns_400(self) -> None:
        """Password nuevo igual al actual responde 400."""
        self.client.force_authenticate(user=self.user)
        response = self.client.post(
            "/api/auth/password-change/",
            {
                "current_password": "old-password-123",
                "new_password": "old-password-123",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_unauthenticated_returns_401(self) -> None:
        """Sin autenticación el endpoint exige credenciales."""
        response = self.client.post(
            "/api/auth/password-change/",
            {"current_password": "old-password-123", "new_password": "new-password-456"},
            format="json",
        )
        self.assertIn(
            response.status_code,
            (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN),
        )


class PasswordChangeMiddlewareTests(TestCase):
    """Verifica el bloqueo de API con flag activo y la allowlist."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.user = _make_user("mw-user", "old-password-123", must_change=True)

    def _authenticate_with_jwt(self) -> None:
        """Autentica con JWT real para atravesar el middleware Django."""
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {_bearer_token(self.user)}")

    def test_blocked_api_returns_403_with_code(self) -> None:
        """Con flag activo, una ruta no exenta responde 403 con code."""
        self._authenticate_with_jwt()
        response = self.client.get("/api/auth/apps/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.json()["code"], "password_change_required")

    def test_allowlist_profile_and_password_change_pass(self) -> None:
        """`/api/auth/me/` y password-change están exentas del bloqueo."""
        self._authenticate_with_jwt()
        profile_response = self.client.get("/api/auth/me/")
        self.assertEqual(profile_response.status_code, status.HTTP_200_OK)
        change_response = self.client.post(
            "/api/auth/password-change/",
            {"current_password": "old-password-123", "new_password": "new-password-456"},
            format="json",
        )
        self.assertEqual(change_response.status_code, status.HTTP_200_OK)

    def test_api_access_restored_after_password_change(self) -> None:
        """Tras cambiar el password, las rutas bloqueadas responden 200."""
        self._authenticate_with_jwt()
        self.client.post(
            "/api/auth/password-change/",
            {"current_password": "old-password-123", "new_password": "new-password-456"},
            format="json",
        )
        response = self.client.get("/api/auth/apps/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_flag_false_does_not_block(self) -> None:
        """Con flag False el middleware deja pasar sin alterar nada."""
        plain_user = _make_user("plain-user", "plain-password-123", must_change=False)
        self.client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {_bearer_token(plain_user)}"
        )
        response = self.client.get("/api/auth/apps/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
