"""types.py: Tipos estrictos de la app calculadora para uso como plantilla."""

from typing import Literal, TypeAlias, TypedDict

CalculatorOperation: TypeAlias = Literal["add", "sub", "mul", "div"]


class CalculatorInput(TypedDict):
    """Parámetros normalizados del plugin calculadora."""

    op: CalculatorOperation
    a: float
    b: float


class CalculatorMetadata(TypedDict):
    """Metadatos de trazabilidad de ejecución de la calculadora."""

    operation_used: CalculatorOperation
    operand_a: float
    operand_b: float


class CalculatorResult(TypedDict):
    """Resultado tipado de ejecución del plugin calculadora."""

    final_result: float
    metadata: CalculatorMetadata


class CalculatorJobCreatePayload(TypedDict):
    """Payload estricto para creación de jobs por endpoint de calculadora."""

    version: str
    op: CalculatorOperation
    a: float
    b: float
