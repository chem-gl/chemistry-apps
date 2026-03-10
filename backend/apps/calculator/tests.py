"""tests.py: Pruebas de contrato estricto HTTP para la app calculadora."""

from unittest.mock import patch

from apps.core.models import ScientificJob
from apps.core.services import JobService
from apps.core.types import JSONMap
from django.test import TestCase
from rest_framework.test import APIClient

from .definitions import APP_API_BASE_PATH, PLUGIN_NAME


class CalculatorContractApiTests(TestCase):
    """Valida request/response estrictos del endpoint dedicado de calculadora."""

    def setUp(self) -> None:
        self.client = APIClient()

    def test_create_and_retrieve_calculator_job_contract(self) -> None:
        request_payload: JSONMap = {
            "version": "1.0.0",
            "op": "mul",
            "a": 7.0,
            "b": 6.0,
        }

        with patch("apps.calculator.routers.dispatch_scientific_job") as dispatch_mock:
            dispatch_mock.return_value = True
            create_response = self.client.post(
                APP_API_BASE_PATH,
                request_payload,
                format="json",
            )
            self.assertEqual(create_response.status_code, 201)
            self.assertEqual(create_response.data["plugin_name"], PLUGIN_NAME)
            self.assertEqual(create_response.data["parameters"]["op"], "mul")
            self.assertEqual(create_response.data["status"], "pending")
            self.assertIsNone(create_response.data["results"])
            created_job_id: str = str(create_response.data["id"])
            dispatch_mock.assert_called_once_with(created_job_id)

        JobService.run_job(created_job_id)

        retrieve_response = self.client.get(f"{APP_API_BASE_PATH}{created_job_id}/")
        self.assertEqual(retrieve_response.status_code, 200)
        self.assertEqual(retrieve_response.data["status"], "completed")
        self.assertEqual(retrieve_response.data["results"]["final_result"], 42.0)
        self.assertEqual(
            retrieve_response.data["results"]["metadata"]["operation_used"], "mul"
        )

    def test_create_calculator_job_rejects_invalid_operation(self) -> None:
        invalid_payload: JSONMap = {
            "version": "1.0.0",
            "op": "pow",
            "a": 2.0,
            "b": 3.0,
        }

        response = self.client.post(
            APP_API_BASE_PATH,
            invalid_payload,
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("op", response.data)

    def test_retrieve_calculator_endpoint_ignores_other_plugins(self) -> None:
        foreign_job: ScientificJob = ScientificJob.objects.create(
            plugin_name="chemistry-simulator",
            algorithm_version="1.0.0",
            job_hash="x" * 64,
            parameters={"mode": "dry"},
            status="completed",
            cache_hit=False,
            cache_miss=True,
            results={"value": 1},
        )

        response = self.client.get(f"{APP_API_BASE_PATH}{foreign_job.id}/")

        self.assertEqual(response.status_code, 404)

    def test_calculator_endpoints_accept_requests_without_trailing_slash(self) -> None:
        request_payload: JSONMap = {
            "version": "1.0.0",
            "op": "add",
            "a": 3.0,
            "b": 4.0,
        }

        with patch("apps.calculator.routers.dispatch_scientific_job") as dispatch_mock:
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
