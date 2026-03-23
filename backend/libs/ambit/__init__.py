"""
# ambit/__init__.py

Punto de entrada de la librería Ambit para cálculo de SA score.
Exporta cliente de alto nivel y funciones utilitarias de consumo directo.

Uso:
    from libs.ambit import AmbitClient, predict_sa_score
"""

from .client import AmbitClient, predict_sa_score, predict_sa_scores
from .models import AmbitBatchResult, AmbitScoreResult
from .types import AmbitBatchOutput, AmbitScoreOutput

__all__ = [
    "AmbitClient",
    "AmbitScoreResult",
    "AmbitBatchResult",
    "AmbitScoreOutput",
    "AmbitBatchOutput",
    "predict_sa_score",
    "predict_sa_scores",
]

__version__ = "1.0.0"
