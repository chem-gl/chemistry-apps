"""
# brsascore/types.py

Tipos estrictos para la librería BRSAScore (BR-SA score de accesibilidad sintética).
Define contratos de entrada/salida para cálculo de SA score mediante RDKit + pickles.

Uso:
    from libs.brsascore.types import BrsaScoreOutput
"""

from typing import TypedDict


class BrsaScoreOutput(TypedDict):
    """Salida compacta por molécula con BR-SA score."""

    smiles: str
    sa_score: float | None
    success: bool
    error_message: str | None


class BrsaBatchOutput(TypedDict):
    """Salida agregada para procesamiento batch con BRSAScore."""

    results: list[BrsaScoreOutput]
    total: int
    successful: int
    failed: int
