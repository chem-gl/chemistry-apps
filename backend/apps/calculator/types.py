"""types.py: Tipos estrictos de la app calculadora para uso como plantilla.

Este módulo centraliza los contratos tipados de dominio usados por plugin,
serializers y pruebas. Mantenerlos alineados evita inconsistencias entre
validación HTTP y ejecución real del algoritmo.
"""

from typing import Literal, NotRequired, TypedDict

type CalculatorOperation = Literal[
    "add",
    "sub",
    "mul",
    "div",
    "pow",
    "factorial",
]


class CalculatorInput(TypedDict):
    """Parámetros normalizados del plugin calculadora.

    Este tipo representa la entrada después de validación y normalización.
    """

    op: CalculatorOperation
    a: float
    b: float | None


class CalculatorMetadata(TypedDict):
    """Metadatos de trazabilidad de ejecución de la calculadora."""

    operation_used: CalculatorOperation
    operand_a: float
    operand_b: float | None


class CalculatorResult(TypedDict):
    """Resultado tipado de ejecución del plugin calculadora."""

    final_result: float
    metadata: CalculatorMetadata


class CalculatorJobCreatePayload(TypedDict):
    """Payload estricto para creación de jobs por endpoint de calculadora.

    Se usa en `routers.py` para tipar `validated_data` del serializer de
    creación y construir el payload persistido del job.
    """

    version: str
    op: CalculatorOperation
    a: float
    b: NotRequired[float | None]
