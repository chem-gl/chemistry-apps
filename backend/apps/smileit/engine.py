"""engine.py: Motor de química molecular para smileit usando RDKit.

Objetivo del archivo:
- Encapsular todas las operaciones RDKit: parseo de SMILES, inspección de átomos,
  fusión de moléculas por índice de átomo, generación 2D y renderizado SVG.
- Mantener la lógica química fuera de plugin.py para separar responsabilidades.

Cómo se usa:
- `plugin.py` importa las funciones de fusión y generación desde aquí.
- `routers.py` importa `inspect_smiles_structure` para el endpoint inspect-structure.
- Ninguna función aquí depende de Django ni de DRF.
"""

import logging
from typing import Optional

from rdkit import Chem
from rdkit.Chem import AllChem
from rdkit.Chem.Draw import rdMolDraw2D

from .definitions import IMAGE_HEIGHT, IMAGE_WIDTH
from .types import SmileitAtomInfo, SmileitStructureInspectionResult

logger = logging.getLogger(__name__)


def canonicalize_smiles(smiles: str) -> Optional[str]:
    """Retorna el SMILES canónico o None si el SMILES es inválido."""
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None
    return Chem.MolToSmiles(mol, isomericSmiles=True)


def canonicalize_substituent(smiles: str, anchor_idx: int) -> Optional[tuple[str, int]]:
    """Canonicaliza un SMILES de sustituyente preservando el índice del átomo de anclaje.

    Usa `rootedAtAtom` para iniciar el recorrido SMILES desde el átomo de anclaje,
    garantizando que al reparse el átomo de anclaje quede en el índice 0.
    Para sustituyentes monoatómicos el índice siempre es None (manejado por el plugin).

    Args:
        smiles: SMILES del sustituyente (puede no ser canónico).
        anchor_idx: Índice del átomo de anclaje en el SMILES original.

    Returns:
        Tupla (canonical_smiles, new_anchor_idx) o None si el SMILES es inválido.
    """
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None
    n_atoms: int = mol.GetNumAtoms()
    # Clampar el índice por si el payload trae un índice fuera de rango
    safe_anchor: int = min(anchor_idx, n_atoms - 1)
    if n_atoms == 1:
        # Monoátomo: el índice siempre es 0
        return Chem.MolToSmiles(mol, isomericSmiles=True), 0
    # Rootear el SMILES en el átomo de anclaje: garantiza que al reparse
    # Chem.MolFromSmiles(result).GetAtomWithIdx(0) sea el átomo de anclaje.
    rooted_smiles: str = Chem.MolToSmiles(
        mol, isomericSmiles=True, rootedAtAtom=safe_anchor
    )
    return rooted_smiles, 0


def validate_smiles(smiles: str) -> bool:
    """Retorna True si el SMILES es parseable por RDKit."""
    return Chem.MolFromSmiles(smiles) is not None


def get_implicit_hydrogens(atom: Chem.Atom) -> int:
    """Retorna el número de hidrógenos implícitos de un átomo."""
    try:
        return atom.GetNumImplicitHs()
    except Exception:  # noqa: BLE001
        return 0


def _display_atom_symbol(atom: Chem.Atom) -> str:
    """Normaliza símbolos especiales para mantener paridad visual con el legado."""
    if atom.GetAtomicNum() == 0 or atom.GetSymbol() == "*":
        return "R"
    return atom.GetSymbol()


def inspect_smiles_structure(smiles: str) -> SmileitStructureInspectionResult:
    """Parsea un SMILES y retorna átomo indexado, conteo y SVG para la UI.

    Args:
        smiles: Cadena SMILES de la molécula a inspeccionar.

    Returns:
        SmileitStructureInspectionResult con canonical_smiles, átomo_count,
        lista de átomos indexados y SVG generado con etiquetas de índice.

    Raises:
        ValueError: Si el SMILES no es válido.
    """
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        raise ValueError(f"SMILES inválido: {smiles!r}")

    canonical: str = Chem.MolToSmiles(mol, isomericSmiles=True)
    mol = Chem.MolFromSmiles(
        canonical
    )  # reparsear desde canónico para índices consistentes
    if mol is None:
        raise ValueError(f"No se pudo repar­sear canónico generado para {smiles!r}")

    # Generar coordenadas 2D para el SVG
    AllChem.Compute2DCoords(mol)

    atoms: list[SmileitAtomInfo] = []
    for atom in mol.GetAtoms():
        atoms.append(
            SmileitAtomInfo(
                index=atom.GetIdx(),
                symbol=_display_atom_symbol(atom),
                implicit_hydrogens=get_implicit_hydrogens(atom),
                is_aromatic=atom.GetIsAromatic(),
            )
        )

    svg: str = _render_molecule_svg_with_indices(mol)

    return SmileitStructureInspectionResult(
        canonical_smiles=canonical,
        atom_count=mol.GetNumAtoms(),
        atoms=atoms,
        svg=svg,
    )


def _render_molecule_svg_with_indices(mol: Chem.Mol) -> str:
    """Renderiza la molécula como SVG con índices de átomos visibles.

    Se quita la etiqueta de 'uso de átomos' mapeados por TagAtoms para dar
    índices secuenciales desde 0 visibles en la UI de selección.
    """
    drawer = rdMolDraw2D.MolDraw2DSVG(IMAGE_WIDTH, IMAGE_HEIGHT)
    drawer.drawOptions().addAtomIndices = True
    drawer.DrawMolecule(mol)
    drawer.FinishDrawing()
    return drawer.GetDrawingText()


def render_molecule_svg(smiles: str) -> str:
    """Renderiza un SMILES como SVG limpio (sin índices visibles en el SVG de resultado).

    Args:
        smiles: Cadena SMILES de la molécula.

    Returns:
        Cadena SVG. Si falla, retorna una cadena vacía y logea el error.
    """
    try:
        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            return ""
        AllChem.Compute2DCoords(mol)
        drawer = rdMolDraw2D.MolDraw2DSVG(IMAGE_WIDTH, IMAGE_HEIGHT)
        drawer.DrawMolecule(mol)
        drawer.FinishDrawing()
        return drawer.GetDrawingText()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Error renderizando SVG para %r: %s", smiles, exc)
        return ""


def fuse_molecules(
    principal_smiles: str,
    substituent_smiles: str,
    principal_atom_idx: Optional[int],
    substituent_atom_idx: Optional[int],
    bond_order: int,
) -> Optional[str]:
    """Fusiona la molécula principal con un sustituyente en los átomos indicados.

    Implementa la misma lógica de Molecule.fusionMolecule() del legado Java:
    - Conecta `principal_atom_idx` con `substituent_atom_idx` con un enlace de
      orden `bond_order`.
    - Si cualquiera de los índices es None (molécula de 1 solo átomo), se toma
      el único átomo disponible.

    Args:
        principal_smiles: SMILES de la molécula principal (ya canónico).
        substituent_smiles: SMILES del sustituyente.
        principal_atom_idx: Índice del átomo de unión en el principal (None si 1 átomo).
        substituent_atom_idx: Índice del átomo de unión en el sustituyente (None si 1 átomo).
        bond_order: Orden del enlace a crear (1, 2 o 3).

    Returns:
        SMILES canónico de la molécula fusionada, o None si la fusión no es válida.
    """
    mol_p = Chem.MolFromSmiles(principal_smiles)
    mol_s = Chem.MolFromSmiles(substituent_smiles)
    if mol_p is None or mol_s is None:
        return None

    # Resolver índices de átomos de unión
    p_idx: int = principal_atom_idx if principal_atom_idx is not None else 0
    s_idx: int = substituent_atom_idx if substituent_atom_idx is not None else 0

    if p_idx >= mol_p.GetNumAtoms() or s_idx >= mol_s.GetNumAtoms():
        logger.warning(
            "Índice de átomo fuera de rango: p_idx=%d, s_idx=%d", p_idx, s_idx
        )
        return None

    atom_p = mol_p.GetAtomWithIdx(p_idx)
    atom_s = mol_s.GetAtomWithIdx(s_idx)

    if atom_s.GetAtomicNum() == 0 or atom_s.GetSymbol() == "*":
        return _fuse_with_wildcard_anchor(
            principal_molecule=mol_p,
            substituent_molecule=mol_s,
            principal_atom_idx=p_idx,
            wildcard_atom_idx=s_idx,
            principal_smiles=principal_smiles,
            substituent_smiles=substituent_smiles,
        )

    if not _has_enough_implicit_hydrogens(atom_p, atom_s, bond_order):
        return None

    # Combinar las dos moléculas en un RWMol
    combo = Chem.RWMol(Chem.CombineMols(mol_p, mol_s))

    # El índice del átomo del sustituyente en el combo es desplazado por n átomos del principal
    offset: int = mol_p.GetNumAtoms()
    bond_type = _bond_order_to_type(bond_order)

    combo.AddBond(p_idx, s_idx + offset, bond_type)

    try:
        Chem.SanitizeMol(combo)
    except Exception as exc:  # noqa: BLE001
        logger.debug(
            "Sanitización fallida para fusión %r + %r: %s",
            principal_smiles,
            substituent_smiles,
            exc,
        )
        return None

    try:
        return Chem.MolToSmiles(combo, isomericSmiles=True)
    except Exception as exc:  # noqa: BLE001
        logger.debug("Error generando SMILES: %s", exc)
        return None


def _fuse_with_wildcard_anchor(
    principal_molecule: Chem.Mol,
    substituent_molecule: Chem.Mol,
    principal_atom_idx: int,
    wildcard_atom_idx: int,
    principal_smiles: str,
    substituent_smiles: str,
) -> Optional[str]:
    """Fusiona usando un átomo comodín `*` como punto de anclaje removible.

    El legado trataba `*` como un marcador visual `R`: el átomo no debía quedar
    en el resultado final, sino ser reemplazado por el átomo del principal.
    """
    wildcard_atom = substituent_molecule.GetAtomWithIdx(wildcard_atom_idx)
    if wildcard_atom.GetDegree() != 1:
        return None

    wildcard_bond = wildcard_atom.GetBonds()[0]
    substituent_neighbor_idx: int = wildcard_bond.GetOtherAtomIdx(wildcard_atom_idx)
    substituent_neighbor = substituent_molecule.GetAtomWithIdx(substituent_neighbor_idx)
    principal_atom = principal_molecule.GetAtomWithIdx(principal_atom_idx)

    bond_order = int(wildcard_bond.GetBondTypeAsDouble())
    if not _has_enough_implicit_hydrogens(
        principal_atom,
        substituent_neighbor,
        bond_order,
    ):
        return None

    editable_substituent = Chem.RWMol(substituent_molecule)
    editable_substituent.RemoveAtom(wildcard_atom_idx)
    normalized_substituent = editable_substituent.GetMol()

    normalized_neighbor_idx: int = substituent_neighbor_idx
    if substituent_neighbor_idx > wildcard_atom_idx:
        normalized_neighbor_idx -= 1

    combo = Chem.RWMol(Chem.CombineMols(principal_molecule, normalized_substituent))
    offset: int = principal_molecule.GetNumAtoms()
    combo.AddBond(
        principal_atom_idx,
        normalized_neighbor_idx + offset,
        wildcard_bond.GetBondType(),
    )

    try:
        Chem.SanitizeMol(combo)
    except Exception as exc:  # noqa: BLE001
        logger.debug(
            "Sanitización fallida para wildcard %r + %r: %s",
            principal_smiles,
            substituent_smiles,
            exc,
        )
        return None

    try:
        return Chem.MolToSmiles(combo, isomericSmiles=True)
    except Exception as exc:  # noqa: BLE001
        logger.debug("Error generando SMILES con wildcard: %s", exc)
        return None


def _has_enough_implicit_hydrogens(
    atom_p: Chem.Atom, atom_s: Chem.Atom, bond_order: int
) -> bool:
    """Verifica si los dos átomos tienen suficientes hidrógenos disponibles para el enlace.

    Refleja la lógica `haveEnoughImplicitHydrogens` del legado Java.
    Si cualquiera de los dos no es carbono, siempre se permite (heteroátomos
    tienen semántica especial de valencia flexible).

    Para carbonos se comprueba la suma de H implícitos + H explícitos porque
    sustituyentes como [CH2]Cl o [CH]=O especifican sus H vía notación de
    corchete (implícitos=0, explícitos>0) pero aún poseen valencia libre.
    """
    if atom_p.GetSymbol() != "C" or atom_s.GetSymbol() != "C":
        return True
    h_p: int = get_implicit_hydrogens(atom_p) + atom_p.GetNumExplicitHs()
    h_s: int = get_implicit_hydrogens(atom_s) + atom_s.GetNumExplicitHs()
    return h_p >= bond_order and h_s >= bond_order


def _bond_order_to_type(order: int) -> Chem.rdchem.BondType:
    """Convierte un entero de orden de enlace al tipo RDKit."""
    mapping: dict[int, Chem.rdchem.BondType] = {
        1: Chem.rdchem.BondType.SINGLE,
        2: Chem.rdchem.BondType.DOUBLE,
        3: Chem.rdchem.BondType.TRIPLE,
    }
    return mapping.get(order, Chem.rdchem.BondType.SINGLE)
