"""
# rdkit_sa/types.py

Tipos estrictos para la librería de SA score nativo de RDKit.
Define contratos de entrada/salida análogos a libs/ambit/types.py.

Uso:
    from libs.rdkit_sa.types import RdkitSaScoreOutput
"""

from typing import TypedDict


class RdkitSaScoreOutput(TypedDict):
    """Salida compacta por molécula con SA score nativo de RDKit."""

    smiles: str
    sa_score: float | None
    success: bool
    error_message: str | None


class RdkitSaBatchOutput(TypedDict):
    """Salida agregada para procesamiento batch con RDKit SA score."""

    results: list[RdkitSaScoreOutput]
    total: int
    successful: int
    failed: int
