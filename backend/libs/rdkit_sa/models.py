"""
# rdkit_sa/models.py

Modelos de dominio para resultados de SA score nativo de RDKit.
Transportan resultados tipados y serializables análogos a libs/ambit/models.py.

Uso:
    from libs.rdkit_sa.models import RdkitSaScoreResult
"""

from __future__ import annotations

from dataclasses import dataclass

from .types import RdkitSaBatchOutput, RdkitSaScoreOutput


@dataclass
class RdkitSaScoreResult:
    """Resultado de SA score nativo de RDKit para una molécula."""

    smiles: str
    sa_score: float | None
    success: bool
    error_message: str | None = None

    def to_dict(self) -> RdkitSaScoreOutput:
        """Convierte el resultado a contrato serializable."""
        return {
            "smiles": self.smiles,
            "sa_score": self.sa_score,
            "success": self.success,
            "error_message": self.error_message,
        }


@dataclass
class RdkitSaBatchResult:
    """Resultado batch para múltiples moléculas con RDKit SA score."""

    results: list[RdkitSaScoreResult]

    def to_dict(self) -> RdkitSaBatchOutput:
        """Convierte el batch a contrato serializable."""
        successful_count: int = 0
        failed_count: int = 0
        serialized_results: list[RdkitSaScoreOutput] = []

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
