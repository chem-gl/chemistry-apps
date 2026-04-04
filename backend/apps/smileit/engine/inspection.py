"""engine/inspection.py: Inspección estructural de moléculas SMILES.

Parsea un SMILES y retorna información atómica indexada, propiedades
rápidas, anotaciones visuales y SVG para la interfaz de usuario.
"""

from rdkit import Chem
from rdkit.Chem import AllChem

from ..types import (
    SmileitAtomInfo,
    SmileitPatternEntry,
    SmileitStructureInspectionResult,
)
from .parsing import display_atom_symbol, get_implicit_hydrogens
from .rendering import render_molecule_svg_with_indices
from .verification import (
    build_active_pattern_refs,
    calculate_quick_properties,
    collect_pattern_annotations,
)


def inspect_smiles_structure(smiles: str) -> SmileitStructureInspectionResult:
    """Parsea un SMILES y retorna átomo indexado, conteo y SVG para la UI.

    Raises:
        ValueError: Si el SMILES no es válido.
    """
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        raise ValueError(f"SMILES inválido: {smiles!r}")

    canonical: str = Chem.MolToSmiles(mol, isomericSmiles=True)
    mol = Chem.MolFromSmiles(canonical)
    if mol is None:
        raise ValueError(f"No se pudo repar­sear canónico generado para {smiles!r}")

    AllChem.Compute2DCoords(mol)

    atoms: list[SmileitAtomInfo] = []
    for atom in mol.GetAtoms():
        atoms.append(
            SmileitAtomInfo(
                index=atom.GetIdx(),
                symbol=display_atom_symbol(atom),
                implicit_hydrogens=get_implicit_hydrogens(atom),
                is_aromatic=atom.GetIsAromatic(),
            )
        )

    svg: str = render_molecule_svg_with_indices(mol)
    quick_properties = calculate_quick_properties(mol)

    return SmileitStructureInspectionResult(
        canonical_smiles=canonical,
        atom_count=mol.GetNumAtoms(),
        atoms=atoms,
        svg=svg,
        quick_properties=quick_properties,
        annotations=[],
        active_pattern_refs=[],
    )


def inspect_smiles_structure_with_patterns(
    smiles: str,
    patterns: list[SmileitPatternEntry],
) -> SmileitStructureInspectionResult:
    """Inspecciona un SMILES y agrega anotaciones visuales por patrones activos."""
    base_result = inspect_smiles_structure(smiles)

    mol = Chem.MolFromSmiles(base_result["canonical_smiles"])
    if mol is None:
        raise ValueError(f"No se pudo parsear el canónico para anotación: {smiles!r}")

    annotations = collect_pattern_annotations(mol, patterns)
    base_result["annotations"] = annotations
    base_result["active_pattern_refs"] = build_active_pattern_refs(annotations)
    return base_result
