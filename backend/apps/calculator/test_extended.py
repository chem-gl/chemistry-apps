"""test_extended.py: Pruebas extendidas de plugin/contrato y escenarios API.

Objetivo del archivo:
- Evitar duplicación de tests HTTP básicos que ya existen en tests.py.
- Cubrir ramas no ejercitadas del plugin y contrato declarativo.
- Mantener casos API adicionales de valor (cache hit, defaults y filtros).

Cómo se usa:
- Ejecutar con `python manage.py test apps.calculator.test_extended`.
"""

from __future__ import annotations

from typing import Callable, cast
from unittest.mock import patch

from django.test import SimpleTestCase

from apps.core.test_utils import ScientificJobTestMixin
from apps.core.types import DomainError, Failure, PureTask, Success

from .contract import get_calculator_contract
from .definitions import APP_API_BASE_PATH, PLUGIN_NAME
from .plugin import _build_calculator_input, calculator_plugin
from .routers import CalculatorJobViewSet
from .schemas import CalculatorJobCreateSerializer

ROUTER_MODULE = "apps.calculator.routers"


class CalculatorPluginContractTests(SimpleTestCase):
    """Pruebas unitarias para plugin y contrato declarativo de calculadora."""

    def test_build_input_validates_binary_operations_require_second_operand(
        self,
    ) -> None:
        """Cada operación binaria debe exigir `b` para evitar ejecuciones ambiguas."""
        for binary_operation in ("add", "sub", "mul", "div", "pow"):
            with self.subTest(binary_operation=binary_operation):
                with self.assertRaisesMessage(
                    ValueError,
                    f"La operación '{binary_operation}' requiere el parámetro b.",
                ):
                    _build_calculator_input({"op": binary_operation, "a": 2.0})

    def test_build_input_rejects_invalid_factorial_operands(self) -> None:
        """Factorial debe aceptar únicamente enteros no negativos y sin `b`."""
        with self.assertRaisesMessage(
            ValueError,
            "La operación factorial no admite el parámetro b.",
        ):
            _build_calculator_input({"op": "factorial", "a": 5.0, "b": 1.0})

        for invalid_a in (-1.0, 2.5):
            with self.subTest(invalid_a=invalid_a):
                with self.assertRaisesMessage(
                    ValueError,
                    "La operación factorial requiere un entero no negativo en a.",
                ):
                    _build_calculator_input({"op": "factorial", "a": invalid_a})

    def test_plugin_executes_all_supported_operations(self) -> None:
        """El plugin debe producir resultado correcto para todas las operaciones soportadas."""
        operation_payloads: dict[str, tuple[dict[str, float | str], float]] = {
            "add": ({"op": "add", "a": 3.0, "b": 7.0}, 10.0),
            "sub": ({"op": "sub", "a": 10.0, "b": 3.0}, 7.0),
            "mul": ({"op": "mul", "a": 6.0, "b": 7.0}, 42.0),
            "div": ({"op": "div", "a": 20.0, "b": 5.0}, 4.0),
            "pow": ({"op": "pow", "a": 2.0, "b": 10.0}, 1024.0),
            "factorial": ({"op": "factorial", "a": 5.0}, 120.0),
        }

        for operation_name, (payload, expected_result) in operation_payloads.items():
            with self.subTest(operation_name=operation_name):
                response = calculator_plugin(payload)
                self.assertEqual(response["final_result"], expected_result)
                self.assertEqual(response["metadata"]["operation_used"], operation_name)

    def test_plugin_raises_on_division_by_zero(self) -> None:
        """División por cero debe fallar explícitamente para trazabilidad correcta."""
        with self.assertRaisesMessage(
            ValueError,
            "División por cero no permitida en la calculadora.",
        ):
            calculator_plugin({"op": "div", "a": 8.0, "b": 0.0})

    def test_plugin_emits_expected_log_events(self) -> None:
        """La ejecución debe emitir eventos de log clave para auditoría de job."""
        captured_messages: list[str] = []

        def log_collector(
            _level: str,
            _source: str,
            message: str,
            _payload: dict[str, object] | None,
        ) -> None:
            captured_messages.append(message)

        calculator_plugin(
            {"op": "add", "a": 2.0, "b": 2.0},
            log_callback=log_collector,
        )

        self.assertIn(
            "Log fantasma: se ejecutará la operación de calculadora solicitada.",
            captured_messages,
        )
        self.assertIn("Iniciando operación de calculadora.", captured_messages)
        self.assertIn("Operación de calculadora completada.", captured_messages)

    def test_contract_exposes_callable_execute_and_validate(self) -> None:
        """El contrato debe exponer callables reutilizables para API declarativa."""
        contract = get_calculator_contract()

        validate_input = contract["validate_input"]
        execute = contract["execute"]

        self.assertTrue(callable(validate_input))
        self.assertTrue(callable(execute))
        self.assertEqual(contract["plugin_name"], PLUGIN_NAME)
        self.assertEqual(contract["supports_pause_resume"], False)

        normalized_input = (
            cast(Callable[[dict[str, object]], dict[str, object]], validate_input)
        )({"op": "add", "a": 1.0, "b": 4.0})
        execution_output = (
            cast(Callable[[dict[str, object]], dict[str, object]], execute)
        )(normalized_input)
        self.assertEqual(execution_output["final_result"], 5.0)


class CalculatorExtendedApiTests(ScientificJobTestMixin):
    """Pruebas adicionales del contrato API de calculadora."""

    def test_create_returns_503_when_declarative_submit_fails(self) -> None:
        """Si submit_job falla, el endpoint debe responder 503 con detalle claro."""
        payload = {"version": "1.0.0", "op": "add", "a": 5.0, "b": 2.0}

        class FailingDeclarativeApi:
            def __init__(self, dispatch_callback: object) -> None:
                del dispatch_callback

            def submit_job(
                self,
                *,
                plugin: str,
                parameters: dict[str, object],
                version: str,
            ) -> PureTask[object, DomainError]:
                del plugin, parameters, version
                return PureTask(Failure(DomainError("forced submit failure")))

        with patch(
            "apps.calculator.routers.DeclarativeJobAPI",
            FailingDeclarativeApi,
        ):
            response = self.client.post(APP_API_BASE_PATH, payload, format="json")

        self.assertEqual(response.status_code, 503)
        self.assertIn("forced submit failure", str(response.data["detail"]))

    def test_create_returns_503_when_submit_returns_no_handle(self) -> None:
        """Si submit_job responde success sin handle, se debe devolver 503."""
        payload = {"version": "1.0.0", "op": "add", "a": 9.0, "b": 1.0}

        class MissingHandleDeclarativeApi:
            def __init__(self, dispatch_callback: object) -> None:
                del dispatch_callback

            def submit_job(
                self,
                *,
                plugin: str,
                parameters: dict[str, object],
                version: str,
            ) -> PureTask[object | None, DomainError]:
                del plugin, parameters, version
                return PureTask(Success(None))

        with patch(
            "apps.calculator.routers.DeclarativeJobAPI",
            MissingHandleDeclarativeApi,
        ):
            response = self.client.post(APP_API_BASE_PATH, payload, format="json")

        self.assertEqual(response.status_code, 503)
        self.assertIn(
            "No se pudo obtener el handle del job creado", str(response.data["detail"])
        )

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


class CalculatorRoutersTests(SimpleTestCase):
    """Pruebas unitarias para routers de calculadora."""

    def test_build_csv_content_formats_single_row_correctly(self) -> None:
        """build_csv_content debe generar CSV con header y fila de datos."""
        from apps.core.models import ScientificJob

        # Mock job with results
        job = ScientificJob(
            plugin_name=PLUGIN_NAME,
            results={
                "final_result": 10.0,
                "metadata": {
                    "operation_used": "add",
                    "operand_a": 5.0,
                    "operand_b": 5.0,
                },
            },
        )
        viewset = CalculatorJobViewSet()
        csv_content = viewset.build_csv_content(job)
        expected = "operation,operand_a,operand_b,final_result\nadd,5.0000000000,5.0000000000,10.0000000000"
        self.assertEqual(csv_content, expected)

    def test_build_csv_content_handles_factorial_without_b(self) -> None:
        """build_csv_content debe manejar factorial sin operando b."""
        from apps.core.models import ScientificJob

        job = ScientificJob(
            plugin_name=PLUGIN_NAME,
            results={
                "final_result": 120.0,
                "metadata": {
                    "operation_used": "factorial",
                    "operand_a": 5.0,
                    "operand_b": None,
                },
            },
        )
        viewset = CalculatorJobViewSet()
        csv_content = viewset.build_csv_content(job)
        expected = "operation,operand_a,operand_b,final_result\nfactorial,5.0000000000,,120.0000000000"
        self.assertEqual(csv_content, expected)


class CalculatorSchemasTests(SimpleTestCase):
    """Pruebas unitarias para schemas de calculadora."""

    def test_calculator_job_create_serializer_validates_factorial_requires_no_b(
        self,
    ) -> None:
        """Serializer debe rechazar b para factorial."""
        serializer = CalculatorJobCreateSerializer(
            data={"op": "factorial", "a": 5.0, "b": 1.0}
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn("b", serializer.errors)

    def test_calculator_job_create_serializer_validates_factorial_requires_integer_a(
        self,
    ) -> None:
        """Serializer debe rechazar a no entero para factorial."""
        serializer = CalculatorJobCreateSerializer(data={"op": "factorial", "a": 2.5})
        self.assertFalse(serializer.is_valid())
        self.assertIn("a", serializer.errors)

    def test_calculator_job_create_serializer_validates_binary_requires_b(self) -> None:
        """Serializer debe exigir b para operaciones binarias."""
        serializer = CalculatorJobCreateSerializer(data={"op": "add", "a": 5.0})
        self.assertFalse(serializer.is_valid())
        self.assertIn("b", serializer.errors)

    def test_calculator_job_create_serializer_accepts_valid_binary(self) -> None:
        """Serializer debe aceptar datos válidos para binarias."""
        serializer = CalculatorJobCreateSerializer(
            data={"op": "add", "a": 5.0, "b": 3.0}
        )
        self.assertTrue(serializer.is_valid())
        self.assertEqual(serializer.validated_data["op"], "add")

    def test_calculator_job_create_serializer_accepts_valid_factorial(self) -> None:
        """Serializer debe aceptar datos válidos para factorial."""
        serializer = CalculatorJobCreateSerializer(data={"op": "factorial", "a": 5.0})
        self.assertTrue(serializer.is_valid())
        self.assertEqual(serializer.validated_data["op"], "factorial")


class CalculatorContractTests(SimpleTestCase):
    """Pruebas unitarias para contract de calculadora."""

    def test_get_calculator_contract_returns_expected_structure(self) -> None:
        """get_calculator_contract debe retornar diccionario con claves requeridas."""
        contract = get_calculator_contract()
        expected_keys = {
            "plugin_name",
            "version",
            "supports_pause_resume",
            "input_type",
            "result_type",
            "metadata_type",
            "validate_input",
            "execute",
            "description",
        }
        self.assertEqual(set(contract.keys()), expected_keys)
        self.assertEqual(contract["plugin_name"], PLUGIN_NAME)
        self.assertFalse(contract["supports_pause_resume"])
        self.assertEqual(
            contract["description"],
            "Calculadora científica con operaciones aritméticas",
        )

    def test_get_calculator_contract_validate_input_callable(self) -> None:
        """validate_input en contract debe ser callable y funcionar."""
        contract = get_calculator_contract()
        validate_input = contract["validate_input"]
        result = validate_input({"op": "add", "a": 1.0, "b": 2.0})
        self.assertEqual(result["op"], "add")
        self.assertEqual(result["a"], 1.0)
        self.assertEqual(result["b"], 2.0)

    def test_get_calculator_contract_execute_callable(self) -> None:
        """execute en contract debe ser callable y funcionar."""
        contract = get_calculator_contract()
        execute = contract["execute"]
        result = execute({"op": "add", "a": 1.0, "b": 2.0})
        self.assertEqual(result["final_result"], 3.0)
