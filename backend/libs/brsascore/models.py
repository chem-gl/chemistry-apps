"""
# brsascore/models.py

Modelos de dominio para resultados de BR-SA score obtenidos con BRSAScore.
Transportan resultados tipados y serializables análogos a libs/ambit/models.py.

Uso:
    from libs.brsascore.models import BrsaScoreResult
"""

from __future__ import annotations

from dataclasses import dataclass

from .types import BrsaBatchOutput, BrsaScoreOutput


@dataclass
class BrsaScoreResult:
    """Resultado de BR-SA score para una molécula."""

    smiles: str
    sa_score: float | None
    success: bool
    error_message: str | None = None

    def to_dict(self) -> BrsaScoreOutput:
        """Convierte el resultado a contrato serializable."""
        return {
            "smiles": self.smiles,
            "sa_score": self.sa_score,
            "success": self.success,
            "error_message": self.error_message,
        }


@dataclass
class BrsaBatchResult:
    """Resultado batch para múltiples moléculas con BRSAScore."""

    results: list[BrsaScoreResult]

    def to_dict(self) -> BrsaBatchOutput:
        """Convierte el batch a contrato serializable."""
        successful_count: int = 0
        failed_count: int = 0
        serialized_results: list[BrsaScoreOutput] = []

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
