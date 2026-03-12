"""tests.py: Pruebas de contrato estricto HTTP para la app calculadora."""

from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import ScientificJob, ScientificJobLogEvent
from apps.core.services import JobService
from apps.core.types import JSONMap

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
            "op": "sqrt",
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

    def test_create_and_run_calculator_pow_operation(self) -> None:
        request_payload: JSONMap = {
            "version": "1.0.0",
            "op": "pow",
            "a": 2.0,
            "b": 8.0,
        }

        with patch("apps.calculator.routers.dispatch_scientific_job") as dispatch_mock:
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
        self.assertEqual(retrieve_response.data["results"]["final_result"], 256.0)
        self.assertEqual(
            retrieve_response.data["results"]["metadata"]["operation_used"], "pow"
        )

    def test_create_and_run_calculator_factorial_operation(self) -> None:
        request_payload: JSONMap = {
            "version": "1.0.0",
            "op": "factorial",
            "a": 5.0,
        }

        with patch("apps.calculator.routers.dispatch_scientific_job") as dispatch_mock:
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
        self.assertEqual(retrieve_response.data["results"]["final_result"], 120.0)
        self.assertEqual(
            retrieve_response.data["results"]["metadata"]["operation_used"],
            "factorial",
        )
        self.assertIsNone(retrieve_response.data["results"]["metadata"]["operand_b"])

    def test_create_factorial_rejects_second_operand(self) -> None:
        invalid_payload: JSONMap = {
            "version": "1.0.0",
            "op": "factorial",
            "a": 5.0,
            "b": 2.0,
        }

        response = self.client.post(
            APP_API_BASE_PATH,
            invalid_payload,
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("b", response.data)

    def test_create_factorial_rejects_non_integer_operand(self) -> None:
        invalid_payload: JSONMap = {
            "version": "1.0.0",
            "op": "factorial",
            "a": 3.5,
        }

        response = self.client.post(
            APP_API_BASE_PATH,
            invalid_payload,
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("a", response.data)

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

    def test_calculator_job_persists_start_and_finish_logs(self) -> None:
        request_payload: JSONMap = {
            "version": "1.0.0",
            "op": "add",
            "a": 3.0,
            "b": 4.0,
        }

        with patch("apps.calculator.routers.dispatch_scientific_job") as dispatch_mock:
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
        calculator_logs = ScientificJobLogEvent.objects.filter(
            job=job,
            source="calculator.plugin",
        ).order_by("event_index")

        self.assertGreaterEqual(calculator_logs.count(), 3)
        messages: list[str] = [str(item.message) for item in calculator_logs]
        self.assertIn(
            "Log fantasma: se ejecutará la operación de calculadora solicitada.",
            messages,
        )
        self.assertIn("Iniciando operación de calculadora.", messages)
        self.assertIn("Operación de calculadora completada.", messages)

    def test_report_csv_returns_download_for_completed_calculator_job(self) -> None:
        completed_job: ScientificJob = ScientificJob.objects.create(
            plugin_name=PLUGIN_NAME,
            algorithm_version="1.0.0",
            job_hash="c" * 64,
            parameters={
                "op": "mul",
                "a": 6.0,
                "b": 7.0,
            },
            status="completed",
            cache_hit=False,
            cache_miss=True,
            results={
                "final_result": 42.0,
                "metadata": {
                    "operation_used": "mul",
                    "operand_a": 6.0,
                    "operand_b": 7.0,
                },
            },
        )

        response = self.client.get(f"{APP_API_BASE_PATH}{completed_job.id}/report-csv/")

        self.assertEqual(response.status_code, 200)
        self.assertIn("text/csv", str(response["Content-Type"]))

        csv_content: str = response.content.decode("utf-8")
        self.assertIn("operation,operand_a,operand_b,final_result", csv_content)
        self.assertIn("mul", csv_content)
        self.assertIn("42.0000000000", csv_content)

    def test_report_csv_returns_conflict_for_non_completed_calculator_job(self) -> None:
        running_job: ScientificJob = ScientificJob.objects.create(
            plugin_name=PLUGIN_NAME,
            algorithm_version="1.0.0",
            job_hash="d" * 64,
            parameters={
                "op": "mul",
                "a": 6.0,
                "b": 7.0,
            },
            status="running",
            cache_hit=False,
            cache_miss=True,
            results=None,
        )

        response = self.client.get(f"{APP_API_BASE_PATH}{running_job.id}/report-csv/")

        self.assertEqual(response.status_code, 409)
        self.assertIn("completed", str(response.data["detail"]))

    def test_report_error_returns_download_for_failed_calculator_job(self) -> None:
        failed_job: ScientificJob = ScientificJob.objects.create(
            plugin_name=PLUGIN_NAME,
            algorithm_version="1.0.0",
            job_hash="e" * 64,
            parameters={
                "op": "div",
                "a": 10.0,
                "b": 0.0,
            },
            status="failed",
            cache_hit=False,
            cache_miss=True,
            error_trace="Division by zero controlada para prueba.",
        )

        response = self.client.get(f"{APP_API_BASE_PATH}{failed_job.id}/report-error/")

        self.assertEqual(response.status_code, 200)
        self.assertIn("text/plain", str(response["Content-Type"]))
        report_content: str = response.content.decode("utf-8")
        self.assertIn("=== JOB ERROR REPORT ===", report_content)
        self.assertIn("Division by zero controlada para prueba.", report_content)
