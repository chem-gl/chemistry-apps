"""
# ck_test/calculators.py

Implementación del calculador TST (Transition State Theory) para constantes de velocidad.
Integra la lógica de cálculo con tipado estricto y manejo de errores robusto.

Uso:
    from libs.ck_test.calculators import TST

    calculator = TST(
        delta_zpe=-8.2,
        barrier_zpe=3.5,
        frequency=625,
        temperature=298.15
    )
    result = calculator.calculate()
    print(result)
"""

import math
from typing import Optional

from .models import TSTInputParams, TSTPrecalculatedConstants, TSTResult


class TST:
    """
    Calculador de Teoría de Estado de Transición (TST).

    Implementa el cálculo de coeficientes de velocidad usando integración
    numérica por cuadratura de Gauss-Legendre con 40 puntos.

    Atributos:
        constants: Constantes físicas precalculadas
        gauss_nodes: Nodos de Gauss-Legendre (40 puntos)
        gauss_weights: Pesos de Gauss-Legendre (40 puntos)
        input_params: Parámetros de entrada del cálculo
        result: Resultado del último cálculo (si existe)

    Ejemplo:
        calculator = TST(
            delta_zpe=-8.2,
            barrier_zpe=3.5,
            frequency=625,
            temperature=298.15
        )
        result = calculator.calculate()
        if result.success:
            print(f"G = {result.g}")
    """

    def __init__(
        self,
        delta_zpe: Optional[float] = None,
        barrier_zpe: Optional[float] = None,
        frequency: Optional[float] = None,
        temperature: Optional[float] = None,
    ) -> None:
        """
        Inicializa el calculador TST.

        Args:
            delta_zpe: Diferencia de energía de punto cero (kcal/mol)
            barrier_zpe: Barrera energética de punto cero (kcal/mol)
            frequency: Frecuencia imaginaria (cm^-1), sin signo negativo
            temperature: Temperatura del cálculo (K)
        """
        self.constants: TSTPrecalculatedConstants = TSTPrecalculatedConstants()
        self._initialize_gauss_nodes()
        self.input_params: Optional[TSTInputParams] = None
        self.result: Optional[TSTResult] = None

        if all(
            param is not None
            for param in [delta_zpe, barrier_zpe, frequency, temperature]
        ):
            self.input_params = TSTInputParams(
                delta_zpe=delta_zpe,  # type: ignore
                barrier_zpe=barrier_zpe,  # type: ignore
                frequency=frequency,  # type: ignore
                temperature=temperature,  # type: ignore
            )
            self.result = self.calculate()

    def _initialize_gauss_nodes(self) -> None:
        """Inicializa los nodos y pesos de Gauss-Legendre (40 puntos)."""
        self.gauss_nodes: list[float] = [
            -0.9982377,
            -0.9907262,
            -0.9772599,
            -0.9579168,
            -0.9328128,
            -0.9020988,
            -0.8659595,
            -0.8246122,
            -0.7783057,
            -0.7273183,
            -0.6719567,
            -0.6125539,
            -0.5494671,
            -0.4830758,
            -0.4137792,
            -0.3419941,
            -0.2681522,
            -0.1926976,
            -0.1160841,
            -0.0387724,
            0.0387724,
            0.1160841,
            0.1926976,
            0.2681522,
            0.3419941,
            0.4137792,
            0.4830758,
            0.5494671,
            0.6125539,
            0.6719567,
            0.7273183,
            0.7783057,
            0.8246122,
            0.8659595,
            0.9020988,
            0.9328128,
            0.9579168,
            0.9772599,
            0.9907262,
            0.9982377,
        ]

        self.gauss_weights: list[float] = [
            0.0045213,
            0.0104983,
            0.0164211,
            0.0222458,
            0.0279370,
            0.0334602,
            0.0387822,
            0.0438709,
            0.0486958,
            0.0532278,
            0.0574398,
            0.0613062,
            0.0648040,
            0.0679120,
            0.0706116,
            0.0728866,
            0.0747232,
            0.0761104,
            0.0770398,
            0.0775059,
            0.0775059,
            0.0770398,
            0.0761104,
            0.0747232,
            0.0728866,
            0.0706116,
            0.0679120,
            0.0648040,
            0.0613062,
            0.0574398,
            0.0532278,
            0.0486958,
            0.0438709,
            0.0387822,
            0.0334602,
            0.027937,
            0.0222458,
            0.0164211,
            0.0104983,
            0.0045213,
        ]

    def calculate(self) -> TSTResult:
        """
        Ejecuta el cálculo TST con los parámetros establecidos.

        Calcula alpha_1, alpha_2, U y G usando integración gaussiana.

        Returns:
            TSTResult: Objeto con los resultados del cálculo

        Raises:
            ValueError: Si los parámetros no están inicializados o son inválidos
        """
        if self.input_params is None:
            return TSTResult(
                success=False, error_message="Parámetros de entrada no inicializados"
            )

        try:
            return self._compute_tst_values()
        except ValueError as e:
            return TSTResult(success=False, error_message=str(e))
        except Exception as e:
            return TSTResult(
                success=False,
                error_message=f"Error inesperado en cálculo: {str(e)}",
            )

    def _compute_tst_values(self) -> TSTResult:
        """
        Realiza el cálculo numérico TST.

        Returns:
            TSTResult: Objeto con parámetros y valor G

        Raises:
            ValueError: Si hay error en los cálculos matemáticos
        """
        if self.input_params is None:
            raise ValueError("Parámetros no inicializados")

        params = self.input_params

        # Validación de entrada
        if params.frequency < 0:
            raise ValueError("La frecuencia no debe tener signo negativo")

        # Cálculo de alpha_1 y alpha_2
        alpha_1: float = (
            2.0 * math.pi * params.barrier_zpe * self.constants.cal_to_joule
        ) / (
            self.constants.avogadro
            * self.constants.planck
            * self.constants.speed_of_light
            * params.frequency
        )

        alpha_2: float = (
            2.0
            * math.pi
            * (params.barrier_zpe - params.delta_zpe)
            * self.constants.cal_to_joule
        ) / (
            self.constants.avogadro
            * self.constants.planck
            * self.constants.speed_of_light
            * params.frequency
        )

        # Factor U adimensional
        u: float = (
            self.constants.planck * self.constants.speed_of_light * params.frequency
        ) / (self.constants.boltzmann * params.temperature)

        # Cálculo mediante integración gaussiana
        try:
            g_value: float = self._gauss_quadrature_integration(alpha_1, alpha_2, u)
        except (ValueError, OverflowError) as e:
            raise ValueError(
                f"Barrera energética o frecuencia imaginaria excedida: {str(e)}"
            )

        return TSTResult(
            alpha_1=alpha_1,
            alpha_2=alpha_2,
            u=u,
            g=g_value,
            success=True,
            input_params=params,
        )

    def _gauss_quadrature_integration(
        self, alpha_1: float, alpha_2: float, u: float
    ) -> float:
        """
        Integración por cuadratura de Gauss-Legendre (40 puntos).
        Calcula el valor G mediante integración numérica.

        Args:
            alpha_1: Parámetro alfa 1
            alpha_2: Parámetro alfa 2
            u: Factor U adimensional

        Returns:
            float: Valor G calculado

        Raises:
            ValueError: Si hay error matemático en la integración
        """
        pi_2: float = 2.0 * math.pi
        u_pi_2: float = u / pi_2

        # Precomputación
        c: float = (
            0.125
            * math.pi
            * u
            * math.pow((1.0 / math.sqrt(alpha_1)) + (1.0 / math.sqrt(alpha_2)), 2)
        )

        v1: float = u_pi_2 * alpha_1
        v2: float = u_pi_2 * alpha_2

        d: float = 4.0 * alpha_1 * alpha_2 - math.pow(math.pi, 2)

        # Función hiperbólica
        df: float = math.cosh(math.sqrt(d)) if d > 0.0 else math.cos(math.sqrt(-d))

        # Energías extremales
        e_z: float = -v1 if v2 >= v1 else -v2
        e_m: float = 0.5 * (u - e_z)
        e_p: float = 0.5 * (u + e_z)

        # Integración gaussiana
        g_value: float = 0.0
        for j in range(40):
            energy: float = e_m * self.gauss_nodes[j] + e_p

            try:
                a1: float = math.pi * math.sqrt((energy + v1) / c)
                a2: float = math.pi * math.sqrt((energy + v2) / c)

                fp: float = math.cosh(a1 + a2)
                fm: float = math.cosh(a1 - a2)

                g_value += (
                    self.gauss_weights[j] * math.exp(-energy) * (fp - fm) / (fp + df)
                )
            except (ValueError, ZeroDivisionError) as e:
                raise ValueError(
                    f"Error en integración gaussiana en punto {j}: {str(e)}"
                )

        g_value = e_m * g_value + math.exp(-u)

        return g_value

    def set_parameters(
        self,
        delta_zpe: float,
        barrier_zpe: float,
        frequency: float,
        temperature: float,
    ) -> TSTResult:
        """
        Establece nuevos parámetros y ejecuta el cálculo.

        Args:
            delta_zpe: Diferencia de energía de punto cero (kcal/mol)
            barrier_zpe: Barrera energética de punto cero (kcal/mol)
            frequency: Frecuencia imaginaria (cm^-1), sin signo negativo
            temperature: Temperatura del cálculo (K)

        Returns:
            TSTResult: Resultado del cálculo
        """
        self.input_params = TSTInputParams(
            delta_zpe=delta_zpe,
            barrier_zpe=barrier_zpe,
            frequency=frequency,
            temperature=temperature,
        )
        self.result = self.calculate()
        return self.result

    def get_result(self) -> Optional[TSTResult]:
        """
        Obtiene el resultado del último cálculo.

        Returns:
            TSTResult: Resultado almacenado o None si no hay cálculo
        """
        return self.result

    def __str__(self) -> str:
        """Representación en string del calculador y su resultado."""
        if self.result is None:
            return "TST Calculator - No calculation performed yet"
        return str(self.result)
