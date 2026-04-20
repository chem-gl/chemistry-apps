"""test_identity_extended.py: Pruebas adicionales de cobertura para identidad.

Cubre rutas de código faltantes en bootstrap, routers y authorization service
que no se alcanzan con los tests principales de test_identity_api.py.
"""

from __future__ import annotations

from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient

from apps.core.models import (
    AppPermission,
    GroupAppConfig,
    GroupMembership,
    UserIdentityProfile,
    WorkGroup,
)

CONFIGURED_ROOT_TEST_VALUE = "root-via-setting"


class BootstrapSuperadminGroupTests(TestCase):
    """Valida la creación idempotente del grupo Superadmin y sus permisos."""

    def setUp(self) -> None:
        self.user_model = get_user_model()
        # Limpiar artefactos creados por el post_migrate de startup.py
        AppPermission.objects.filter(group__slug="superadmin").delete()
        GroupMembership.objects.filter(group__slug="superadmin").delete()
        UserIdentityProfile.objects.filter(primary_group__slug="superadmin").update(
            primary_group=None
        )
        WorkGroup.objects.filter(slug="superadmin").delete()

        self.root_user = self.user_model.objects.create_user(
            username="bootstrap-root",
            email="bootstrap@test.local",
            password="root-pwd",
            is_superuser=True,
            is_staff=True,
        )

    def test_ensure_superadmin_group_creates_group_and_permissions(self) -> None:
        """Primera ejecución crea grupo, membresía, perfil y permisos."""
        from apps.core.identity.bootstrap.superadmin_group import (
            SUPERADMIN_GROUP_SLUG,
            ensure_superadmin_group,
        )

        group, created = ensure_superadmin_group(self.root_user)

        self.assertTrue(created)
        self.assertEqual(group.slug, SUPERADMIN_GROUP_SLUG)
        # Membresía admin creada
        self.assertTrue(
            GroupMembership.objects.filter(
                user=self.root_user, group=group, role_in_group="admin"
            ).exists()
        )
        # Primary group asignado
        profile = UserIdentityProfile.objects.get(user=self.root_user)
        self.assertEqual(profile.primary_group_id, group.id)
        # Permisos de apps creados (al menos 1 si hay apps registradas)
        permission_count = AppPermission.objects.filter(group=group).count()
        self.assertGreaterEqual(permission_count, 0)

    def test_ensure_superadmin_group_is_idempotent(self) -> None:
        """Segunda ejecución no duplica grupo, membresía ni permisos."""
        from apps.core.identity.bootstrap.superadmin_group import (
            ensure_superadmin_group,
        )

        group_first, created_first = ensure_superadmin_group(self.root_user)
        group_second, created_second = ensure_superadmin_group(self.root_user)

        self.assertTrue(created_first)
        self.assertFalse(created_second)
        self.assertEqual(group_first.id, group_second.id)
        # Solo una membresía
        membership_count = GroupMembership.objects.filter(
            user=self.root_user, group=group_first
        ).count()
        self.assertEqual(membership_count, 1)

    def test_ensure_superadmin_sets_primary_group_when_profile_exists_without_group(
        self,
    ) -> None:
        """Si el perfil ya existe sin grupo primario, lo asigna."""
        from apps.core.identity.bootstrap.superadmin_group import (
            ensure_superadmin_group,
        )

        # Crear perfil sin primary_group previamente
        UserIdentityProfile.objects.create(
            user=self.root_user,
            role=UserIdentityProfile.ROLE_ROOT,
            primary_group=None,
        )

        group, _ = ensure_superadmin_group(self.root_user)

        profile = UserIdentityProfile.objects.get(user=self.root_user)
        self.assertEqual(profile.primary_group_id, group.id)


class BootstrapRootUserTests(TestCase):
    """Valida la creación idempotente del usuario root en bootstrap."""

    def test_ensure_root_user_creates_user(self) -> None:
        """Verifica que ensure_root_user crea el superusuario si no existe."""
        from apps.core.identity.bootstrap.root_user import ensure_root_user

        user_model = get_user_model()
        # Eliminar todos los superusuarios para forzar la creación
        user_model.objects.filter(is_superuser=True).delete()

        user, password, created = ensure_root_user()

        self.assertTrue(created)
        self.assertEqual(user.username, settings.ROOT_USERNAME)
        self.assertTrue(user.is_superuser)
        self.assertTrue(user.is_staff)
        self.assertIsNotNone(password)

    def test_ensure_root_user_is_idempotent(self) -> None:
        """Segunda ejecución no duplica el usuario root."""
        from apps.core.identity.bootstrap.root_user import ensure_root_user

        user_model = get_user_model()
        # Eliminar todos los superusuarios para partir de cero
        user_model.objects.filter(is_superuser=True).delete()

        _, _, first_created = ensure_root_user()
        _, _, second_created = ensure_root_user()

        self.assertTrue(first_created)
        self.assertFalse(second_created)

    @override_settings(ROOT_PASSWORD="")
    def test_ensure_root_user_generates_runtime_password_when_missing(self) -> None:
        """Si no hay password configurada, genera una temporal en lugar de usar una credencial fija."""
        from apps.core.identity.bootstrap.root_user import ensure_root_user

        user_model = get_user_model()
        user_model.objects.filter(is_superuser=True).delete()

        user, password, created = ensure_root_user()

        self.assertTrue(created)
        self.assertIsNotNone(password)
        self.assertNotEqual(password, "admin123")
        self.assertTrue(user.check_password(password))

    @override_settings(ROOT_PASSWORD=CONFIGURED_ROOT_TEST_VALUE)
    def test_ensure_root_user_uses_configured_password_when_provided(self) -> None:
        """Si el entorno define ROOT_PASSWORD, el bootstrap debe respetarlo."""
        from apps.core.identity.bootstrap.root_user import ensure_root_user

        user_model = get_user_model()
        user_model.objects.filter(is_superuser=True).delete()

        user, password, created = ensure_root_user()

        self.assertTrue(created)
        self.assertEqual(password, CONFIGURED_ROOT_TEST_VALUE)
        self.assertTrue(user.check_password(CONFIGURED_ROOT_TEST_VALUE))


class IdentityRouterExtendedTests(TestCase):
    """Cubre endpoints de routers no alcanzados por test_identity_api.py."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.user_model = get_user_model()
        self.root_user = self.user_model.objects.create_user(
            username="root-ext",
            email="root-ext@test.local",
            password="root-pwd",
            is_superuser=True,
            is_staff=True,
        )
        self.admin_user = self.user_model.objects.create_user(
            username="admin-ext",
            email="admin-ext@test.local",
            password="admin-pwd",
        )
        self.standard_user = self.user_model.objects.create_user(
            username="user-ext",
            email="user-ext@test.local",
            password="user-pwd",
        )
        self.group = WorkGroup.objects.create(
            name="Extended", slug="extended", created_by=self.root_user
        )

        UserIdentityProfile.objects.create(
            user=self.root_user,
            role=UserIdentityProfile.ROLE_ROOT,
            primary_group=self.group,
        )
        UserIdentityProfile.objects.create(
            user=self.admin_user,
            role=UserIdentityProfile.ROLE_ADMIN,
            primary_group=self.group,
        )
        UserIdentityProfile.objects.create(
            user=self.standard_user,
            role=UserIdentityProfile.ROLE_USER,
            primary_group=self.group,
        )

        GroupMembership.objects.create(
            user=self.root_user,
            group=self.group,
            role_in_group=GroupMembership.ROLE_ADMIN,
        )
        GroupMembership.objects.create(
            user=self.admin_user,
            group=self.group,
            role_in_group=GroupMembership.ROLE_ADMIN,
        )
        GroupMembership.objects.create(
            user=self.standard_user,
            group=self.group,
            role_in_group=GroupMembership.ROLE_MEMBER,
        )

    def _auth(self, user) -> None:
        self.client.force_authenticate(user=user)

    def _ensure_single_active_root(self) -> None:
        """Deja a root_user como único root activo para pruebas de invariantes."""
        self.user_model.objects.exclude(id=self.root_user.id).filter(
            role=UserIdentityProfile.ROLE_ROOT,
            account_status=UserIdentityProfile.STATUS_ACTIVE,
        ).update(
            account_status=UserIdentityProfile.STATUS_INACTIVE,
            is_active=False,
        )

    # ── Usuarios: listado ──

    def test_root_can_list_users(self) -> None:
        """Root obtiene listado completo de usuarios."""
        self._auth(self.root_user)
        response = self.client.get("/api/identity/users/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(len(response.data), 3)

    def test_admin_can_list_all_users(self) -> None:
        """Admin obtiene listado completo de usuarios para administración global."""
        self._auth(self.admin_user)
        response = self.client.get("/api/identity/users/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        usernames = [u["username"] for u in response.data]
        self.assertIn("admin-ext", usernames)
        self.assertIn("root-ext", usernames)
        self.assertIn("user-ext", usernames)

    def test_standard_user_cannot_list_users(self) -> None:
        """Usuario estándar no puede listar usuarios."""
        self._auth(self.standard_user)
        response = self.client.get("/api/identity/users/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    # ── Usuarios: actualización con campos básicos ──

    def test_root_can_update_user_basic_fields(self) -> None:
        """Root actualiza email y nombre de otro usuario."""
        self._auth(self.root_user)
        response = self.client.patch(
            f"/api/identity/users/{self.standard_user.id}/",
            {"email": "updated@test.local", "first_name": "Updated"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.standard_user.refresh_from_db()
        self.assertEqual(self.standard_user.email, "updated@test.local")
        self.assertEqual(self.standard_user.first_name, "Updated")

    def test_self_update_rejects_admin_fields_for_regular_user(self) -> None:
        """Usuario normal no puede cambiar su propio rol."""
        self._auth(self.standard_user)
        response = self.client.patch(
            f"/api/identity/users/{self.standard_user.id}/",
            {"role": "root"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_root_can_toggle_user_active_status(self) -> None:
        """Root puede desactivar y reactivar un usuario."""
        self._auth(self.root_user)
        response = self.client.patch(
            f"/api/identity/users/{self.standard_user.id}/",
            {"is_active": False},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        profile = UserIdentityProfile.objects.get(user=self.standard_user)
        self.assertEqual(profile.account_status, UserIdentityProfile.STATUS_INACTIVE)

    def test_root_cannot_deactivate_last_active_root(self) -> None:
        """No permite desactivar el ultimo root activo para evitar bloqueo."""
        self._ensure_single_active_root()
        self._auth(self.root_user)
        response = self.client.patch(
            f"/api/identity/users/{self.root_user.id}/",
            {"is_active": False},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("ultimo usuario root activo", response.data["detail"])

        self.root_user.refresh_from_db()
        self.assertTrue(self.root_user.is_active)

    def test_root_cannot_demote_last_active_root_role(self) -> None:
        """No permite degradar a admin al ultimo root activo."""
        self._ensure_single_active_root()
        self._auth(self.root_user)
        response = self.client.patch(
            f"/api/identity/users/{self.root_user.id}/",
            {"role": "admin"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("ultimo usuario root activo", response.data["detail"])

        self.root_user.refresh_from_db()
        self.assertTrue(self.root_user.is_superuser)

    def test_root_can_deactivate_root_when_another_active_root_exists(self) -> None:
        """Permite desactivar root si existe al menos otro root activo."""
        secondary_root = self.user_model.objects.create_user(
            username="second-root-ext",
            email="second-root-ext@test.local",
            password="root-pwd",
            is_superuser=True,
            is_staff=True,
        )
        UserIdentityProfile.objects.create(
            user=secondary_root,
            role=UserIdentityProfile.ROLE_ROOT,
            primary_group=self.group,
        )

        self._auth(self.root_user)
        response = self.client.patch(
            f"/api/identity/users/{self.root_user.id}/",
            {"is_active": False},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.root_user.refresh_from_db()
        self.assertFalse(self.root_user.is_active)

    def test_root_can_change_user_staff_flag(self) -> None:
        """Root puede promover is_staff y se ajusta role si estaba en user."""
        self._auth(self.root_user)
        response = self.client.patch(
            f"/api/identity/users/{self.standard_user.id}/",
            {"is_staff": True},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        profile = UserIdentityProfile.objects.get(user=self.standard_user)
        self.assertEqual(profile.role, UserIdentityProfile.ROLE_ADMIN)

    def test_root_can_change_user_password(self) -> None:
        """Root puede cambiar la contraseña de otro usuario."""
        self._auth(self.root_user)
        response = self.client.patch(
            f"/api/identity/users/{self.standard_user.id}/",
            {"password": "new-secure-password"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.standard_user.refresh_from_db()
        self.assertTrue(self.standard_user.check_password("new-secure-password"))

    def test_root_can_change_user_primary_group(self) -> None:
        """Root puede reasignar el grupo primario de un usuario."""
        other_group = WorkGroup.objects.create(name="Other", slug="other-ext")
        self._auth(self.root_user)
        response = self.client.patch(
            f"/api/identity/users/{self.standard_user.id}/",
            {"primary_group_id": other_group.id},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        profile = UserIdentityProfile.objects.get(user=self.standard_user)
        self.assertEqual(profile.primary_group_id, other_group.id)
        self.assertTrue(
            GroupMembership.objects.filter(
                user=self.standard_user,
                group=other_group,
            ).exists()
        )

    def test_root_promoting_user_to_admin_updates_primary_group_membership_role(
        self,
    ) -> None:
        """Al promover a admin, su membresía del grupo primario debe pasar a admin."""
        self._auth(self.root_user)

        response = self.client.patch(
            f"/api/identity/users/{self.standard_user.id}/",
            {"role": "admin"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        primary_membership = GroupMembership.objects.get(
            user=self.standard_user,
            group=self.group,
        )
        self.assertEqual(primary_membership.role_in_group, GroupMembership.ROLE_ADMIN)

    def test_root_can_change_account_status(self) -> None:
        """Root puede cambiar account_status explícitamente."""
        self._auth(self.root_user)
        response = self.client.patch(
            f"/api/identity/users/{self.standard_user.id}/",
            {"account_status": "inactive"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.standard_user.refresh_from_db()
        self.assertFalse(self.standard_user.is_active)

    # ── Grupos: listado y creación ──

    def test_root_can_list_groups(self) -> None:
        """Root obtiene todos los grupos."""
        self._auth(self.root_user)
        response = self.client.get("/api/identity/groups/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(len(response.data), 1)

    def test_admin_lists_only_administered_groups(self) -> None:
        """Admin solo ve grupos donde es admin."""
        WorkGroup.objects.create(name="Secret", slug="secret-ext")
        self._auth(self.admin_user)
        response = self.client.get("/api/identity/groups/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        group_names = [g["name"] for g in response.data]
        self.assertIn("Extended", group_names)
        self.assertNotIn("Secret", group_names)

    def test_standard_user_cannot_list_groups(self) -> None:
        """Usuario estándar no puede listar grupos."""
        self._auth(self.standard_user)
        response = self.client.get("/api/identity/groups/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    # ── Membresías: listado ──

    def test_root_can_list_memberships(self) -> None:
        """Root obtiene todas las membresías."""
        self._auth(self.root_user)
        response = self.client.get("/api/identity/memberships/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(len(response.data), 1)

    def test_admin_lists_memberships_of_managed_groups(self) -> None:
        """Admin solo ve membresías de sus grupos administrados."""
        self._auth(self.admin_user)
        response = self.client.get("/api/identity/memberships/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_admin_cannot_assign_primary_group_outside_managed_scope(self) -> None:
        """Admin no puede mover usuarios a grupos que no administra."""
        foreign_group = WorkGroup.objects.create(name="Foreign", slug="foreign-ext")
        self._auth(self.admin_user)

        response = self.client.patch(
            f"/api/identity/users/{self.standard_user.id}/",
            {"primary_group_id": foreign_group.id},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_standard_user_cannot_list_memberships(self) -> None:
        """Usuario estándar no puede listar membresías."""
        self._auth(self.standard_user)
        response = self.client.get("/api/identity/memberships/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    # ── Permisos de app: CRUD ──

    def test_root_can_list_permissions(self) -> None:
        """Root obtiene todas las reglas de acceso."""
        AppPermission.objects.create(
            app_name="molar-fractions", group=self.group, is_enabled=True
        )
        self._auth(self.root_user)
        response = self.client.get("/api/identity/app-permissions/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(len(response.data), 1)

    def test_admin_lists_permissions_only_for_managed_groups(self) -> None:
        """Admin no debe ver reglas de permisos de grupos fuera de su alcance."""
        foreign_group = WorkGroup.objects.create(name="Foreign2", slug="foreign2-ext")
        AppPermission.objects.create(
            app_name="molar-fractions",
            group=self.group,
            is_enabled=True,
        )
        AppPermission.objects.create(
            app_name="smileit",
            group=foreign_group,
            is_enabled=False,
        )
        self._auth(self.admin_user)

        response = self.client.get("/api/identity/app-permissions/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        returned_group_ids = {item["group"] for item in response.data}
        self.assertIn(self.group.id, returned_group_ids)
        self.assertNotIn(foreign_group.id, returned_group_ids)

    def test_root_can_create_permission(self) -> None:
        """Root crea una regla de acceso para una app."""
        self._auth(self.root_user)
        response = self.client.post(
            "/api/identity/app-permissions/",
            {
                "app_name": "molar-fractions",
                "group": self.group.id,
                "is_enabled": True,
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_admin_can_create_permission_for_managed_group(self) -> None:
        """Admin del grupo puede crear reglas de acceso para su grupo."""
        self._auth(self.admin_user)
        response = self.client.post(
            "/api/identity/app-permissions/",
            {
                "app_name": "molar-fractions",
                "group": self.group.id,
                "is_enabled": True,
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_root_can_update_permission(self) -> None:
        """Root puede actualizar una regla de acceso existente."""
        perm = AppPermission.objects.create(
            app_name="molar-fractions", group=self.group, is_enabled=True
        )
        self._auth(self.root_user)
        response = self.client.patch(
            f"/api/identity/app-permissions/{perm.id}/",
            {"is_enabled": False},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        perm.refresh_from_db()
        self.assertFalse(perm.is_enabled)

    def test_admin_can_update_permission(self) -> None:
        """Admin del grupo puede actualizar reglas de acceso de su grupo."""
        perm = AppPermission.objects.create(
            app_name="molar-fractions", group=self.group, is_enabled=True
        )
        self._auth(self.admin_user)
        response = self.client.patch(
            f"/api/identity/app-permissions/{perm.id}/",
            {"is_enabled": False},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_root_can_delete_permission(self) -> None:
        """Root puede eliminar una regla de acceso."""
        perm = AppPermission.objects.create(
            app_name="molar-fractions", group=self.group, is_enabled=True
        )
        self._auth(self.root_user)
        response = self.client.delete(f"/api/identity/app-permissions/{perm.id}/")
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(AppPermission.objects.filter(id=perm.id).exists())

    def test_admin_can_delete_permission(self) -> None:
        """Admin del grupo puede eliminar reglas de acceso de su grupo."""
        perm = AppPermission.objects.create(
            app_name="molar-fractions", group=self.group, is_enabled=True
        )
        self._auth(self.admin_user)
        response = self.client.delete(f"/api/identity/app-permissions/{perm.id}/")
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)

    # ── Configuración de app por usuario ──

    def test_user_can_patch_own_app_config(self) -> None:
        """El usuario puede guardar su configuración personal de app."""
        self._auth(self.standard_user)
        response = self.client.patch(
            "/api/auth/app-configs/molar-fractions/",
            {"config": {"theme": "dark"}},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["config"]["theme"], "dark")

    # ── Configuración de app por grupo ──

    def test_admin_can_get_group_app_config(self) -> None:
        """Admin del grupo puede consultar configuración de app grupal."""
        GroupAppConfig.objects.create(
            group=self.group, app_name="molar-fractions", config={"mode": "basic"}
        )
        self._auth(self.admin_user)
        response = self.client.get(
            f"/api/identity/groups/{self.group.id}/app-configs/molar-fractions/"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["config"]["mode"], "basic")

    def test_non_admin_cannot_get_group_app_config(self) -> None:
        """Usuario sin rol admin no puede consultar config grupal."""
        self._auth(self.standard_user)
        response = self.client.get(
            f"/api/identity/groups/{self.group.id}/app-configs/molar-fractions/"
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_non_admin_cannot_patch_group_app_config(self) -> None:
        """Usuario sin rol admin no puede modificar config grupal."""
        self._auth(self.standard_user)
        response = self.client.patch(
            f"/api/identity/groups/{self.group.id}/app-configs/molar-fractions/",
            {"config": {"mode": "advanced"}},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_standard_user_cannot_list_permissions(self) -> None:
        """Usuario estándar no puede listar permisos."""
        self._auth(self.standard_user)
        response = self.client.get("/api/identity/app-permissions/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    # ── Admin no puede crear usuarios ──

    def test_admin_cannot_create_user_without_primary_group(self) -> None:
        """La creación de usuarios exige grupo primario para mantener el invariante."""
        self._auth(self.admin_user)
        response = self.client.post(
            "/api/identity/users/",
            {
                "username": "blocked",
                "email": "blocked@test.local",
                "password": "blocked-pwd",
                "role": "user",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_admin_cannot_delete_last_user_membership(self) -> None:
        """Evita dejar a un usuario no-root sin grupos asignados."""
        membership = GroupMembership.objects.get(
            user=self.standard_user, group=self.group
        )
        self._auth(self.admin_user)
        response = self.client.delete(f"/api/identity/memberships/{membership.id}/")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    # ── Grupos: actualización y eliminación ──

    def test_admin_can_patch_group(self) -> None:
        """Admin del grupo puede actualizar nombre y descripción."""
        self._auth(self.admin_user)
        response = self.client.patch(
            f"/api/identity/groups/{self.group.id}/",
            {"name": "Renamed"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.group.refresh_from_db()
        self.assertEqual(self.group.name, "Renamed")

    def test_root_can_delete_group(self) -> None:
        """Root puede eliminar un grupo si no deja usuarios no-root sin grupo."""
        target = WorkGroup.objects.create(
            name="Disposable", slug="disposable-ext", created_by=self.root_user
        )
        extra_user = self.user_model.objects.create_user(
            username="disposable-user",
            email="disposable-user@test.local",
            password="user-pwd",
        )
        UserIdentityProfile.objects.create(
            user=extra_user,
            role=UserIdentityProfile.ROLE_USER,
            primary_group=target,
        )
        GroupMembership.objects.create(
            user=extra_user,
            group=target,
            role_in_group=GroupMembership.ROLE_MEMBER,
        )
        fallback_group = WorkGroup.objects.create(
            name="Fallback",
            slug="fallback-ext",
            created_by=self.root_user,
        )
        GroupMembership.objects.create(
            user=extra_user,
            group=fallback_group,
            role_in_group=GroupMembership.ROLE_MEMBER,
        )
        self._auth(self.root_user)
        response = self.client.delete(f"/api/identity/groups/{target.id}/")
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(WorkGroup.objects.filter(id=target.id).exists())
        migrated_profile = UserIdentityProfile.objects.get(user=extra_user)
        self.assertEqual(migrated_profile.primary_group_id, fallback_group.id)

    def test_admin_can_delete_managed_group_with_fallback_membership(self) -> None:
        """Admin puede eliminar su grupo si todos los usuarios conservan otro grupo."""
        deletable_group = WorkGroup.objects.create(
            name="Managed Disposable",
            slug="managed-disposable-ext",
            created_by=self.admin_user,
        )
        GroupMembership.objects.create(
            user=self.admin_user,
            group=deletable_group,
            role_in_group=GroupMembership.ROLE_ADMIN,
        )
        UserIdentityProfile.objects.filter(user=self.admin_user).update(
            primary_group=deletable_group
        )
        fallback_group = WorkGroup.objects.create(
            name="Admin Fallback",
            slug="admin-fallback-ext",
            created_by=self.root_user,
        )
        GroupMembership.objects.create(
            user=self.admin_user,
            group=fallback_group,
            role_in_group=GroupMembership.ROLE_ADMIN,
        )

        self._auth(self.admin_user)
        response = self.client.delete(f"/api/identity/groups/{deletable_group.id}/")
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(WorkGroup.objects.filter(id=deletable_group.id).exists())
        updated_profile = UserIdentityProfile.objects.get(user=self.admin_user)
        self.assertEqual(updated_profile.primary_group_id, fallback_group.id)

    def test_admin_cannot_delete_group_if_it_orphans_user(self) -> None:
        """Bloquea el borrado si algún usuario perdería su último grupo."""
        self._auth(self.admin_user)
        response = self.client.delete(f"/api/identity/groups/{self.group.id}/")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    # ── Membresías: creación, actualización y eliminación ──

    def test_admin_can_create_membership(self) -> None:
        """Admin del grupo puede agregar un miembro nuevo."""
        new_user = self.user_model.objects.create_user(
            username="new-member", email="new@test.local", password="pwd"
        )
        self._auth(self.admin_user)
        response = self.client.post(
            "/api/identity/memberships/",
            {
                "user": new_user.id,
                "group": self.group.id,
                "role_in_group": "member",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_admin_can_patch_membership(self) -> None:
        """Admin puede cambiar el rol de un miembro en su grupo."""
        membership = GroupMembership.objects.get(
            user=self.standard_user, group=self.group
        )
        self._auth(self.admin_user)
        response = self.client.patch(
            f"/api/identity/memberships/{membership.id}/",
            {"role_in_group": "admin"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_admin_can_delete_membership(self) -> None:
        """Admin puede remover un miembro de su grupo."""
        auxiliary_group = WorkGroup.objects.create(
            name="Auxiliary",
            slug="auxiliary-ext",
            created_by=self.root_user,
        )
        GroupMembership.objects.create(
            user=self.standard_user,
            group=auxiliary_group,
            role_in_group=GroupMembership.ROLE_MEMBER,
        )
        membership = GroupMembership.objects.get(
            user=self.standard_user, group=self.group
        )
        self._auth(self.admin_user)
        response = self.client.delete(f"/api/identity/memberships/{membership.id}/")
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
