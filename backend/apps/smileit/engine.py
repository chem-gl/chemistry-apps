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
from contextlib import contextmanager
from functools import lru_cache
from html import escape
from typing import Optional

from rdkit import Chem, RDLogger
from rdkit.Chem import AllChem, Crippen, Descriptors, Lipinski, rdMolDescriptors
from rdkit.Chem.Draw import rdMolDraw2D

from .definitions import IMAGE_HEIGHT, IMAGE_WIDTH
from .types import (
    SmileitAtomInfo,
    SmileitCategoryVerificationRule,
    SmileitPatternEntry,
    SmileitQuickProperties,
    SmileitStructuralAnnotation,
    SmileitStructureInspectionResult,
)

logger = logging.getLogger(__name__)


@contextmanager
def _silence_rdkit_logs():
    """Silencia logs nativos de RDKit en caminos donde un rechazo es esperado.

    Smile-it prueba muchas fusiones candidatas que pueden ser químicamente
    inválidas. En esos casos el rechazo es parte normal del algoritmo y no debe
    inundar stderr con mensajes repetitivos del core C++ de RDKit.
    Usa RDLogger (Python-level) para garantizar silenciamiento en workers fork,
    a diferencia de rdBase.BlockLogs que depende del destructor C++ y no es
    confiable en procesos Celery con prefork.
    """
    RDLogger.DisableLog("rdApp.*")
    try:
        yield
    finally:
        RDLogger.EnableLog("rdApp.*")


@lru_cache(maxsize=8192)
def _parse_smiles_cached(smiles: str) -> Optional[Chem.Mol]:
    """Cachea el parseo RDKit para evitar reconstruir grafos idénticos.

    RDKit devuelve objetos mutables, por lo que los callers que modifiquen la
    molécula deben clonar el resultado con `Chem.Mol(...)` antes de usarlo.
    """
    with _silence_rdkit_logs():
        return Chem.MolFromSmiles(smiles)


def canonicalize_smiles(smiles: str) -> Optional[str]:
    """Retorna el SMILES canónico o None si el SMILES es inválido."""
    mol = _parse_smiles_cached(smiles)
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
    mol = _parse_smiles_cached(smiles)
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
    return _parse_smiles_cached(smiles) is not None


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

    quick_properties: SmileitQuickProperties = calculate_quick_properties(mol)

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


@lru_cache(maxsize=4096)
def render_molecule_svg(smiles: str) -> str:
    """Renderiza un SMILES como SVG limpio (sin índices visibles en el SVG de resultado).

    Args:
        smiles: Cadena SMILES de la molécula.

    Returns:
        Cadena SVG. Si falla, retorna una cadena vacía y logea el error.
    """
    try:
        base_molecule = _parse_smiles_cached(smiles)
        if base_molecule is None:
            return ""
        mol = Chem.Mol(base_molecule)
        with _silence_rdkit_logs():
            AllChem.Compute2DCoords(mol)
        drawer = rdMolDraw2D.MolDraw2DSVG(IMAGE_WIDTH, IMAGE_HEIGHT)
        drawer.DrawMolecule(mol)
        drawer.FinishDrawing()
        return drawer.GetDrawingText()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Error renderizando SVG para %r: %s", smiles, exc)
        return ""


def render_molecule_svg_with_atom_labels(
    smiles: str,
    atom_labels: dict[int, str],
    include_labels: bool = True,
) -> str:
    """Renderiza un scaffold con etiquetas personalizadas para sitios reactivos.

    Se usa para mostrar placeholders tipo `R1`, `R2`, etc. sobre los átomos
    del principal que recibieron una sustitución en el derivado final.

    Args:
        smiles: Estructura SMILES de la molécula principal.
        atom_labels: Mapeo de índice de átomo a etiqueta (ej: {0: 'R1', 2: 'R2'}).
        include_labels: Si False, renderiza con highlighting pero SIN etiquetas de texto.
                       Si True (defecto), incluye las etiquetas sobre los átomos.
    """
    try:
        base_molecule = _parse_smiles_cached(smiles)
        if base_molecule is None:
            return ""

        mol = Chem.Mol(base_molecule)
        with _silence_rdkit_logs():
            AllChem.Compute2DCoords(mol)

        valid_labels: dict[int, str] = {
            atom_index: atom_label
            for atom_index, atom_label in atom_labels.items()
            if 0 <= atom_index < mol.GetNumAtoms() and atom_label.strip() != ""
        }

        drawer = rdMolDraw2D.MolDraw2DSVG(IMAGE_WIDTH, IMAGE_HEIGHT)
        drawer.DrawMolecule(mol, highlightAtoms=sorted(valid_labels))

        # Solo generar elementos de texto si include_labels es True
        text_elements: list[str] = []
        if include_labels:
            for atom_index, atom_label in valid_labels.items():
                point = drawer.GetDrawCoords(atom_index)
                text_elements.append(
                    (
                        "<text x='{x:.1f}' y='{y:.1f}' "
                        "text-anchor='middle' dominant-baseline='middle' "
                        "font-family='Avenir Next, Trebuchet MS, Segoe UI, sans-serif' "
                        "font-size='18' font-weight='800' fill='#0f172a' "
                        "stroke='#ffffff' stroke-width='3' paint-order='stroke'>"
                        "{label}</text>"
                    ).format(x=point.x, y=point.y, label=escape(atom_label))
                )

        drawer.FinishDrawing()
        svg_output = drawer.GetDrawingText()
        if len(text_elements) == 0:
            return svg_output

        return svg_output.replace(
            "</svg>", "\n" + "\n".join(text_elements) + "\n</svg>"
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "Error renderizando SVG con placeholders para %r: %s",
            smiles,
            exc,
        )
        return ""


def render_derivative_svg_with_substituent_highlighting(
    principal_smiles: str,
    derivative_smiles: str,
    substituent_smiles_list: list[str],
) -> str:
    """Renderiza la molécula derivada completa con highlighting en átomos de sustituto.

    La molécula principal se muestra NORMAL (sin highlighting).
    Los átomos que pertenecen a sustitutos se muestran con HIGHLIGHTING (color verde).

    Args:
        principal_smiles: SMILES de la molécula principal original.
        derivative_smiles: SMILES de la molécula derivada (principal + sustitutos combinados).
        substituent_smiles_list: Lista de SMILES de sustitutos en orden de aplicación.
                                 Usado para calcular exactamente cuántos átomos agregó cada uno.

    Returns:
        SVG markup string con la molécula derivada completa renderizada.
    """
    try:
        principal_mol = _parse_smiles_cached(principal_smiles)
        derivative_mol = _parse_smiles_cached(derivative_smiles)

        if principal_mol is None or derivative_mol is None:
            return ""

        # Rastrear crecimiento de átomos a través de las fusiones
        num_principal_atoms: int = principal_mol.GetNumAtoms()
        current_atom_count: int = num_principal_atoms
        
        # Conjunto de índices de átomos que pertenecen a sustitutos
        substituent_atom_indices: set[int] = set()

        # Para cada sustituto aplicado, calcular qué átomos se agregaron
        for substituent_smiles in substituent_smiles_list:
            sub_mol = _parse_smiles_cached(substituent_smiles)
            if sub_mol is None:
                continue
            
            num_sub_atoms: int = sub_mol.GetNumAtoms()
            # Los átomos del sustituto son los que se acaban de agregar
            for atom_idx in range(current_atom_count, current_atom_count + num_sub_atoms):
                substituent_atom_indices.add(atom_idx)
            
            current_atom_count += num_sub_atoms

        if not substituent_atom_indices:
            # Si no hay sustitutos, renderizar sin highlighting
            return render_molecule_svg(derivative_smiles)

        # Renderizar la molécula derivada completa con highlighting en sustitutos
        mol = Chem.Mol(derivative_mol)
        with _silence_rdkit_logs():
            AllChem.Compute2DCoords(mol)

        drawer = rdMolDraw2D.MolDraw2DSVG(IMAGE_WIDTH, IMAGE_HEIGHT)
        drawer.DrawMolecule(mol, highlightAtoms=sorted(substituent_atom_indices))

        drawer.FinishDrawing()
        return drawer.GetDrawingText()

    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "Error renderizando SVG derivado con highlighting de sustituto: %s",
            exc,
        )
        return ""


@lru_cache(maxsize=32768)
def is_fusion_candidate_viable(
    principal_smiles: str,
    substituent_smiles: str,
    principal_atom_idx: Optional[int],
    substituent_atom_idx: Optional[int],
    bond_order: int,
) -> bool:
    """Valida de forma exacta si una firma de fusión merece entrar a RDKit pesado.

    Esta comprobación usa solo parseo cacheado y lectura de átomos para descartar
    temprano combinaciones imposibles antes de clonar moléculas, combinarlas y
    sanitizarlas. No cambia la semántica del resultado: únicamente evita trabajo
    cuando ya puede demostrarse que la fusión fallará.
    """
    principal_base = _parse_smiles_cached(principal_smiles)
    substituent_base = _parse_smiles_cached(substituent_smiles)
    if principal_base is None or substituent_base is None:
        return False

    p_idx: int = principal_atom_idx if principal_atom_idx is not None else 0
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
    principal_base = _parse_smiles_cached(principal_smiles)
    substituent_base = _parse_smiles_cached(substituent_smiles)
    if principal_base is None or substituent_base is None:
        return None

    # Clonar desde la caché para que cada intento de fusión mantenga aislamiento.
    mol_p = Chem.Mol(principal_base)
    mol_s = Chem.Mol(substituent_base)

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
        with _silence_rdkit_logs():
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
        with _silence_rdkit_logs():
            return Chem.MolToSmiles(combo, isomericSmiles=True)
    except Exception as exc:  # noqa: BLE001
        logger.debug("Error generando SMILES: %s", exc)
        return None


def clear_smileit_caches() -> None:
    """Limpia todos los cachés LRU para evitar que persistan en workers.

    En workers Celery con prefork, los cachés LRU pueden crecer indefinidamente
    consumiendo memoria si no se limpian periódicamente. Esta función debe
    llamarse al finalizar cada job para liberar la memoria.
    """
    _parse_smiles_cached.cache_clear()
    render_molecule_svg.cache_clear()
    is_fusion_candidate_viable.cache_clear()
    fuse_molecules.cache_clear()


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
    principal_atom = principal_molecule.GetAtomWithIdx(principal_atom_idx)

    bond_order = int(wildcard_bond.GetBondTypeAsDouble())
    # Solo verificar el átomo del principal: la valencia del vecino del comodín
    # no cambia porque el enlace con '*' es reemplazado por el enlace con el
    # principal usando el mismo orden (misma bond_order), dejando la valencia
    # neta del vecino invariante tras la remoción del wildcard.
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
        with _silence_rdkit_logs():
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
        with _silence_rdkit_logs():
            return Chem.MolToSmiles(combo, isomericSmiles=True)
    except Exception as exc:  # noqa: BLE001
        logger.debug("Error generando SMILES con wildcard: %s", exc)
        return None


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


def _has_free_valence(atom: Chem.Atom, bond_order: int) -> bool:
    """Retorna True si el átomo tiene valencia libre para un enlace adicional.

    Suma hidrógenos implícitos (calculados por RDKit según la valencia estándar
    del elemento) y explícitos (notación de corchete como [CH2] o [NH3+]).
    Funciona para cualquier tipo de átomo: C, N, O, S, etc.
    """
    return (get_implicit_hydrogens(atom) + atom.GetNumExplicitHs()) >= bond_order


def _has_enough_implicit_hydrogens(
    atom_p: Chem.Atom, atom_s: Chem.Atom, bond_order: int
) -> bool:
    """Verifica que ambos átomos de unión tengan valencia libre para el nuevo enlace.

    Aplica la comprobación a todos los tipos de átomo (no solo C) para detectar
    tempranamente fusiones inviables en heteroátomos con valencia plena (p.ej.
    O ya con 2 enlaces, N ya con 3), evitando llamadas costosas a SanitizeMol
    que siempre fallarían y generarían ruido en los logs de RDKit.
    """
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


def validate_smarts(smarts: str) -> bool:
    """Valida si un SMARTS es parseable por RDKit."""
    return Chem.MolFromSmarts(smarts) is not None


def calculate_quick_properties(molecule: Chem.Mol) -> SmileitQuickProperties:
    """Calcula propiedades rápidas para soporte de decisiones medicinales."""
    return SmileitQuickProperties(
        molecular_weight=round(float(Descriptors.MolWt(molecule)), 4),
        clogp=round(float(Crippen.MolLogP(molecule)), 4),
        rotatable_bonds=int(Lipinski.NumRotatableBonds(molecule)),
        hbond_donors=int(Lipinski.NumHDonors(molecule)),
        hbond_acceptors=int(Lipinski.NumHAcceptors(molecule)),
        tpsa=round(float(rdMolDescriptors.CalcTPSA(molecule)), 4),
        aromatic_rings=int(rdMolDescriptors.CalcNumAromaticRings(molecule)),
    )


def verify_substituent_category(
    smiles: str,
    verification_rule: SmileitCategoryVerificationRule,
    verification_smarts: str,
) -> tuple[bool, str]:
    """Verifica si un sustituyente cumple una categoría química específica."""
    molecule = Chem.MolFromSmiles(smiles)
    if molecule is None:
        return False, "SMILES inválido para verificación de categoría."

    if verification_rule == "aromatic":
        return _verify_aromatic_category(molecule)
    if verification_rule == "hbond_donor":
        return _verify_hbond_donor_category(molecule)
    if verification_rule == "hbond_acceptor":
        return _verify_hbond_acceptor_category(molecule)
    if verification_rule == "hydrophobic":
        return _verify_hydrophobic_category(molecule)
    if verification_rule == "smarts":
        return _verify_smarts_category(molecule, verification_smarts)

    return False, "Regla de verificación no soportada para la categoría."


def _verify_aromatic_category(molecule: Chem.Mol) -> tuple[bool, str]:
    """Valida pertenencia a categoría aromática."""
    has_aromatic_atom = any(atom.GetIsAromatic() for atom in molecule.GetAtoms())
    if not has_aromatic_atom:
        return False, "El sustituyente no contiene átomos aromáticos."
    return True, "Categoría aromática validada."


def _verify_hbond_donor_category(molecule: Chem.Mol) -> tuple[bool, str]:
    """Valida categoría de donador de puente de hidrógeno."""
    h_donors = int(Lipinski.NumHDonors(molecule))
    if h_donors <= 0:
        return False, "El sustituyente no presenta grupos donadores de hidrógeno."
    return True, "Categoría donador de hidrógeno validada."


def _verify_hbond_acceptor_category(molecule: Chem.Mol) -> tuple[bool, str]:
    """Valida categoría de aceptor de puente de hidrógeno."""
    h_acceptors = int(Lipinski.NumHAcceptors(molecule))
    if h_acceptors <= 0:
        return False, "El sustituyente no presenta grupos aceptores de hidrógeno."
    return True, "Categoría aceptor de hidrógeno validada."


def _verify_hydrophobic_category(molecule: Chem.Mol) -> tuple[bool, str]:
    """Valida categoría hidrofóbica simple basada en cLogP."""
    log_p = float(Crippen.MolLogP(molecule))
    if log_p < 0.5:
        return (
            False,
            "El sustituyente no cumple criterio hidrofóbico mínimo (cLogP >= 0.5).",
        )
    return True, "Categoría hidrofóbica validada."


def _verify_smarts_category(
    molecule: Chem.Mol,
    verification_smarts: str,
) -> tuple[bool, str]:
    """Valida categoría basada en coincidencia SMARTS."""
    if verification_smarts.strip() == "":
        return False, "La categoría SMARTS requiere un patrón de verificación."

    smarts_molecule = Chem.MolFromSmarts(verification_smarts)
    if smarts_molecule is None:
        return False, "El patrón SMARTS de la categoría es inválido."

    if not molecule.HasSubstructMatch(smarts_molecule):
        return False, "El sustituyente no coincide con el patrón SMARTS requerido."

    return True, "Categoría SMARTS validada."


def collect_pattern_annotations(
    molecule: Chem.Mol,
    patterns: list[SmileitPatternEntry],
) -> list[SmileitStructuralAnnotation]:
    """Detecta coincidencias de patrones y construye anotaciones visuales."""
    annotations: list[SmileitStructuralAnnotation] = []

    for pattern in patterns:
        smarts_molecule = Chem.MolFromSmarts(pattern["smarts"])
        if smarts_molecule is None:
            logger.warning("Patrón SMARTS inválido omitido: %s", pattern["name"])
            continue

        matches = molecule.GetSubstructMatches(smarts_molecule)
        if len(matches) == 0:
            continue

        annotation_color = (
            "#d93a2f" if pattern["pattern_type"] == "toxicophore" else "#2f9e44"
        )
        for atom_match in matches:
            annotations.append(
                SmileitStructuralAnnotation(
                    pattern_stable_id=pattern["stable_id"],
                    pattern_version=pattern["version"],
                    name=pattern["name"],
                    pattern_type=pattern["pattern_type"],
                    caption=pattern["caption"],
                    atom_indices=list(atom_match),
                    color=annotation_color,
                )
            )

    return annotations


def build_active_pattern_refs(
    annotations: list[SmileitStructuralAnnotation],
) -> list[dict[str, str | int]]:
    """Construye referencias únicas solo para patrones realmente coincidentes."""
    active_refs: list[dict[str, str | int]] = []
    seen_patterns: set[tuple[str, int]] = set()

    for annotation in annotations:
        pattern_key = (
            annotation["pattern_stable_id"],
            annotation["pattern_version"],
        )
        if pattern_key in seen_patterns:
            continue

        seen_patterns.add(pattern_key)
        active_refs.append(
            {
                "stable_id": annotation["pattern_stable_id"],
                "version": annotation["pattern_version"],
                "name": annotation["name"],
                "pattern_type": annotation["pattern_type"],
            }
        )

    return active_refs
