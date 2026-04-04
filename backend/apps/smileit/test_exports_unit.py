"""test_exports_unit.py: Tests unitarios para funciones puras del módulo exports.py.

Objetivo: Cubrir rutas de manejo de valores vacíos, nombres duplicados y resultados
nulos en las funciones de construcción de CSV/ZIP/resumen que no alcanzan los tests
de integración HTTP existentes.
"""

from __future__ import annotations

from unittest import TestCase
from unittest.mock import MagicMock, patch

# =========================
# _build_pipe_joined_values
# =========================


class BuildPipeJoinedValuesTests(TestCase):
    """Prueba que _build_pipe_joined_values omite valores vacíos."""

    def test_empty_string_is_skipped(self) -> None:
        """Cadenas vacías o solo espacios deben ser omitidas (continue)."""
        from .routers.exports import _build_pipe_joined_values

        result = _build_pipe_joined_values(["CC", "", "  ", "CCO"])
        self.assertEqual(result, "CC|CCO")

    def test_all_empty_returns_empty_string(self) -> None:
        """Lista con solo espacios devuelve cadena vacía."""
        from .routers.exports import _build_pipe_joined_values

        result = _build_pipe_joined_values(["", "  ", "   "])
        self.assertEqual(result, "")

    def test_no_empty_preserves_all(self) -> None:
        """Sin cadenas vacías mantiene todos los valores separados por |."""
        from .routers.exports import _build_pipe_joined_values

        result = _build_pipe_joined_values(["a", "b", "c"])
        self.assertEqual(result, "a|b|c")


# =========================
# _build_compound_name
# =========================


class BuildCompoundNameTests(TestCase):
    """Prueba las tres ramas de retorno de _build_compound_name."""

    def test_empty_substituent_returns_principal_smiles(self) -> None:
        """Cuando substituent_smiles es vacío retorna solo principal_smiles."""
        from .routers.exports import _build_compound_name

        result = _build_compound_name("c1ccccc1", "", "0")
        self.assertEqual(result, "c1ccccc1")

    def test_empty_positions_returns_simple_sum(self) -> None:
        """Cuando applied_positions es vacío retorna 'principal + substituent'."""
        from .routers.exports import _build_compound_name

        result = _build_compound_name("c1ccccc1", "C", "")
        self.assertEqual(result, "c1ccccc1 + C")

    def test_full_name_includes_positions(self) -> None:
        """Cuando todos los campos son válidos retorna nombre completo con @."""
        from .routers.exports import _build_compound_name

        result = _build_compound_name("c1ccccc1", "C", "0")
        self.assertEqual(result, "c1ccccc1 + C @ 0")


# =========================
# _sanitize_zip_entry_base
# =========================


class SanitizeZipEntryBaseTests(TestCase):
    """Prueba que nombres inválidos usen el fallback."""

    def test_name_with_only_special_chars_uses_fallback(self) -> None:
        """Nombre con solo caracteres especiales → cleaned_name vacía → usa fallback."""
        from .routers.exports import _sanitize_zip_entry_base

        result = _sanitize_zip_entry_base("!@#$%^", "fallback_name")
        self.assertEqual(result, "fallback_name")

    def test_empty_name_uses_fallback(self) -> None:
        """Nombre vacío → usa fallback."""
        from .routers.exports import _sanitize_zip_entry_base

        result = _sanitize_zip_entry_base("", "fallback_001")
        self.assertEqual(result, "fallback_001")

    def test_valid_name_is_preserved(self) -> None:
        """Nombre alfanumérico válido se preserva."""
        from .routers.exports import _sanitize_zip_entry_base

        result = _sanitize_zip_entry_base("MyCompound123", "fallback")
        self.assertEqual(result, "MyCompound123")


# =========================
# build_derivations_images_zip — rutas con skip de estructuras
# =========================


class BuildDerivationsImagesZipTests(TestCase):
    """Prueba rutas de skip en build_derivations_images_zip."""

    def test_structure_with_empty_smiles_is_skipped(self) -> None:
        """Estructura con SMILES vacío debe saltar (continue) sin añadir a ZIP."""
        from .routers.exports import build_derivations_images_zip

        results = {
            "principal_smiles": "c1ccccc1",
            "generated_structures": [
                {"smiles": "", "name": "empty", "traceability": []},
            ],
        }
        result_bytes = build_derivations_images_zip(results)  # type: ignore[arg-type]
        from io import BytesIO
        from zipfile import ZipFile

        with ZipFile(BytesIO(result_bytes)) as zf:
            # Solo debe contener generated_smiles.txt (sin SVG)
            self.assertIn("generated_smiles.txt", zf.namelist())
            svg_files = [n for n in zf.namelist() if n.endswith(".svg")]
            self.assertEqual(len(svg_files), 0)

    def test_duplicate_file_base_gets_suffix(self) -> None:
        """Dos estructuras con el mismo nombre deben generar nombres de archivo únicos."""
        from .routers.exports import build_derivations_images_zip

        # Usamos SMILES que generen SVG real (no mocked)
        results = {
            "principal_smiles": "c1ccccc1",
            "generated_structures": [
                {
                    "smiles": "Cc1ccccc1",
                    "name": "DuplicateName",
                    "traceability": [],
                    "placeholder_assignments": [],
                },
                {
                    "smiles": "CCc1ccccc1",
                    "name": "DuplicateName",  # mismo nombre
                    "traceability": [],
                    "placeholder_assignments": [],
                },
            ],
        }
        result_bytes = build_derivations_images_zip(results)  # type: ignore[arg-type]
        from io import BytesIO
        from zipfile import ZipFile

        with ZipFile(BytesIO(result_bytes)) as zf:
            names = zf.namelist()
            svg_files = [n for n in names if n.endswith(".svg")]
            # Ambas estructuras tienen SVG válido, nombres únicos
            if len(svg_files) == 2:
                self.assertNotEqual(svg_files[0], svg_files[1])

    def test_empty_svg_structure_is_skipped(self) -> None:
        """Estructura que genera SVG vacío debe saltar (continue) sin añadir al ZIP."""
        from .routers.exports import build_derivations_images_zip

        with patch(
            "apps.smileit.routers.exports.render_derivative_svg_with_substituent_highlighting",
            return_value="",
        ):
            results = {
                "principal_smiles": "c1ccccc1",
                "generated_structures": [
                    {
                        "smiles": "Cc1ccccc1",
                        "name": "TestMol",
                        "traceability": [],
                        "placeholder_assignments": [],
                    }
                ],
            }
            result_bytes = build_derivations_images_zip(results)  # type: ignore[arg-type]

        from io import BytesIO
        from zipfile import ZipFile

        with ZipFile(BytesIO(result_bytes)) as zf:
            svg_files = [n for n in zf.namelist() if n.endswith(".svg")]
            self.assertEqual(len(svg_files), 0)


# =========================
# build_smileit_summary_payload — resultados no dict
# =========================


class BuildSmileitSummaryPayloadTests(TestCase):
    """Prueba la ruta de retorno temprano cuando results no es dict."""

    def test_non_dict_results_returns_payload_unchanged(self) -> None:
        """Cuando results no es un dict, debe retornar payload sin modificarlo."""
        from .routers.exports import build_smileit_summary_payload

        mock_job = MagicMock()
        with patch(
            "apps.smileit.routers.exports.SmileitJobResponseSerializer"
        ) as mock_cls:
            mock_serializer = MagicMock()
            mock_serializer.data = {"id": "abc", "results": None}
            mock_cls.return_value = mock_serializer

            result = build_smileit_summary_payload(mock_job)

        # results es None → no es dict → retorna payload sin tocar
        self.assertEqual(result["id"], "abc")
        self.assertIsNone(result["results"])


# =========================
# resolve_job_structure_by_index — rutas nulas / fuera de rango
# =========================


class ResolveJobStructureByIndexTests(TestCase):
    """Prueba las rutas de retorno None en resolve_job_structure_by_index."""

    def test_none_results_returns_none(self) -> None:
        """Cuando results es None debe retornar None."""
        from .routers.exports import resolve_job_structure_by_index

        result = resolve_job_structure_by_index(None, 0)
        self.assertIsNone(result)

    def test_negative_index_returns_none(self) -> None:
        """Índice negativo debe retornar None."""
        from .routers.exports import resolve_job_structure_by_index

        results = {  # type: ignore[assignment]
            "generated_structures": [{"smiles": "CC"}],
            "principal_smiles": "c1ccccc1",
        }
        result = resolve_job_structure_by_index(results, -1)  # type: ignore[arg-type]
        self.assertIsNone(result)

    def test_out_of_range_index_returns_none(self) -> None:
        """Índice >= len(structures) debe retornar None."""
        from .routers.exports import resolve_job_structure_by_index

        results = {  # type: ignore[assignment]
            "generated_structures": [{"smiles": "CC"}],
            "principal_smiles": "c1ccccc1",
        }
        result = resolve_job_structure_by_index(results, 999)  # type: ignore[arg-type]
        self.assertIsNone(result)

    def test_valid_index_returns_structure(self) -> None:
        """Índice válido debe retornar la estructura correspondiente."""
        from .routers.exports import resolve_job_structure_by_index

        structure = {"smiles": "CCO", "name": "ethanol"}
        results = {  # type: ignore[assignment]
            "generated_structures": [structure],
            "principal_smiles": "c1ccccc1",
        }
        result = resolve_job_structure_by_index(results, 0)  # type: ignore[arg-type]
        self.assertIsNotNone(result)
        self.assertEqual(result["smiles"], "CCO")  # type: ignore[index]
