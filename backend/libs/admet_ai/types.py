"""types.py: Tipos estrictos de salida para predicciones ADMET-AI.

Define contratos serializables para una predicción individual y para
procesamiento por lotes sin depender de detalles internos de la librería.
"""

from typing import TypedDict


class AdmetPredictionOutput(TypedDict):
    """Salida tipada para una molécula predicha por ADMET-AI."""

    smiles: str
    success: bool
    predictions: dict[str, float]
    error_message: str | None


class AdmetPredictionBatchOutput(TypedDict):
    """Salida tipada para procesamiento por lotes con ADMET-AI."""

    results: list[AdmetPredictionOutput]
    total: int
    successful: int
    failed: int
