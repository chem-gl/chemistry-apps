"""engine/parsing.py: Parseo, canonicalización y validación de SMILES con RDKit.

Funciones base para parsear, cachear y canonicalizar moléculas SMILES.
Incluye silenciamiento de logs RDKit y funciones de inspección atómica.
"""

import logging
from contextlib import contextmanager
from functools import lru_cache

from rdkit import Chem, RDLogger

logger = logging.getLogger(__name__)


@contextmanager
def silence_rdkit_logs():
    """Silencia logs nativos de RDKit en caminos donde un rechazo es esperado.

    Smile-it prueba muchas fusiones candidatas que pueden ser químicamente
    inválidas. En esos casos el rechazo es parte normal del algoritmo y no debe
    inundar stderr con mensajes repetitivos del core C++ de RDKit.
    Usa RDLogger (Python-level) para garantizar silenciamiento en workers fork.
    """
    RDLogger.DisableLog("rdApp.*")
    try:
        yield
    finally:
        RDLogger.EnableLog("rdApp.*")


@lru_cache(maxsize=8192)
def parse_smiles_cached(smiles: str) -> Chem.Mol | None:
    """Cachea el parseo RDKit para evitar reconstruir grafos idénticos.

    RDKit devuelve objetos mutables, por lo que los callers que modifiquen la
    molécula deben clonar el resultado con `Chem.Mol(...)` antes de usarlo.
    """
    with silence_rdkit_logs():
        return Chem.MolFromSmiles(smiles)


def canonicalize_smiles(smiles: str) -> str | None:
    """Retorna el SMILES canónico o None si el SMILES es inválido."""
    mol = parse_smiles_cached(smiles)
    if mol is None:
        return None
    return Chem.MolToSmiles(mol, isomericSmiles=True)


def canonicalize_substituent(smiles: str, anchor_idx: int) -> tuple[str, int] | None:
    """Canonicaliza un SMILES de sustituyente preservando el índice del átomo de anclaje.

    Usa `rootedAtAtom` para iniciar el recorrido SMILES desde el átomo de anclaje,
    garantizando que al reparse el átomo de anclaje quede en el índice 0.
    """
    mol = parse_smiles_cached(smiles)
    if mol is None:
        return None
    n_atoms: int = mol.GetNumAtoms()
    safe_anchor: int = min(anchor_idx, n_atoms - 1)
    if n_atoms == 1:
        return Chem.MolToSmiles(mol, isomericSmiles=True), 0
    rooted_smiles: str = Chem.MolToSmiles(
        mol, isomericSmiles=True, rootedAtAtom=safe_anchor
    )
    return rooted_smiles, 0


def remap_anchor_indices_to_canonical(
    smiles: str,
    anchor_indices: list[int],
) -> tuple[str, list[int]] | None:
    """Canonicaliza un SMILES y remapea los índices de anclaje al espacio canónico.

    Usa GetSubstructMatch para calcular el mapeo exacto de índices entre el SMILES
    de entrada y el SMILES canónico de RDKit. Garantiza que anchor_atom_indices
    siempre referencie los mismos átomos en el SMILES canónico real.

    Necesario porque RDKit puede reordenar átomos al canonicalizar: p.ej.
    'C(=O)O' (C en idx 0) se canonicaliza a 'O=CO' (C en idx 1).

    Returns:
        Tupla (canonical_smiles, new_anchor_indices) o None si el SMILES es inválido
        o si no se puede calcular el match estructural.
    """
    mol_input = parse_smiles_cached(smiles)
    if mol_input is None:
        return None

    canonical = Chem.MolToSmiles(mol_input, isomericSmiles=True)
    mol_canonical = Chem.MolFromSmiles(canonical)
    if mol_canonical is None:
        return None

    # match[i] = índice en mol_canonical correspondiente al átomo i del query (mol_input)
    match: tuple[int, ...] = mol_canonical.GetSubstructMatch(mol_input)
    if len(match) == 0:
        return None

    remapped: list[int] = []
    for anchor_idx in anchor_indices:
        if 0 <= anchor_idx < len(match):
            remapped.append(match[anchor_idx])

    if len(remapped) == 0:
        return None

    return canonical, remapped


def validate_smiles(smiles: str) -> bool:
    """Retorna True si el SMILES es parseable por RDKit."""
    return parse_smiles_cached(smiles) is not None


def get_implicit_hydrogens(atom: Chem.Atom) -> int:
    """Retorna el número de hidrógenos implícitos de un átomo."""
    try:
        return atom.GetNumImplicitHs()
    except Exception:  # noqa: BLE001
        return 0


def display_atom_symbol(atom: Chem.Atom) -> str:
    """Normaliza símbolos especiales para mantener paridad visual con el legado."""
    if atom.GetAtomicNum() == 0 or atom.GetSymbol() == "*":
        return "R"
    return atom.GetSymbol()


def validate_smarts(smarts: str) -> bool:
    """Valida si un SMARTS es parseable por RDKit."""
    return Chem.MolFromSmarts(smarts) is not None
