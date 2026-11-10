"""Recalcula SMILES canónico y anclas de los sustituyentes semilla de Smile-it.

El bootstrap original guardaba `smiles_canonical` canónico pero dejaba
`anchor_atom_indices=[0]` tomado del espacio crudo. RDKit puede reordenar átomos
al canonicalizar (`C(=O)O` → `O=CO`), así que el ancla 0 apuntaba a otro átomo y
la fusión se rechazaba en todos los sitios (semillas "muertas").

Solo las filas del bootstrap (`source_reference == SUBSTITUENT_SOURCE_REFERENCE`)
tienen este patrón: su única ancla cruda era siempre `[0]`. La migración recalcula
canónico + anclas con esa misma premisa, de modo que reejecutarla es idempotente
(las filas ya corregidas se quedan igual).
"""

from django.db import migrations

from apps.smileit.engine import remap_anchor_indices_to_canonical
from apps.smileit.seed_bootstrap import SUBSTITUENT_SOURCE_REFERENCE

# Ancla cruda con la que el bootstrap original creó todas las semillas.
LEGACY_RAW_ANCHOR_INDICES: list[int] = [0]


def fix_seed_substituent_anchors(apps, schema_editor) -> None:
    """Remapea las anclas de los sustituyentes semilla al SMILES canónico real."""
    del schema_editor
    substituent_model = apps.get_model("smileit", "SmileitSubstituent")

    seed_substituents = substituent_model.objects.filter(
        source_reference=SUBSTITUENT_SOURCE_REFERENCE
    )
    for substituent in seed_substituents:
        if not substituent.smiles_input or not substituent.anchor_atom_indices:
            continue

        remapped = remap_anchor_indices_to_canonical(
            substituent.smiles_input, LEGACY_RAW_ANCHOR_INDICES
        )
        if remapped is None:
            continue

        canonical_smiles, remapped_anchors = remapped
        if len(remapped_anchors) != len(LEGACY_RAW_ANCHOR_INDICES):
            continue

        normalized_anchors = sorted(set(remapped_anchors))
        if (
            substituent.smiles_canonical == canonical_smiles
            and list(substituent.anchor_atom_indices) == normalized_anchors
        ):
            continue

        substituent.smiles_canonical = canonical_smiles
        substituent.anchor_atom_indices = normalized_anchors
        substituent.save(update_fields=["smiles_canonical", "anchor_atom_indices"])


class Migration(migrations.Migration):
    """Corrige las anclas de las semillas que quedaron apuntando al átomo equivocado."""

    dependencies = [
        ("smileit", "0002_smileit_seed_data"),
    ]

    operations = [
        migrations.RunPython(fix_seed_substituent_anchors, migrations.RunPython.noop),
    ]
