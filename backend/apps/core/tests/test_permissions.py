"""test_permissions.py: Pruebas unitarias del módulo transversal de permisos.

Objetivo del archivo:
- Cubrir reglas puras de visibilidad, edición y eliminación basadas en
  `source_reference` y `provenance_metadata`.
- Validar ramas de parsing y fallback para evitar regresiones silenciosas en
  Smileit y en futuras apps científicas que reutilicen estas helpers.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from django.test import SimpleTestCase

from apps.core.permissions import (
    _get_owner_user_id_from_metadata,
    can_user_delete_entry,
    can_user_edit_entry,
    can_user_view_entry,
    get_entry_owner_group_id,
    get_entry_source_reference,
    get_source_reference_for_role,
)


@dataclass(slots=True)
class DummyEntry:
    """Entrada mínima para probar permisos sin depender de modelos Django."""

    source_reference: str
    provenance_metadata: object = field(default_factory=dict)


class PermissionsModuleTests(SimpleTestCase):
    """Cubre las ramas principales y de fallback del sistema de permisos."""

    def test_source_reference_is_normalized(self) -> None:
        # Verifica normalización de espacios y mayúsculas en la fuente de una entrada.
        entry = DummyEntry(source_reference="  Admin-15  ")
        self.assertEqual(get_entry_source_reference(entry), "admin-15")

    def test_owner_group_id_returns_none_for_invalid_or_non_admin_sources(self) -> None:
        # Verifica parsing robusto del grupo propietario para fuentes admin y no-admin.
        self.assertIsNone(
            get_entry_owner_group_id(DummyEntry(source_reference="local-lab"))
        )
        self.assertIsNone(
            get_entry_owner_group_id(DummyEntry(source_reference="admin-abc"))
        )
        self.assertEqual(
            get_entry_owner_group_id(DummyEntry(source_reference="admin-42")), 42
        )

    def test_owner_user_id_from_metadata_handles_missing_invalid_and_valid_values(
        self,
    ) -> None:
        # Verifica fallback seguro cuando la metadata no es usable y parsing correcto cuando sí lo es.
        self.assertIsNone(
            _get_owner_user_id_from_metadata(
                DummyEntry(source_reference="local-lab", provenance_metadata=None)
            )
        )
        self.assertIsNone(
            _get_owner_user_id_from_metadata(
                DummyEntry(source_reference="local-lab", provenance_metadata={})
            )
        )
        self.assertIsNone(
            _get_owner_user_id_from_metadata(
                DummyEntry(
                    source_reference="local-lab",
                    provenance_metadata={"owner_user_id": "abc"},
                ),
            ),
        )
        self.assertEqual(
            _get_owner_user_id_from_metadata(
                DummyEntry(
                    source_reference="local-lab",
                    provenance_metadata={"owner_user_id": " 7 "},
                ),
            ),
            7,
        )

    def test_view_permissions_cover_seed_root_owner_group_and_unknown_sources(
        self,
    ) -> None:
        # Verifica visibilidad para todas las fuentes soportadas y el fallback de denegación.
        seed_entry = DummyEntry(source_reference="smileit-seed")
        root_entry = DummyEntry(source_reference="root")
        owned_entry = DummyEntry(
            source_reference="local-lab",
            provenance_metadata={"owner_user_id": "9"},
        )
        admin_entry = DummyEntry(source_reference="admin-5")
        unknown_entry = DummyEntry(source_reference="legacy-custom")

        self.assertTrue(can_user_view_entry(seed_entry, actor_user_id=None))
        self.assertTrue(can_user_view_entry(root_entry, actor_user_id=None))
        self.assertTrue(
            can_user_view_entry(owned_entry, actor_user_id=9, actor_role="user")
        )
        self.assertFalse(
            can_user_view_entry(owned_entry, actor_user_id=10, actor_role="user")
        )
        self.assertTrue(
            can_user_view_entry(
                admin_entry, actor_user_id=11, actor_user_groups=[5], actor_role="user"
            )
        )
        self.assertFalse(
            can_user_view_entry(
                admin_entry, actor_user_id=11, actor_user_groups=[7], actor_role="user"
            )
        )
        self.assertTrue(
            can_user_view_entry(unknown_entry, actor_user_id=1, actor_role="root")
        )
        self.assertFalse(
            can_user_view_entry(unknown_entry, actor_user_id=1, actor_role="user")
        )

    def test_view_permissions_reject_unauthenticated_non_public_entries(self) -> None:
        # Verifica que una entrada privada no quede visible sin autenticación.
        entry = DummyEntry(
            source_reference="local-lab", provenance_metadata={"owner_user_id": "4"}
        )
        self.assertFalse(
            can_user_view_entry(entry, actor_user_id=None, actor_role=None)
        )

    def test_edit_permissions_cover_user_admin_root_seed_and_unknown_sources(
        self,
    ) -> None:
        # Verifica las reglas de edición por rol y fuente, incluyendo bloqueos explícitos.
        user_entry = DummyEntry(
            source_reference="local-lab", provenance_metadata={"owner_user_id": "3"}
        )
        admin_entry = DummyEntry(source_reference="admin-8")
        root_entry = DummyEntry(source_reference="root")
        seed_entry = DummyEntry(source_reference="legacy-smileit")
        unknown_entry = DummyEntry(source_reference="custom-source")

        self.assertTrue(
            can_user_edit_entry(user_entry, actor_user_id=3, actor_role="user")
        )
        self.assertFalse(
            can_user_edit_entry(user_entry, actor_user_id=3, actor_role="root")
        )
        self.assertFalse(
            can_user_edit_entry(user_entry, actor_user_id=9, actor_role="user")
        )
        self.assertTrue(
            can_user_edit_entry(
                admin_entry, actor_user_id=1, actor_role="admin", actor_user_groups=[8]
            )
        )
        self.assertTrue(
            can_user_edit_entry(
                admin_entry, actor_user_id=1, actor_role="root", actor_user_groups=[]
            )
        )
        self.assertFalse(
            can_user_edit_entry(
                admin_entry, actor_user_id=1, actor_role="admin", actor_user_groups=[2]
            )
        )
        self.assertTrue(
            can_user_edit_entry(root_entry, actor_user_id=1, actor_role="root")
        )
        self.assertFalse(
            can_user_edit_entry(root_entry, actor_user_id=1, actor_role="admin")
        )
        self.assertFalse(
            can_user_edit_entry(seed_entry, actor_user_id=1, actor_role="root")
        )
        self.assertFalse(
            can_user_edit_entry(unknown_entry, actor_user_id=1, actor_role="admin")
        )

    def test_delete_permissions_delegate_to_edit_rules(self) -> None:
        # Verifica que eliminación reutiliza exactamente la misma política que edición.
        admin_entry = DummyEntry(source_reference="admin-6")
        self.assertTrue(
            can_user_delete_entry(
                admin_entry, actor_user_id=2, actor_role="admin", actor_user_groups=[6]
            )
        )
        self.assertFalse(
            can_user_delete_entry(
                admin_entry, actor_user_id=2, actor_role="user", actor_user_groups=[6]
            )
        )

    def test_source_reference_for_role_covers_all_supported_roles(self) -> None:
        # Verifica el mapeo de roles a source_reference y la validación del grupo admin.
        self.assertEqual(get_source_reference_for_role("root"), "root")
        self.assertEqual(get_source_reference_for_role("user"), "local-lab")
        self.assertEqual(
            get_source_reference_for_role("admin", actor_primary_group_id=12),
            "admin-12",
        )
        self.assertEqual(get_source_reference_for_role(None), "")

    def test_source_reference_for_admin_requires_primary_group(self) -> None:
        # Verifica que un admin sin grupo primario no pueda producir un source_reference ambiguo.
        with self.assertRaises(ValueError):
            get_source_reference_for_role("admin")
