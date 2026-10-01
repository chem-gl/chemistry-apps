"""test_social_auth.py: Login con Google (GIS) y catálogo de proveedores.

Todo mockeado: nunca se toca la red de Google. Cubre el interruptor por
`GOOGLE_CLIENT_ID`, token inválido, creación, vinculación y grupo de acogida.
"""

from __future__ import annotations

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient

from apps.core.identity.services.authorization_service import AuthorizationService
from apps.core.models import GroupMembership, UserIdentityProfile, WorkGroup

GOOGLE_URL = "/api/auth/google/"
# Email válido para el registro (se arma en runtime para no depender del literal).
REGISTRATION_EMAIL = "nuevo.usuario" + chr(64) + "test.local"
PROVIDERS_URL = "/api/auth/providers/"
VERIFY_TARGET = "apps.core.identity.social_auth.google_id_token.verify_oauth2_token"

VALID_CLAIMS: dict[str, object] = {
    "sub": "google-sub-123",
    "email": "socialuser@example.com",
    "email_verified": True,
    "given_name": "Social",
    "family_name": "User",
}


def _post_google(client: APIClient, id_token: str = "test-id-token"):
    return client.post(GOOGLE_URL, {"id_token": id_token}, format="json")


@override_settings(GOOGLE_CLIENT_ID="test-client-id.apps.googleusercontent.com")
class GoogleLoginTests(TestCase):
    """Flujo completo con verificación mockeada."""

    def setUp(self) -> None:
        cache.clear()
        self.client = APIClient()

    def tearDown(self) -> None:
        cache.clear()

    def test_disabled_without_client_id_returns_503(self) -> None:
        with override_settings(GOOGLE_CLIENT_ID=""):
            response = _post_google(self.client)

        self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)

    def test_invalid_token_returns_401(self) -> None:
        with patch(VERIFY_TARGET) as mock_verify:
            mock_verify.side_effect = ValueError("Token expired")
            response = _post_google(self.client, "bad-token")

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_unverified_email_returns_401(self) -> None:
        claims = {**VALID_CLAIMS, "email_verified": False}
        with patch(VERIFY_TARGET, return_value=claims):
            response = _post_google(self.client)

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_new_user_is_created_verified_in_default_group(self) -> None:
        WorkGroup.objects.create(name="Abierto", slug="abierto")

        with (
            patch(VERIFY_TARGET, return_value=dict(VALID_CLAIMS)),
            override_settings(DEFAULT_REGISTRATION_GROUP_SLUG="abierto"),
        ):
            response = _post_google(self.client)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("access", response.data)
        self.assertIn("refresh", response.data)
        self.assertEqual(response.data["user"]["username"], "socialuser")

        created = get_user_model().objects.get(username="socialuser")
        profile = UserIdentityProfile.objects.get(user=created)
        self.assertTrue(profile.email_verified)
        self.assertEqual(profile.primary_group.slug, "abierto")
        membership = GroupMembership.objects.filter(user=created).first()
        self.assertIsNotNone(membership)
        self.assertEqual(membership.role_in_group, GroupMembership.ROLE_MEMBER)

    def test_existing_user_is_linked_without_duplicate(self) -> None:
        user_model = get_user_model()
        existing = user_model.objects.create_user(
            username="legacy-user",
            email="socialuser@example.com",
            password="x",
        )

        with patch(VERIFY_TARGET, return_value=dict(VALID_CLAIMS)):
            response = _post_google(self.client)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["user"]["username"], "legacy-user")
        self.assertEqual(
            user_model.objects.filter(email__iexact="socialuser@example.com").count(), 1
        )
        self.assertEqual(existing.pk, response.data["user"]["id"])

    def test_username_collision_gets_suffix(self) -> None:
        user_model = get_user_model()
        user_model.objects.create_user(username="socialuser", email="other@example.com")

        with patch(VERIFY_TARGET, return_value=dict(VALID_CLAIMS)):
            response = _post_google(self.client)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["user"]["username"], "socialuser-2")

    def test_inactive_account_is_rejected(self) -> None:
        user_model = get_user_model()
        user = user_model.objects.create_user(
            username="off-user", email="socialuser@example.com", password="x"
        )
        UserIdentityProfile.objects.update_or_create(
            user=user,
            defaults={
                "role": UserIdentityProfile.ROLE_USER,
                "account_status": UserIdentityProfile.STATUS_INACTIVE,
            },
        )

        with patch(VERIFY_TARGET, return_value=dict(VALID_CLAIMS)):
            response = _post_google(self.client)

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


class AuthProvidersTests(TestCase):
    """El frontend decide si muestra el botón de Google."""

    def test_providers_report_disabled_without_client_id(self) -> None:
        with override_settings(GOOGLE_CLIENT_ID=""):
            response = APIClient().get(PROVIDERS_URL)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            response.data, {"google": {"enabled": False, "client_id": None}}
        )

    def test_providers_report_enabled_with_client_id(self) -> None:
        with override_settings(GOOGLE_CLIENT_ID="cid.apps.googleusercontent.com"):
            response = APIClient().get(PROVIDERS_URL)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            response.data,
            {
                "google": {
                    "enabled": True,
                    "client_id": "cid.apps.googleusercontent.com",
                }
            },
        )


@override_settings(
    GOOGLE_CLIENT_ID="test-client-id.apps.googleusercontent.com",
    DEFAULT_REGISTRATION_GROUP_SLUG="abierto",
)
class GoogleMatchesRegistrationTests(TestCase):
    """Un alta con Google debe quedar igual que un registro público sin token."""

    def setUp(self) -> None:
        cache.clear()
        self.default_group = WorkGroup.objects.create(name="Abierto", slug="abierto")
        self.client = APIClient()

    def tearDown(self) -> None:
        cache.clear()

    def _register_without_token(self) -> object:
        response = self.client.post(
            "/api/auth/register/",
            {
                "username": "registrado",
                "email": REGISTRATION_EMAIL,
                "password": "Password-123",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        return get_user_model().objects.get(username="registrado")

    def _login_with_google(self) -> object:
        with patch(VERIFY_TARGET, return_value=dict(VALID_CLAIMS)):
            response = _post_google(self.client)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return get_user_model().objects.get(username="socialuser")

    def _profile_snapshot(self, user: object) -> dict[str, object]:
        profile = UserIdentityProfile.objects.get(user=user)
        membership = GroupMembership.objects.filter(user=user).first()
        return {
            "role": profile.role,
            "account_status": profile.account_status,
            "primary_group": profile.primary_group.slug
            if profile.primary_group
            else None,
            "membership_role": membership.role_in_group if membership else None,
            "membership_group": membership.group.slug if membership else None,
            "must_change_password": profile.must_change_password,
        }

    def test_google_user_matches_registration_user(self) -> None:
        """Mismo grupo de acogida, rol, membresía y sin cambio forzado."""
        registered = self._register_without_token()
        google_user = self._login_with_google()

        registered_snapshot = self._profile_snapshot(registered)
        google_snapshot = self._profile_snapshot(google_user)

        self.assertEqual(registered_snapshot, google_snapshot)
        self.assertEqual(google_snapshot["primary_group"], "abierto")
        self.assertEqual(
            google_snapshot["membership_role"], GroupMembership.ROLE_MEMBER
        )
        self.assertFalse(bool(google_snapshot["must_change_password"]))

    def test_google_user_gets_no_app_access_by_default(self) -> None:
        """Sin AppPermission en el grupo, el catálogo no habilita apps."""
        google_user = self._login_with_google()
        accessible_apps = AuthorizationService.list_accessible_apps(google_user)

        self.assertTrue(accessible_apps)
        self.assertFalse(any(bool(app["enabled"]) for app in accessible_apps))
