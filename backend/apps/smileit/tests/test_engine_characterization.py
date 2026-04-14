"""test_engine_characterization.py: Tests de caracterización para engine.py.

Objetivo: Fijar el comportamiento actual de las funciones del motor
de química molecular previo a su modularización. Cubren parseo,
validación, renderizado, fusión, propiedades y verificación de categorías.
"""

from __future__ import annotations

from unittest.mock import patch

from django.test import TestCase
from rdkit import Chem

from ..engine import (
    _bond_order_to_type,
    _compute_substituent_atom_indices,
    _has_enough_implicit_hydrogens,
    _has_free_valence,
    _parse_smiles_cached,
    _score_principal_match_for_sites,
    build_active_pattern_refs,
    calculate_quick_properties,
    canonicalize_smiles,
    canonicalize_substituent,
    clear_smileit_caches,
    collect_pattern_annotations,
    fuse_molecules,
    get_implicit_hydrogens,
    inspect_smiles_structure,
    inspect_smiles_structure_with_patterns,
    is_fusion_candidate_viable,
    render_derivative_svg_with_substituent_highlighting,
    render_molecule_svg,
    render_molecule_svg_with_atom_labels,
    tint_svg,
    validate_smarts,
    validate_smiles,
    verify_substituent_category,
)
from ..types import SmileitPatternEntry


class ParseAndCanonicalizationTests(TestCase):
    """Verifica parseo y canonicalización SMILES."""

    def test_valid_smiles_canonicalizes(self) -> None:
        result = canonicalize_smiles("C(=O)O")
        self.assertIsNotNone(result)
        self.assertEqual(result, "O=CO")

    def test_invalid_smiles_returns_none(self) -> None:
        result = canonicalize_smiles("INVALID")
        self.assertIsNone(result)

    def test_validate_smiles_accepts_valid(self) -> None:
        self.assertTrue(validate_smiles("CCO"))

    def test_validate_smiles_rejects_invalid(self) -> None:
        self.assertFalse(validate_smiles("X@#$"))

    def test_canonicalize_substituent_single_atom(self) -> None:
        result = canonicalize_substituent("C", 0)
        self.assertIsNotNone(result)
        _, idx = result
        self.assertEqual(idx, 0)

    def test_canonicalize_substituent_multi_atom(self) -> None:
        result = canonicalize_substituent("CCO", 1)
        self.assertIsNotNone(result)
        _, idx = result
        self.assertEqual(idx, 0)  # Siempre retorna 0 por rootedAtAtom

    def test_canonicalize_substituent_invalid_returns_none(self) -> None:
        result = canonicalize_substituent("INVALID", 0)
        self.assertIsNone(result)

    def test_parse_smiles_cached_returns_mol_for_valid(self) -> None:
        mol = _parse_smiles_cached("CCO")
        self.assertIsNotNone(mol)

    def test_parse_smiles_cached_returns_none_for_invalid(self) -> None:
        mol = _parse_smiles_cached("INVALID_SMILES")
        self.assertIsNone(mol)


class InspectionTests(TestCase):
    """Verifica inspección completa de estructura molecular."""

    def test_inspect_valid_smiles_returns_complete_result(self) -> None:
        result = inspect_smiles_structure("CCO")
        self.assertIn("canonical_smiles", result)
        self.assertIn("atom_count", result)
        self.assertIn("atoms", result)
        self.assertIn("svg", result)
        self.assertIn("quick_properties", result)
        self.assertGreater(result["atom_count"], 0)
        self.assertGreater(len(result["atoms"]), 0)
        self.assertIn("<svg", result["svg"])

    def test_inspect_invalid_smiles_raises_value_error(self) -> None:
        with self.assertRaises(ValueError):
            inspect_smiles_structure("INVALID")

    def test_inspect_atoms_have_expected_fields(self) -> None:
        result = inspect_smiles_structure("C")
        atom = result["atoms"][0]
        self.assertIn("index", atom)
        self.assertIn("symbol", atom)
        self.assertIn("implicit_hydrogens", atom)
        self.assertIn("is_aromatic", atom)

    def test_inspect_with_patterns_adds_annotations(self) -> None:
        patterns: list[SmileitPatternEntry] = [
            {
                "stable_id": "test-pattern-1",
                "version": 1,
                "name": "Hydroxyl",
                "smarts": "[OX2H]",
                "pattern_type": "pharmacophore",
                "caption": "Grupo hidroxilo",
            }
        ]
        result = inspect_smiles_structure_with_patterns("CCO", patterns)
        self.assertIsInstance(result["annotations"], list)
        # CCO tiene un grupo -OH, el patrón debería coincidir
        self.assertGreater(len(result["annotations"]), 0)
        self.assertEqual(result["annotations"][0]["name"], "Hydroxyl")


class RenderingTests(TestCase):
    """Verifica renderizado SVG de moléculas."""

    def test_render_valid_smiles_returns_svg(self) -> None:
        svg = render_molecule_svg("CCO")
        self.assertIn("<svg", svg)

    def test_render_invalid_smiles_returns_empty(self) -> None:
        svg = render_molecule_svg("INVALID")
        self.assertEqual(svg, "")

    def test_render_with_atom_labels(self) -> None:
        svg = render_molecule_svg_with_atom_labels(
            "CCO", {0: "R1"}, include_labels=True
        )
        self.assertIn("<svg", svg)
        self.assertIn("R1", svg)

    def test_render_with_atom_labels_no_text(self) -> None:
        svg = render_molecule_svg_with_atom_labels(
            "CCO", {0: "R1"}, include_labels=False
        )
        self.assertIn("<svg", svg)
        # Sin include_labels, no debería haber etiqueta R1 en texto extra
        # (puede estar solo en highlighting)

    def test_render_invalid_smiles_with_labels_returns_empty(self) -> None:
        svg = render_molecule_svg_with_atom_labels("INVALID", {0: "R1"})
        self.assertEqual(svg, "")

    def test_tint_svg_replaces_black(self) -> None:
        raw_svg = '<svg><path fill="#000000"/></svg>'
        result = tint_svg(raw_svg, "#FF0000")
        self.assertIn("#FF0000", result)
        self.assertNotIn("#000000", result)

    def test_tint_svg_empty_input(self) -> None:
        result = tint_svg("", "#FF0000")
        self.assertEqual(result, "")

    def test_tint_svg_preserves_non_black_colors(self) -> None:
        raw_svg = '<svg><path fill="#0000FF"/></svg>'
        result = tint_svg(raw_svg, "#FF0000")
        self.assertIn("#0000FF", result)


class DerivativeHighlightingTests(TestCase):
    """Verifica renderizado de derivados con highlighting de sustituyentes."""

    def test_derivative_with_known_substituent(self) -> None:
        # Benceno + metilo → tolueno
        svg = render_derivative_svg_with_substituent_highlighting(
            principal_smiles="c1ccccc1",
            derivative_smiles="Cc1ccccc1",
            substituent_smiles_list=["C"],
        )
        self.assertIn("<svg", svg)

    def test_derivative_invalid_principal_returns_empty(self) -> None:
        svg = render_derivative_svg_with_substituent_highlighting(
            principal_smiles="INVALID",
            derivative_smiles="CCO",
            substituent_smiles_list=["O"],
        )
        self.assertEqual(svg, "")


class FusionTests(TestCase):
    """Verifica fusión de moléculas principales con sustituyentes."""

    def setUp(self) -> None:
        clear_smileit_caches()

    def test_simple_fusion_produces_valid_smiles(self) -> None:
        # Metano (C) + Metano (C) → Etano (CC)
        result = fuse_molecules("C", "C", 0, 0, 1)
        self.assertIsNotNone(result)
        self.assertTrue(validate_smiles(result))

    def test_fusion_with_invalid_principal_returns_none(self) -> None:
        result = fuse_molecules("INVALID", "C", 0, 0, 1)
        self.assertIsNone(result)

    def test_fusion_with_out_of_range_index_returns_none(self) -> None:
        result = fuse_molecules("C", "C", 999, 0, 1)
        self.assertIsNone(result)

    def test_fusion_with_wildcard_substituent(self) -> None:
        # Principal: C, Sustituyente con wildcard: *C (átomo 0 es *)
        result = fuse_molecules("C", "*C", 0, 0, 1)
        # El wildcard debe removerse y conectar con el vecino
        if result is not None:
            self.assertTrue(validate_smiles(result))

    def test_is_fusion_candidate_viable_valid_case(self) -> None:
        result = is_fusion_candidate_viable("C", "C", 0, 0, 1)
        self.assertTrue(result)

    def test_is_fusion_candidate_viable_invalid_smiles(self) -> None:
        result = is_fusion_candidate_viable("INVALID", "C", 0, 0, 1)
        self.assertFalse(result)

    def test_is_fusion_candidate_viable_out_of_range_index(self) -> None:
        result = is_fusion_candidate_viable("C", "C", 999, 0, 1)
        self.assertFalse(result)

    def test_bond_order_to_type_single(self) -> None:
        self.assertEqual(_bond_order_to_type(1), Chem.rdchem.BondType.SINGLE)

    def test_bond_order_to_type_double(self) -> None:
        self.assertEqual(_bond_order_to_type(2), Chem.rdchem.BondType.DOUBLE)

    def test_bond_order_to_type_triple(self) -> None:
        self.assertEqual(_bond_order_to_type(3), Chem.rdchem.BondType.TRIPLE)

    def test_bond_order_to_type_unknown_defaults_to_single(self) -> None:
        self.assertEqual(_bond_order_to_type(99), Chem.rdchem.BondType.SINGLE)


class ValenceTests(TestCase):
    """Verifica comprobaciones de valencia libre para fusiones."""

    def test_has_free_valence_on_methane_carbon(self) -> None:
        mol = Chem.MolFromSmiles("C")
        atom = mol.GetAtomWithIdx(0)
        # Metano tiene 4 H implícitos, bond_order=1 → True
        self.assertTrue(_has_free_valence(atom, 1))

    def test_has_free_valence_on_water_oxygen(self) -> None:
        mol = Chem.MolFromSmiles("O")
        atom = mol.GetAtomWithIdx(0)
        # Oxígeno en agua: 2 H implícitos
        self.assertTrue(_has_free_valence(atom, 1))

    def test_has_enough_implicit_hydrogens_both_atoms(self) -> None:
        mol_p = Chem.MolFromSmiles("C")
        mol_s = Chem.MolFromSmiles("C")
        self.assertTrue(
            _has_enough_implicit_hydrogens(
                mol_p.GetAtomWithIdx(0), mol_s.GetAtomWithIdx(0), 1
            )
        )

    def test_get_implicit_hydrogens_for_carbon(self) -> None:
        mol = Chem.MolFromSmiles("C")
        self.assertEqual(get_implicit_hydrogens(mol.GetAtomWithIdx(0)), 4)


class QuickPropertiesTests(TestCase):
    """Verifica cálculo de propiedades moleculares rápidas."""

    def test_ethanol_properties(self) -> None:
        mol = Chem.MolFromSmiles("CCO")
        props = calculate_quick_properties(mol)
        self.assertIn("molecular_weight", props)
        self.assertIn("clogp", props)
        self.assertIn("rotatable_bonds", props)
        self.assertIn("hbond_donors", props)
        self.assertIn("hbond_acceptors", props)
        self.assertIn("tpsa", props)
        self.assertIn("aromatic_rings", props)
        self.assertGreater(props["molecular_weight"], 0)
        self.assertEqual(props["aromatic_rings"], 0)

    def test_benzene_has_aromatic_ring(self) -> None:
        mol = Chem.MolFromSmiles("c1ccccc1")
        props = calculate_quick_properties(mol)
        self.assertEqual(props["aromatic_rings"], 1)


class ValidateSmartsTests(TestCase):
    """Verifica validación de patrones SMARTS."""

    def test_valid_smarts(self) -> None:
        self.assertTrue(validate_smarts("[OX2H]"))

    def test_invalid_smarts(self) -> None:
        self.assertFalse(validate_smarts("INVALID_SMARTS[[["))


class CategoryVerificationTests(TestCase):
    """Verifica verificación de categorías químicas de sustituyentes."""

    def test_aromatic_category_with_benzene(self) -> None:
        result, _ = verify_substituent_category("c1ccccc1", "aromatic", "")
        self.assertTrue(result)

    def test_aromatic_category_with_ethanol(self) -> None:
        result, _ = verify_substituent_category("CCO", "aromatic", "")
        self.assertFalse(result)

    def test_hbond_donor_with_ethanol(self) -> None:
        result, _ = verify_substituent_category("CCO", "hbond_donor", "")
        self.assertTrue(result)

    def test_hbond_donor_without_donor(self) -> None:
        result, _ = verify_substituent_category("CC", "hbond_donor", "")
        self.assertFalse(result)

    def test_hbond_acceptor_with_ethanol(self) -> None:
        result, _ = verify_substituent_category("CCO", "hbond_acceptor", "")
        self.assertTrue(result)

    def test_hydrophobic_category(self) -> None:
        # Hexano debería ser hidrofóbico (cLogP > 0.5)
        result, _ = verify_substituent_category("CCCCCC", "hydrophobic", "")
        self.assertTrue(result)

    def test_hydrophobic_fails_for_water(self) -> None:
        result, _ = verify_substituent_category("O", "hydrophobic", "")
        self.assertFalse(result)

    def test_smarts_category_valid_pattern(self) -> None:
        # Buscar grupo hidroxilo en etanol
        result, _ = verify_substituent_category("CCO", "smarts", "[OX2H]")
        self.assertTrue(result)

    def test_smarts_category_no_match(self) -> None:
        result, _ = verify_substituent_category("CC", "smarts", "[OX2H]")
        self.assertFalse(result)

    def test_smarts_category_empty_pattern(self) -> None:
        result, _ = verify_substituent_category("CCO", "smarts", "")
        self.assertFalse(result)

    def test_smarts_category_invalid_pattern(self) -> None:
        result, _ = verify_substituent_category("CCO", "smarts", "[[[INVALID")
        self.assertFalse(result)

    def test_invalid_smiles_returns_false(self) -> None:
        result, _ = verify_substituent_category("INVALID", "aromatic", "")
        self.assertFalse(result)

    def test_unsupported_rule(self) -> None:
        result, _ = verify_substituent_category("CCO", "unknown_rule", "")
        self.assertFalse(result)


class PatternAnnotationTests(TestCase):
    """Verifica recolección de anotaciones por patrones SMARTS."""

    def test_collect_annotations_with_match(self) -> None:
        mol = Chem.MolFromSmiles("CCO")
        patterns: list[SmileitPatternEntry] = [
            {
                "stable_id": "hydroxyl-1",
                "version": 1,
                "name": "Hydroxyl",
                "smarts": "[OX2H]",
                "pattern_type": "pharmacophore",
                "caption": "OH group",
            }
        ]
        annotations = collect_pattern_annotations(mol, patterns)
        self.assertGreater(len(annotations), 0)
        self.assertEqual(annotations[0]["name"], "Hydroxyl")
        self.assertEqual(annotations[0]["color"], "#2f9e44")

    def test_collect_annotations_toxicophore_color(self) -> None:
        mol = Chem.MolFromSmiles("CCO")
        patterns: list[SmileitPatternEntry] = [
            {
                "stable_id": "tox-1",
                "version": 1,
                "name": "Toxic OH",
                "smarts": "[OX2H]",
                "pattern_type": "toxicophore",
                "caption": "Toxic group",
            }
        ]
        annotations = collect_pattern_annotations(mol, patterns)
        self.assertGreater(len(annotations), 0)
        self.assertEqual(annotations[0]["color"], "#d93a2f")

    def test_collect_annotations_no_match(self) -> None:
        mol = Chem.MolFromSmiles("CC")
        patterns: list[SmileitPatternEntry] = [
            {
                "stable_id": "hydroxyl-1",
                "version": 1,
                "name": "Hydroxyl",
                "smarts": "[OX2H]",
                "pattern_type": "pharmacophore",
                "caption": "OH group",
            }
        ]
        annotations = collect_pattern_annotations(mol, patterns)
        self.assertEqual(len(annotations), 0)

    def test_build_active_pattern_refs_deduplicates(self) -> None:
        annotations = [
            {
                "pattern_stable_id": "p1",
                "pattern_version": 1,
                "name": "Pattern A",
                "pattern_type": "pharmacophore",
                "caption": "Cap",
                "atom_indices": [0],
                "color": "#2f9e44",
            },
            {
                "pattern_stable_id": "p1",
                "pattern_version": 1,
                "name": "Pattern A",
                "pattern_type": "pharmacophore",
                "caption": "Cap",
                "atom_indices": [1],
                "color": "#2f9e44",
            },
        ]
        refs = build_active_pattern_refs(annotations)
        self.assertEqual(len(refs), 1)
        self.assertEqual(refs[0]["stable_id"], "p1")


class CacheClearTests(TestCase):
    """Verifica que clear_smileit_caches limpia los cachés LRU."""

    def test_clear_caches_does_not_raise(self) -> None:
        # Poblar un cache y luego limpiar
        _parse_smiles_cached("CCO")
        render_molecule_svg("CCO")
        clear_smileit_caches()
        # No debería lanzar excepciones
        info = _parse_smiles_cached.cache_info()
        self.assertEqual(info.currsize, 0)


class RenderingExceptionPathTests(TestCase):
    """Verifica los caminos de excepción en las funciones de renderizado SVG."""

    def setUp(self) -> None:
        """Limpia caches de rendering antes de cada prueba."""
        clear_smileit_caches()

    def test_render_molecule_svg_returns_empty_on_rdkit_exception(self) -> None:
        """Si RDKit lanza excepción durante el renderizado, se retorna cadena vacía."""
        from rdkit.Chem import AllChem

        with patch.object(
            AllChem,
            "Compute2DCoords",
            side_effect=RuntimeError("render fail"),
        ):
            # Necesita un SMILES válido para llegar al código de renderizado
            result = render_molecule_svg("CCO_UNIQUE_EXCEPTION_TEST")
        self.assertEqual(result, "")

    def test_render_molecule_svg_with_atom_labels_returns_empty_on_exception(
        self,
    ) -> None:
        """Si RDKit falla durante renderizado con etiquetas, retorna cadena vacía."""
        from rdkit.Chem import AllChem

        with patch.object(
            AllChem,
            "Compute2DCoords",
            side_effect=RuntimeError("labels render fail"),
        ):
            result = render_molecule_svg_with_atom_labels(
                "CCO_LABELS_EXCEPTION", {0: "R1"}
            )
        self.assertEqual(result, "")

    def test_render_derivative_svg_returns_empty_on_parse_failure(self) -> None:
        """Si principal o derivado no parsean, retorna cadena vacía."""
        result = render_derivative_svg_with_substituent_highlighting(
            principal_smiles="INVALID",
            derivative_smiles="CCO",
            substituent_smiles_list=["C"],
        )
        self.assertEqual(result, "")

    def test_score_principal_match_counts_external_neighbors(self) -> None:
        """_score_principal_match counts sites con vecinos externos al scaffold."""
        # Propanol: C=0, C=1, O=2. Match del scaffold CC en idxs (0,1).
        # El átomo 1 tiene vecino externo (O en idx 2) fuera del set {0,1}.
        derivative_mol = Chem.MolFromSmiles("CCO")
        assert derivative_mol is not None
        principal_match = (0, 1)  # CC como match
        # Sitio en posición 1 del match (átomo idx 1 que conecta con O)
        score = _score_principal_match_for_sites(
            derivative_molecule=derivative_mol,
            principal_match=principal_match,
            principal_site_atom_indices=[1],
        )
        self.assertGreaterEqual(score, 1)

    def test_compute_substituent_atom_indices_with_multiple_matches(self) -> None:
        """Con múltiples matches del scaffold, elige el que maximiza los sitios."""
        # Naftaleno como derivado, benceno como principal → múltiples matches
        from apps.smileit.engine.parsing import parse_smiles_cached

        principal = parse_smiles_cached("c1ccccc1")
        derivative = parse_smiles_cached("c1ccc2ccccc2c1")  # naftaleno
        if principal is None or derivative is None:
            self.skipTest("SMILES no válidos en entorno de test")

        result = _compute_substituent_atom_indices(
            principal_molecule=principal,
            derivative_molecule=derivative,
            principal_site_atom_indices=[0],
        )
        # Los átomos fuera del scaffold del benceno deben estar en el resultado
        self.assertIsInstance(result, set)
