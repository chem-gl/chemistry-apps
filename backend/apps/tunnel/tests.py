"""tests.py: Pruebas de contrato y ejecución para la app Tunnel.

Objetivo del archivo:
- Verificar creación/consulta de jobs, validaciones y trazabilidad de eventos.

Cómo se usa:
- Ejecutar con `python manage.py test apps.tunnel`.
"""

from __future__ import annotations

import math
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import ScientificJob, ScientificJobLogEvent
from apps.core.services import JobService
from apps.core.types import JSONMap

from .definitions import APP_API_BASE_PATH, PLUGIN_NAME


class TunnelContractApiTests(TestCase):
    """Valida contrato HTTP y ejecución del plugin Tunnel."""

    def setUp(self) -> None:
        self.client = APIClient()

    def test_create_and_retrieve_tunnel_job(self) -> None:
        request_payload: JSONMap = {
            "version": "2.0.0",
            "reaction_barrier_zpe": 3.5,
            "imaginary_frequency": 625.0,
            "reaction_energy_zpe": -8.2,
            "temperature": 298.15,
            "input_change_events": [
                {
                    "field_name": "reaction_barrier_zpe",
                    "previous_value": 0.0,
                    "new_value": 3.5,
                    "changed_at": "2026-03-12T10:01:10.000Z",
                }
            ],
        }

        with patch("apps.tunnel.routers.dispatch_scientific_job") as dispatch_mock:
            dispatch_mock.return_value = True
            create_response = self.client.post(
                APP_API_BASE_PATH,
                request_payload,
                format="json",
            )

        self.assertEqual(create_response.status_code, 201)
        self.assertEqual(create_response.data["plugin_name"], PLUGIN_NAME)
        created_job_id: str = str(create_response.data["id"])

        JobService.run_job(created_job_id)

        retrieve_response = self.client.get(f"{APP_API_BASE_PATH}{created_job_id}/")
        self.assertEqual(retrieve_response.status_code, 200)
        self.assertEqual(retrieve_response.data["status"], "completed")

        result_payload: dict[str, object] = retrieve_response.data["results"]
        self.assertTrue(math.isfinite(float(result_payload["u"])))
        self.assertTrue(math.isfinite(float(result_payload["alpha_1"])))
        self.assertTrue(math.isfinite(float(result_payload["alpha_2"])))
        self.assertTrue(math.isfinite(float(result_payload["g"])))
        self.assertTrue(math.isfinite(float(result_payload["kappa_tst"])))

    def test_create_tunnel_rejects_non_positive_frequency(self) -> None:
        invalid_payload: JSONMap = {
            "version": "2.0.0",
            "reaction_barrier_zpe": 3.5,
            "imaginary_frequency": 0.0,
            "reaction_energy_zpe": -8.2,
            "temperature": 298.15,
            "input_change_events": [],
        }

        response = self.client.post(APP_API_BASE_PATH, invalid_payload, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertIn("imaginary_frequency", response.data)

    def test_tunnel_persists_input_change_events_as_logs(self) -> None:
        request_payload: JSONMap = {
            "version": "2.0.0",
            "reaction_barrier_zpe": 3.5,
            "imaginary_frequency": 625.0,
            "reaction_energy_zpe": -8.2,
            "temperature": 298.15,
            "input_change_events": [
                {
                    "field_name": "reaction_barrier_zpe",
                    "previous_value": 0.0,
                    "new_value": 3.5,
                    "changed_at": "2026-03-12T10:01:10.000Z",
                },
                {
                    "field_name": "temperature",
                    "previous_value": 300.0,
                    "new_value": 298.15,
                    "changed_at": "2026-03-12T10:01:15.000Z",
                },
            ],
        }

        with patch("apps.tunnel.routers.dispatch_scientific_job") as dispatch_mock:
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
        input_logs = ScientificJobLogEvent.objects.filter(
            job=job,
            source="tunnel.input",
        ).order_by("event_index")

        self.assertEqual(input_logs.count(), 2)
        messages: list[str] = [str(item.message) for item in input_logs]
        self.assertIn("Cambio de entrada registrado desde frontend.", messages)

        math_logs = ScientificJobLogEvent.objects.filter(
            job=job,
            source="tunnel.math",
        ).order_by("event_index")
        self.assertGreaterEqual(math_logs.count(), 6)

        math_messages: list[str] = [str(item.message) for item in math_logs]
        self.assertIn("Operacion matematica: calculo de alpha_1.", math_messages)
        self.assertIn("Operacion matematica: calculo de alpha_2.", math_messages)
        self.assertIn("Operacion matematica: calculo de U.", math_messages)
        self.assertIn(
            "Operacion matematica: calculo de kappa_tst.",
            math_messages,
        )

    def test_report_csv_returns_download_for_completed_tunnel_job(self) -> None:
        completed_job: ScientificJob = ScientificJob.objects.create(
            plugin_name=PLUGIN_NAME,
            algorithm_version="2.0.0",
            job_hash="t" * 64,
            parameters={
                "reaction_barrier_zpe": 3.5,
                "imaginary_frequency": 625.0,
                "reaction_energy_zpe": -8.2,
                "temperature": 298.15,
                "input_change_events": [],
            },
            status="completed",
            cache_hit=False,
            cache_miss=True,
            results={
                "u": 3.012,
                "alpha_1": 3.380,
                "alpha_2": 11.299,
                "g": 0.082,
                "kappa_tst": 1.662,
                "metadata": {
                    "model_name": "Asymmetric Eckart Tunneling (Gauss-Legendre 40-point)",
                    "source_library": "libs.ck_test.TST",
                    "units": {
                        "reaction_barrier_zpe": "kcal/mol",
                        "reaction_energy_zpe": "kcal/mol",
                        "imaginary_frequency": "cm^-1",
                        "temperature": "K",
                        "u": "dimensionless",
                        "alpha_1": "dimensionless",
                        "alpha_2": "dimensionless",
                        "g": "dimensionless",
                        "kappa_tst": "dimensionless",
                    },
                    "input_event_count": 0,
                },
            },
        )

        response = self.client.get(f"{APP_API_BASE_PATH}{completed_job.id}/report-csv/")

        self.assertEqual(response.status_code, 200)
        self.assertIn("text/csv", str(response["Content-Type"]))
        csv_content: str = response.content.decode("utf-8")
        self.assertIn("reaction_barrier_zpe", csv_content)
        self.assertIn("kappa_tst", csv_content)
