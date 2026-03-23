"""
# ambit/models.py

Modelos de dominio para resultados de SA score obtenidos con Ambit.
Se usan para transportar resultados tipados y serializables.

Uso:
    from libs.ambit.models import AmbitScoreResult
"""

from __future__ import annotations

from dataclasses import dataclass

from .types import AmbitBatchOutput, AmbitScoreOutput


@dataclass
class AmbitScoreResult:
    """Resultado de SA score para una molécula."""

    smiles: str
    sa_score: float | None
    success: bool
    error_message: str | None = None

    def to_dict(self) -> AmbitScoreOutput:
        """Convierte el resultado a contrato serializable."""
        return {
            "smiles": self.smiles,
            "sa_score": self.sa_score,
            "success": self.success,
            "error_message": self.error_message,
        }


@dataclass
class AmbitBatchResult:
    """Resultado batch para múltiples moléculas."""

    results: list[AmbitScoreResult]

    def to_dict(self) -> AmbitBatchOutput:
        """Convierte el batch a contrato serializable."""
        successful_count: int = 0
        failed_count: int = 0
        serialized_results: list[AmbitScoreOutput] = []

        for score_result in self.results:
            serialized_results.append(score_result.to_dict())
            if score_result.success:
                successful_count += 1
            else:
                failed_count += 1

        return {
            "results": serialized_results,
            "total": len(self.results),
            "successful": successful_count,
            "failed": failed_count,
        }
