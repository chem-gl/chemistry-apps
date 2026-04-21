"""seed_bootstrap.py: Bootstrap idempotente de los datos semilla de Smile-it.

Objetivo del archivo:
- Reutilizar la misma lógica de carga y desactivación de seeds tanto desde
  migraciones como desde comandos de gestión.
- Mantener el catálogo base pequeño, verificable y coherente con un reinicio
  completo de la base de datos.
"""

from __future__ import annotations

import uuid

from django.db.models import Model

from .seed_data import (
    CATEGORY_SEED_DEFINITIONS,
    PATTERN_SEED_DEFINITIONS,
    SUBSTITUENT_SEED_DEFINITIONS,
)

type SeedModelType = type[Model]

SUBSTITUENT_SOURCE_REFERENCE = "legacy-smileit"
PATTERN_SOURCE_REFERENCE = "smileit-seed"
SEED_PROVENANCE = {"seed": True}


def apply_smileit_seed_data(
    *,
    category_model: SeedModelType,
    substituent_model: SeedModelType,
    link_model: SeedModelType,
    pattern_model: SeedModelType,
) -> None:
    """Crea o recupera el catálogo semilla mínimo de Smile-it de forma idempotente."""
    categories_by_key: dict[str, Model] = {}

    for category_seed in CATEGORY_SEED_DEFINITIONS:
        category, _ = category_model.objects.get_or_create(
            key=category_seed.key,
            version=1,
            defaults={
                "is_latest": True,
                "is_active": True,
                "name": category_seed.name,
                "description": category_seed.description,
                "verification_rule": category_seed.verification_rule,
                "verification_smarts": "",
            },
        )
        categories_by_key[category_seed.key] = category

    for substituent_seed in SUBSTITUENT_SEED_DEFINITIONS:
        substituent, _ = substituent_model.objects.get_or_create(
            name=substituent_seed.name,
            version=1,
            defaults={
                "stable_id": uuid.uuid4(),
                "is_latest": True,
                "is_active": True,
                "smiles_input": substituent_seed.smiles,
                "smiles_canonical": substituent_seed.smiles,
                "anchor_atom_indices": [0],
                "source_reference": SUBSTITUENT_SOURCE_REFERENCE,
                "provenance_metadata": SEED_PROVENANCE,
            },
        )

        for category_key in substituent_seed.categories:
            link_model.objects.get_or_create(
                substituent=substituent,
                category=categories_by_key[category_key],
                defaults={
                    "verification_passed": True,
                    "verification_message": "Seed category assignment.",
                },
            )

    for pattern_seed in PATTERN_SEED_DEFINITIONS:
        pattern_model.objects.get_or_create(
            name=pattern_seed.name,
            pattern_type=pattern_seed.pattern_type,
            version=1,
            defaults={
                "stable_id": uuid.uuid4(),
                "is_latest": True,
                "is_active": True,
                "smarts": pattern_seed.smarts,
                "caption": pattern_seed.caption,
                "source_reference": PATTERN_SOURCE_REFERENCE,
                "provenance_metadata": SEED_PROVENANCE,
            },
        )


def deactivate_smileit_seed_data(
    *,
    category_model: SeedModelType,
    substituent_model: SeedModelType,
    pattern_model: SeedModelType,
) -> None:
    """Marca como inactivos los registros semilla sin borrar su trazabilidad."""
    seed_category_keys = [seed.key for seed in CATEGORY_SEED_DEFINITIONS]
    category_model.objects.filter(key__in=seed_category_keys, version=1).update(
        is_active=False
    )
    substituent_model.objects.filter(
        source_reference=SUBSTITUENT_SOURCE_REFERENCE,
        provenance_metadata__seed=True,
    ).update(is_active=False)
    pattern_model.objects.filter(
        source_reference=PATTERN_SOURCE_REFERENCE,
        provenance_metadata__seed=True,
    ).update(is_active=False)
