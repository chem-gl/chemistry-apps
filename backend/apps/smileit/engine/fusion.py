"""engine/fusion.py: Fusión molecular por índice de átomo con RDKit.

Funciones para evaluar viabilidad de fusión, combinar dos moléculas
mediante enlace covalente en posiciones específicas, incluyendo soporte
para átomos comodín (`*`), y gestión de cachés LRU.
"""

import logging
from functools import lru_cache

from rdkit import Chem

from .parsing import get_implicit_hydrogens, parse_smiles_cached, silence_rdkit_logs

logger = logging.getLogger(__name__)


def _resolve_principal_atom_index(
    principal_molecule: Chem.Mol,
    principal_atom_idx: int | None,
) -> int:
    """Resuelve índice efectivo de la principal usando atom map cuando existe."""
    if principal_atom_idx is None:
        return 0

    target_map_number = principal_atom_idx + 1
    for principal_atom in principal_molecule.GetAtoms():
        if principal_atom.GetAtomMapNum() == target_map_number:
            return principal_atom.GetIdx()

    return principal_atom_idx


def _has_free_valence(atom: Chem.Atom, bond_order: int) -> bool:
    """Retorna True si el átomo tiene valencia libre para un enlace adicional.

    La validación prioriza la sustitución de hidrógenos (implícitos/explicítos) y,
    cuando no hay hidrógenos removibles, usa las valencias permitidas por tabla
    periódica para no descartar casos válidos como `[F]`.
    """
    available_hydrogen_slots = get_implicit_hydrogens(atom) + atom.GetNumExplicitHs()
    if available_hydrogen_slots >= bond_order:
        return True

    atomic_number = atom.GetAtomicNum()
    if atomic_number <= 0:
        return False

    total_valence = int(atom.GetTotalValence())
    periodic_table = Chem.GetPeriodicTable()
    allowed_valences = periodic_table.GetValenceList(atomic_number)
    for allowed_valence in allowed_valences:
        if int(allowed_valence) < 0:
            continue
        if total_valence + bond_order <= int(allowed_valence):
            return True
    return False


def _has_enough_implicit_hydrogens(
    atom_p: Chem.Atom, atom_s: Chem.Atom, bond_order: int
) -> bool:
    """Verifica que ambos átomos de unión tengan valencia libre para el nuevo enlace."""
    return _has_free_valence(atom_p, bond_order) and _has_free_valence(
        atom_s, bond_order
    )


def _bond_order_to_type(order: int) -> Chem.rdchem.BondType:
    """Convierte un entero de orden de enlace al tipo RDKit."""
    mapping: dict[int, Chem.rdchem.BondType] = {
        1: Chem.rdchem.BondType.SINGLE,
        2: Chem.rdchem.BondType.DOUBLE,
        3: Chem.rdchem.BondType.TRIPLE,
    }
    return mapping.get(order, Chem.rdchem.BondType.SINGLE)


def _is_wildcard_fusion_candidate_viable(
    principal_atom: Chem.Atom,
    substituent_molecule: Chem.Mol,
    wildcard_atom_idx: int,
) -> bool:
    """Evalúa si una fusión por wildcard es viable sin construir la molécula final."""
    if wildcard_atom_idx >= substituent_molecule.GetNumAtoms():
        return False

    wildcard_atom = substituent_molecule.GetAtomWithIdx(wildcard_atom_idx)
    if wildcard_atom.GetDegree() != 1:
        return False

    wildcard_bond = wildcard_atom.GetBonds()[0]
    bond_order = int(wildcard_bond.GetBondTypeAsDouble())
    return _has_free_valence(principal_atom, bond_order)


def _fuse_with_wildcard_anchor(
    principal_molecule: Chem.Mol,
    substituent_molecule: Chem.Mol,
    principal_atom_idx: int,
    wildcard_atom_idx: int,
    principal_smiles: str,
    substituent_smiles: str,
) -> str | None:
    """Fusiona usando un átomo comodín `*` como punto de anclaje removible.

    El legado trataba `*` como un marcador visual `R`: el átomo no debía quedar
    en el resultado final, sino ser reemplazado por el átomo del principal.
    """
    wildcard_atom = substituent_molecule.GetAtomWithIdx(wildcard_atom_idx)
    if wildcard_atom.GetDegree() != 1:
        return None

    wildcard_bond = wildcard_atom.GetBonds()[0]
    substituent_neighbor_idx: int = wildcard_bond.GetOtherAtomIdx(wildcard_atom_idx)
    principal_atom = principal_molecule.GetAtomWithIdx(principal_atom_idx)

    bond_order = int(wildcard_bond.GetBondTypeAsDouble())
    if not _has_free_valence(principal_atom, bond_order):
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
        with silence_rdkit_logs():
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
        with silence_rdkit_logs():
            return Chem.MolToSmiles(combo, isomericSmiles=True)
    except Exception as exc:  # noqa: BLE001
        logger.debug("Error generando SMILES con wildcard: %s", exc)
        return None


@lru_cache(maxsize=32768)
def is_fusion_candidate_viable(
    principal_smiles: str,
    substituent_smiles: str,
    principal_atom_idx: int | None,
    substituent_atom_idx: int | None,
    bond_order: int,
) -> bool:
    """Valida de forma exacta si una firma de fusión merece entrar a RDKit pesado.

    Esta comprobación usa solo parseo cacheado y lectura de átomos para descartar
    temprano combinaciones imposibles antes de clonar moléculas, combinarlas y
    sanitizarlas.
    """
    principal_base = parse_smiles_cached(principal_smiles)
    substituent_base = parse_smiles_cached(substituent_smiles)
    if principal_base is None or substituent_base is None:
        return False

    p_idx: int = _resolve_principal_atom_index(principal_base, principal_atom_idx)
    s_idx: int = substituent_atom_idx if substituent_atom_idx is not None else 0

    if p_idx >= principal_base.GetNumAtoms() or s_idx >= substituent_base.GetNumAtoms():
        return False

    principal_atom = principal_base.GetAtomWithIdx(p_idx)
    substituent_atom = substituent_base.GetAtomWithIdx(s_idx)

    if substituent_atom.GetAtomicNum() == 0 or substituent_atom.GetSymbol() == "*":
        return _is_wildcard_fusion_candidate_viable(
            principal_atom=principal_atom,
            substituent_molecule=substituent_base,
            wildcard_atom_idx=s_idx,
        )

    return _has_enough_implicit_hydrogens(principal_atom, substituent_atom, bond_order)


@lru_cache(maxsize=16384)
def fuse_molecules(
    principal_smiles: str,
    substituent_smiles: str,
    principal_atom_idx: int | None,
    substituent_atom_idx: int | None,
    bond_order: int,
) -> str | None:
    """Fusiona la molécula principal con un sustituyente en los átomos indicados.

    Implementa la misma lógica de Molecule.fusionMolecule() del legado Java:
    - Conecta `principal_atom_idx` con `substituent_atom_idx` con un enlace de
      orden `bond_order`.
    - Si cualquiera de los índices es None (molécula de 1 solo átomo), se toma
      el único átomo disponible.
    """
    principal_base = parse_smiles_cached(principal_smiles)
    substituent_base = parse_smiles_cached(substituent_smiles)
    if principal_base is None or substituent_base is None:
        return None

    mol_p = Chem.Mol(principal_base)
    mol_s = Chem.Mol(substituent_base)

    p_idx: int = _resolve_principal_atom_index(mol_p, principal_atom_idx)
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

    combo = Chem.RWMol(Chem.CombineMols(mol_p, mol_s))
    offset: int = mol_p.GetNumAtoms()
    bond_type = _bond_order_to_type(bond_order)

    # Ajustar hidrógeno explícito en sustituyente antes de añadir nuevo enlace
    # Si el átomo de anclaje tiene H explícito, reducirlo para permitir sanitización
    atom_s_in_combo = combo.GetAtomWithIdx(s_idx + offset)
    if atom_s_in_combo.GetNumExplicitHs() > 0:
        current_explicit_h = atom_s_in_combo.GetNumExplicitHs()
        new_explicit_h = max(0, current_explicit_h - bond_order)
        atom_s_in_combo.SetNumExplicitHs(new_explicit_h)

    combo.AddBond(p_idx, s_idx + offset, bond_type)

    try:
        with silence_rdkit_logs():
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
        with silence_rdkit_logs():
            return Chem.MolToSmiles(combo, isomericSmiles=True)
    except Exception as exc:  # noqa: BLE001
        logger.debug("Error generando SMILES: %s", exc)
        return None


def clear_smileit_caches() -> None:
    """Limpia todos los cachés LRU para evitar que persistan en workers.

    En workers Celery con prefork, los cachés LRU pueden crecer indefinidamente.
    Esta función debe llamarse al finalizar cada job para liberar la memoria.
    """
    from .rendering import render_molecule_svg

    parse_smiles_cached.cache_clear()
    render_molecule_svg.cache_clear()
    is_fusion_candidate_viable.cache_clear()
    fuse_molecules.cache_clear()
