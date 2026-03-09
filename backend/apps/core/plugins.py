"""plugins.py: Plugins cientificos registrados en la plataforma modular."""

import logging
from typing import cast

from .processing import PluginRegistry
from .types import CalculatorInput, CalculatorOperation, CalculatorResult, JSONMap

logger = logging.getLogger(__name__)


def _build_calculator_input(parameters: JSONMap) -> CalculatorInput:
    """Valida y normaliza los parametros de entrada del plugin calculadora."""
    raw_operation_value: str = str(parameters.get("op", "add"))
    valid_operations: set[str] = {"add", "sub", "mul", "div"}
    if raw_operation_value not in valid_operations:
        raise ValueError(
            f"Operacion desconocida en plugin de calculadora: {raw_operation_value}"
        )

    raw_a_value: float = float(parameters.get("a", 0.0))
    raw_b_value: float = float(parameters.get("b", 0.0))

    return {
        "op": cast(CalculatorOperation, raw_operation_value),
        "a": raw_a_value,
        "b": raw_b_value,
    }


@PluginRegistry.register("calculator")
def calculator_plugin(parameters: JSONMap) -> JSONMap:
    """Plugin piloto de calculadora para validar flujo E2E y cache."""
    calculator_input: CalculatorInput = _build_calculator_input(parameters)
    operation_name: CalculatorOperation = calculator_input["op"]
    first_operand: float = calculator_input["a"]
    second_operand: float = calculator_input["b"]

    logger.info(
        "Running calculator plugin operation '%s' for %s and %s",
        operation_name,
        first_operand,
        second_operand,
    )

    if operation_name == "add":
        result_value: float = first_operand + second_operand
    elif operation_name == "sub":
        result_value = first_operand - second_operand
    elif operation_name == "mul":
        result_value = first_operand * second_operand
    else:
        if second_operand == 0:
            raise ValueError("División por cero en plugin de calculadora no permitida.")
        result_value = first_operand / second_operand

    response_payload: CalculatorResult = {
        "final_result": result_value,
        "metadata": {
            "operation_used": operation_name,
            "operand_a": first_operand,
            "operand_b": second_operand,
        },
    }
    return response_payload
