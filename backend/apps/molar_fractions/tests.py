"""tests.py: Pruebas de contrato y ejecución para la app molar_fractions.

Objetivo del archivo:
- Verificar creación/consulta de jobs, validaciones de payload y logs por paso.

Cómo se usa:
- Ejecutar con `python manage.py test apps.molar_fractions`.
"""

from __future__ import annotations

from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import ScientificJob, ScientificJobLogEvent
from apps.core.services import JobService
from apps.core.types import JSONMap

from ._species_labels import generate_species_labels
from .definitions import APP_API_BASE_PATH, PLUGIN_NAME


class MolarFractionsContractApiTests(TestCase):
    """Valida contrato HTTP y ejecución del plugin molar_fractions."""

    def setUp(self) -> None:
        self.client = APIClient()

    def test_create_and_retrieve_molar_fractions_job_range(self) -> None:
        request_payload: JSONMap = {
            "version": "1.0.0",
            "pka_values": [2.2, 7.2, 12.3],
            "initial_charge": "q",
            "label": "A",
            "ph_mode": "range",
            "ph_min": 0.0,
            "ph_max": 14.0,
            "ph_step": 1.0,
        }

        with patch(
            "apps.molar_fractions.routers.dispatch_scientific_job"
        ) as dispatch_mock:
            dispatch_mock.return_value = True
            create_response = self.client.post(
                APP_API_BASE_PATH,
                request_payload,
                format="json",
            )

        self.assertEqual(create_response.status_code, 201)
        self.assertEqual(create_response.data["plugin_name"], PLUGIN_NAME)
        self.assertEqual(create_response.data["status"], "pending")

        created_job_id: str = str(create_response.data["id"])
        JobService.run_job(created_job_id)

        retrieve_response = self.client.get(f"{APP_API_BASE_PATH}{created_job_id}/")
        self.assertEqual(retrieve_response.status_code, 200)
        self.assertEqual(retrieve_response.data["status"], "completed")

        species_labels: list[str] = list(
            retrieve_response.data["results"]["species_labels"]
        )
        rows: list[dict[str, object]] = list(retrieve_response.data["results"]["rows"])

        self.assertEqual(species_labels, ["H₃Aq", "H₂Aq⁻¹", "HAq⁻²", "Aq⁻³"])
        self.assertEqual(len(rows), 15)

        for row in rows:
            row_sum: float = float(row["sum_fraction"])
            self.assertAlmostEqual(row_sum, 1.0, places=6)

    def test_create_molar_fractions_single_ph_mode(self) -> None:
        request_payload: JSONMap = {
            "version": "1.0.0",
            "pka_values": [4.75],
            "initial_charge": -1,
            "label": "Ac",
            "ph_mode": "single",
            "ph_value": 7.4,
        }

        with patch(
            "apps.molar_fractions.routers.dispatch_scientific_job"
        ) as dispatch_mock:
            dispatch_mock.return_value = True
            create_response = self.client.post(
                APP_API_BASE_PATH,
                request_payload,
                format="json",
            )

        self.assertEqual(create_response.status_code, 201)
        created_job_id: str = str(create_response.data["id"])

        JobService.run_job(created_job_id)

        retrieve_response = self.client.get(f"{APP_API_BASE_PATH}{created_job_id}/")
        self.assertEqual(retrieve_response.status_code, 200)
        self.assertEqual(len(retrieve_response.data["results"]["rows"]), 1)
        self.assertEqual(
            retrieve_response.data["results"]["metadata"]["ph_mode"],
            "single",
        )
        self.assertEqual(
            retrieve_response.data["results"]["species_labels"],
            ["HAc⁻", "Ac²⁻"],
        )

    def test_create_molar_fractions_rejects_single_without_ph_value(self) -> None:
        invalid_payload: JSONMap = {
            "version": "1.0.0",
            "pka_values": [4.75],
            "ph_mode": "single",
        }

        response = self.client.post(APP_API_BASE_PATH, invalid_payload, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertIn("ph_value", response.data)

    def test_create_molar_fractions_rejects_invalid_step(self) -> None:
        invalid_payload: JSONMap = {
            "version": "1.0.0",
            "pka_values": [2.2, 7.2, 12.3],
            "ph_mode": "range",
            "ph_min": 0.0,
            "ph_max": 14.0,
            "ph_step": 0.0,
        }

        response = self.client.post(APP_API_BASE_PATH, invalid_payload, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertIn("ph_step", response.data)

    def test_create_molar_fractions_rejects_step_smaller_than_point_zero_five(
        self,
    ) -> None:
        invalid_payload: JSONMap = {
            "version": "1.0.0",
            "pka_values": [2.2, 7.2, 12.3],
            "ph_mode": "range",
            "ph_min": 0.0,
            "ph_max": 1.0,
            "ph_step": 0.01,
        }

        response = self.client.post(APP_API_BASE_PATH, invalid_payload, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertIn("ph_step", response.data)
        self.assertIn("0.05", str(response.data["ph_step"]))

    def test_create_molar_fractions_requires_at_least_eight_points_in_range(
        self,
    ) -> None:
        invalid_payload: JSONMap = {
            "version": "1.0.0",
            "pka_values": [2.2, 7.2, 12.3],
            "ph_mode": "range",
            "ph_min": 0.0,
            "ph_max": 1.0,
            "ph_step": 0.5,
        }

        response = self.client.post(APP_API_BASE_PATH, invalid_payload, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertIn("ph_step", response.data)
        self.assertIn("8", str(response.data["ph_step"]))

    def test_create_molar_fractions_rejects_more_than_three_hundred_fifty_points(
        self,
    ) -> None:
        invalid_payload: JSONMap = {
            "version": "1.0.0",
            "pka_values": [2.2, 7.2, 12.3],
            "ph_mode": "range",
            "ph_min": 0.0,
            "ph_max": 20.0,
            "ph_step": 0.05,
        }

        response = self.client.post(APP_API_BASE_PATH, invalid_payload, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertIn("ph_step", response.data)
        self.assertIn("350", str(response.data["ph_step"]))

    def test_create_molar_fractions_swaps_reversed_ph_range(self) -> None:
        request_payload: JSONMap = {
            "version": "1.0.0",
            "pka_values": [2.2, 7.2, 12.3],
            "initial_charge": "q",
            "label": "A",
            "ph_mode": "range",
            "ph_min": 14.0,
            "ph_max": 0.0,
            "ph_step": 1.0,
        }

        with patch(
            "apps.molar_fractions.routers.dispatch_scientific_job"
        ) as dispatch_mock:
            dispatch_mock.return_value = True
            create_response = self.client.post(
                APP_API_BASE_PATH,
                request_payload,
                format="json",
            )

        self.assertEqual(create_response.status_code, 201)
        created_job_id: str = str(create_response.data["id"])

        JobService.run_job(created_job_id)

        retrieve_response = self.client.get(f"{APP_API_BASE_PATH}{created_job_id}/")
        metadata = retrieve_response.data["results"]["metadata"]
        self.assertEqual(metadata["ph_min"], 0.0)
        self.assertEqual(metadata["ph_max"], 14.0)

    def test_retrieve_molar_fractions_ignores_other_plugins(self) -> None:
        foreign_job: ScientificJob = ScientificJob.objects.create(
            plugin_name="smileit",
            algorithm_version="1.0.0",
            job_hash="x" * 64,
            parameters={"seed_url": "https://example.com/seed.txt", "total_numbers": 3},
            status="completed",
            cache_hit=False,
            cache_miss=True,
            results={"numbers": [1, 2, 3]},
        )

        response = self.client.get(f"{APP_API_BASE_PATH}{foreign_job.id}/")
        self.assertEqual(response.status_code, 404)

    def test_molar_fractions_endpoints_support_no_trailing_slash(self) -> None:
        request_payload: JSONMap = {
            "version": "1.0.0",
            "pka_values": [2.2, 7.2],
            "ph_mode": "single",
            "ph_value": 7.0,
        }

        with patch(
            "apps.molar_fractions.routers.dispatch_scientific_job"
        ) as dispatch_mock:
            dispatch_mock.return_value = True
            create_response = self.client.post(
                APP_API_BASE_PATH.rstrip("/"),
                request_payload,
                format="json",
            )

        self.assertEqual(create_response.status_code, 201)
        created_job_id: str = str(create_response.data["id"])

        retrieve_response = self.client.get(
            f"{APP_API_BASE_PATH.rstrip('/')}/{created_job_id}"
        )
        self.assertEqual(retrieve_response.status_code, 200)

    def test_molar_fractions_persists_step_by_step_logs(self) -> None:
        request_payload: JSONMap = {
            "version": "1.0.0",
            "pka_values": [2.2, 7.2, 12.3],
            "initial_charge": 2,
            "label": "EDA",
            "ph_mode": "range",
            "ph_min": 0.0,
            "ph_max": 7.0,
            "ph_step": 1.0,
        }

        with patch(
            "apps.molar_fractions.routers.dispatch_scientific_job"
        ) as dispatch_mock:
            dispatch_mock.return_value = True
            create_response = self.client.post(
                APP_API_BASE_PATH,
                request_payload,
                format="json",
            )

        self.assertEqual(create_response.status_code, 201)
        created_job_id: str = str(create_response.data["id"])

        JobService.run_job(created_job_id)

        job: ScientificJob = ScientificJob.objects.get(id=created_job_id)
        plugin_logs = ScientificJobLogEvent.objects.filter(
            job=job,
            source="molar_fractions.plugin",
        ).order_by("event_index")

        self.assertGreaterEqual(plugin_logs.count(), 7)
        messages: list[str] = [str(item.message) for item in plugin_logs]

        self.assertIn(
            "Iniciando validación de parámetros para cálculo de fracciones molares.",
            messages,
        )
        self.assertIn(
            "Se iniciará el cálculo para el punto de pH actual.",
            messages,
        )
        self.assertIn("Cálculo de punto completado correctamente.", messages)
        self.assertIn("Cálculo global de fracciones molares completado.", messages)

    def test_report_csv_returns_download_for_completed_molar_job(self) -> None:
        completed_job: ScientificJob = ScientificJob.objects.create(
            plugin_name=PLUGIN_NAME,
            algorithm_version="1.0.0",
            job_hash="m" * 64,
            parameters={
                "pka_values": [4.75],
                "initial_charge": "q",
                "label": "A",
                "ph_mode": "single",
                "ph_value": 7.4,
            },
            status="completed",
            cache_hit=False,
            cache_miss=True,
            results={
                "species_labels": ["HAq", "Aq⁻¹"],
                "rows": [
                    {
                        "ph": 7.4,
                        "fractions": [0.1, 0.9],
                        "sum_fraction": 1.0,
                    }
                ],
                "metadata": {
                    "pka_values": [4.75],
                    "initial_charge": "q",
                    "label": "A",
                    "ph_mode": "single",
                    "ph_min": 7.4,
                    "ph_max": 7.4,
                    "ph_step": 0.1,
                    "total_species": 2,
                    "total_points": 1,
                },
            },
        )

        response = self.client.get(f"{APP_API_BASE_PATH}{completed_job.id}/report-csv/")

        self.assertEqual(response.status_code, 200)
        self.assertIn("text/csv", str(response["Content-Type"]))
        self.assertIn("attachment;", str(response["Content-Disposition"]))

        csv_content: str = response.content.decode("utf-8")
        self.assertIn("ph,HAq,Aq⁻¹,sum_fraction", csv_content)
        self.assertIn("7.400000", csv_content)

    def test_report_csv_returns_conflict_when_job_is_not_completed(self) -> None:
        pending_job: ScientificJob = ScientificJob.objects.create(
            plugin_name=PLUGIN_NAME,
            algorithm_version="1.0.0",
            job_hash="n" * 64,
            parameters={
                "pka_values": [4.75],
                "initial_charge": "q",
                "label": "A",
                "ph_mode": "single",
                "ph_value": 7.4,
            },
            status="pending",
            cache_hit=False,
            cache_miss=True,
            results=None,
        )

        response = self.client.get(f"{APP_API_BASE_PATH}{pending_job.id}/report-csv/")

        self.assertEqual(response.status_code, 409)
        self.assertIn("completed", str(response.data["detail"]))

    def test_report_error_returns_download_for_failed_molar_job(self) -> None:
        failed_job: ScientificJob = ScientificJob.objects.create(
            plugin_name=PLUGIN_NAME,
            algorithm_version="1.0.0",
            job_hash="o" * 64,
            parameters={
                "pka_values": [2.2, 7.2],
                "initial_charge": "q",
                "label": "A",
                "ph_mode": "range",
                "ph_min": 0.0,
                "ph_max": 14.0,
                "ph_step": 1.0,
            },
            status="failed",
            cache_hit=False,
            cache_miss=True,
            error_trace="Fallo de prueba en cálculo de fracciones molares.",
        )

        response = self.client.get(f"{APP_API_BASE_PATH}{failed_job.id}/report-error/")

        self.assertEqual(response.status_code, 200)
        self.assertIn("text/plain", str(response["Content-Type"]))
        report_content: str = response.content.decode("utf-8")
        self.assertIn("=== JOB ERROR REPORT ===", report_content)
        self.assertIn(
            "Fallo de prueba en cálculo de fracciones molares.", report_content
        )


class MolarFractionsContractTests(TestCase):
    """Valida que el contrato declarativo expone la interfaz esperada."""

    def test_contract_exposes_required_interface(self) -> None:
        """El contrato debe tener plugin_name, execute y supports_pause_resume."""
        from .contract import get_molar_fractions_contract

        contract = get_molar_fractions_contract()
        for key in ("plugin_name", "version", "execute", "supports_pause_resume"):
            self.assertIn(key, contract)
        self.assertIsNotNone(contract["execute"])


class MolarFractionsSpeciesLabelTests(TestCase):
    """Valida la generación de etiquetas químicas a partir del notebook legado."""

    def test_generate_species_labels_supports_numeric_initial_charge(self) -> None:
        label_payload = generate_species_labels(
            pka_values=[6.16, 10.26],
            initial_charge=2,
            label="EDA",
        )

        self.assertEqual(
            label_payload["labels_pretty"],
            ["H₂EDA²⁺", "HEDA⁺", "EDA"],
        )
        self.assertEqual(label_payload["charges"], [2, 1, 0])

    def test_generate_species_labels_supports_symbolic_initial_charge(self) -> None:
        label_payload = generate_species_labels(
            pka_values=[2.0, 6.0],
            initial_charge="q",
            label="A",
        )

        self.assertEqual(
            label_payload["labels_pretty"],
            ["H₂Aq", "HAq⁻¹", "Aq⁻²"],
        )
        self.assertEqual(label_payload["labels_ascii"], ["H2Aq", "HAq-1", "Aq-2"])
