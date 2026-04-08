"""test_identity_api.py: Pruebas de integración para endpoints del dominio de identidad.

Valida RBAC de administración de usuarios/grupos/permisos y uso del perfil
transversal (UserIdentityProfile) en claims y ownership de jobs.
"""

from __future__ import annotations

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from apps.core.models import (
    AppPermission,
    GroupAppConfig,
    GroupMembership,
    UserAppConfig,
    UserIdentityProfile,
    WorkGroup,
)


class IdentityApiTests(TestCase):
    """Cubre escenarios de autorización para endpoints administrativos de identidad."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.user_model = get_user_model()
        self.root_user = self.user_model.objects.create_user(
            username="root-test",
            email="root@test.local",
            password="root-password",
            is_superuser=True,
            is_staff=True,
        )
        self.admin_user = self.user_model.objects.create_user(
            username="admin-test",
            email="admin@test.local",
            password="admin-password",
        )
        self.standard_user = self.user_model.objects.create_user(
            username="user-test",
            email="user@test.local",
            password="user-password",
        )
        self.other_user = self.user_model.objects.create_user(
            username="other-test",
            email="other@test.local",
            password="other-password",
        )
        self.group_alpha = WorkGroup.objects.create(name="Alpha", slug="alpha")
        self.group_beta = WorkGroup.objects.create(name="Beta", slug="beta")

        UserIdentityProfile.objects.create(
            user=self.admin_user,
            role=UserIdentityProfile.ROLE_ADMIN,
            account_status=UserIdentityProfile.STATUS_ACTIVE,
            primary_group=self.group_alpha,
        )
        UserIdentityProfile.objects.create(
            user=self.standard_user,
            role=UserIdentityProfile.ROLE_USER,
            account_status=UserIdentityProfile.STATUS_ACTIVE,
            primary_group=self.group_alpha,
        )
        UserIdentityProfile.objects.create(
            user=self.other_user,
            role=UserIdentityProfile.ROLE_USER,
            account_status=UserIdentityProfile.STATUS_ACTIVE,
            primary_group=self.group_beta,
        )

        GroupMembership.objects.create(
            user=self.admin_user,
            group=self.group_alpha,
            role_in_group=GroupMembership.ROLE_ADMIN,
        )
        GroupMembership.objects.create(
            user=self.standard_user,
            group=self.group_alpha,
            role_in_group=GroupMembership.ROLE_MEMBER,
        )

    def _authenticate(self, user) -> None:
        """Autentica el cliente de prueba con el usuario indicado."""
        self.client.force_authenticate(user=user)

    def test_identity_users_requires_authentication(self) -> None:
        """Verifica que el listado de usuarios no expone datos sin autenticación."""
        response = self.client.get("/api/identity/users/")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_root_can_create_work_group(self) -> None:
        """Confirma que root puede crear grupos para administración transversal."""
        self._authenticate(self.root_user)

        response = self.client.post(
            "/api/identity/groups/",
            {"name": "Gamma", "slug": "gamma", "description": "QA group"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["name"], "Gamma")

    def test_admin_cannot_create_work_group(self) -> None:
        """Comprueba que la creación de grupos se restringe al rol root."""
        self._authenticate(self.admin_user)

        response = self.client.post(
            "/api/identity/groups/",
            {"name": "Gamma", "slug": "gamma"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_root_can_create_user_with_identity_profile(self) -> None:
        """Asegura que root crea usuarios y perfil transversal en una sola operación."""
        self._authenticate(self.root_user)

        response = self.client.post(
            "/api/identity/users/",
            {
                "username": "new-admin",
                "email": "new-admin@test.local",
                "password": "secure-password",
                "role": "admin",
                "account_status": "active",
                "primary_group_id": self.group_alpha.id,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        created_user = self.user_model.objects.get(username="new-admin")
        created_profile = UserIdentityProfile.objects.get(user=created_user)
        self.assertEqual(created_profile.role, UserIdentityProfile.ROLE_ADMIN)
        self.assertEqual(created_profile.primary_group_id, self.group_alpha.id)

    def test_admin_can_manage_user_in_shared_group(self) -> None:
        """Valida que admin puede actualizar usuarios de su mismo grupo."""
        self._authenticate(self.admin_user)

        response = self.client.patch(
            f"/api/identity/users/{self.standard_user.id}/",
            {"role": "admin", "account_status": "active"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        updated_profile = UserIdentityProfile.objects.get(user=self.standard_user)
        self.assertEqual(updated_profile.role, UserIdentityProfile.ROLE_ADMIN)

    def test_admin_cannot_manage_user_from_other_group(self) -> None:
        """Comprueba aislamiento entre grupos para administración por admins."""
        self._authenticate(self.admin_user)

        response = self.client.patch(
            f"/api/identity/users/{self.other_user.id}/",
            {"role": "admin"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_can_create_membership_only_in_administered_group(self) -> None:
        """Verifica control de alcance al crear membresías por admins."""
        self._authenticate(self.admin_user)

        allowed_response = self.client.post(
            "/api/identity/memberships/",
            {
                "user": self.other_user.id,
                "group": self.group_alpha.id,
                "role_in_group": "member",
            },
            format="json",
        )
        denied_response = self.client.post(
            "/api/identity/memberships/",
            {
                "user": self.standard_user.id,
                "group": self.group_beta.id,
                "role_in_group": "member",
            },
            format="json",
        )

        self.assertEqual(allowed_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(denied_response.status_code, status.HTTP_403_FORBIDDEN)

    def test_profile_and_token_use_role_and_group_from_identity_profile(self) -> None:
        """Garantiza que claims y endpoint me reflejan datos del perfil transversal."""
        self._authenticate(self.admin_user)

        me_response = self.client.get("/api/auth/me/")
        self.assertEqual(me_response.status_code, status.HTTP_200_OK)
        self.assertEqual(me_response.data["role"], "admin")
        self.assertEqual(me_response.data["primary_group_id"], self.group_alpha.id)

        token_response = self.client.post(
            "/api/auth/login/",
            {"username": "admin-test", "password": "admin-password"},
            format="json",
        )
        self.assertEqual(token_response.status_code, status.HTTP_200_OK)
        self.assertIn("access", token_response.data)

    def test_job_creation_uses_primary_group_from_profile(self) -> None:
        """Asegura que jobs nuevos heredan owner y group desde identidad del actor."""
        self._authenticate(self.standard_user)

        with patch(
            "apps.core.routers.viewset.dispatch_scientific_job"
        ) as dispatch_mock:
            dispatch_mock.return_value = True
            response = self.client.post(
                "/api/jobs/",
                {
                    "plugin_name": "calculator",
                    "version": "1.0.0",
                    "parameters": {"op": "add", "a": 1, "b": 3},
                },
                format="json",
            )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["owner"], self.standard_user.id)
        self.assertEqual(response.data["group"], self.group_alpha.id)

    def test_current_user_accessible_apps_reflect_group_permission(self) -> None:
        """Verifica que el catálogo accesible respeta reglas deshabilitadas por grupo."""
        AppPermission.objects.create(
            app_name="smileit",
            group=self.group_alpha,
            is_enabled=False,
        )
        self._authenticate(self.standard_user)

        response = self.client.get("/api/auth/apps/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        smileit_entry = next(
            app_item for app_item in response.data if app_item["app_name"] == "smileit"
        )
        self.assertFalse(smileit_entry["enabled"])
        self.assertFalse(smileit_entry["group_permission"])

    def test_current_user_app_config_merges_group_and_user_layers(self) -> None:
        """Confirma precedencia de configuración grupo -> usuario para una app."""
        GroupAppConfig.objects.create(
            group=self.group_alpha,
            app_name="smileit",
            config={"theme": "group", "catalog_scope": "shared"},
        )
        UserAppConfig.objects.create(
            user=self.standard_user,
            app_name="smileit",
            config={"theme": "user", "page_size": 25},
        )
        self._authenticate(self.standard_user)

        response = self.client.get("/api/auth/app-configs/smileit/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["group_config"]["theme"], "group")
        self.assertEqual(response.data["user_config"]["theme"], "user")
        self.assertEqual(response.data["effective_config"]["theme"], "user")
        self.assertEqual(response.data["effective_config"]["catalog_scope"], "shared")
        self.assertEqual(response.data["effective_config"]["page_size"], 25)

    def test_admin_can_update_group_app_config_for_managed_group(self) -> None:
        """Valida que admin del grupo puede ajustar configuración grupal de apps."""
        self._authenticate(self.admin_user)

        response = self.client.patch(
            f"/api/identity/groups/{self.group_alpha.id}/app-configs/smileit/",
            {"config": {"catalog_scope": "group-only"}},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        created_group_config = GroupAppConfig.objects.get(
            group=self.group_alpha,
            app_name="smileit",
        )
        self.assertEqual(created_group_config.config["catalog_scope"], "group-only")
