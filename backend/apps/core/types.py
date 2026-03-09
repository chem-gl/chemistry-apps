"""types.py: Tipos compartidos para tipado estricto del dominio cientifico."""

from __future__ import annotations

from typing import Literal, TypeAlias, TypedDict

JSONPrimitive: TypeAlias = str | int | float | bool | None
JSONValue: TypeAlias = JSONPrimitive | list["JSONValue"] | dict[str, "JSONValue"]
JSONMap: TypeAlias = dict[str, JSONValue]
CalculatorOperation: TypeAlias = Literal["add", "sub", "mul", "div"]


class JobCreatePayload(TypedDict):
    """Estructura tipada para crear un ScientificJob desde capa API."""

    plugin_name: str
    version: str
    parameters: JSONMap


class CalculatorInput(TypedDict):
    """Parametros validados del plugin de calculadora."""

    op: CalculatorOperation
    a: float
    b: float


class CalculatorMetadata(TypedDict):
    """Metadatos de trazabilidad de ejecucion de calculadora."""

    operation_used: CalculatorOperation
    operand_a: float
    operand_b: float


class CalculatorResult(TypedDict):
    """Respuesta tipada del plugin de calculadora."""

    final_result: float
    metadata: CalculatorMetadata
