"""test_permissions_multilevel.py: Tests para sistema multinivel de permisos.

Objetivo del archivo:
- Verificar que el sistema de permisos funciona correctamente para usuarios, admins y root.
- Probar visibilidad (can_user_view), edición (can_user_edit) y eliminación (can_user_delete).
- Validar que source_reference es correcto basado en rol.

Cómo se usa:
- pytest backend/apps/smileit/test_permissions_multilevel.py -v
- Cubre: SmileitSubstituent y SmileitPattern con roles user/admin/root.
"""

from __future__ import annotations

import pytest
from django.contrib.auth.models import Group

from apps.accounts.models import UserAccount
from apps.core.permissions import (
    can_user_delete_entry,
    can_user_edit_entry,
    can_user_view_entry,
    get_source_reference_for_role,
)
from apps.smileit.catalog import (
    create_catalog_substituent,
    create_pattern_entry,
    list_active_catalog_entries,
)
from apps.smileit.models import SmileitCategory, SmileitSubstituent


@pytest.mark.django_db
class TestPermissionsFunctions:
    """Tests para funciones genéricas de permisos."""

    @pytest.fixture
    def setup_users_and_groups(self):
        """Crea usuarios y grupos de prueba."""
        # Crear grupos
        grupo_a = Group.objects.create(name="Grupo A")
        grupo_b = Group.objects.create(name="Grupo B")

        # Crear usuarios
        root_user = UserAccount.objects.create(
            username="test_root",
            email="root@test.com",
            is_superuser=True,
            is_staff=True,
            role=UserAccount.ROLE_ROOT,
        )

        admin_user_a = UserAccount.objects.create(
            username="admin_a",
            email="admin_a@test.com",
            is_superuser=False,
            is_staff=True,
            role=UserAccount.ROLE_ADMIN,
        )
        admin_user_a.groups.add(grupo_a)

        admin_user_b = UserAccount.objects.create(
            username="admin_b",
            email="admin_b@test.com",
            is_superuser=False,
            is_staff=True,
            role=UserAccount.ROLE_ADMIN,
        )
        admin_user_b.groups.add(grupo_b)

        user_a = UserAccount.objects.create(
            username="user_a",
            email="user_a@test.com",
            is_superuser=False,
            is_staff=False,
            role=UserAccount.ROLE_USER,
        )
        user_a.groups.add(grupo_a)

        user_b = UserAccount.objects.create(
            username="user_b",
            email="user_b@test.com",
            is_superuser=False,
            is_staff=False,
            role=UserAccount.ROLE_USER,
        )
        user_b.groups.add(grupo_b)

        return {
            "root": root_user,
            "admin_a": admin_user_a,
            "admin_b": admin_user_b,
            "user_a": user_a,
            "user_b": user_b,
            "grupo_a": grupo_a,
            "grupo_b": grupo_b,
        }

    def test_get_source_reference_for_role_root(self):
        """Test: Root user gets 'root' source_reference."""
        result = get_source_reference_for_role("root", None)
        assert result == "root"

    def test_get_source_reference_for_role_admin(self):
        """Test: Admin user gets 'admin-{group_id}' source_reference."""
        result = get_source_reference_for_role("admin", 1)
        assert result == "admin-1"

    def test_get_source_reference_for_role_user(self):
        """Test: Regular user gets 'local-lab' source_reference."""
        result = get_source_reference_for_role("user", None)
        assert result == "local-lab"

    def test_get_source_reference_for_role_invalid(self):
        """Test: Invalid role returns empty string."""
        result = get_source_reference_for_role(None, None)
        assert result == ""


@pytest.mark.django_db
class TestPermissionsViewEditDelete:
    """Tests para permisos view/edit/delete con diferentes tipos de entries."""

    @pytest.fixture
    def setup_data(self, setup_users_and_groups):
        """Crea categories y entries de prueba."""
        users = setup_users_and_groups

        # Crear categoría base
        category = SmileitCategory.objects.create(
            stable_id="cat-test",
            version=1,
            is_latest=True,
            is_active=True,
            name="Test Category",
        )

        # Entry: Usuario regular (local-lab)
        user_entry = SmileitSubstituent.objects.create(
            stable_id="user-entry",
            version=1,
            is_latest=True,
            is_active=True,
            name="User Substituent",
            smiles_input="C",
            smiles_canonical="C",
            source_reference="local-lab",
            category=category,
            created_by=users["user_a"],
            provenance_metadata={
                "owner_user_id": str(users["user_a"].id),
                "owner_username": "user_a",
            },
        )

        # Entry: Admin de Grupo A
        admin_entry_a = SmileitSubstituent.objects.create(
            stable_id="admin-entry-a",
            version=1,
            is_latest=True,
            is_active=True,
            name="Admin A Substituent",
            smiles_input="CC",
            smiles_canonical="CC",
            source_reference=f"admin-{users['grupo_a'].id}",
            category=category,
            created_by=users["admin_a"],
            provenance_metadata={
                "owner_user_id": str(users["admin_a"].id),
                "owner_username": "admin_a",
                "owner_group_id": str(users["grupo_a"].id),
            },
        )

        # Entry: Root
        root_entry = SmileitSubstituent.objects.create(
            stable_id="root-entry",
            version=1,
            is_latest=True,
            is_active=True,
            name="Root Substituent",
            smiles_input="CCC",
            smiles_canonical="CCC",
            source_reference="root",
            category=category,
            created_by=users["root"],
            provenance_metadata={
                "owner_user_id": str(users["root"].id),
                "owner_username": "root",
            },
        )

        # Entry: Seed (no editable)
        seed_entry = SmileitSubstituent.objects.create(
            stable_id="seed-entry",
            version=1,
            is_latest=True,
            is_active=True,
            name="Seed Substituent",
            smiles_input="CCCC",
            smiles_canonical="CCCC",
            source_reference="smileit-seed",
            category=category,
            created_by=None,
            provenance_metadata={"source": "seed"},
        )

        return {
            "users": users,
            "category": category,
            "user_entry": user_entry,
            "admin_entry_a": admin_entry_a,
            "root_entry": root_entry,
            "seed_entry": seed_entry,
        }

    def test_can_view_user_entry_by_owner(self, setup_data):
        """Test: Usuario puede ver sus propias entries."""
        data = setup_data
        user = data["users"]["user_a"]
        entry = data["user_entry"]

        result = can_user_view_entry(entry, user.id, [user.groups.first().id], "user")
        assert result is True

    def test_can_view_user_entry_by_other_user(self, setup_data):
        """Test: Usuario NO puede ver entries de otro usuario."""
        data = setup_data
        viewer = data["users"]["user_b"]
        entry = data["user_entry"]

        result = can_user_view_entry(
            entry, viewer.id, [data["users"]["grupo_b"].id], "user"
        )
        assert result is False

    def test_can_view_admin_entry_by_group_member(self, setup_data):
        """Test: Usuario en grupo puede ver entries de admin de ese grupo."""
        data = setup_data
        user = data["users"]["user_a"]
        entry = data["admin_entry_a"]

        result = can_user_view_entry(
            entry, user.id, [data["users"]["grupo_a"].id], "user"
        )
        assert result is True

    def test_can_view_admin_entry_by_other_group_member(self, setup_data):
        """Test: Usuario de otro grupo NO puede ver entries admin de otro grupo."""
        data = setup_data
        user = data["users"]["user_b"]
        entry = data["admin_entry_a"]

        result = can_user_view_entry(
            entry, user.id, [data["users"]["grupo_b"].id], "user"
        )
        assert result is False

    def test_can_view_root_entry_by_anyone(self, setup_data):
        """Test: Todos pueden ver entries de root."""
        data = setup_data
        entry = data["root_entry"]

        # Usuario regular
        result_user = can_user_view_entry(
            entry, data["users"]["user_a"].id, [data["users"]["grupo_a"].id], "user"
        )
        assert result_user is True

        # Admin otro grupo
        result_admin = can_user_view_entry(
            entry, data["users"]["admin_b"].id, [data["users"]["grupo_b"].id], "admin"
        )
        assert result_admin is True

    def test_can_view_seed_entry_by_anyone(self, setup_data):
        """Test: Todos pueden ver entries seed."""
        data = setup_data
        entry = data["seed_entry"]

        result = can_user_view_entry(
            entry, data["users"]["user_a"].id, [data["users"]["grupo_a"].id], "user"
        )
        assert result is True

    def test_can_edit_own_user_entry(self, setup_data):
        """Test: Usuario puede editar su propia entry."""
        data = setup_data
        user = data["users"]["user_a"]
        entry = data["user_entry"]

        result = can_user_edit_entry(
            entry, user.id, "user", [data["users"]["grupo_a"].id]
        )
        assert result is True

    def test_cannot_edit_other_user_entry(self, setup_data):
        """Test: Usuario NO puede editar entry de otro usuario."""
        data = setup_data
        viewer = data["users"]["user_b"]
        entry = data["user_entry"]

        result = can_user_edit_entry(
            entry, viewer.id, "user", [data["users"]["grupo_b"].id]
        )
        assert result is False

    def test_can_edit_admin_entry_by_admin_in_group(self, setup_data):
        """Test: Admin puede editar entries admin de su grupo."""
        data = setup_data
        admin = data["users"]["admin_a"]
        entry = data["admin_entry_a"]

        result = can_user_edit_entry(
            entry, admin.id, "admin", [data["users"]["grupo_a"].id]
        )
        assert result is True

    def test_cannot_edit_admin_entry_by_admin_other_group(self, setup_data):
        """Test: Admin NO puede editar entries admin de otro grupo."""
        data = setup_data
        admin_b = data["users"]["admin_b"]
        entry = data["admin_entry_a"]

        result = can_user_edit_entry(
            entry, admin_b.id, "admin", [data["users"]["grupo_b"].id]
        )
        assert result is False

    def test_can_edit_admin_entry_by_root(self, setup_data):
        """Test: Root puede editar entries admin."""
        data = setup_data
        root = data["users"]["root"]
        entry = data["admin_entry_a"]

        result = can_user_edit_entry(entry, root.id, "root", [])
        assert result is True

    def test_cannot_edit_user_entry_as_root(self, setup_data):
        """Test: Root NO puede editar entries de usuarios regulares."""
        data = setup_data
        root = data["users"]["root"]
        entry = data["user_entry"]

        result = can_user_edit_entry(entry, root.id, "root", [])
        assert result is False

    def test_can_edit_root_entry_by_root_only(self, setup_data):
        """Test: Solo root puede editar entries root."""
        data = setup_data
        root = data["users"]["root"]
        admin = data["users"]["admin_a"]
        entry = data["root_entry"]

        # Root puede editar su propia entry
        result_root = can_user_edit_entry(entry, root.id, "root", [])
        assert result_root is True

        # Admin NO puede editar entry root
        result_admin = can_user_edit_entry(
            entry, admin.id, "admin", [data["users"]["grupo_a"].id]
        )
        assert result_admin is False

    def test_cannot_edit_seed_entries(self, setup_data):
        """Test: Nadie puede editar entries seed."""
        data = setup_data
        entry = data["seed_entry"]

        # Root intenta editar
        result_root = can_user_edit_entry(entry, data["users"]["root"].id, "root", [])
        assert result_root is False

        # Admin intenta editar
        result_admin = can_user_edit_entry(
            entry, data["users"]["admin_a"].id, "admin", [data["users"]["grupo_a"].id]
        )
        assert result_admin is False

    def test_delete_permissions_same_as_edit(self, setup_data):
        """Test: Permisos de delete son idénticos a edit."""
        data = setup_data

        # Test varias combinaciones
        test_cases = [
            (
                data["user_entry"],
                data["users"]["user_a"],
                "user",
                [data["users"]["grupo_a"].id],
                True,
            ),
            (
                data["user_entry"],
                data["users"]["user_b"],
                "user",
                [data["users"]["grupo_b"].id],
                False,
            ),
            (
                data["admin_entry_a"],
                data["users"]["admin_a"],
                "admin",
                [data["users"]["grupo_a"].id],
                True,
            ),
            (data["root_entry"], data["users"]["root"], "root", [], True),
            (data["seed_entry"], data["users"]["root"], "root", [], False),
        ]

        for entry, user, role, groups, expected in test_cases:
            edit_result = can_user_edit_entry(entry, user.id, role, groups)
            delete_result = can_user_delete_entry(entry, user.id, role, groups)
            assert edit_result == delete_result == expected, (
                f"Mismatch para {entry.name} por {user.username}: "
                f"edit={edit_result}, delete={delete_result}, expected={expected}"
            )


@pytest.mark.django_db
class TestCRUDPermissions:
    """Tests para CRUD operations con permisos."""

    @pytest.fixture
    def setup_crud_data(self, setup_users_and_groups):
        """Prepara datos para tests CRUD."""
        users = setup_users_and_groups
        category = SmileitCategory.objects.create(
            stable_id="crud-cat",
            version=1,
            is_latest=True,
            is_active=True,
            name="CRUD Test Category",
        )
        return {"users": users, "category": category}

    def test_create_substituent_as_user(self, setup_crud_data):
        """Test: Usuario regular puede crear substituent con source_reference='local-lab'."""
        data = setup_crud_data
        user = data["users"]["user_a"]

        result = create_catalog_substituent(
            payload={
                "name": "Test User Substituent",
                "smiles": "CCCC",
                "anchor_atom_indices": [0],
                "category_keys": ["CRUD Test Category"],
                "provenance_metadata": {},
            },
            actor_user_id=user.id,
            actor_username=user.username,
            actor_role="user",
            actor_user_group_ids=[],
        )

        assert result is not None
        assert result.source_reference == "local-lab"
        assert result.created_by == user

    def test_create_pattern_as_admin(self, setup_crud_data):
        """Test: Admin puede crear pattern con source_reference='admin-{group_id}'."""
        data = setup_crud_data
        admin = data["users"]["admin_a"]

        result = create_pattern_entry(
            payload={
                "name": "Test Admin Pattern",
                "smarts": "[C:1][C:2]",
                "description": "Test pattern",
                "provenance_metadata": {},
            },
            actor_user_id=admin.id,
            actor_username=admin.username,
            actor_role="admin",
            actor_user_group_ids=[data["setup_users_and_groups"]["grupo_a"].id],
        )

        assert result is not None
        assert (
            result.source_reference
            == f"admin-{data['setup_users_and_groups']['grupo_a'].id}"
        )

    def test_create_substituent_as_root(self, setup_crud_data):
        """Test: Root puede crear substituent con source_reference='root'."""
        data = setup_crud_data
        root = data["users"]["root"]

        result = create_catalog_substituent(
            payload={
                "name": "Test Root Substituent",
                "smiles": "CCCCC",
                "anchor_atom_indices": [0],
                "category_keys": ["CRUD Test Category"],
                "provenance_metadata": {},
            },
            actor_user_id=root.id,
            actor_username=root.username,
            actor_role="root",
            actor_user_group_ids=[],
        )

        assert result is not None
        assert result.source_reference == "root"

    def test_list_entries_filtered_by_permissions(self, setup_crud_data):
        """Test: List operations filtran por permisos del usuario."""
        data = setup_crud_data
        user_a = data["users"]["user_a"]
        grupo_a_id = data["setup_users_and_groups"]["grupo_a"].id

        # Crear entries de diferentes tipos
        create_catalog_substituent(
            payload={
                "name": "User A Entry",
                "smiles": "C",
                "anchor_atom_indices": [0],
                "category_keys": ["CRUD Test Category"],
                "provenance_metadata": {},
            },
            actor_user_id=user_a.id,
            actor_username=user_a.username,
            actor_role="user",
            actor_user_group_ids=[grupo_a_id],
        )

        # Listar entries para user_a
        entries = list_active_catalog_entries(
            actor_user_id=user_a.id,
            actor_role="user",
            actor_user_group_ids=[grupo_a_id],
            filter_mode="normal",
        )

        # user_a debe ver su propia entry y seed entries
        assert any(e["name"] == "User A Entry" for e in entries)
