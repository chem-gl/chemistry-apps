"""test_rendering_unit.py: Tests unitarios para rutas no cubiertas de rendering.py.

Objetivo: Cubrir manejadores de excepción, rutas con molécula nula y ramas de
continuación en las funciones de renderizado SVG de RDKit que no alcanzan los
tests de integración HTTP existentes.
"""

from __future__ import annotations

from unittest import TestCase
from unittest.mock import MagicMock, patch


class RenderMoleculeSvgExceptionTests(TestCase):
    """Cubre el manejador de excepción en render_molecule_svg (líneas except)."""

    def test_exception_in_compute_2d_returns_empty_string(self) -> None:
        """Si Compute2DCoords lanza, la función debe retornar '' y logear warning."""
        from .rendering import render_molecule_svg

        # Limpiamos cache para que no use resultado previo de "C"
        render_molecule_svg.cache_clear()
        with patch(
            "apps.smileit.engine.rendering.AllChem.Compute2DCoords",
            side_effect=RuntimeError("fallo de coordenadas"),
        ):
            result = render_molecule_svg("C")
        # La excepción fue atrapada y retorna cadena vacía
        self.assertEqual(result, "")
        # Restauramos para otros tests
        render_molecule_svg.cache_clear()

    def test_exception_in_draw_molecule_returns_empty_string(self) -> None:
        """Si DrawMolecule lanza, la función debe retornar '' y logear warning."""
        from .rendering import render_molecule_svg

        render_molecule_svg.cache_clear()
        with patch(
            "apps.smileit.engine.rendering.rdMolDraw2D.MolDraw2DSVG"
        ) as mock_drawer_cls:
            mock_drawer = MagicMock()
            mock_drawer.DrawMolecule.side_effect = RuntimeError("fallo de dibujado")
            mock_drawer_cls.return_value = mock_drawer
            result = render_molecule_svg("CC")
        self.assertEqual(result, "")
        render_molecule_svg.cache_clear()


class RenderMoleculeSvgWithAtomLabelsTests(TestCase):
    """Cubre rutas no cubiertas de render_molecule_svg_with_atom_labels."""

    def test_invalid_smiles_returns_empty_string(self) -> None:
        """SMILES inválido → molécula None → retorna ''."""
        from .rendering import render_molecule_svg_with_atom_labels

        result = render_molecule_svg_with_atom_labels(
            "INVALID_SMILES_XYZ_123", atom_labels={}
        )
        self.assertEqual(result, "")

    def test_exception_in_rendering_returns_empty_string(self) -> None:
        """Excepción en el proceso de renderizado → retorna '' y logea warning."""
        from .rendering import render_molecule_svg_with_atom_labels

        with patch(
            "apps.smileit.engine.rendering.AllChem.Compute2DCoords",
            side_effect=ValueError("error de coordenadas"),
        ):
            result = render_molecule_svg_with_atom_labels(
                "CCO", atom_labels={0: "R1", 1: "R2"}
            )
        self.assertEqual(result, "")

    def test_include_labels_false_returns_svg_without_text(self) -> None:
        """include_labels=False → text_elements vacío → retorna SVG sin elementos text."""
        from .rendering import render_molecule_svg_with_atom_labels

        result = render_molecule_svg_with_atom_labels(
            "CC", atom_labels={0: "R1"}, include_labels=False
        )
        # El SVG retornado es válido (no vacío) pero sin elementos de texto añadidos
        self.assertIn("<svg", result)
        self.assertNotIn("<text", result)

    def test_all_labels_out_of_range_gives_svg_without_text(self) -> None:
        """Índices de etiquetas fuera de rango → text_elements vacío → SVG sin text."""
        from .rendering import render_molecule_svg_with_atom_labels

        result = render_molecule_svg_with_atom_labels(
            "CC",
            atom_labels={999: "R999"},  # etanol tiene solo átomos 0..4
        )
        self.assertIn("<svg", result)
        self.assertNotIn("<text", result)


class ScorePrincipalMatchForSitesTests(TestCase):
    """Cubre la rama continue en _score_principal_match_for_sites (índice fuera de rango)."""

    def test_out_of_range_site_index_skipped(self) -> None:
        """Índice de sitio -1 o > len(match) debe procesarse vía continue sin error."""
        from apps.smileit.engine.rendering import (
            render_derivative_svg_with_substituent_highlighting,
        )

        # principal= benceno (6 átomos), derivative= tolueno (7 átomos)
        # Pasamos un principal_site_atom_indices con índices fuera de rango
        result = render_derivative_svg_with_substituent_highlighting(
            principal_smiles="c1ccccc1",
            derivative_smiles="Cc1ccccc1",
            substituent_smiles_list=["C"],
            principal_site_atom_indices=[-1, 100],  # ambos fuera de rango → continue
        )
        # Debe retornar algo (SVG o cadena vacía), sin lanzar excepción
        self.assertIsInstance(result, str)


class RenderDerivativeSvgTests(TestCase):
    """Cubre rutas de render_derivative_svg_with_substituent_highlighting."""

    def test_invalid_principal_smiles_returns_empty_string(self) -> None:
        """SMILES inválido para la molécula principal → principal_mol None → ''."""
        from apps.smileit.engine.rendering import (
            render_derivative_svg_with_substituent_highlighting,
        )

        result = render_derivative_svg_with_substituent_highlighting(
            principal_smiles="NOT_A_VALID_SMILES",
            derivative_smiles="CC",
            substituent_smiles_list=[],
        )
        self.assertEqual(result, "")

    def test_invalid_derivative_smiles_returns_empty_string(self) -> None:
        """SMILES inválido para el derivado → derivative_mol None → ''."""
        from apps.smileit.engine.rendering import (
            render_derivative_svg_with_substituent_highlighting,
        )

        result = render_derivative_svg_with_substituent_highlighting(
            principal_smiles="c1ccccc1",
            derivative_smiles="NOT_VALID_XYZ",
            substituent_smiles_list=[],
        )
        self.assertEqual(result, "")

    def test_no_scaffold_match_fallback_to_simple_render(self) -> None:
        """Sin match del scaffold → substituent_atom_indices vacío → fallback a render simple."""
        from apps.smileit.engine.rendering import (
            render_derivative_svg_with_substituent_highlighting,
        )

        # Usamos principal que NO está contenido en el derivado
        result = render_derivative_svg_with_substituent_highlighting(
            principal_smiles="c1ccccc1C",  # tolueno
            derivative_smiles="CC",  # etano → no contiene tolueno
            substituent_smiles_list=[],
        )
        # Retorna SVG del derivado (fallback a render_molecule_svg)
        self.assertIsInstance(result, str)

    def test_substituent_smiles_none_mol_is_skipped(self) -> None:
        """Sustituyente con SMILES inválido in substituent_smiles_list → continue (no error)."""
        from apps.smileit.engine.rendering import (
            render_derivative_svg_with_substituent_highlighting,
        )

        # Escenario: principal no está en derivado → busca por substituents_list
        # Un SMILES inválido dispara el continue cuando parse_smiles_cached retorna None
        result = render_derivative_svg_with_substituent_highlighting(
            principal_smiles="c1ccccc1C",  # tolueno
            derivative_smiles="CC",  # ethane, sin substructure match con tolueno
            substituent_smiles_list=["INVALID_XYZ", "ALSO_INVALID"],
        )
        self.assertIsInstance(result, str)

    def test_substituent_no_match_in_derivative_is_skipped(self) -> None:
        """Sustituyente válido pero sin match en derivativo → continue, no error."""
        from apps.smileit.engine.rendering import (
            render_derivative_svg_with_substituent_highlighting,
        )

        # principal (tolueno) no está en derivado (etano) → busca por sustituyentes
        # '[N]' no está en 'CC' → len(substitute_matches) == 0 → continue
        result = render_derivative_svg_with_substituent_highlighting(
            principal_smiles="c1ccccc1C",
            derivative_smiles="CC",
            substituent_smiles_list=["[N]", "[O]"],  # no están en CC
        )
        self.assertIsInstance(result, str)

    def test_exception_in_highlighting_returns_empty_string(self) -> None:
        """Excepción en el proceso de highlighting → retorna '' y logea warning."""
        from apps.smileit.engine.rendering import (
            render_derivative_svg_with_substituent_highlighting,
        )

        with patch(
            "apps.smileit.engine.rendering.AllChem.Compute2DCoords",
            side_effect=RuntimeError("fallo de coords en derivado"),
        ):
            result = render_derivative_svg_with_substituent_highlighting(
                principal_smiles="c1ccccc1",
                derivative_smiles="Cc1ccccc1",
                substituent_smiles_list=["C"],
            )
        self.assertEqual(result, "")
