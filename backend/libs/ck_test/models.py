"""
# ck_test/models.py

Modelos de dominio para el calculador TST (Transition State Theory).
Usa dataclasses para mantener estructura clara y tipada.

Uso:
    from libs.ck_test.models import TST, TSTInputParams, TSTResult

    params = TSTInputParams(
        delta_zpe=-8.2,
        barrier_zpe=3.5,
        frequency=625,
        temperature=298.15
    )
    calculator = TST(**params)
    result = calculator.calculate()
"""

from dataclasses import dataclass
from typing import Optional, TypeAlias

ScalarValue: TypeAlias = str | int | float | bool


@dataclass
class TSTPrecalculatedConstants:
    """
    Constantes físicas precalculadas para el cálculo TST.
    Valores según estándares CODATA.

    Atributos:
        avogadro: Número de Avogadro (6.0221367e+23 partículas/mol)
        planck: Constante de Planck (6.6260755e-34 J·s)
        speed_of_light: Velocidad de la luz (2.9979246e+10 cm/s)
        boltzmann: Constante de Boltzmann (1.380658e-23 J/K)
        cal_to_joule: Factor de conversión (4184.0 J/cal)
    """

    avogadro: float = 6.0221367e23
    planck: float = 6.6260755e-34
    speed_of_light: float = 2.9979246e10
    boltzmann: float = 1.380658e-23
    cal_to_joule: float = 4184.0


@dataclass
class TSTInputParams:
    """
    Parámetros de entrada para el cálculo TST.

    Atributos:
        delta_zpe: Diferencia de energía de punto cero (kcal/mol)
        barrier_zpe: Barrera energética de punto cero (kcal/mol)
        frequency: Frecuencia imaginaria (cm^-1), sin signo negativo
        temperature: Temperatura del cálculo (K)
    """

    delta_zpe: float
    barrier_zpe: float
    frequency: float
    temperature: float


@dataclass
class TSTResult:
    """
    Resultado del cálculo TST.
    Contiene todos los parámetros calculados y el valor G final.

    Atributos:
        alpha_1: Parámetro alfa 1 (adimensional)
        alpha_2: Parámetro alfa 2 (adimensional)
        u: Factor U adimensional (energía reducida)
        g: Valor G del cálculo (coeficiente de velocidad)
        success: Si el cálculo fue exitoso
        error_message: Mensaje de error si falla (None si exitoso)
        input_params: Parámetros de entrada usados
    """

    alpha_1: float = float("nan")
    alpha_2: float = float("nan")
    u: float = float("nan")
    g: float = float("nan")
    success: bool = False
    error_message: Optional[str] = None
    input_params: Optional[TSTInputParams] = None

    def __str__(self) -> str:
        """Representación en string del resultado."""
        if not self.success:
            return f"Error: {self.error_message}"

        return (
            "\n_________________________________________________\n"
            f" U: \t\t{round(self.u, 3)}\n"
            f" Alpha 1:\t{round(self.alpha_1, 3)}\n"
            f" Alpha 2:\t{round(self.alpha_2, 3)}\n"
            f" G:\t\t{round(self.g, 2)}\n"
            "_________________________________________________\n"
        )

    def to_dict(self) -> dict[str, ScalarValue]:
        """Convierte el resultado a diccionario."""
        return {
            "alpha_1": round(self.alpha_1, 3),
            "alpha_2": round(self.alpha_2, 3),
            "u": round(self.u, 3),
            "g": round(self.g, 2),
            "success": self.success,
            "error_message": self.error_message or "",
        }
