"""
# ck_test/types.py

Definiciones de tipos estrictos para el calculador TST (Transition State Theory).
Contiene TypeDicts y TypeAlias que definen contratos explícitos para entrada,
parámetros, resultados y constantes del cálculo.

Uso:
    from libs.ck_test.types import TSTCalculationInput, TSTCalculationResult

    input_data: TSTCalculationInput = {
        'delta_zpe': -8.2,
        'barrier_zpe': 3.5,
        'frequency': 625,
        'temperature': 298.15
    }
"""

from typing import TypedDict

# Tipos de alias para valores escalares
type NumericValue = float | int
type PhysicalConstant = float

# Tipos de entrada para cálculo TST
type TSTCalculationInput = dict[str, float]

TSTCalculationParams = TypedDict(
    "TSTCalculationParams",
    {
        "delta_zpe": float,
        "barrier_zpe": float,
        "frequency": float,
        "temperature": float,
    },
    total=False,
)


# Tipos de resultado
class TSTCalculationResult(TypedDict, total=False):
    """
    Resultado del cálculo TST.

    Atributos:
        alpha_1: Parámetro alfa 1 calculado
        alpha_2: Parámetro alfa 2 calculado
        u: Factor U adimensional
        g: Valor G del cálculo (coeficiente de velocidad)
        success: Si el cálculo fue exitoso
        error: Mensaje de error si falla
    """

    alpha_1: float
    alpha_2: float
    u: float
    g: float
    success: bool
    error: str | None


# Tipo de constantes físicas
class PhysicalConstants(TypedDict, total=False):
    """
    Constantes físicas utilizadas en el cálculo TST.

    Atributos:
        avogadro: Número de Avogadro (partículas/mol)
        planck: Constante de Planck (J·s)
        speed_of_light: Velocidad de la luz (cm/s)
        boltzmann: Constante de Boltzmann (J/K)
        cal_to_joule: Factor de conversión (cal a J)
    """

    avogadro: float
    planck: float
    speed_of_light: float
    boltzmann: float
    cal_to_joule: float
