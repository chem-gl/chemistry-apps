"""test_seed.py: Mixin base con datos semilla para tests de Smile-it.

Objetivo del archivo:
- Proveer SmileitSeedTestCase con setUpTestData que crea categorías,
  sustituyentes y patrones mínimos requeridos para las pruebas de contrato
  sin depender de datos precargados en la base de datos de producción.

Cómo se usa:
- Heredar SmileitSeedTestCase en vez de TestCase en clases que necesiten
  acceso a categorías o sustituyentes del catálogo Smile-it.
"""

from __future__ import annotations

import uuid

from django.core.management import call_command
from django.test import TestCase

from ..models import (
    SmileitCategory,
    SmileitPattern,
    SmileitSubstituent,
    SmileitSubstituentCategory,
)
from ..seed_bootstrap import apply_smileit_seed_data
from ..seed_data import (
    CATEGORY_SEED_DEFINITIONS,
    PATTERN_SEED_DEFINITIONS,
    SUBSTITUENT_SEED_DEFINITIONS,
)


class SmileitSeedTestCase(TestCase):
    """TestCase base con datos semilla de categorías, sustituyentes y patrones.

    Crea los datos mínimos del catálogo que replican los datos de migración
    inicial, necesarios para que las pruebas de ciclo de vida funcionen
    independientemente del estado de la base de datos de producción.
    """

    @classmethod
    def setUpTestData(cls) -> None:
        """Crea categorías, sustituyentes y patrones semilla para los tests."""
        super().setUpTestData()

        # Crear categorías verificables base
        cls.cat_aromatic = cls._get_or_create_seed_category(
            key="aromatic",
            name="Aromatic",
            description="Contains aromatic ring systems.",
            verification_rule="aromatic",
        )
        cls.cat_hbond_donor = cls._get_or_create_seed_category(
            key="hbond_donor",
            name="Hydrogen Bond Donor",
            description="Contains donor atoms for hydrogen bonding.",
            verification_rule="hbond_donor",
        )
        cls.cat_hbond_acceptor = cls._get_or_create_seed_category(
            key="hbond_acceptor",
            name="Hydrogen Bond Acceptor",
            description="Contains acceptor atoms for hydrogen bonding.",
            verification_rule="hbond_acceptor",
        )
        cls.cat_hydrophobic = cls._get_or_create_seed_category(
            key="hydrophobic",
            name="Hydrophobic",
            description="Predominantly hydrophobic fragment.",
            verification_rule="hydrophobic",
        )

        # Crear sustituyentes semilla con sus categorías correspondientes
        benzene_sub = cls._get_or_create_seed_substituent(
            name="Benzene",
            smiles_input="c1ccccc1",
            smiles_canonical="c1ccccc1",
            anchor_atom_indices=[0],
        )
        SmileitSubstituentCategory.objects.get_or_create(
            substituent=benzene_sub,
            category=cls.cat_aromatic,
            defaults={
                "verification_passed": True,
                "verification_message": "Seed category assignment.",
            },
        )
        SmileitSubstituentCategory.objects.get_or_create(
            substituent=benzene_sub,
            category=cls.cat_hydrophobic,
            defaults={
                "verification_passed": True,
                "verification_message": "Seed category assignment.",
            },
        )

        amine_sub = cls._get_or_create_seed_substituent(
            name="Amine",
            smiles_input="[NH2]",
            smiles_canonical="N",
            anchor_atom_indices=[0],
        )
        SmileitSubstituentCategory.objects.get_or_create(
            substituent=amine_sub,
            category=cls.cat_hbond_donor,
            defaults={
                "verification_passed": True,
                "verification_message": "Seed category assignment.",
            },
        )
        SmileitSubstituentCategory.objects.get_or_create(
            substituent=amine_sub,
            category=cls.cat_hbond_acceptor,
            defaults={
                "verification_passed": True,
                "verification_message": "Seed category assignment.",
            },
        )

        chlorine_sub = cls._get_or_create_seed_substituent(
            name="Chlorine",
            smiles_input="[Cl]",
            smiles_canonical="[Cl]",
            anchor_atom_indices=[0],
        )
        SmileitSubstituentCategory.objects.get_or_create(
            substituent=chlorine_sub,
            category=cls.cat_hydrophobic,
            defaults={
                "verification_passed": True,
                "verification_message": "Seed category assignment.",
            },
        )

        # Crear patrón nitro aromático para tests de inspección
        cls._get_or_create_seed_pattern(
            name="Nitro Aromatic Alert",
            smarts="[NX3+](=O)[O-]",
            pattern_type="toxicophore",
            caption=(
                "Nitro group can be associated with toxicological alerts "
                "in medicinal chemistry."
            ),
        )

    @classmethod
    def _get_or_create_seed_category(
        cls,
        *,
        key: str,
        name: str,
        description: str,
        verification_rule: str,
    ) -> SmileitCategory:
        """Recupera o crea una categoría semilla manteniendo valores esperados por tests."""
        category, created = SmileitCategory.objects.get_or_create(
            key=key,
            version=1,
            defaults={
                "is_latest": True,
                "is_active": True,
                "name": name,
                "description": description,
                "verification_rule": verification_rule,
                "verification_smarts": "",
            },
        )

        if not created:
            # Mantiene el contrato de datos semilla aunque la categoría exista por otro setup.
            category.is_latest = True
            category.is_active = True
            category.name = name
            category.description = description
            category.verification_rule = verification_rule
            category.verification_smarts = ""
            category.save(
                update_fields=[
                    "is_latest",
                    "is_active",
                    "name",
                    "description",
                    "verification_rule",
                    "verification_smarts",
                    "updated_at",
                ]
            )

        return category

    @classmethod
    def _get_or_create_seed_substituent(
        cls,
        *,
        name: str,
        smiles_input: str,
        smiles_canonical: str,
        anchor_atom_indices: list[int],
    ) -> SmileitSubstituent:
        """Recupera o crea un sustituyente semilla para evitar duplicados entre clases."""
        substituent, created = SmileitSubstituent.objects.get_or_create(
            name=name,
            version=1,
            defaults={
                "stable_id": uuid.uuid4(),
                "is_latest": True,
                "is_active": True,
                "smiles_input": smiles_input,
                "smiles_canonical": smiles_canonical,
                "anchor_atom_indices": anchor_atom_indices,
                "source_reference": "seed",
                "provenance_metadata": {"seed": True},
            },
        )

        if not created:
            substituent.is_latest = True
            substituent.is_active = True
            substituent.smiles_input = smiles_input
            substituent.smiles_canonical = smiles_canonical
            substituent.anchor_atom_indices = anchor_atom_indices
            substituent.source_reference = "seed"
            substituent.provenance_metadata = {"seed": True}
            substituent.save(
                update_fields=[
                    "is_latest",
                    "is_active",
                    "smiles_input",
                    "smiles_canonical",
                    "anchor_atom_indices",
                    "source_reference",
                    "provenance_metadata",
                    "updated_at",
                ]
            )

        return substituent

    @classmethod
    def _get_or_create_seed_pattern(
        cls,
        *,
        name: str,
        smarts: str,
        pattern_type: str,
        caption: str,
    ) -> SmileitPattern:
        """Recupera o crea un patrón semilla evitando duplicación entre clases de test."""
        pattern = (
            SmileitPattern.objects.filter(name=name, version=1)
            .order_by("created_at")
            .first()
        )
        created = pattern is None

        if pattern is None:
            pattern = SmileitPattern.objects.create(
                stable_id=uuid.uuid4(),
                version=1,
                is_latest=True,
                is_active=True,
                name=name,
                smarts=smarts,
                pattern_type=pattern_type,
                caption=caption,
                source_reference="seed",
                provenance_metadata={"seed": True},
            )

        if not created:
            pattern.is_latest = True
            pattern.is_active = True
            pattern.smarts = smarts
            pattern.pattern_type = pattern_type
            pattern.caption = caption
            pattern.save(
                update_fields=[
                    "is_latest",
                    "is_active",
                    "smarts",
                    "pattern_type",
                    "caption",
                    "updated_at",
                ]
            )

        return pattern


class SmileitSeedBootstrapTests(TestCase):
    """Valida el bootstrap compartido de seeds reales del catálogo Smile-it."""

    def test_apply_smileit_seed_data_is_idempotent(self) -> None:
        """Reaplicar los seeds no debe duplicar categorías, sustituyentes ni patrones."""
        SmileitSubstituentCategory.objects.all().delete()
        SmileitSubstituent.objects.all().delete()
        SmileitPattern.objects.all().delete()
        SmileitCategory.objects.all().delete()

        apply_smileit_seed_data(
            category_model=SmileitCategory,
            substituent_model=SmileitSubstituent,
            link_model=SmileitSubstituentCategory,
            pattern_model=SmileitPattern,
        )
        apply_smileit_seed_data(
            category_model=SmileitCategory,
            substituent_model=SmileitSubstituent,
            link_model=SmileitSubstituentCategory,
            pattern_model=SmileitPattern,
        )

        self.assertEqual(
            SmileitCategory.objects.filter(version=1).count(),
            len(CATEGORY_SEED_DEFINITIONS),
        )
        self.assertEqual(
            SmileitSubstituent.objects.filter(version=1).count(),
            len(SUBSTITUENT_SEED_DEFINITIONS),
        )
        self.assertEqual(
            SmileitPattern.objects.filter(version=1).count(),
            len(PATTERN_SEED_DEFINITIONS),
        )
        self.assertEqual(
            SmileitSubstituentCategory.objects.count(),
            sum(len(seed.categories) for seed in SUBSTITUENT_SEED_DEFINITIONS),
        )

    def test_regenerate_smileit_seed_reset_restores_catalog(self) -> None:
        """El comando de gestión debe poder reconstruir el catálogo desde cero."""
        SmileitSubstituentCategory.objects.all().delete()
        SmileitSubstituent.objects.all().delete()
        SmileitPattern.objects.all().delete()
        SmileitCategory.objects.all().delete()

        call_command("regenerate_smileit_seed", "--reset")

        self.assertEqual(
            SmileitCategory.objects.filter(is_latest=True, is_active=True).count(),
            len(CATEGORY_SEED_DEFINITIONS),
        )
        self.assertEqual(
            SmileitSubstituent.objects.filter(is_latest=True, is_active=True).count(),
            len(SUBSTITUENT_SEED_DEFINITIONS),
        )
        self.assertEqual(
            SmileitPattern.objects.filter(is_latest=True, is_active=True).count(),
            len(PATTERN_SEED_DEFINITIONS),
        )
