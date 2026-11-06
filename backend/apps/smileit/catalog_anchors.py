"""catalog_anchors.py: Validación y remapeo de índices de anclaje para Smile-it.

Objetivo del archivo:
- Validar índices de anclaje contra la molécula y normalizarlos.
- Remapear anclajes del espacio crudo al SMILES canónico antes de persistir.

Cómo se usa:
- `catalog.py` importa estos helpers para crear/actualizar sustituyentes.
"""

from __future__ import annotations

from rdkit import Chem

from .engine import remap_anchor_indices_to_canonical


def _assert_anchor_indices(smiles: str, anchor_atom_indices: list[int]) -> list[int]:
    """Valida índices de anclaje y retorna lista normalizada ordenada sin repetidos."""
    molecule = Chem.MolFromSmiles(smiles)
    if molecule is None:
        raise ValueError("SMILES inválido para validar índices de anclaje.")

    atom_count = molecule.GetNumAtoms()
    if atom_count <= 0:
        raise ValueError("El sustituyente debe contener al menos un átomo.")

    normalized_indices: list[int] = sorted(
        {int(value) for value in anchor_atom_indices}
    )
    if len(normalized_indices) == 0:
        raise ValueError("Debe indicar al menos un índice de anclaje válido.")

    for atom_index in normalized_indices:
        if atom_index < 0 or atom_index >= atom_count:
            raise ValueError(
                "Se detectó un índice de anclaje fuera de rango para el sustituyente."
            )
    return normalized_indices


def _remap_substituent_anchors_or_raise(
    raw_smiles: str,
    anchor_atom_indices: list[int],
    substituent_label: str,
) -> tuple[str, list[int]]:
    """Canoniza el SMILES y remapea los anclajes crudos a ese espacio.

    RDKit puede reordenar átomos al canonicalizar (p. ej. 'C(=O)O' con el C
    en idx 0 se canonicaliza a 'O=CO' con el C en idx 1): validar los índices
    crudos contra la molécula canónica aceptaría el índice pero apuntaría al
    átomo equivocado. Este helper traduce los anclajes antes de validar, con
    la misma semántica de error que `_assert_anchor_indices` para entradas
    vacías o fuera de rango.
    """
    if len(anchor_atom_indices) == 0:
        raise ValueError("Debe indicar al menos un índice de anclaje válido.")

    remapped = remap_anchor_indices_to_canonical(raw_smiles, anchor_atom_indices)
    if remapped is None or len(remapped[1]) != len(anchor_atom_indices):
        raise ValueError(
            "Se detectó un índice de anclaje fuera de rango para el sustituyente "
            f"{substituent_label!r}: {anchor_atom_indices} no se pudo mapear al "
            "SMILES canónico."
        )

    canonical_smiles, remapped_anchors = remapped
    return canonical_smiles, sorted(set(remapped_anchors))
