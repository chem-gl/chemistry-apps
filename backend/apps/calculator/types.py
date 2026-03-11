"""types.py: Tipos estrictos de la app calculadora para uso como plantilla."""

from typing import Literal, NotRequired, TypeAlias, TypedDict

CalculatorOperation: TypeAlias = Literal[
    "add",
    "sub",
    "mul",
    "div",
    "pow",
    "factorial",
]


class CalculatorInput(TypedDict):
    """Parámetros normalizados del plugin calculadora."""

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
    """Payload estricto para creación de jobs por endpoint de calculadora."""

    version: str
    op: CalculatorOperation
    a: float
    b: NotRequired[float | None]
