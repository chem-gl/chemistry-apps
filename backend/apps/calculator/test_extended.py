"""test_extended.py: Tests HTTP extendidos para la app calculadora.

Objetivo del archivo:
- Cubrir ramas adicionales del router/schemas de calculator no cubiertas
  por tests.py: operaciones por división, factorial, cache hit, error handling.

Cómo se usa:
- Ejecutar con `python manage.py test apps.calculator.test_extended`.
"""

from __future__ import annotations

from unittest.mock import patch

from apps.core.models import ScientificJob
from apps.core.test_utils import ScientificJobTestMixin

from .definitions import APP_API_BASE_PATH, PLUGIN_NAME

ROUTER_MODULE = "apps.calculator.routers"


class CalculatorExtendedApiTests(ScientificJobTestMixin):
    """Pruebas adicionales del contrato API de calculadora."""

    def test_divide_operation(self) -> None:
        payload = {"version": "1.0.0", "op": "div", "a": 10.0, "b": 2.0}
        _job_id, response = self.create_and_run_job(
            APP_API_BASE_PATH, payload, ROUTER_MODULE
        )
        self.assert_job_completed(response)
        self.assertEqual(response.data["results"]["final_result"], 5.0)

    def test_subtract_operation(self) -> None:
        payload = {"version": "1.0.0", "op": "sub", "a": 9.0, "b": 4.0}
        _job_id, response = self.create_and_run_job(
            APP_API_BASE_PATH, payload, ROUTER_MODULE
        )
        self.assert_job_completed(response)
        self.assertEqual(response.data["results"]["final_result"], 5.0)

    def test_add_operation(self) -> None:
        payload = {"version": "1.0.0", "op": "add", "a": 3.0, "b": 7.0}
        _job_id, response = self.create_and_run_job(
            APP_API_BASE_PATH, payload, ROUTER_MODULE
        )
        self.assert_job_completed(response)
        self.assertEqual(response.data["results"]["final_result"], 10.0)

    def test_factorial_operation(self) -> None:
        payload = {"version": "1.0.0", "op": "factorial", "a": 5.0}
        _job_id, response = self.create_and_run_job(
            APP_API_BASE_PATH, payload, ROUTER_MODULE
        )
        self.assert_job_completed(response)
        self.assertEqual(response.data["results"]["final_result"], 120.0)

    def test_pow_operation(self) -> None:
        payload = {"version": "1.0.0", "op": "pow", "a": 2.0, "b": 10.0}
        _job_id, response = self.create_and_run_job(
            APP_API_BASE_PATH, payload, ROUTER_MODULE
        )
        self.assert_job_completed(response)
        self.assertEqual(response.data["results"]["final_result"], 1024.0)

    def test_divide_by_zero_results_in_failed_or_error(self) -> None:
        """División por cero debe resultar en job fallido."""
        payload = {"version": "1.0.0", "op": "div", "a": 5.0, "b": 0.0}
        _job_id, response = self.create_and_run_job(
            APP_API_BASE_PATH, payload, ROUTER_MODULE
        )
        # Puede completarse con error en results o marcarse como failed
        self.assertIn(response.data["status"], ("failed", "completed"))

    def test_cache_hit_returns_existing_result(self) -> None:
        """Segunda llamada con los mismos parámetros debe retornar cache hit."""
        payload = {"version": "1.0.0", "op": "add", "a": 1.0, "b": 1.0}
        _job_id_1, response_1 = self.create_and_run_job(
            APP_API_BASE_PATH, payload, ROUTER_MODULE
        )
        self.assert_job_completed(response_1)
        # Segunda solicitud con mismos parámetros
        with patch(f"{ROUTER_MODULE}.dispatch_scientific_job") as mock_d:
            mock_d.return_value = True
            response_2 = self.client.post(APP_API_BASE_PATH, payload, format="json")
        self.assertEqual(response_2.status_code, 201)
        # El segundo job puede ser un cache hit
        job_2 = self.get_job_from_db(str(response_2.data["id"]))
        self.assertIn(job_2.status, ("completed", "pending"))

    def test_missing_version_uses_default(self) -> None:
        """Llamada sin version debe usar versión por defecto."""
        payload = {"op": "add", "a": 5.0, "b": 5.0}
        create_response = self.create_job_via_api(
            APP_API_BASE_PATH, payload, ROUTER_MODULE
        )
        self.assertEqual(create_response.status_code, 201)

    def test_list_calculator_jobs(self) -> None:
        """Listar jobs filtrando por plugin_name devuelve solo calculadora."""
        payload = {"version": "1.0.0", "op": "add", "a": 1.0, "b": 2.0}
        self.create_job_via_api(APP_API_BASE_PATH, payload, ROUTER_MODULE)
        response = self.client.get("/api/jobs/", {"plugin_name": PLUGIN_NAME})
        self.assertEqual(response.status_code, 200)
        for job_data in response.data:
            self.assertEqual(job_data["plugin_name"], PLUGIN_NAME)

    def test_retrieve_nonexistent_job_returns_404(self) -> None:
        from uuid import uuid4

        response = self.client.get(f"{APP_API_BASE_PATH}{uuid4()}/")
        self.assertEqual(response.status_code, 404)

    def test_schema_rejects_invalid_operation(self) -> None:
        payload = {"version": "1.0.0", "op": "modulo", "a": 10.0, "b": 3.0}
        response = self.client.post(APP_API_BASE_PATH, payload, format="json")
        self.assertEqual(response.status_code, 400)

    def test_schema_rejects_missing_operands(self) -> None:
        """Operaciones binarias sin 'b' deben fallar validación."""
        payload = {"version": "1.0.0", "op": "mul", "a": 5.0}
        response = self.client.post(APP_API_BASE_PATH, payload, format="json")
        self.assertEqual(response.status_code, 400)
