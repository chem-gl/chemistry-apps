"""
# brsascore/__init__.py

Punto de entrada de la librería BRSAScore para cálculo de BR-SA score.
Exporta cliente de alto nivel y funciones utilitarias de consumo directo.

Uso:
    from libs.brsascore import BrsaScoreClient, predict_brsa_score
"""

from .client import BrsaScoreClient, predict_brsa_score, predict_brsa_scores
from .models import BrsaBatchResult, BrsaScoreResult
from .types import BrsaBatchOutput, BrsaScoreOutput

__all__ = [
    "BrsaScoreClient",
    "BrsaScoreResult",
    "BrsaBatchResult",
    "BrsaScoreOutput",
    "BrsaBatchOutput",
    "predict_brsa_score",
    "predict_brsa_scores",
]

__version__ = "1.0.0"
