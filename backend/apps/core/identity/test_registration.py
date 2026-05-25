"""test_registration.py: Pruebas de registro público y gestión de tokens de invitación.

Cubre:
- Registro sin token (usuario sin acceso a apps)
- Registro con token válido (usuario se asigna al grupo + auto-login)
- Casos de error del token (inválido, expirado, revocado, sin usos disponibles)
- Gestión de tokens por root/admin/user
"""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.core.models import (
    AppPermission,
    GroupMembership,
    SelfRegistrationToken,
    UserIdentityProfile,
    WorkGroup,
)


class UserRegistrationTests(TestCase):
    """Pruebas del endpoint público de registro de usuarios."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.user_model = get_user_model()

        # Crear root + grupo de prueba para tokens
        self.root_user = self.user_model.objects.create_user(
            username="root-reg-test",
            email="root-reg@test.local",
            password="root-password",
            is_superuser=True,
            is_staff=True,
        )
        self.test_group = WorkGroup.objects.create(name="Test Lab", slug="test-lab")
        # Crear un AppPermission para que el grupo tenga acceso a al menos una app
        self.app_permission = AppPermission.objects.create(
            app_name="molar-fractions",
            group=self.test_group,
            is_enabled=True,
        )

    def _create_valid_token(self, **kwargs) -> SelfRegistrationToken:
        """Helper para crear un token de registro válido."""
        defaults = {
            "group": self.test_group,
            "created_by": self.root_user,
            "max_uses": 1,
            "description": "Test invitation",
        }
        defaults.update(kwargs)
        return SelfRegistrationToken.objects.create(**defaults)

    def _login_payload(self, username: str, password: str) -> dict:
        """Helper para crear payload de login."""
        return {"username": username, "password": password}

    # ── Registro sin token ──────────────────────────────────────────────

    def test_register_without_token_creates_user_no_group(self) -> None:
        """Usuario registrado sin token se crea sin grupo ni permisos."""
        payload = {
            "username": "newuser",
            "email": "newuser@test.local",
            "password": "securePass123",
        }
        response = self.client.post("/api/auth/register/", payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertIn("user", response.data)
        self.assertNotIn("access", response.data)
        self.assertNotIn("refresh", response.data)

        user_data = response.data["user"]
        self.assertEqual(user_data["username"], "newuser")
        self.assertEqual(user_data["role"], "user")
        self.assertIsNone(user_data["primary_group_id"])

        # Verificar que el usuario existe en BD sin grupo
        created_user = self.user_model.objects.get(username="newuser")
        self.assertFalse(created_user.is_superuser)
        self.assertFalse(created_user.is_staff)

        profile = UserIdentityProfile.objects.filter(user=created_user).first()
        self.assertIsNotNone(profile)
        self.assertIsNone(profile.primary_group_id)
        self.assertFalse(profile.email_verified)

        # Verificar que no tiene membresías
        self.assertEqual(GroupMembership.objects.filter(user=created_user).count(), 0)

    def test_register_without_token_then_login_has_no_apps(self) -> None:
        """Usuario registrado sin token puede loguearse pero no ve apps."""
        # 1. Register
        payload = {
            "username": "noappuser",
            "email": "noapp@test.local",
            "password": "securePass123",
        }
        self.client.post("/api/auth/register/", payload, format="json")

        # 2. Login
        login_resp = self.client.post(
            "/api/auth/login/",
            self._login_payload("noappuser", "securePass123"),
            format="json",
        )
        self.assertEqual(login_resp.status_code, status.HTTP_200_OK)
        access_token = login_resp.data["access"]

        # 3. Check accessible apps
        auth_client = APIClient()
        auth_client.credentials(HTTP_AUTHORIZATION=f"Bearer {access_token}")
        apps_resp = auth_client.get("/api/auth/apps/")
        self.assertEqual(apps_resp.status_code, status.HTTP_200_OK)

        for app_entry in apps_resp.data:
            self.assertFalse(app_entry["enabled"])

    def test_register_without_token_first_name_last_name(self) -> None:
        """Registro sin token acepta nombres opcionales."""
        payload = {
            "username": "nameduser",
            "email": "named@test.local",
            "password": "securePass123",
            "first_name": "John",
            "last_name": "Doe",
        }
        response = self.client.post("/api/auth/register/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["user"]["first_name"], "John")
        self.assertEqual(response.data["user"]["last_name"], "Doe")

    # ── Registro con token válido ───────────────────────────────────────

    def test_register_with_valid_token_auto_login(self) -> None:
        """Registro con token válido devuelve JWT y asigna al grupo."""
        token_obj = self._create_valid_token()

        payload = {
            "username": "tokenuser",
            "email": "token@test.local",
            "password": "securePass123",
            "registration_token": token_obj.token,
        }
        response = self.client.post("/api/auth/register/", payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertIn("user", response.data)
        self.assertIn("access", response.data)
        self.assertIn("refresh", response.data)

        # Verificar grupo asignado
        user_data = response.data["user"]
        self.assertEqual(user_data["primary_group_id"], self.test_group.id)

        # Verificar membresía creada
        created_user = self.user_model.objects.get(username="tokenuser")
        membership = GroupMembership.objects.filter(
            user=created_user, group=self.test_group
        ).first()
        self.assertIsNotNone(membership)
        self.assertEqual(membership.role_in_group, GroupMembership.ROLE_MEMBER)

        # Verificar que el token se marcó como usado
        token_obj.refresh_from_db()
        self.assertEqual(token_obj.use_count, 1)

    def test_register_with_token_can_access_apps(self) -> None:
        """Usuario registrado con token ve apps habilitadas del grupo."""
        token_obj = self._create_valid_token()

        # Register with token
        payload = {
            "username": "appaccessuser",
            "email": "appaccess@test.local",
            "password": "securePass123",
            "registration_token": token_obj.token,
        }
        register_resp = self.client.post("/api/auth/register/", payload, format="json")
        access_token = register_resp.data["access"]

        # Check accessible apps
        auth_client = APIClient()
        auth_client.credentials(HTTP_AUTHORIZATION=f"Bearer {access_token}")
        apps_resp = auth_client.get("/api/auth/apps/")
        self.assertEqual(apps_resp.status_code, status.HTTP_200_OK)

        # La app 'molar-fractions' debe estar enabled para este grupo
        molar_app = next(
            (a for a in apps_resp.data if a["app_name"] == "molar-fractions"),
            None,
        )
        self.assertIsNotNone(molar_app)
        self.assertTrue(molar_app["enabled"])

    def test_register_with_token_updates_use_count(self) -> None:
        """El contador de usos del token se incrementa correctamente."""
        token_obj = self._create_valid_token(max_uses=3)

        for i in range(3):
            username = f"multiuser{i}@test.local"
            payload = {
                "username": f"multiuser{i}",
                "email": username,
                "password": "securePass123",
                "registration_token": token_obj.token,
            }
            response = self.client.post("/api/auth/register/", payload, format="json")
            self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        token_obj.refresh_from_db()
        self.assertEqual(token_obj.use_count, 3)

    def test_register_with_unlimited_uses_token(self) -> None:
        """Token con max_uses=0 permite registros ilimitados."""
        token_obj = self._create_valid_token(max_uses=0)

        for i in range(5):
            payload = {
                "username": f"unlimited{i}",
                "email": f"unlimited{i}@test.local",
                "password": "securePass123",
                "registration_token": token_obj.token,
            }
            response = self.client.post("/api/auth/register/", payload, format="json")
            self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        token_obj.refresh_from_db()
        self.assertEqual(token_obj.use_count, 5)

    # ── Casos de error del token ────────────────────────────────────────

    def test_register_with_invalid_token_returns_error(self) -> None:
        """Token inexistente produce error 400."""
        payload = {
            "username": "badtokenuser",
            "email": "badtoken@test.local",
            "password": "securePass123",
            "registration_token": "NONEXISTENT123",
        }
        response = self.client.post("/api/auth/register/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("registration_token", str(response.data))

    def test_register_with_expired_token_returns_error(self) -> None:
        """Token con expires_at en el pasado produce error."""
        token_obj = self._create_valid_token(
            expires_at=timezone.now() - timedelta(hours=1)
        )
        payload = {
            "username": "expiredtokenuser",
            "email": "expired@test.local",
            "password": "securePass123",
            "registration_token": token_obj.token,
        }
        response = self.client.post("/api/auth/register/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_register_with_revoked_token_returns_error(self) -> None:
        """Token con is_active=False produce error."""
        token_obj = self._create_valid_token(is_active=False)
        payload = {
            "username": "revokedtokenuser",
            "email": "revoked@test.local",
            "password": "securePass123",
            "registration_token": token_obj.token,
        }
        response = self.client.post("/api/auth/register/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_register_with_exhausted_token_returns_error(self) -> None:
        """Token que ya alcanzó max_uses produce error."""
        token_obj = self._create_valid_token(max_uses=1, use_count=1)
        payload = {
            "username": "exhaustedtokenuser",
            "email": "exhausted@test.local",
            "password": "securePass123",
            "registration_token": token_obj.token,
        }
        response = self.client.post("/api/auth/register/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_register_with_empty_token_works_as_no_token(self) -> None:
        """Token vacío se trata como si no se hubiera proporcionado."""
        payload = {
            "username": "emptytokenuser",
            "email": "emptytoken@test.local",
            "password": "securePass123",
            "registration_token": "",
        }
        response = self.client.post("/api/auth/register/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertNotIn("access", response.data)

    # ── Validaciones del formulario ─────────────────────────────────────

    def test_register_duplicate_username_returns_error(self) -> None:
        """Username duplicado produce error."""
        # Crear primer usuario
        payload1 = {
            "username": "dupeuser",
            "email": "dupe1@test.local",
            "password": "securePass123",
        }
        self.client.post("/api/auth/register/", payload1, format="json")

        # Intentar crear el mismo username
        payload2 = {
            "username": "dupeuser",
            "email": "dupe2@test.local",
            "password": "securePass123",
        }
        response = self.client.post("/api/auth/register/", payload2, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_register_weak_password_returns_error(self) -> None:
        """Contraseña muy corta produce error."""
        payload = {
            "username": "weakpassuser",
            "email": "weak@test.local",
            "password": "123",  # menos de 8 caracteres
        }
        response = self.client.post("/api/auth/register/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_register_without_username_returns_error(self) -> None:
        """Falta campo obligatorio username."""
        payload = {
            "email": "nousername@test.local",
            "password": "securePass123",
        }
        response = self.client.post("/api/auth/register/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_register_invalid_email_returns_error(self) -> None:
        """Email mal formado produce error."""
        payload = {
            "username": "bademailuser",
            "email": "not-an-email",
            "password": "securePass123",
        }
        response = self.client.post("/api/auth/register/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    # ── Seguridad ───────────────────────────────────────────────────────

    def test_register_creates_user_not_root(self) -> None:
        """El registro nunca crea un usuario root."""
        payload = {
            "username": "normaluser",
            "email": "normal@test.local",
            "password": "securePass123",
        }
        response = self.client.post("/api/auth/register/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["user"]["role"], "user")

        created_user = self.user_model.objects.get(username="normaluser")
        self.assertFalse(created_user.is_superuser)
        self.assertFalse(created_user.is_staff)

    def test_register_endpoint_is_public(self) -> None:
        """El endpoint de registro no requiere autenticación."""
        payload = {
            "username": "publicuser",
            "email": "public@test.local",
            "password": "securePass123",
        }
        # Sin autenticar
        response = self.client.post("/api/auth/register/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_token_validation_is_idempotent_at_creation(self) -> None:
        """Validar que dos registros simultáneos con el mismo token de 1 uso
        no crean dos usuarios. Simula race condition via secuencial."""
        token_obj = self._create_valid_token(max_uses=1)

        # Primer uso: debe funcionar
        payload1 = {
            "username": "raceuser1",
            "email": "race1@test.local",
            "password": "securePass123",
            "registration_token": token_obj.token,
        }
        resp1 = self.client.post("/api/auth/register/", payload1, format="json")
        self.assertEqual(resp1.status_code, status.HTTP_201_CREATED)

        # Segundo uso: debe fallar porque ya se agotó
        payload2 = {
            "username": "raceuser2",
            "email": "race2@test.local",
            "password": "securePass123",
            "registration_token": token_obj.token,
        }
        resp2 = self.client.post("/api/auth/register/", payload2, format="json")
        self.assertEqual(resp2.status_code, status.HTTP_400_BAD_REQUEST)

        # Solo se creó un usuario
        self.assertEqual(
            self.user_model.objects.filter(username__startswith="raceuser").count(),
            1,
        )


class RegistrationTokenManagementTests(TestCase):
    """Pruebas de gestión de tokens de auto-registro (CRUD para admin/root)."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.user_model = get_user_model()

        self.root_user = self.user_model.objects.create_user(
            username="root-token-mgr",
            email="root-token@test.local",
            password="root-password",
            is_superuser=True,
            is_staff=True,
        )
        self.admin_user = self.user_model.objects.create_user(
            username="admin-token-mgr",
            email="admin-token@test.local",
            password="admin-password",
        )
        self.standard_user = self.user_model.objects.create_user(
            username="user-token-mgr",
            email="user-token@test.local",
            password="user-password",
        )
        self.group_lab_a = WorkGroup.objects.create(name="Lab A", slug="lab-a")
        self.group_lab_b = WorkGroup.objects.create(name="Lab B", slug="lab-b")

        # Admin es admin de Lab A
        UserIdentityProfile.objects.create(
            user=self.admin_user,
            role=UserIdentityProfile.ROLE_ADMIN,
            account_status=UserIdentityProfile.STATUS_ACTIVE,
            primary_group=self.group_lab_a,
        )
        GroupMembership.objects.create(
            user=self.admin_user,
            group=self.group_lab_a,
            role_in_group=GroupMembership.ROLE_ADMIN,
        )

        # Standard user es miembro de Lab A
        UserIdentityProfile.objects.create(
            user=self.standard_user,
            role=UserIdentityProfile.ROLE_USER,
            account_status=UserIdentityProfile.STATUS_ACTIVE,
            primary_group=self.group_lab_a,
        )
        GroupMembership.objects.create(
            user=self.standard_user,
            group=self.group_lab_a,
            role_in_group=GroupMembership.ROLE_MEMBER,
        )

        # Crear algunos tokens
        self.token_a = SelfRegistrationToken.objects.create(
            group=self.group_lab_a,
            created_by=self.root_user,
            description="Lab A invitation",
            max_uses=5,
        )
        self.token_b = SelfRegistrationToken.objects.create(
            group=self.group_lab_b,
            created_by=self.root_user,
            description="Lab B invitation",
            max_uses=3,
        )
        self.revoked_token = SelfRegistrationToken.objects.create(
            group=self.group_lab_a,
            created_by=self.root_user,
            description="Revoked invitation",
            max_uses=1,
            is_active=False,
        )

    def _authenticate(self, user) -> None:
        self.client.force_authenticate(user=user)

    # ── GET /api/identity/registration-tokens/ ──────────────────────────

    def test_root_can_list_all_tokens(self) -> None:
        """Root ve todos los tokens de registro."""
        self._authenticate(self.root_user)
        response = self.client.get("/api/identity/registration-tokens/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 3)

    def test_admin_can_list_tokens_for_administered_groups(self) -> None:
        """Admin ve solo tokens de grupos que administra."""
        self._authenticate(self.admin_user)
        response = self.client.get("/api/identity/registration-tokens/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # Admin de Lab A: ve token_a y revoked_token (ambos de Lab A), no token_b
        self.assertEqual(len(response.data), 2)
        token_groups = {t["group"] for t in response.data}
        self.assertIn(self.group_lab_a.id, token_groups)
        self.assertNotIn(self.group_lab_b.id, token_groups)

    def test_standard_user_cannot_list_tokens(self) -> None:
        """Usuario estándar no puede listar tokens."""
        self._authenticate(self.standard_user)
        response = self.client.get("/api/identity/registration-tokens/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_unauthenticated_cannot_list_tokens(self) -> None:
        """Usuario anónimo no puede listar tokens."""
        response = self.client.get("/api/identity/registration-tokens/")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    # ── POST /api/identity/registration-tokens/ ─────────────────────────

    def test_root_can_create_token(self) -> None:
        """Root puede crear un token de registro."""
        self._authenticate(self.root_user)
        payload = {
            "group_id": self.group_lab_a.id,
            "description": "New team invitation",
            "max_uses": 10,
        }
        response = self.client.post(
            "/api/identity/registration-tokens/", payload, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["group"], self.group_lab_a.id)
        self.assertEqual(response.data["description"], "New team invitation")
        self.assertEqual(response.data["max_uses"], 10)
        self.assertEqual(response.data["use_count"], 0)
        self.assertTrue(response.data["is_active"])
        self.assertEqual(len(response.data["token"]), 12)

    def test_root_can_create_token_without_description(self) -> None:
        """Token sin descripción se crea correctamente."""
        self._authenticate(self.root_user)
        payload = {"group_id": self.group_lab_a.id}
        response = self.client.post(
            "/api/identity/registration-tokens/", payload, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_admin_cannot_create_token(self) -> None:
        """Admin no puede crear tokens de registro."""
        self._authenticate(self.admin_user)
        payload = {
            "group_id": self.group_lab_a.id,
            "description": "Admin trying",
        }
        response = self.client.post(
            "/api/identity/registration-tokens/", payload, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_create_token_with_nonexistent_group_returns_error(self) -> None:
        """Token con grupo inexistente produce error."""
        self._authenticate(self.root_user)
        payload = {"group_id": 99999}
        response = self.client.post(
            "/api/identity/registration-tokens/", payload, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_token_with_expires_at(self) -> None:
        """Token puede tener fecha de expiración opcional."""
        self._authenticate(self.root_user)
        future = timezone.now() + timedelta(days=30)
        payload = {
            "group_id": self.group_lab_a.id,
            "expires_at": future.isoformat(),
        }
        response = self.client.post(
            "/api/identity/registration-tokens/", payload, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertIsNotNone(response.data["expires_at"])

    def test_create_token_default_max_uses(self) -> None:
        """El valor por defecto de max_uses es 1."""
        self._authenticate(self.root_user)
        payload = {"group_id": self.group_lab_a.id}
        response = self.client.post(
            "/api/identity/registration-tokens/", payload, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["max_uses"], 1)

    # ── DELETE /api/identity/registration-tokens/<uuid>/ ────────────────

    def test_root_can_revoke_token(self) -> None:
        """Root puede revocar un token (is_active=False)."""
        self._authenticate(self.root_user)
        response = self.client.delete(
            f"/api/identity/registration-tokens/{self.token_a.id}/"
        )
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)

        self.token_a.refresh_from_db()
        self.assertFalse(self.token_a.is_active)

    def test_admin_cannot_revoke_token(self) -> None:
        """Admin no puede revocar tokens."""
        self._authenticate(self.admin_user)
        response = self.client.delete(
            f"/api/identity/registration-tokens/{self.token_a.id}/"
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_revoke_nonexistent_token_returns_404(self) -> None:
        """Revocar token inexistente produce 404."""
        self._authenticate(self.root_user)
        response = self.client.delete(
            "/api/identity/registration-tokens/00000000-0000-0000-0000-000000000000/"
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    # ── Token response data ─────────────────────────────────────────────

    def test_token_response_contains_group_name(self) -> None:
        """La respuesta del token incluye group_name para facilitar UI."""
        self._authenticate(self.root_user)
        response = self.client.get("/api/identity/registration-tokens/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        for token_entry in response.data:
            self.assertIn("group_name", token_entry)
            self.assertIn("group", token_entry)
