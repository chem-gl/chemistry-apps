"""smiles_batch.py: Utilidades compartidas para lotes tipados de SMILES.

Objetivo del archivo:
- Normalizar entradas de lotes químicos con pares opcionales name/smiles.
- Validar compatibilidad RDKit en un único punto para evitar duplicación.

Cómo se usa:
- Los serializers de apps científicas llaman `normalize_named_smiles_entries`.
- Los plugins consumen la salida ya normalizada para preservar nombres de moléculas.
"""

from __future__ import annotations

from typing import Mapping, TypedDict

from rdkit import Chem


class NamedSmilesEntry(TypedDict):
    """Representa una fila de entrada con nombre visible y SMILES normalizado."""

    name: str
    smiles: str


def normalize_named_smiles_entries(
    *,
    smiles_list: list[str] | None = None,
    molecule_entries: list[Mapping[str, object]] | None = None,
) -> list[NamedSmilesEntry]:
    """Normaliza entradas de SMILES preservando nombres explícitos cuando existan."""
    normalized_entries: list[NamedSmilesEntry] = []

    if molecule_entries is not None:
        raw_entries: list[Mapping[str, object]] = molecule_entries
    else:
        raw_entries = [{"smiles": smiles_value} for smiles_value in smiles_list or []]

    for raw_entry in raw_entries:
        raw_smiles_value: object = raw_entry.get("smiles", "")
        normalized_smiles: str = str(raw_smiles_value).strip()
        if normalized_smiles == "":
            continue

        if Chem.MolFromSmiles(normalized_smiles) is None:
            raise ValueError(f"SMILES no compatible con RDKit: {normalized_smiles}")

        raw_name_value: object | None = raw_entry.get("name")
        normalized_name: str = (
            str(raw_name_value).strip()
            if raw_name_value is not None
            else normalized_smiles
        )
        if normalized_name == "":
            normalized_name = normalized_smiles

        normalized_entries.append(
            {
                "name": normalized_name,
                "smiles": normalized_smiles,
            }
        )

    if len(normalized_entries) == 0:
        raise ValueError(
            "La lista de moléculas no puede quedar vacía tras normalizar name/smiles."
        )

    return normalized_entries
