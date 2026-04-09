"""engine/__init__.py: Re-exporta todos los símbolos públicos del paquete engine.

Mantiene compatibilidad hacia atrás con `from .engine import X` y
con `mock.patch('apps.smileit.engine.Chem.MolFromSmiles')` / `AllChem.Compute2DCoords`.
"""

from rdkit import Chem
from rdkit.Chem import AllChem

# --- Fusion ---
from .fusion import (
    _bond_order_to_type,
    _has_enough_implicit_hydrogens,
    _has_free_valence,
    clear_smileit_caches,
    fuse_molecules,
    is_fusion_candidate_viable,
)

# --- Inspection ---
from .inspection import inspect_smiles_structure, inspect_smiles_structure_with_patterns

# --- Parsing ---
from .parsing import (
    canonicalize_smiles,
    canonicalize_substituent,
    display_atom_symbol,
    get_implicit_hydrogens,
    parse_smiles_cached,
    remap_anchor_indices_to_canonical,
    silence_rdkit_logs,
    validate_smarts,
    validate_smiles,
)

# --- Rendering ---
from .rendering import (
    _compute_substituent_atom_indices,
    _score_principal_match_for_sites,
    render_derivative_svg_with_substituent_highlighting,
    render_molecule_svg,
    render_molecule_svg_with_atom_labels,
    tint_svg,
)

# --- Verification ---
from .verification import (
    build_active_pattern_refs,
    calculate_quick_properties,
    collect_pattern_annotations,
    verify_substituent_category,
)

# Aliases con nombre original (privado) para consumidores existentes
_silence_rdkit_logs = silence_rdkit_logs
_parse_smiles_cached = parse_smiles_cached
_display_atom_symbol = display_atom_symbol

__all__ = [
    # parsing
    "canonicalize_smiles",
    "canonicalize_substituent",
    "remap_anchor_indices_to_canonical",
    "validate_smiles",
    "validate_smarts",
    "get_implicit_hydrogens",
    "parse_smiles_cached",
    "silence_rdkit_logs",
    "display_atom_symbol",
    # aliases privados
    "_silence_rdkit_logs",
    "_parse_smiles_cached",
    "_display_atom_symbol",
    # inspection
    "inspect_smiles_structure",
    "inspect_smiles_structure_with_patterns",
    # rendering
    "render_molecule_svg",
    "render_molecule_svg_with_atom_labels",
    "render_derivative_svg_with_substituent_highlighting",
    "tint_svg",
    "_compute_substituent_atom_indices",
    "_score_principal_match_for_sites",
    # fusion
    "fuse_molecules",
    "is_fusion_candidate_viable",
    "clear_smileit_caches",
    "_bond_order_to_type",
    "_has_enough_implicit_hydrogens",
    "_has_free_valence",
    # verification
    "calculate_quick_properties",
    "verify_substituent_category",
    "collect_pattern_annotations",
    "build_active_pattern_refs",
    # rdkit (para mock.patch targets)
    "Chem",
    "AllChem",
]
