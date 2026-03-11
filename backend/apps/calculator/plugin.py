"""plugin.py: Implementación del plugin calculadora desacoplado y reutilizable.

Este módulo contiene la lógica de dominio de calculator y su registro en
`PluginRegistry` de `apps.core.processing`.

Pautas de uso para apps que reutilicen este patrón:
1. Mantener la función de plugin libre de dependencias HTTP.
2. Validar parámetros de dominio antes de ejecutar operaciones.
3. Retornar un payload tipado y estable para persistencia/cache/OpenAPI.
"""

import logging
import math
from typing import cast

from apps.core.processing import PluginRegistry
from apps.core.types import (
    JSONMap,
    JSONValue,
    PluginLogCallback,
    PluginProgressCallback,
)

from .definitions import PLUGIN_NAME, SUPPORTED_OPERATIONS
from .types import CalculatorInput, CalculatorOperation, CalculatorResult

logger = logging.getLogger(__name__)


def _build_calculator_input(parameters: JSONMap) -> CalculatorInput:
    """Valida y normaliza parámetros de entrada para el contrato del plugin.

    Reglas importantes:
    - `factorial` usa solo `a` y exige entero no negativo.
    - Operaciones binarias (`add/sub/mul/div/pow`) exigen `b`.
    """
    raw_operation_value: str = str(parameters.get("op", "add"))
    if raw_operation_value not in SUPPORTED_OPERATIONS:
        raise ValueError(
            f"Operación desconocida en plugin de calculadora: {raw_operation_value}"
        )

    normalized_first_operand: float = float(parameters.get("a", 0.0))

    raw_second_operand_value: JSONValue | None = parameters.get("b")
    normalized_second_operand: float | None

    if raw_operation_value == "factorial":
        if raw_second_operand_value is not None:
            raise ValueError("La operación factorial no admite el parámetro b.")
        if normalized_first_operand < 0 or not normalized_first_operand.is_integer():
            raise ValueError(
                "La operación factorial requiere un entero no negativo en a."
            )
        normalized_second_operand = None
    else:
        if raw_second_operand_value is None:
            raise ValueError(
                f"La operación '{raw_operation_value}' requiere el parámetro b."
            )
        normalized_second_operand = float(raw_second_operand_value)

    return {
        "op": cast(CalculatorOperation, raw_operation_value),
        "a": normalized_first_operand,
        "b": normalized_second_operand,
    }


@PluginRegistry.register(PLUGIN_NAME)
def calculator_plugin(
    parameters: JSONMap,
    progress_callback: PluginProgressCallback | None = None,
    log_callback: PluginLogCallback | None = None,
) -> JSONMap:
    """Ejecuta operaciones aritméticas bajo el contrato publicado en schemas.

    Esta función es llamada indirectamente por `JobService` a través de
    `PluginRegistry.execute(...)`, no por la capa HTTP.
    """
    del progress_callback
    emit_log: PluginLogCallback = (
        log_callback
        if log_callback is not None
        else lambda _level, _source, _message, _payload: None
    )

    validated_input: CalculatorInput = _build_calculator_input(parameters)
    operation_name: CalculatorOperation = validated_input["op"]
    first_operand: float = validated_input["a"]
    second_operand: float | None = validated_input["b"]

    emit_log(
        "info",
        "calculator.plugin",
        "Iniciando operación de calculadora.",
        {
            "operation": operation_name,
            "operand_a": first_operand,
            "operand_b": second_operand,
        },
    )

    logger.info(
        "Ejecutando calculadora '%s' con operandos %s y %s",
        operation_name,
        first_operand,
        second_operand,
    )

    result_value: float
    if operation_name == "add":
        result_value = first_operand + cast(float, second_operand)
    elif operation_name == "sub":
        result_value = first_operand - cast(float, second_operand)
    elif operation_name == "mul":
        result_value = first_operand * cast(float, second_operand)
    elif operation_name == "div":
        if second_operand == 0:
            raise ValueError("División por cero no permitida en la calculadora.")
        result_value = first_operand / cast(float, second_operand)
    elif operation_name == "pow":
        result_value = first_operand ** cast(float, second_operand)
    else:
        factorial_operand: int = int(first_operand)
        result_value = float(math.factorial(factorial_operand))

    typed_response_payload: CalculatorResult = {
        "final_result": result_value,
        "metadata": {
            "operation_used": operation_name,
            "operand_a": first_operand,
            "operand_b": second_operand,
        },
    }

    emit_log(
        "info",
        "calculator.plugin",
        "Operación de calculadora completada.",
        {
            "operation": operation_name,
            "result": result_value,
        },
    )

    return typed_response_payload
