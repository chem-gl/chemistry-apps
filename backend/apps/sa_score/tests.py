"""tests.py: Pruebas unitarias para la app SA Score.

Valida el plugin, la construcción de CSVs y la integración con los tres clientes.
Los clientes de SA score se mockean para aislar la lógica del plugin.

Uso:
    cd backend
    ./venv/bin/python manage.py test apps.sa_score --verbosity=2
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from django.test import TestCase
from libs.brsascore.client import BrsaScoreClient

from .plugin import (
    _compute_ambit_score,
    _compute_brsa_score,
    _compute_rdkit_score,
    _convert_score,
)
from .routers import _build_full_csv, _build_single_method_csv
from .schemas import SaScoreJobCreateSerializer
from .types import SaMoleculeResult


class CsvBuilderTests(TestCase):
    """Pruebas para las funciones de construcción de CSV."""

    def setUp(self) -> None:
        self.molecule_results: list[SaMoleculeResult] = [
            {
                "smiles": "CCO",
                "ambit_sa": 1.23,
                "brsa_sa": 2.34,
                "rdkit_sa": 3.45,
                "ambit_error": None,
                "brsa_error": None,
                "rdkit_error": None,
            },
            {
                "smiles": "c1ccccc1",
                "ambit_sa": None,
                "brsa_sa": 4.56,
                "rdkit_sa": 5.67,
                "ambit_error": "AMBIT timeout",
                "brsa_error": None,
                "rdkit_error": None,
            },
        ]

    def test_full_csv_includes_requested_method_columns(self) -> None:
        """El CSV completo debe incluir solo columnas de métodos solicitados."""
        csv_content = _build_full_csv(self.molecule_results, ["ambit", "brsa"])
        lines = csv_content.splitlines()

        self.assertIn("smiles,ambit_sa_percent,brsa_sa", lines[0])
        self.assertNotIn("rdkit_sa", lines[0])
        self.assertEqual(len(lines), 3)  # header + 2 moléculas

    def test_full_csv_uses_all_three_methods(self) -> None:
        """El CSV completo con los tres métodos debe tener 4 columnas."""
        csv_content = _build_full_csv(self.molecule_results, ["ambit", "brsa", "rdkit"])
        header = csv_content.splitlines()[0]
        self.assertEqual(header, "smiles,ambit_sa_percent,brsa_sa,rdkit_sa")

    def test_single_method_csv_has_smiles_sa_columns(self) -> None:
        """El CSV de método único debe tener columnas smiles,sa."""
        csv_content = _build_single_method_csv(self.molecule_results, "brsa")
        lines = csv_content.splitlines()

        self.assertEqual(lines[0], "smiles,sa")
        self.assertIn("2.340000", lines[1])  # brsa_sa de CCO
        self.assertIn("4.560000", lines[2])  # brsa_sa de c1ccccc1

    def test_single_method_csv_ambit_uses_percent_header(self) -> None:
        """El CSV de AMBIT debe exponer encabezado explícito de porcentaje."""
        csv_content = _build_single_method_csv(self.molecule_results, "ambit")
        lines = csv_content.splitlines()
        self.assertEqual(lines[0], "smiles,sa_percent")

    def test_single_method_csv_empty_score_when_none(self) -> None:
        """Las celdas con score None deben quedar vacías en el CSV."""
        csv_content = _build_single_method_csv(self.molecule_results, "ambit")
        lines = csv_content.splitlines()

        # c1ccccc1 tuvo error en ambit → celda vacía
        self.assertTrue(lines[2].endswith(","))


class PluginFunctionTests(TestCase):
    """Pruebas de las funciones de cómputo del plugin con mocking."""

    def test_compute_ambit_score_returns_score_on_success(self) -> None:
        """_compute_ambit_score debe retornar (score, None) cuando AMBIT tiene éxito."""
        mock_result = MagicMock()
        mock_result.success = True
        mock_result.sa_score = 4.5
        mock_result.error_message = None

        with patch("libs.ambit.client.AmbitClient") as MockAmbitClient:
            MockAmbitClient.return_value.predict_sa_score.return_value = mock_result
            score, error = _compute_ambit_score("CCO")

        self.assertEqual(score, 4.5)
        self.assertIsNone(error)

    def test_compute_ambit_score_returns_error_on_failure(self) -> None:
        """_compute_ambit_score debe retornar (None, error) cuando AMBIT falla."""
        mock_result = MagicMock()
        mock_result.success = False
        mock_result.sa_score = None
        mock_result.error_message = "AMBIT timeout"

        with patch("libs.ambit.client.AmbitClient") as MockAmbitClient:
            MockAmbitClient.return_value.predict_sa_score.return_value = mock_result
            score, error = _compute_ambit_score("CCO")

        self.assertIsNone(score)
        self.assertEqual(error, "AMBIT timeout")

    def test_compute_brsa_score_returns_score_on_success(self) -> None:
        """_compute_brsa_score debe retornar score convertido a escala 0-100."""
        mock_result = MagicMock()
        mock_result.success = True
        mock_result.sa_score = 3.1
        mock_result.error_message = None

        with patch("libs.brsascore.client.BrsaScoreClient") as MockBrsa:
            MockBrsa.return_value.predict_sa_score.return_value = mock_result
            score, error = _compute_brsa_score("CCO")

        self.assertAlmostEqual(score or 0.0, _convert_score(3.1), places=3)
        self.assertIsNone(error)

    def test_compute_rdkit_score_returns_score_on_success(self) -> None:
        """_compute_rdkit_score debe retornar score convertido a escala 0-100."""
        mock_result = MagicMock()
        mock_result.success = True
        mock_result.sa_score = 2.8
        mock_result.error_message = None

        with patch("libs.rdkit_sa.client.RdkitSaClient") as MockRdkit:
            MockRdkit.return_value.predict_sa_score.return_value = mock_result
            score, error = _compute_rdkit_score("CCO")

        self.assertAlmostEqual(score or 0.0, _convert_score(2.8), places=3)
        self.assertIsNone(error)

    def test_convert_score_maps_1_to_100_and_10_to_0(self) -> None:
        """La conversión 1-10 -> 0-100 debe preservar extremos esperados."""
        self.assertEqual(_convert_score(1.0), 100.0)
        self.assertEqual(_convert_score(10.0), 0.0)
        self.assertAlmostEqual(_convert_score(5.5), 50.0, places=6)


class SaScoreJobPluginIntegrationTests(TestCase):
    """Pruebas del plugin completo con todos los métodos mockeados."""

    def _make_success_result(self, score: float) -> MagicMock:
        """Crea un resultado de SA score exitoso para mocking."""
        result = MagicMock()
        result.success = True
        result.sa_score = score
        result.error_message = None
        return result

    def test_plugin_produces_results_for_all_methods(self) -> None:
        """El plugin debe producir una entrada por SMILES con los tres métodos."""
        from .plugin import sa_score_plugin

        def _noop_progress(pct: int, stage: str, msg: str) -> None:
            pass

        def _noop_log(level: str, source: str, msg: str, payload: dict) -> None:
            pass

        with (
            patch("libs.ambit.client.AmbitClient") as MockAmbit,
            patch("libs.brsascore.client.BrsaScoreClient") as MockBrsa,
            patch("libs.rdkit_sa.client.RdkitSaClient") as MockRdkit,
        ):
            MockAmbit.return_value.predict_sa_score.return_value = (
                self._make_success_result(4.2)
            )
            MockBrsa.return_value.predict_sa_score.return_value = (
                self._make_success_result(3.1)
            )
            MockRdkit.return_value.predict_sa_score.return_value = (
                self._make_success_result(2.9)
            )

            result = sa_score_plugin(
                {
                    "smiles_list": ["CCO", "c1ccccc1"],
                    "methods": ["ambit", "brsa", "rdkit"],
                },
                _noop_progress,
                _noop_log,
            )

        molecules = result["molecules"]
        self.assertEqual(result["total"], 2)
        self.assertEqual(len(molecules), 2)
        self.assertAlmostEqual(float(molecules[0]["ambit_sa"] or 0), 4.2, places=2)
        self.assertAlmostEqual(
            float(molecules[0]["brsa_sa"] or 0), _convert_score(3.1), places=2
        )
        self.assertAlmostEqual(
            float(molecules[0]["rdkit_sa"] or 0), _convert_score(2.9), places=2
        )

    def test_plugin_skips_non_requested_methods(self) -> None:
        """El plugin no debe llamar métodos que no están en 'methods'."""
        from .plugin import sa_score_plugin

        def _noop(pct, stage, msg):
            pass

        def _noop_log(level, source, msg, payload):
            pass

        with (
            patch("libs.ambit.client.AmbitClient") as MockAmbit,
            patch("libs.brsascore.client.BrsaScoreClient") as MockBrsa,
            patch("libs.rdkit_sa.client.RdkitSaClient") as MockRdkit,
        ):
            MockBrsa.return_value.predict_sa_score.return_value = (
                self._make_success_result(3.5)
            )

            result = sa_score_plugin(
                {"smiles_list": ["CCO"], "methods": ["brsa"]},
                _noop,
                _noop_log,
            )

        MockAmbit.assert_not_called()
        MockRdkit.assert_not_called()
        self.assertIsNone(result["molecules"][0]["ambit_sa"])
        self.assertIsNone(result["molecules"][0]["rdkit_sa"])


class BrsaScoreClientRegressionTests(TestCase):
    """Pruebas de regresión del cliente BRSAScore usado por SA score."""

    def test_brsascore_receives_smiles_string_not_mol(self) -> None:
        """El cliente debe invocar calculateScore con un SMILES string."""
        with patch("BRSAScore.SAScorer") as MockSAScorer:
            mock_scorer_instance = MockSAScorer.return_value
            mock_scorer_instance.calculateScore.return_value = (3.21, {})

            result = BrsaScoreClient().predict_sa_score("CCO")

        mock_scorer_instance.calculateScore.assert_called_once_with("CCO")
        self.assertTrue(result.success)
        self.assertAlmostEqual(result.sa_score or 0.0, 3.21, places=2)


class SaScoreCreateSerializerValidationTests(TestCase):
    """Pruebas de validación de payload para creación de job SA score."""

    def test_rejects_incompatible_smiles(self) -> None:
        """Debe fallar si algún SMILES no es compatible con RDKit."""
        serializer = SaScoreJobCreateSerializer(
            data={
                "smiles": ["CCO", "not_a_smiles"],
                "methods": ["ambit"],
            }
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn("smiles", serializer.errors)
