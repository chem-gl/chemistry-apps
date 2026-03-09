"""types.py: Tipos compartidos para tipado estricto del dominio cientifico."""

from __future__ import annotations

from typing import TypeAlias, TypedDict

JSONPrimitive: TypeAlias = str | int | float | bool | None
JSONValue: TypeAlias = JSONPrimitive | list["JSONValue"] | dict[str, "JSONValue"]
JSONMap: TypeAlias = dict[str, JSONValue]


class JobCreatePayload(TypedDict):
    """Estructura tipada para crear un ScientificJob desde capa API."""

    plugin_name: str
    version: str
    parameters: JSONMap
