"""test_catalog_unit.py: Tests unitarios para las funciones puras de catalog.py.

Objetivo: Cubrir validaciones de SMILES, índices de anclaje y normalización de
metadatos que no son alcanzadas por los tests de integración HTTP existentes.
"""

from __future__ import annotations

from unittest import TestCase
from unittest.mock import MagicMock, patch

from .catalog import (
    CategoryValidationResult,
    _assert_anchor_indices,
    _is_substituent_user_editable,
    _normalize_metadata,
    _resolve_category_map_or_raise,
    _validate_substituent_categories_or_raise,
    create_pattern_entry,
    normalize_manual_substituent,
)

# =========================
# _normalize_metadata
# =========================


class NormalizeMetadataTests(TestCase):
    """Prueba que _normalize_metadata elimina claves vacías y normaliza espacios."""

    def test_empty_key_is_removed(self) -> None:
        """Claves vacías (o solo espacios) deben ser eliminadas del resultado."""
        result = _normalize_metadata({"  ": "some_value", "key": "val"})
        self.assertNotIn("  ", result)
        self.assertNotIn("", result)
        self.assertIn("key", result)

    def test_blank_only_key_is_removed(self) -> None:
        """Claves formadas solo por espacios deben eliminarse."""
        result = _normalize_metadata({"   ": "value"})
        self.assertEqual(result, {})

    def test_values_are_stripped(self) -> None:
        """Los valores deben ser strippeados de espacios."""
        result = _normalize_metadata({"key": "  valor con espacios  "})
        self.assertEqual(result["key"], "valor con espacios")

    def test_keys_are_stripped(self) -> None:
        """Las claves también deben ser strippeadas para normalización."""
        result = _normalize_metadata({"  key  ": "val"})
        self.assertIn("key", result)

    def test_empty_dict_returns_empty(self) -> None:
        """Diccionario vacío retorna vacío."""
        result = _normalize_metadata({})
        self.assertEqual(result, {})

    def test_valid_entries_preserved(self) -> None:
        """Entradas válidas se preservan sin cambios significativos."""
        result = _normalize_metadata({"source": "chembl", "version": "1.0"})
        self.assertEqual(result["source"], "chembl")
        self.assertEqual(result["version"], "1.0")


# =========================
# _assert_anchor_indices
# =========================


class AssertAnchorIndicesTests(TestCase):
    """Prueba la validación de índices de anclaje para sustituyentes."""

    def test_invalid_smiles_raises_value_error(self) -> None:
        """SMILES inválido debe lanzar ValueError antes de verificar índices."""
        with self.assertRaises(ValueError) as ctx:
            _assert_anchor_indices("NOT_VALID_SMILES", [0])
        self.assertIn("SMILES", str(ctx.exception))

    def test_empty_indices_raises_value_error(self) -> None:
        """Lista vacía de índices debe lanzar ValueError."""
        with self.assertRaises(ValueError) as ctx:
            _assert_anchor_indices("CCO", [])
        self.assertIn("anclaje", str(ctx.exception))

    def test_out_of_range_index_raises_value_error(self) -> None:
        """Índice fuera del rango de átomos debe lanzar ValueError."""
        with self.assertRaises(ValueError) as ctx:
            _assert_anchor_indices("CCO", [0, 100])
        self.assertIn("rango", str(ctx.exception))

    def test_negative_index_raises_value_error(self) -> None:
        """Índice negativo debe lanzar ValueError."""
        with self.assertRaises(ValueError):
            _assert_anchor_indices("CCO", [-1])

    def test_valid_indices_returns_sorted_unique(self) -> None:
        """Índices válidos y duplicados retornan lista ordenada sin repetidos."""
        result = _assert_anchor_indices("CCO", [2, 0, 1, 0])
        self.assertEqual(result, [0, 1, 2])

    def test_single_valid_index_returned(self) -> None:
        """Índice único válido retorna lista de un elemento."""
        result = _assert_anchor_indices("c1ccccc1", [0])
        self.assertEqual(result, [0])


# =========================
# _is_substituent_user_editable
# =========================


class IsSubstituentUserEditableTests(TestCase):
    """Prueba las reglas de editabilidad de sustituyentes por source_reference."""

    def _make_substituent(self, source_reference: str, provenance: dict) -> MagicMock:
        """Crea un mock de sustituyente con source_reference y provenance_metadata."""
        mock_sub = MagicMock()
        mock_sub.source_reference = source_reference
        mock_sub.provenance_metadata = provenance
        return mock_sub

    def test_legacy_smileit_is_not_editable(self) -> None:
        """Sustituyentes con source=legacy-smileit no son editables."""
        sub = self._make_substituent("legacy-smileit", {})
        self.assertFalse(_is_substituent_user_editable(sub))

    def test_smileit_seed_is_not_editable(self) -> None:
        """Sustituyentes con source=smileit-seed no son editables."""
        sub = self._make_substituent("smileit-seed", {})
        self.assertFalse(_is_substituent_user_editable(sub))

    def test_seed_true_in_provenance_is_not_editable(self) -> None:
        """Sustituyentes con seed=True en provenance_metadata no son editables."""
        sub = self._make_substituent("user", {"seed": "true"})
        self.assertFalse(_is_substituent_user_editable(sub))

    def test_seed_one_in_provenance_is_not_editable(self) -> None:
        """Sustituyentes con seed=1 en provenance_metadata no son editables."""
        sub = self._make_substituent("user", {"seed": "1"})
        self.assertFalse(_is_substituent_user_editable(sub))

    def test_seed_yes_in_provenance_is_not_editable(self) -> None:
        """Sustituyentes con seed=yes en provenance_metadata no son editables."""
        sub = self._make_substituent("user", {"seed": "yes"})
        self.assertFalse(_is_substituent_user_editable(sub))

    def test_user_without_seed_flag_is_editable(self) -> None:
        """Sustituyente de usuario sin flag seed es editable."""
        sub = self._make_substituent("user-import", {})
        self.assertTrue(_is_substituent_user_editable(sub))

    def test_user_with_false_seed_is_editable(self) -> None:
        """Sustituyente con seed=false es editable."""
        sub = self._make_substituent("user-import", {"seed": "false"})
        self.assertTrue(_is_substituent_user_editable(sub))

    def test_mixed_case_legacy_source_is_not_editable(self) -> None:
        """source_reference 'LEGACY-SMILEIT' con mayúsculas también bloquea edición."""
        sub = self._make_substituent("LEGACY-SMILEIT", {})
        self.assertFalse(_is_substituent_user_editable(sub))


# =========================
# _validate_substituent_categories_or_raise
# =========================


class ValidateSubstituentCategoriesOrRaiseTests(TestCase):
    """Prueba el lanzamiento de ValueError cuando alguna categoría falla."""

    def _make_category(self, key: str, passed: bool, message: str = "ok") -> object:
        """Crea mock de categoría con resultado de validación."""

        class MockCategory(MagicMock):
            pass

        return MockCategory()

    def _make_validation_result(
        self, key: str, passed: bool, message: str
    ) -> CategoryValidationResult:
        """Crea resultado de validación de categoría."""
        return CategoryValidationResult(
            category_key=key, passed=passed, message=message
        )

    def test_failed_validations_raise_value_error(self) -> None:
        """Si alguna categoría falla, se lanza ValueError con los mensajes."""
        canonical_smiles = "CCO"

        with self.assertRaises(ValueError) as ctx:
            # Usamos un mock de category_map que hace fallar la verificación
            from unittest.mock import patch

            with patch(
                "apps.smileit.catalog.validate_substituent_categories"
            ) as mock_v:
                mock_v.return_value = [
                    self._make_validation_result("cat_a", False, "No aplica el SMARTS.")
                ]
                mock_category_map = {
                    "cat_a": MagicMock(
                        key="cat_a",
                        verification_rule="smarts",
                        verification_smarts="[OH]",
                    )
                }
                _validate_substituent_categories_or_raise(
                    canonical_smiles, mock_category_map
                )
        self.assertIn("cat_a", str(ctx.exception))

    def test_all_passed_validations_returns_list(self) -> None:
        """Si todas las validaciones pasan, retorna la lista de resultados."""
        canonical_smiles = "CCO"

        from unittest.mock import patch

        with patch("apps.smileit.catalog.validate_substituent_categories") as mock_v:
            mock_v.return_value = [
                self._make_validation_result("cat_b", True, "Válido.")
            ]
            mock_category_map = {
                "cat_b": MagicMock(
                    key="cat_b",
                    verification_rule="smarts",
                    verification_smarts="[OH]",
                )
            }
            results = _validate_substituent_categories_or_raise(
                canonical_smiles, mock_category_map
            )
        self.assertEqual(len(results), 1)
        self.assertTrue(results[0].passed)


# =========================
# _assert_anchor_indices — ruta atom_count <= 0
# =========================


class AssertAnchorIndicesAtomCountTests(TestCase):
    """Prueba la rama atom_count <= 0 en _assert_anchor_indices."""

    def test_molecule_with_zero_atoms_raises_value_error(self) -> None:
        """Molécula simulada con 0 átomos debe lanzar ValueError."""
        mock_mol = MagicMock()
        mock_mol.GetNumAtoms.return_value = 0

        with patch("apps.smileit.catalog.Chem.MolFromSmiles", return_value=mock_mol):
            with self.assertRaises(ValueError) as ctx:
                _assert_anchor_indices("CC", [0])
        self.assertIn("al menos un átomo", str(ctx.exception))


# =========================
# _resolve_category_map_or_raise — ruta con categorías faltantes
# =========================


class ResolveCategoryMapOrRaiseTests(TestCase):
    """Prueba la ruta de error en _resolve_category_map_or_raise."""

    def test_missing_category_raises_value_error(self) -> None:
        """Si get_category_map retorna menos categorías que las pedidas → ValueError."""
        with patch("apps.smileit.catalog.get_category_map", return_value={}):
            with self.assertRaises(ValueError) as ctx:
                _resolve_category_map_or_raise(["categoria_inexistente"])
        self.assertIn("categorías inexistentes", str(ctx.exception))

    def test_all_categories_found_returns_map(self) -> None:
        """Si todas las categorías existen, retorna el mapa sin error."""
        mock_category = MagicMock()
        with patch(
            "apps.smileit.catalog.get_category_map",
            return_value={"cat_a": mock_category},
        ):
            result = _resolve_category_map_or_raise(["cat_a"])
        self.assertIn("cat_a", result)


# =========================
# create_pattern_entry — rutas puras sin DB
# =========================


class CreatePatternEntryPureTests(TestCase):
    """Prueba rutas sin DB de create_pattern_entry."""

    _BASE: dict = {
        "name": "Test pattern",
        "smarts": "[OH]",
        "pattern_type": "toxicophore",
        "caption": "Test pattern caption",
        "source_reference": "test",
        "provenance_metadata": {},
    }

    def test_empty_caption_raises_value_error(self) -> None:
        """caption vacío debe lanzar ValueError antes de consultar la BD."""
        payload = {**self._BASE, "caption": "   "}
        with self.assertRaises(ValueError) as ctx:
            create_pattern_entry(payload)  # type: ignore[arg-type]
        self.assertIn("caption", str(ctx.exception))

    def test_invalid_smarts_raises_value_error(self) -> None:
        """SMARTS inválido debe lanzar ValueError antes de consultar la BD."""
        payload = {**self._BASE, "smarts": "INVALID_SMARTS_123!@#"}
        with self.assertRaises(ValueError) as ctx:
            create_pattern_entry(payload)  # type: ignore[arg-type]
        self.assertIn("SMARTS", str(ctx.exception))


# =========================
# normalize_manual_substituent — ruta SMILES inválido
# =========================


class NormalizeManualSubstituentPureTests(TestCase):
    """Prueba rutas sin DB de normalize_manual_substituent."""

    def test_invalid_smiles_raises_value_error(self) -> None:
        """SMILES inválido para sustituyente manual debe lanzar ValueError."""
        entry = {
            "name": "test_sub",
            "smiles": "NOT_VALID_SMILES",
            "anchor_atom_indices": [0],
            "categories": [],
        }
        with self.assertRaises(ValueError) as ctx:
            normalize_manual_substituent(entry)  # type: ignore[arg-type]
        self.assertIn("SMILES inválido", str(ctx.exception))
