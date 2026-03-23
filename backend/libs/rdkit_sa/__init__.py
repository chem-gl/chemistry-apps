"""
# rdkit_sa/__init__.py

Punto de entrada de la librería de SA score nativo de RDKit.
Exporta cliente de alto nivel y funciones utilitarias de consumo directo.

Uso:
    from libs.rdkit_sa import RdkitSaClient, predict_rdkit_sa_score
"""

from .client import RdkitSaClient, predict_rdkit_sa_score, predict_rdkit_sa_scores
from .models import RdkitSaBatchResult, RdkitSaScoreResult
from .types import RdkitSaBatchOutput, RdkitSaScoreOutput

__all__ = [
    "RdkitSaClient",
    "RdkitSaScoreResult",
    "RdkitSaBatchResult",
    "RdkitSaScoreOutput",
    "RdkitSaBatchOutput",
    "predict_rdkit_sa_score",
    "predict_rdkit_sa_scores",
]

__version__ = "1.0.0"
