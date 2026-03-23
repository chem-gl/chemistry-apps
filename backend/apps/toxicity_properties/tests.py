"""tests.py: Pruebas unitarias para Toxicity Properties.

Valida mapeo de claves ADMET, construcción de CSV y ejecución del plugin
con mocks para mantener pruebas determinísticas y rápidas.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

from apps.core.models import ScientificJob
from apps.core.services import JobService
from django.test import TestCase
from libs.admet_ai.client import AdmetAiClient
from libs.admet_ai.models import AdmetPredictionResult
from rest_framework.test import APIClient

from .definitions import APP_API_BASE_PATH, PLUGIN_NAME
from .plugin import (
    _build_molecule_result,
    _find_prediction_key,
    toxicity_properties_plugin,
)
from .routers import _build_toxicity_csv
from .types import ToxicityMoleculeResult


class ToxicityCsvBuilderTests(TestCase):
    """Pruebas para construcción de CSV con columnas fijas."""

    def test_build_toxicity_csv_with_expected_header(self) -> None:
        """El encabezado del CSV debe incluir las cinco columnas definidas."""
        molecules: list[ToxicityMoleculeResult] = [
            {
                "smiles": "CCO",
                "LD50_mgkg": 430.2,
                "mutagenicity": "Negative",
                "ames_score": 0.21,
                "DevTox": "Positive",
                "devtox_score": 0.78,
                "error_message": None,
            }
        ]

        csv_content: str = _build_toxicity_csv(molecules)
        lines: list[str] = csv_content.splitlines()

        self.assertEqual(
            lines[0],
            "smiles,LD50_mgkg,mutagenicity,ames_score,DevTox,devtox_score",
        )
        self.assertEqual(len(lines), 2)


class ToxicityMappingTests(TestCase):
    """Pruebas de búsqueda de claves y normalización de resultados."""

    def test_find_prediction_key_returns_first_matching_keyword(self) -> None:
        """Debe resolver la primera clave compatible con la prioridad de keywords."""
        keys: list[str] = ["something", "acute_ld50", "ames_probability"]
        resolved_key: str | None = _find_prediction_key(keys, ("ld50", "acute"))
        self.assertEqual(resolved_key, "acute_ld50")

    @patch("apps.toxicity_properties.plugin._ld50_to_mgkg", return_value=430.2)
    def test_build_molecule_result_maps_labels_and_scores(
        self, _mock_ld50: object
    ) -> None:
        """Debe mapear columnas finales con umbrales Ames/DevTox."""
        prediction_result = AdmetPredictionResult(
            smiles="CCO",
            success=True,
            predictions={
                "ld50_oral": 0.34,
                "ames_probability": 0.21,
                "development_toxicity": 0.78,
            },
            error_message=None,
        )

        molecule_result = _build_molecule_result("CCO", prediction_result)

        self.assertEqual(molecule_result["LD50_mgkg"], 430.2)
        self.assertEqual(molecule_result["mutagenicity"], "Negative")
        self.assertEqual(molecule_result["ames_score"], 0.21)
        self.assertEqual(molecule_result["DevTox"], "Positive")
        self.assertEqual(molecule_result["devtox_score"], 0.78)
        self.assertIsNone(molecule_result["error_message"])


class ToxicityPluginTests(TestCase):
    """Pruebas del plugin completo con cliente ADMET-AI mockeado."""

    @patch("apps.toxicity_properties.plugin.AdmetAiClient")
    @patch("apps.toxicity_properties.plugin._ld50_to_mgkg", return_value=123.45)
    def test_plugin_returns_rows_for_each_smiles(
        self,
        _mock_ld50: object,
        mock_client_class: object,
    ) -> None:
        """El plugin debe producir una fila por SMILES y referencias globales."""
        mock_client = mock_client_class.return_value
        mock_client.predict_properties.side_effect = [
            AdmetPredictionResult(
                smiles="CCO",
                success=True,
                predictions={
                    "ld50": 0.4,
                    "ames": 0.8,
                    "devtox": 0.3,
                },
            ),
            AdmetPredictionResult(
                smiles="c1ccccc1",
                success=False,
                predictions={},
                error_message="No se pudo importar admet_ai",
            ),
        ]

        progress_events: list[tuple[int, str, str]] = []

        def _capture_progress(percentage: int, stage: str, message: str) -> None:
            progress_events.append((percentage, stage, message))

        log_events: list[tuple[str, str, str]] = []

        def _capture_log(level: str, source: str, message: str, payload: dict) -> None:
            del payload
            log_events.append((level, source, message))

        result_payload = toxicity_properties_plugin(
            {"smiles_list": ["CCO", "c1ccccc1"]},
            _capture_progress,
            _capture_log,
        )

        molecules = result_payload["molecules"]
        self.assertEqual(result_payload["total"], 2)
        self.assertEqual(len(molecules), 2)
        self.assertEqual(molecules[0]["LD50_mgkg"], 123.45)
        self.assertEqual(molecules[0]["mutagenicity"], "Positive")
        self.assertEqual(molecules[0]["DevTox"], "Negative")
        self.assertIsNotNone(molecules[1]["error_message"])
        self.assertTrue(len(result_payload["scientific_references"]) >= 3)
        self.assertEqual(progress_events[-1][0], 100)
        self.assertTrue(len(log_events) > 0)

    @patch("apps.toxicity_properties.plugin.AdmetAiClient")
    def test_plugin_raises_when_model_is_not_available(
        self,
        mock_client_class: object,
    ) -> None:
        """Si ADMET-AI no está disponible, el plugin debe fallar de forma fatal."""
        mock_client = mock_client_class.return_value
        mock_client.ensure_model_available.side_effect = RuntimeError(
            "No se pudo importar admet_ai"
        )

        def _noop_progress(_pct: int, _stage: str, _message: str) -> None:
            return None

        def _noop_log(
            _level: str,
            _source: str,
            _message: str,
            _payload: dict,
        ) -> None:
            return None

        with self.assertRaises(RuntimeError):
            toxicity_properties_plugin(
                {"smiles_list": ["CCO"]},
                _noop_progress,
                _noop_log,
            )


class AdmetClientSafetyTests(TestCase):
    """Pruebas de seguridad de runtime para ADMET-AI en workers daemon."""

    def test_client_initializes_admet_model_with_zero_workers(self) -> None:
        """El cliente debe forzar num_workers=0 para evitar forks en Celery."""
        captured_kwargs: dict[str, object] = {}

        class FakeADMETModel:
            def __init__(self, **kwargs: object) -> None:
                captured_kwargs.update(kwargs)

        previous_model_instance = AdmetAiClient._model_instance
        AdmetAiClient._model_instance = None
        try:
            with patch.dict(
                "sys.modules",
                {"admet_ai": SimpleNamespace(ADMETModel=FakeADMETModel)},
            ):
                AdmetAiClient().ensure_model_available()
        finally:
            AdmetAiClient._model_instance = previous_model_instance

        self.assertEqual(captured_kwargs.get("num_workers"), 0)


class ToxicityContractApiTests(TestCase):
    """Pruebas de contrato HTTP para creación, consulta y reportes."""

    def setUp(self) -> None:
        self.client = APIClient()

    @patch("apps.toxicity_properties.routers.dispatch_scientific_job")
    @patch("apps.toxicity_properties.plugin.AdmetAiClient")
    @patch("apps.toxicity_properties.plugin._ld50_to_mgkg", return_value=321.0)
    def test_create_and_retrieve_toxicity_job(
        self,
        _mock_ld50: object,
        mock_admet_client_class: object,
        mock_dispatch_job: object,
    ) -> None:
        """Debe crear y recuperar un job completed con resultados tipados."""
        del mock_dispatch_job
        mock_admet_client = mock_admet_client_class.return_value
        mock_admet_client.predict_properties.return_value = AdmetPredictionResult(
            smiles="CCO",
            success=True,
            predictions={
                "ld50_oral": 0.4,
                "ames_probability": 0.2,
                "development_toxicity": 0.9,
            },
            error_message=None,
        )

        create_response = self.client.post(
            APP_API_BASE_PATH,
            {"smiles": ["CCO"], "version": "1.0.0"},
            format="json",
        )

        self.assertEqual(create_response.status_code, 201)
        created_job_id: str = str(create_response.data["id"])

        JobService.run_job(created_job_id)

        retrieve_response = self.client.get(f"{APP_API_BASE_PATH}{created_job_id}/")
        self.assertEqual(retrieve_response.status_code, 200)
        self.assertEqual(retrieve_response.data["status"], "completed")

        result_payload = retrieve_response.data["results"]
        molecules = result_payload["molecules"]
        self.assertEqual(result_payload["total"], 1)
        self.assertEqual(molecules[0]["smiles"], "CCO")
        self.assertEqual(molecules[0]["LD50_mgkg"], 321.0)
        self.assertEqual(molecules[0]["mutagenicity"], "Negative")
        self.assertEqual(molecules[0]["DevTox"], "Positive")

    @patch("apps.toxicity_properties.routers.dispatch_scientific_job")
    @patch("apps.toxicity_properties.plugin.AdmetAiClient")
    def test_run_job_sets_failed_when_admet_model_is_missing(
        self,
        mock_admet_client_class: object,
        mock_dispatch_job: object,
    ) -> None:
        """Si el modelo ADMET no está disponible, el job debe quedar en failed."""
        del mock_dispatch_job
        mock_admet_client = mock_admet_client_class.return_value
        mock_admet_client.ensure_model_available.side_effect = RuntimeError(
            "No se pudo importar admet_ai"
        )

        create_response = self.client.post(
            APP_API_BASE_PATH,
            {"smiles": ["CCO"], "version": "1.0.0"},
            format="json",
        )
        self.assertEqual(create_response.status_code, 201)

        created_job_id: str = str(create_response.data["id"])
        JobService.run_job(created_job_id)

        retrieve_response = self.client.get(f"{APP_API_BASE_PATH}{created_job_id}/")
        self.assertEqual(retrieve_response.status_code, 200)
        self.assertEqual(retrieve_response.data["status"], "failed")
        failed_job = ScientificJob.objects.get(id=created_job_id)
        self.assertIsNotNone(failed_job.error_trace)
        self.assertIn("No se pudo importar admet_ai", str(failed_job.error_trace))

    def test_create_rejects_empty_smiles_after_normalization(self) -> None:
        """Debe rechazar payloads cuyo listado de SMILES queda vacío."""
        response = self.client.post(
            APP_API_BASE_PATH,
            {"smiles": ["  ", "\t", "\n"]},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("smiles", response.data)

    def test_create_rejects_incompatible_smiles(self) -> None:
        """Debe rechazar payloads con SMILES no compatibles con RDKit."""
        response = self.client.post(
            APP_API_BASE_PATH,
            {"smiles": ["CCO", "not_a_smiles"]},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("smiles", response.data)

    def test_report_csv_returns_download_for_completed_job(self) -> None:
        """Debe descargar CSV cuando el job está completado."""
        completed_job = ScientificJob.objects.create(
            plugin_name=PLUGIN_NAME,
            algorithm_version="1.0.0",
            job_hash="tox-csv-job-hash-000000000000000000000000000000000000000000000000",
            parameters={"smiles_list": ["CCO"]},
            status="completed",
            cache_hit=False,
            cache_miss=True,
            results={
                "molecules": [
                    {
                        "smiles": "CCO",
                        "LD50_mgkg": 430.2,
                        "mutagenicity": "Negative",
                        "ames_score": 0.21,
                        "DevTox": "Positive",
                        "devtox_score": 0.78,
                        "error_message": None,
                    }
                ],
                "total": 1,
                "scientific_references": ["Ref A", "Ref B"],
            },
        )

        response = self.client.get(f"{APP_API_BASE_PATH}{completed_job.id}/report-csv/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("text/csv", str(response["Content-Type"]))
        csv_content: str = response.content.decode("utf-8")
        self.assertIn(
            "smiles,LD50_mgkg,mutagenicity,ames_score,DevTox,devtox_score", csv_content
        )
        self.assertIn("CCO", csv_content)

    def test_report_csv_returns_conflict_for_non_completed_job(self) -> None:
        """Debe retornar 409 si el job no está en estado completed."""
        pending_job = ScientificJob.objects.create(
            plugin_name=PLUGIN_NAME,
            algorithm_version="1.0.0",
            job_hash="tox-pending-job-hash-0000000000000000000000000000000000000000000000",
            parameters={"smiles_list": ["CCO"]},
            status="pending",
            cache_hit=False,
            cache_miss=True,
            results=None,
        )

        response = self.client.get(f"{APP_API_BASE_PATH}{pending_job.id}/report-csv/")
        self.assertEqual(response.status_code, 409)
        self.assertIn("detail", response.data)

    def test_report_log_returns_download_file(self) -> None:
        """Debe descargar reporte log para auditoría del job."""
        completed_job = ScientificJob.objects.create(
            plugin_name=PLUGIN_NAME,
            algorithm_version="1.0.0",
            job_hash="tox-log-job-hash-000000000000000000000000000000000000000000000000",
            parameters={"smiles_list": ["CCO"]},
            status="completed",
            cache_hit=False,
            cache_miss=True,
            progress_percentage=100,
            progress_stage="completed",
            progress_message="Completed",
            results={"molecules": [], "total": 0, "scientific_references": []},
        )

        response = self.client.get(f"{APP_API_BASE_PATH}{completed_job.id}/report-log/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("text/plain", str(response["Content-Type"]))

    def test_report_error_returns_download_for_failed_job(self) -> None:
        """Debe descargar reporte de error cuando el job falla."""
        failed_job = ScientificJob.objects.create(
            plugin_name=PLUGIN_NAME,
            algorithm_version="1.0.0",
            job_hash="tox-error-job-hash-00000000000000000000000000000000000000000000000",
            parameters={"smiles_list": ["CCO"]},
            status="failed",
            cache_hit=False,
            cache_miss=True,
            error_trace="RuntimeError: ADMET inference failed",
            results=None,
        )

        response = self.client.get(f"{APP_API_BASE_PATH}{failed_job.id}/report-error/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("text/plain", str(response["Content-Type"]))
        report_content: str = response.content.decode("utf-8")
        self.assertIn("RuntimeError: ADMET inference failed", report_content)
        self.assertIn("RuntimeError: ADMET inference failed", report_content)
        self.assertIn("RuntimeError: ADMET inference failed", report_content)
        self.assertIn("RuntimeError: ADMET inference failed", report_content)
        self.assertIn("RuntimeError: ADMET inference failed", report_content)
