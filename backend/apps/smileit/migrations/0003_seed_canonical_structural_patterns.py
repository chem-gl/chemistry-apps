"""0003_seed_canonical_structural_patterns.py: Canonicaliza patrones estructurales semilla de Smile-it.

Esta migración garantiza que los patrones por defecto del catálogo estructural
usen stable_id fijos y consistentes entre entornos, para que frontend/backend
compartan referencias estables en inspección, toggles y trazabilidad.
"""

from __future__ import annotations

import uuid

from django.db import migrations

CANONICAL_PATTERN_SEED = (
    {
        "stable_id": "bee090e8-b983-4775-b564-74565f34c66a",
        "name": "Indole Privileged",
        "smarts": "c1ccc2[nH]ccc2c1",
        "pattern_type": "privileged",
        "caption": "Indole scaffold is a privileged motif in ligand design.",
    },
    {
        "stable_id": "a2034040-41bc-4dad-9d8d-8acd1a117093",
        "name": "Piperazine Privileged",
        "smarts": "N1CCNCC1",
        "pattern_type": "privileged",
        "caption": "Piperazine is frequently used to tune ADME and binding interactions.",
    },
    {
        "stable_id": "c8e17fd9-76dd-4ccb-8cb3-367aa4f38ebe",
        "name": "Catechol Alert",
        "smarts": "c1ccc(c(c1)O)O",
        "pattern_type": "toxicophore",
        "caption": "Catechol-like motifs can undergo redox cycling and reactive metabolism.",
    },
    {
        "stable_id": "967a0246-200a-4b68-b75e-7a3e77ee77d9",
        "name": "Nitro Aromatic Alert",
        "smarts": "[NX3+](=O)[O-]",
        "pattern_type": "toxicophore",
        "caption": (
            "Nitro group can be associated with toxicological alerts in "
            "medicinal chemistry."
        ),
    },
)


def ensure_canonical_seed_patterns(apps, schema_editor) -> None:
    """Crea o corrige los patrones semilla canónicos y desactiva variantes antiguas."""
    del schema_editor

    pattern_model = apps.get_model("smileit", "SmileitPattern")

    for seed_pattern in CANONICAL_PATTERN_SEED:
        stable_id = uuid.UUID(seed_pattern["stable_id"])

        pattern_model.objects.filter(
            name=seed_pattern["name"],
            source_reference="smileit-seed",
        ).exclude(stable_id=stable_id).delete()

        pattern_entry, _created = pattern_model.objects.get_or_create(
            stable_id=stable_id,
            version=1,
            defaults={
                "is_latest": True,
                "is_active": True,
                "name": seed_pattern["name"],
                "smarts": seed_pattern["smarts"],
                "pattern_type": seed_pattern["pattern_type"],
                "caption": seed_pattern["caption"],
                "source_reference": "smileit-seed",
                "provenance_metadata": {
                    "seed": True,
                    "canonical_seed": True,
                },
            },
        )

        pattern_entry.is_latest = True
        pattern_entry.is_active = True
        pattern_entry.name = seed_pattern["name"]
        pattern_entry.smarts = seed_pattern["smarts"]
        pattern_entry.pattern_type = seed_pattern["pattern_type"]
        pattern_entry.caption = seed_pattern["caption"]
        pattern_entry.source_reference = "smileit-seed"
        pattern_entry.provenance_metadata = {
            "seed": True,
            "canonical_seed": True,
        }
        pattern_entry.save(
            update_fields=[
                "is_latest",
                "is_active",
                "name",
                "smarts",
                "pattern_type",
                "caption",
                "source_reference",
                "provenance_metadata",
                "updated_at",
            ]
        )

        pattern_model.objects.filter(stable_id=stable_id).exclude(
            id=pattern_entry.id
        ).update(is_latest=False)


def noop_reverse(apps, schema_editor) -> None:
    """No revierte datos semilla para evitar pérdida de trazabilidad."""
    del apps, schema_editor


class Migration(migrations.Migration):
    dependencies = [
        (
            "smileit",
            "0002_rename_smileit_cat_key_latest_idx_smileit_smi_key_21b494_idx_and_more",
        ),
    ]

    operations = [
        migrations.RunPython(ensure_canonical_seed_patterns, noop_reverse),
    ]
