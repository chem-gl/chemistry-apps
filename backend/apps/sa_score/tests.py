"""tests.py: Pruebas unitarias para la app SA Score.

Valida el plugin, la construcción de CSVs y la integración con los tres clientes.
Los clientes de SA score se mockean para aislar la lógica del plugin.

Uso:
    cd backend
    poetry run python manage.py test apps.sa_score --verbosity=2
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from django.test import TestCase
from libs.brsascore.client import BrsaScoreClient

from apps.core.models import ScientificJob

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
                "name": "ethanol",
                "smiles": "CCO",
                "ambit_sa": 1.23,
                "brsa_sa": 2.34,
                "rdkit_sa": 3.45,
                "ambit_error": None,
                "brsa_error": None,
                "rdkit_error": None,
            },
            {
                "name": "benzene",
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

        self.assertIn("name,smiles,ambit_sa_percent,brsa_sa", lines[0])
        self.assertNotIn("rdkit_sa", lines[0])
        self.assertEqual(len(lines), 3)  # header + 2 moléculas

    def test_full_csv_uses_all_three_methods(self) -> None:
        """El CSV completo con los tres métodos debe tener 4 columnas."""
        csv_content = _build_full_csv(self.molecule_results, ["ambit", "brsa", "rdkit"])
        header = csv_content.splitlines()[0]
        self.assertEqual(header, "name,smiles,ambit_sa_percent,brsa_sa,rdkit_sa")

    def test_single_method_csv_has_smiles_sa_columns(self) -> None:
        """El CSV de método único debe tener columnas smiles,sa."""
        csv_content = _build_single_method_csv(self.molecule_results, "brsa")
        lines = csv_content.splitlines()

        self.assertEqual(lines[0], "name,smiles,sa")
        self.assertIn("2.340000", lines[1])  # brsa_sa de CCO
        self.assertIn("4.560000", lines[2])  # brsa_sa de c1ccccc1

    def test_single_method_csv_ambit_uses_percent_header(self) -> None:
        """El CSV de AMBIT debe exponer encabezado explícito de porcentaje."""
        csv_content = _build_single_method_csv(self.molecule_results, "ambit")
        lines = csv_content.splitlines()
        self.assertEqual(lines[0], "name,smiles,sa_percent")

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
                    "molecules": [
                        {"name": "ethanol", "smiles": "CCO"},
                        {"name": "benzene", "smiles": "c1ccccc1"},
                    ],
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
                {
                    "molecules": [{"name": "ethanol", "smiles": "CCO"}],
                    "methods": ["brsa"],
                },
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
        """El cliente debe invocar calculate_score con un SMILES string."""
        with patch("BRSAScore.SAScorer") as MockSAScorer:
            mock_scorer_instance = MockSAScorer.return_value
            mock_scorer_instance.calculate_score.return_value = (3.21, {})

            result = BrsaScoreClient().predict_sa_score("CCO")

        mock_scorer_instance.calculate_score.assert_called_once_with("CCO")
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
        self.assertIn("molecules", serializer.errors)


class SaScoreContractTests(TestCase):
    """Valida que el contrato declarativo expone la interfaz esperada."""

    def test_contract_exposes_required_interface(self) -> None:
        """El contrato debe tener plugin_name, execute y supports_pause_resume."""
        from .contract import get_sa_score_contract

        contract = get_sa_score_contract()
        for key in ("plugin_name", "version", "execute", "supports_pause_resume"):
            self.assertIn(key, contract)
        self.assertIsNotNone(contract["execute"])


class SaScoreRouterApiTests(TestCase):
    """Pruebas de integración HTTP para los endpoints del viewset SA Score."""

    SA_SCORE_URL: str = "/api/sa-score/jobs/"

    def setUp(self) -> None:
        from rest_framework.test import APIClient

        self.client = APIClient()

    def _make_completed_sa_job(self, methods: list[str] | None = None) -> ScientificJob:
        """Crea un job de SA score en estado completado para tests de reporte."""
        from uuid import uuid4

        if methods is None:
            methods = ["brsa", "rdkit"]

        molecules = [
            {
                "name": "ethanol",
                "smiles": "CCO",
                "ambit_sa": None,
                "brsa_sa": 2.34,
                "rdkit_sa": 3.45,
                "ambit_error": "not requested",
                "brsa_error": None,
                "rdkit_error": None,
            }
        ]
        return ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="sa-score",
            algorithm_version="1.0.0",
            status="completed",
            parameters={
                "molecules": [{"name": "ethanol", "smiles": "CCO"}],
                "methods": methods,
            },
            results={
                "molecules": molecules,
                "requested_methods": methods,
            },
        )

    def test_create_sa_score_job_returns_201(self) -> None:
        """El endpoint create debe retornar 201 con un job pendiente."""
        payload = {
            "smiles": ["CCO", "c1ccccc1"],
            "methods": ["brsa", "rdkit"],
        }

        with patch("apps.sa_score.routers.dispatch_scientific_job") as mock_dispatch:
            mock_dispatch.return_value = True
            response = self.client.post(self.SA_SCORE_URL, payload, format="json")

        self.assertEqual(response.status_code, 201)
        self.assertIn("id", response.data)
        self.assertIn("status", response.data)

    def test_create_sa_score_job_with_invalid_payload_returns_400(self) -> None:
        """Payload inválido (sin smiles) debe retornar 400."""
        payload = {"methods": ["brsa"]}

        response = self.client.post(self.SA_SCORE_URL, payload, format="json")

        self.assertEqual(response.status_code, 400)

    def test_report_csv_by_method_returns_csv_for_valid_method(self) -> None:
        """Solicitar CSV de un método calculado debe retornar 200 con contenido CSV."""
        job = self._make_completed_sa_job(methods=["brsa", "rdkit"])
        url = f"{self.SA_SCORE_URL}{job.id}/report-csv-method/?method=brsa"

        http_response = self.client.get(url)

        self.assertEqual(http_response.status_code, 200)
        self.assertIn("text/csv", http_response.get("Content-Type", ""))
        content = http_response.content.decode("utf-8")
        self.assertIn("name,smiles,sa", content)
        self.assertIn("CCO", content)

    def test_report_csv_by_method_returns_400_for_unknown_method(self) -> None:
        """Un nombre de método desconocido debe retornar 400."""
        job = self._make_completed_sa_job()
        url = f"{self.SA_SCORE_URL}{job.id}/report-csv-method/?method=unknown"

        response = self.client.get(url)

        self.assertEqual(response.status_code, 400)
        self.assertIn("no válido", response.data["detail"])

    def test_report_csv_by_method_returns_400_when_method_not_calculated(
        self,
    ) -> None:
        """Solicitar un método que no fue calculado en el job debe retornar 400."""
        job = self._make_completed_sa_job(methods=["brsa"])
        url = f"{self.SA_SCORE_URL}{job.id}/report-csv-method/?method=rdkit"

        response = self.client.get(url)

        self.assertEqual(response.status_code, 400)
        self.assertIn("no fue calculado", response.data["detail"])

    def test_report_csv_by_method_returns_409_when_job_not_completed(self) -> None:
        """Un job en estado pending no tiene resultados; debe retornar 409."""
        from uuid import uuid4

        pending_job = ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="sa-score",
            algorithm_version="1.0.0",
            status="pending",
            parameters={
                "molecules": [{"name": "ethanol", "smiles": "CCO"}],
                "methods": ["brsa"],
            },
            results=None,
        )
        url = f"{self.SA_SCORE_URL}{pending_job.id}/report-csv-method/?method=brsa"

        response = self.client.get(url)

        self.assertEqual(response.status_code, 409)
