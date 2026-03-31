"""engine/rendering.py: Renderizado SVG de moléculas con RDKit.

Funciones para generar representaciones SVG de moléculas, incluyendo
índices de átomos, etiquetas personalizadas, tintado de color y
highlighting de sustituyentes en derivados.
"""

import logging
import re
from functools import lru_cache
from html import escape

from rdkit import Chem
from rdkit.Chem import AllChem
from rdkit.Chem.Draw import rdMolDraw2D

from ..definitions import IMAGE_HEIGHT, IMAGE_WIDTH
from .parsing import parse_smiles_cached, silence_rdkit_logs

logger = logging.getLogger(__name__)
HEX_BOUNDARY_CLASS = "[0-9A-F]"


def render_molecule_svg_with_indices(mol: Chem.Mol) -> str:
    """Renderiza la molécula como SVG con índices de átomos visibles."""
    drawer = rdMolDraw2D.MolDraw2DSVG(IMAGE_WIDTH, IMAGE_HEIGHT)
    drawer.drawOptions().addAtomIndices = True
    drawer.DrawMolecule(mol)
    drawer.FinishDrawing()
    return drawer.GetDrawingText()


@lru_cache(maxsize=4096)
def render_molecule_svg(smiles: str) -> str:
    """Renderiza un SMILES como SVG limpio (sin índices visibles).

    Returns:
        Cadena SVG. Si falla, retorna una cadena vacía y logea el error.
    """
    try:
        base_molecule = parse_smiles_cached(smiles)
        if base_molecule is None:
            return ""
        mol = Chem.Mol(base_molecule)
        with silence_rdkit_logs():
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
    """
    try:
        base_molecule = parse_smiles_cached(smiles)
        if base_molecule is None:
            return ""

        mol = Chem.Mol(base_molecule)
        with silence_rdkit_logs():
            AllChem.Compute2DCoords(mol)

        valid_labels: dict[int, str] = {
            atom_index: atom_label
            for atom_index, atom_label in atom_labels.items()
            if 0 <= atom_index < mol.GetNumAtoms() and atom_label.strip() != ""
        }

        drawer = rdMolDraw2D.MolDraw2DSVG(IMAGE_WIDTH, IMAGE_HEIGHT)
        drawer.DrawMolecule(mol, highlightAtoms=sorted(valid_labels))

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


def tint_svg(raw_svg: str, color_hex: str) -> str:
    """Aplica un color dominante al SVG para diferenciar roles visuales."""
    if raw_svg.strip() == "":
        return raw_svg

    colored_svg = re.sub(
        rf"(?<!{HEX_BOUNDARY_CLASS})#000000(?!{HEX_BOUNDARY_CLASS})",
        color_hex,
        raw_svg,
        flags=re.IGNORECASE,
    )
    colored_svg = re.sub(
        rf"(?<!{HEX_BOUNDARY_CLASS})#000(?!{HEX_BOUNDARY_CLASS})",
        color_hex,
        colored_svg,
        flags=re.IGNORECASE,
    )
    return colored_svg


def _score_principal_match_for_sites(
    derivative_molecule: Chem.Mol,
    principal_match: tuple[int, ...],
    principal_site_atom_indices: list[int],
) -> int:
    """Puntúa un match del scaffold según cuántos sitios conectan con sustituyentes."""
    principal_match_set: set[int] = set(principal_match)
    score: int = 0

    for principal_site_index in principal_site_atom_indices:
        if principal_site_index < 0 or principal_site_index >= len(principal_match):
            continue

        derivative_site_atom_index = principal_match[principal_site_index]
        derivative_site_atom = derivative_molecule.GetAtomWithIdx(
            derivative_site_atom_index
        )
        has_external_neighbor = any(
            neighbor.GetIdx() not in principal_match_set
            for neighbor in derivative_site_atom.GetNeighbors()
        )
        if has_external_neighbor:
            score += 1

    return score


def _compute_substituent_atom_indices(
    principal_molecule: Chem.Mol,
    derivative_molecule: Chem.Mol,
    principal_site_atom_indices: list[int] | None = None,
) -> set[int]:
    """Calcula índices de sustituyentes como complemento del mejor match del scaffold."""
    all_principal_matches = derivative_molecule.GetSubstructMatches(principal_molecule)
    if len(all_principal_matches) == 0:
        return set()

    normalized_site_indices: list[int] = principal_site_atom_indices or []
    best_match = all_principal_matches[0]

    if len(normalized_site_indices) > 0:
        best_score = _score_principal_match_for_sites(
            derivative_molecule=derivative_molecule,
            principal_match=best_match,
            principal_site_atom_indices=normalized_site_indices,
        )
        for candidate_match in all_principal_matches[1:]:
            candidate_score = _score_principal_match_for_sites(
                derivative_molecule=derivative_molecule,
                principal_match=candidate_match,
                principal_site_atom_indices=normalized_site_indices,
            )
            if candidate_score > best_score:
                best_match = candidate_match
                best_score = candidate_score

    scaffold_atom_indices: set[int] = set(best_match)
    derivative_atom_count: int = derivative_molecule.GetNumAtoms()
    return {
        atom_index
        for atom_index in range(derivative_atom_count)
        if atom_index not in scaffold_atom_indices
    }


def render_derivative_svg_with_substituent_highlighting(
    principal_smiles: str,
    derivative_smiles: str,
    substituent_smiles_list: list[str],
    principal_site_atom_indices: list[int] | None = None,
    image_width: int = IMAGE_WIDTH,
    image_height: int = IMAGE_HEIGHT,
) -> str:
    """Renderiza la molécula derivada con highlighting en átomos de sustituto.

    La molécula principal se muestra NORMAL (sin highlighting).
    Los átomos que pertenecen a sustitutos se muestran con HIGHLIGHTING.
    """
    try:
        principal_mol = parse_smiles_cached(principal_smiles)
        derivative_mol = parse_smiles_cached(derivative_smiles)

        if principal_mol is None or derivative_mol is None:
            return ""

        substituent_atom_indices: set[int] = _compute_substituent_atom_indices(
            principal_molecule=principal_mol,
            derivative_molecule=derivative_mol,
            principal_site_atom_indices=principal_site_atom_indices,
        )

        if len(substituent_atom_indices) == 0 and len(substituent_smiles_list) > 0:
            for substituent_smiles in substituent_smiles_list:
                substituent_molecule = parse_smiles_cached(substituent_smiles)
                if substituent_molecule is None:
                    continue
                substitute_matches = derivative_mol.GetSubstructMatches(
                    substituent_molecule
                )
                if len(substitute_matches) == 0:
                    continue
                substituent_atom_indices.update(substitute_matches[0])

        if not substituent_atom_indices:
            return render_molecule_svg(derivative_smiles)

        mol = Chem.Mol(derivative_mol)
        with silence_rdkit_logs():
            AllChem.Compute2DCoords(mol)

        drawer = rdMolDraw2D.MolDraw2DSVG(image_width, image_height)
        drawer.DrawMolecule(mol, highlightAtoms=sorted(substituent_atom_indices))

        drawer.FinishDrawing()
        return drawer.GetDrawingText()

    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "Error renderizando SVG derivado con highlighting de sustituto: %s",
            exc,
        )
        return ""
