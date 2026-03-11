"""types.py: Tipos estrictos de la app random_numbers."""

from typing import TypedDict


class RandomNumbersInput(TypedDict):
    """Parámetros normalizados del plugin de números aleatorios."""

    seed_url: str
    numbers_per_batch: int
    interval_seconds: int
    total_numbers: int


class RandomNumbersMetadata(TypedDict):
    """Metadatos de trazabilidad del resultado generado."""

    seed_url: str
    seed_digest: str
    numbers_per_batch: int
    interval_seconds: int
    total_numbers: int


class RandomNumbersResult(TypedDict):
    """Resultado tipado de la generación de números aleatorios."""

    generated_numbers: list[int]
    metadata: RandomNumbersMetadata


class RandomNumbersRuntimeState(TypedDict):
    """Estado serializable para pausar y reanudar generación por lotes."""

    generated_numbers: list[int]
    generated_count: int
    total_numbers: int


class RandomNumbersJobCreatePayload(TypedDict):
    """Payload tipado de creación de jobs random_numbers."""

    version: str
    seed_url: str
    numbers_per_batch: int
    interval_seconds: int
    total_numbers: int
