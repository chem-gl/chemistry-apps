"""0003_fix_seed_anchor_indices.py: Corrige anchor_atom_indices y smiles_canonical en seeds.

Problema: La migración 0001 original guardaba smiles_canonical=smiles_input (sin canonicalizar)
y anchor_atom_indices siempre en [0], sin remapar al espacio del SMILES canónico.

Esta migración corrige los seeds de deployments anteriores al fix de 0001.
En instalaciones nuevas (0001 ya corregido) el guard detecta que smiles_canonical ya
es canónico y no hace nada.

Nota: las migraciones usan modelos históricos (apps.get_model) que no ejecutan el
save() del modelo real, por lo que gestionamos smiles_canonical explícitamente aquí.
El invariante de dominio (save() en SmileitSubstituent) protege todas las escrituras
futuras a través del ORM real.
"""

from __future__ import annotations

from django.db import migrations


def fix_seed_anchor_indices(apps, schema_editor) -> None:
    """Remapea anchor_atom_indices de espacio-input a espacio-canónico para seeds viejos.

    Solo actúa cuando smiles_canonical almacenado NO es el canónico real, lo que
    indica que el registro viene del 0001 original.  Si ya es canónico los anchors
    están en el espacio correcto y no se tocan.
    """
    from rdkit import Chem  # noqa: PLC0415

    substituent_model = apps.get_model("smileit", "SmileitSubstituent")

    for substituent in substituent_model.objects.filter(
        source_reference="legacy-smileit"
    ):
        mol_input = Chem.MolFromSmiles(substituent.smiles_input)
        if mol_input is None:
            continue

        truly_canonical = Chem.MolToSmiles(mol_input, isomericSmiles=True)

        # Guard: si smiles_canonical ya es el canónico real, los anchor_atom_indices
        # ya están en espacio canónico (creados por 0001 corregido) → skip.
        if substituent.smiles_canonical == truly_canonical:
            continue

        # Datos de 0001 original: smiles_canonical era el smiles_input sin canonicalizar.
        # Los anchor_atom_indices están en espacio del smiles_input → remapar.
        mol_canonical = Chem.MolFromSmiles(truly_canonical)
        if mol_canonical is None:
            continue

        match: tuple[int, ...] = mol_canonical.GetSubstructMatch(mol_input)
        if not match:
            continue

        old_anchors: list[int] = list(substituent.anchor_atom_indices or [0])
        new_anchors: list[int] = [
            match[idx] for idx in old_anchors if 0 <= idx < len(match)
        ]
        if not new_anchors:
            continue

        substituent.smiles_canonical = truly_canonical
        substituent.anchor_atom_indices = new_anchors
        substituent.save(update_fields=["smiles_canonical", "anchor_atom_indices"])


class Migration(migrations.Migration):
    """Corrige anchor_atom_indices y smiles_canonical para seeds del 0001 original."""

    dependencies = [
        ("smileit", "0002_smileitcategory_created_by_and_more"),
    ]

    operations = [
        migrations.RunPython(
            fix_seed_anchor_indices,
            reverse_code=migrations.RunPython.noop,
        ),
    ]
