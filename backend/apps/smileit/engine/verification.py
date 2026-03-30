"""engine/verification.py: Verificación de categorías químicas y anotación de patrones.

Funciones para calcular propiedades moleculares rápidas (Lipinski, cLogP, TPSA),
verificar que un sustituyente pertenece a una categoría química específica
(aromática, HBD, HBA, hidrofóbica, SMARTS), y recopilar anotaciones
estructurales a partir de patrones SMARTS activos.
"""

import logging

from rdkit import Chem
from rdkit.Chem import Crippen, Descriptors, Lipinski, rdMolDescriptors

from ..types import (
    SmileitCategoryVerificationRule,
    SmileitPatternEntry,
    SmileitQuickProperties,
    SmileitStructuralAnnotation,
)

logger = logging.getLogger(__name__)


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
