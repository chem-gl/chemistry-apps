"""
# ck_test/__init__.py

Centro de exportación de la librería de cálculo de teoría de estado de transición (TST).
Proporciona acceso a la clase calculadora TST para cálculos de constantes de velocidad.

Uso:
    from libs.ck_test import TST, TSTPrecalculatedConstants

    calculator = TST(
        delta_zpe=-8.2,
        barrier_zpe=3.5,
        frequency=625,
        temperature=298.15
    )
    result = calculator.calculate()
"""

from .calculators import TST
from .models import TSTInputParams, TSTPrecalculatedConstants, TSTResult

__all__ = [
    "TST",
    "TSTPrecalculatedConstants",
    "TSTInputParams",
    "TSTResult",
]

__version__ = "1.0.0"
