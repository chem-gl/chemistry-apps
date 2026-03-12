"""tests.py: Pruebas de contrato y ejecución para la app molar_fractions.

Objetivo del archivo:
- Verificar creación/consulta de jobs, validaciones de payload y logs por paso.

Cómo se usa:
- Ejecutar con `python manage.py test apps.molar_fractions`.
"""

from __future__ import annotations

from unittest.mock import patch

from apps.core.models import ScientificJob, ScientificJobLogEvent
from apps.core.services import JobService
from apps.core.types import JSONMap
from django.test import TestCase
from rest_framework.test import APIClient

from .definitions import APP_API_BASE_PATH, PLUGIN_NAME


class MolarFractionsContractApiTests(TestCase):
    """Valida contrato HTTP y ejecución del plugin molar_fractions."""

    def setUp(self) -> None:
        self.client = APIClient()

    def test_create_and_retrieve_molar_fractions_job_range(self) -> None:
        request_payload: JSONMap = {
            "version": "1.0.0",
            "pka_values": [2.2, 7.2, 12.3],
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

        self.assertEqual(species_labels, ["f0", "f1", "f2", "f3"])
        self.assertEqual(len(rows), 15)

        for row in rows:
            row_sum: float = float(row["sum_fraction"])
            self.assertAlmostEqual(row_sum, 1.0, places=6)

    def test_create_molar_fractions_single_ph_mode(self) -> None:
        request_payload: JSONMap = {
            "version": "1.0.0",
            "pka_values": [4.75],
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

    def test_create_molar_fractions_swaps_reversed_ph_range(self) -> None:
        request_payload: JSONMap = {
            "version": "1.0.0",
            "pka_values": [2.2, 7.2, 12.3],
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
            plugin_name="calculator",
            algorithm_version="1.0.0",
            job_hash="x" * 64,
            parameters={"op": "add", "a": 1, "b": 2},
            status="completed",
            cache_hit=False,
            cache_miss=True,
            results={"final_result": 3},
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
            "ph_mode": "range",
            "ph_min": 0.0,
            "ph_max": 2.0,
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
