"""models.py: Modelos de dominio para resultados del cliente ADMET-AI.

Incluye estructuras tipadas y serializables que el plugin consume sin
acoplarse al objeto de retorno nativo de la librería externa.
"""

from __future__ import annotations

from dataclasses import dataclass

from .types import AdmetPredictionBatchOutput, AdmetPredictionOutput


@dataclass
class AdmetPredictionResult:
    """Resultado de predicción ADMET-AI para una molécula."""

    smiles: str
    success: bool
    predictions: dict[str, float]
    error_message: str | None = None

    def to_dict(self) -> AdmetPredictionOutput:
        """Convierte el resultado a un contrato serializable."""
        return {
            "smiles": self.smiles,
            "success": self.success,
            "predictions": self.predictions,
            "error_message": self.error_message,
        }


@dataclass
class AdmetPredictionBatchResult:
    """Resultado agregado de predicciones ADMET-AI para múltiples moléculas."""

    results: list[AdmetPredictionResult]

    def to_dict(self) -> AdmetPredictionBatchOutput:
        """Serializa el lote de resultados con contadores de estado."""
        successful_count: int = 0
        failed_count: int = 0
        serialized_results: list[AdmetPredictionOutput] = []

        for prediction_result in self.results:
            serialized_results.append(prediction_result.to_dict())
            if prediction_result.success:
                successful_count += 1
            else:
                failed_count += 1

        return {
            "results": serialized_results,
            "total": len(self.results),
            "successful": successful_count,
            "failed": failed_count,
        }
