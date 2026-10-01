"""types.py: Tipos estrictos de dominio para la app Server Calc.

Objetivo del archivo:
- Definir contratos tipados compartidos entre serializers, plugin y pruebas.

Cómo se usa:
- `routers.py` tipa `validated_data` para construir parámetros persistidos.
- `plugin.py` usa estos tipos para mantener salida estable y serializable.
"""

from typing import TypedDict


class ServerCalcCalculationInput(TypedDict):
    """Parámetros normalizados del cálculo remoto."""

    a: float
    op: str
    b: float


class ServerCalcJobCreatePayload(TypedDict):
    """Payload tipado de creación de jobs para la app Server Calc."""

    version: str
    a: float
    op: str
    b: float


class ServerCalcCalculationMetadata(TypedDict):
    """Metadatos de trazabilidad: dónde se ejecutó y si hubo fallback."""

    executed_on: str
    remote_host: str
    fallback_used: bool


class ServerCalcCalculationResult(TypedDict):
    """Resultado tipado del plugin Server Calc."""

    a: float
    op: str
    b: float
    result: float
    file_name: str | None
    file_path: str | None
    metadata: ServerCalcCalculationMetadata
