"""types.py: Tipos estrictos de dominio para la app molar_fractions.

Objetivo del archivo:
- Definir contratos tipados compartidos entre serializer, plugin y pruebas.

Cómo se usa:
- `routers.py` tipa `validated_data` al construir parámetros persistidos.
- `plugin.py` usa estos tipos para mantener salida estable y serializable.
"""

from typing import Literal, NotRequired, TypedDict

MolarFractionsMode = Literal["single", "range"]


class MolarFractionsInput(TypedDict):
    """Parámetros normalizados para ejecutar fracciones molares."""

    pka_values: list[float]
    ph_mode: MolarFractionsMode
    ph_min: float
    ph_max: float
    ph_step: float


class MolarFractionsJobCreatePayload(TypedDict):
    """Payload de entrada de creación de job para contrato HTTP."""

    version: str
    pka_values: list[float]
    ph_mode: MolarFractionsMode
    ph_value: NotRequired[float | None]
    ph_min: NotRequired[float | None]
    ph_max: NotRequired[float | None]
    ph_step: NotRequired[float | None]


class MolarFractionRow(TypedDict):
    """Fila de resultados para un pH específico."""

    ph: float
    fractions: list[float]
    sum_fraction: float


class MolarFractionsMetadata(TypedDict):
    """Metadatos de trazabilidad del cálculo de fracciones molares."""

    pka_values: list[float]
    ph_mode: MolarFractionsMode
    ph_min: float
    ph_max: float
    ph_step: float
    total_species: int
    total_points: int


class MolarFractionsResult(TypedDict):
    """Resultado estable del plugin de fracciones molares."""

    species_labels: list[str]
    rows: list[MolarFractionRow]
    metadata: MolarFractionsMetadata
