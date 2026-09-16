"""Tests Django del catálogo persistente de Smile-it."""

from __future__ import annotations

import uuid

from django.test import TestCase
from django.contrib.auth import get_user_model

from apps.smileit.catalog import (
    create_catalog_substituent,
    create_pattern_entry,
    delete_catalog_substituent,
    delete_pattern_entry,
    resolve_catalog_substituent_reference,
    update_catalog_substituent,
    update_pattern_entry,
)
from apps.smileit.models import SmileitPattern, SmileitSubstituent


def _sub_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "name": "Ethanol",
        "smiles": "CCO",
        "anchor_atom_indices": [0],
        "category_keys": [],
        "provenance_metadata": {" source ": " test "},
        "source_reference": "local-lab",
    }
    payload.update(overrides)
    return payload


def _pattern_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "name": "Alcohol",
        "smarts": "[OH]",
        "pattern_type": "toxicophore",
        "caption": "Alcohol group",
        "source_reference": "local-lab",
        "provenance_metadata": {},
    }
    payload.update(overrides)
    return payload


class SmileitCatalogCrudTests(TestCase):
    def setUp(self) -> None:
        self.user = get_user_model().objects.create_user(
            username="catalog-owner", password="test-password"
        )

    def test_create_and_resolve_substituent(self) -> None:
        created = create_catalog_substituent(
            _sub_payload(), actor_user_id=self.user.id, actor_username=self.user.username,
            actor_role="user",
        )
        resolved = resolve_catalog_substituent_reference(
            {"stable_id": created["stable_id"], "version": 1}
        )
        self.assertEqual(resolved["smiles"], "CCO")
        self.assertEqual(resolved["provenance_metadata"]["source"], "test")

    def test_create_rejects_invalid_anchor(self) -> None:
        with self.assertRaisesMessage(ValueError, "fuera de rango"):
            create_catalog_substituent(_sub_payload(anchor_atom_indices=[99]))

    def test_duplicate_substituent_is_rejected(self) -> None:
        create_catalog_substituent(
            _sub_payload(), actor_user_id=self.user.id, actor_username=self.user.username,
            actor_role="user",
        )
        with self.assertRaisesMessage(ValueError, "equivalente"):
            create_catalog_substituent(
                _sub_payload(name="Duplicate"), actor_user_id=self.user.id,
                actor_username=self.user.username, actor_role="user",
            )

    def test_update_creates_new_version_and_preserves_stable_id(self) -> None:
        created = create_catalog_substituent(
            _sub_payload(), actor_user_id=self.user.id, actor_username=self.user.username,
            actor_role="user",
        )
        updated = update_catalog_substituent(
            created["stable_id"], _sub_payload(name="Updated"),
            actor_user_id=self.user.id, actor_role="user",
        )
        self.assertEqual(updated["name"], "Updated")
        self.assertEqual(updated["version"], 2)
        self.assertFalse(
            SmileitSubstituent.objects.get(
                stable_id=created["stable_id"], version=1
            ).is_latest
        )

    def test_update_rejects_invalid_stable_id(self) -> None:
        with self.assertRaisesMessage(ValueError, "stable_id"):
            update_catalog_substituent("not-a-uuid", _sub_payload())

    def test_delete_substituent_soft_deletes(self) -> None:
        created = create_catalog_substituent(
            _sub_payload(), actor_user_id=self.user.id, actor_username=self.user.username,
            actor_role="user",
        )
        delete_catalog_substituent(
            created["stable_id"], actor_user_id=self.user.id, actor_role="user"
        )
        self.assertFalse(
            SmileitSubstituent.objects.get(id=created["id"]).is_active
        )

    def test_pattern_create_update_and_delete(self) -> None:
        created = create_pattern_entry(
            _pattern_payload(), actor_user_id=self.user.id, actor_role="user"
        )
        updated = update_pattern_entry(
            created["stable_id"], _pattern_payload(name="Updated pattern"),
            actor_user_id=self.user.id, actor_role="user",
        )
        self.assertEqual(updated["version"], 2)
        delete_pattern_entry(
            created["stable_id"], actor_user_id=self.user.id, actor_role="user"
        )
        self.assertFalse(
            SmileitPattern.objects.get(id=updated["id"]).is_active
        )

    def test_pattern_requires_caption_and_valid_smarts(self) -> None:
        with self.assertRaisesMessage(ValueError, "caption"):
            create_pattern_entry(_pattern_payload(caption=""))
        with self.assertRaisesMessage(ValueError, "SMARTS"):
            create_pattern_entry(_pattern_payload(smarts="[[invalid"))

    def test_resolve_missing_version_fails(self) -> None:
        with self.assertRaisesMessage(ValueError, "No existe"):
            resolve_catalog_substituent_reference(
                {"stable_id": str(uuid.uuid4()), "version": 1}
            )
