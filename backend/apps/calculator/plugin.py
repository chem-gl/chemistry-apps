"""plugin.py: Implementación del plugin calculadora desacoplado y reutilizable."""

import logging
from typing import cast

from apps.core.processing import PluginRegistry
from apps.core.types import JSONMap

from .definitions import PLUGIN_NAME, SUPPORTED_OPERATIONS
from .types import CalculatorInput, CalculatorOperation, CalculatorResult

logger = logging.getLogger(__name__)


def _build_calculator_input(parameters: JSONMap) -> CalculatorInput:
    """Valida y normaliza los parámetros de entrada para la calculadora."""
    raw_operation_value: str = str(parameters.get("op", "add"))
    if raw_operation_value not in SUPPORTED_OPERATIONS:
        raise ValueError(
            f"Operación desconocida en plugin de calculadora: {raw_operation_value}"
        )

    normalized_first_operand: float = float(parameters.get("a", 0.0))
    normalized_second_operand: float = float(parameters.get("b", 0.0))

    return {
        "op": cast(CalculatorOperation, raw_operation_value),
        "a": normalized_first_operand,
        "b": normalized_second_operand,
    }


@PluginRegistry.register(PLUGIN_NAME)
def calculator_plugin(parameters: JSONMap) -> JSONMap:
    """Ejecuta operaciones aritméticas base como plugin de ejemplo plantilla."""
    validated_input: CalculatorInput = _build_calculator_input(parameters)
    operation_name: CalculatorOperation = validated_input["op"]
    first_operand: float = validated_input["a"]
    second_operand: float = validated_input["b"]

    logger.info(
        "Ejecutando calculadora '%s' con operandos %s y %s",
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
            raise ValueError("División por cero no permitida en la calculadora.")
        result_value = first_operand / second_operand

    typed_response_payload: CalculatorResult = {
        "final_result": result_value,
        "metadata": {
            "operation_used": operation_name,
            "operand_a": first_operand,
            "operand_b": second_operand,
        },
    }
    return typed_response_payload
