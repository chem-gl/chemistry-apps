"""
# ambit/types.py

Tipos estrictos para la librería Ambit (SyntheticAccessibilityCli.jar).
Define contratos de entrada/salida para cálculo de SA score.

Uso:
    from libs.ambit.types import AmbitScoreOutput
"""

from typing import TypedDict


class AmbitScoreOutput(TypedDict):
    """Salida compacta por molécula con SA score de Ambit."""

    smiles: str
    sa_score: float | None
    success: bool
    error_message: str | None


class AmbitBatchOutput(TypedDict):
    """Salida agregada para procesamiento batch en Ambit."""

    results: list[AmbitScoreOutput]
    total: int
    successful: int
    failed: int
