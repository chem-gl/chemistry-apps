"""
# ck_test/tests.py

Pruebas unitarias para la librería de cálculo TST.
Valida corrección de cálculos, manejo de errores y casos límite.

Uso:
    pytest backend/libs/ck_test/tests.py -v
"""

import math
import unittest

from .calculators import TST
from .models import TSTInputParams, TSTPrecalculatedConstants, TSTResult


class TestTSTPrecalculatedConstants(unittest.TestCase):
    """Pruebas de las constantes físicas precalculadas."""

    def test_constants_initialized_correctly(self) -> None:
        """Verifica que las constantes se inicialicen con valores correctos."""
        constants = TSTPrecalculatedConstants()

        self.assertAlmostEqual(constants.avogadro, 6.0221367e23, places=15)
        self.assertAlmostEqual(constants.planck, 6.6260755e-34, places=40)
        self.assertAlmostEqual(constants.speed_of_light, 2.9979246e10, places=6)
        self.assertAlmostEqual(constants.boltzmann, 1.380658e-23, places=28)
        self.assertEqual(constants.cal_to_joule, 4184.0)


class TestTSTInputParams(unittest.TestCase):
    """Pruebas del modelo de parámetros de entrada."""

    def test_input_params_creation(self) -> None:
        """Verifica la creación correcta de parámetros de entrada."""
        params = TSTInputParams(
            delta_zpe=-8.2,
            barrier_zpe=3.5,
            frequency=625,
            temperature=298.15,
        )

        self.assertEqual(params.delta_zpe, -8.2)
        self.assertEqual(params.barrier_zpe, 3.5)
        self.assertEqual(params.frequency, 625)
        self.assertEqual(params.temperature, 298.15)


class TestTSTResult(unittest.TestCase):
    """Pruebas del modelo de resultado."""

    def test_result_success_to_dict(self) -> None:
        """Verifica conversión a diccionario de resultado exitoso."""
        result = TSTResult(
            alpha_1=1.234,
            alpha_2=5.678,
            u=2.5,
            g=0.98,
            success=True,
        )

        result_dict = result.to_dict()
        self.assertTrue(result_dict["success"])
        self.assertAlmostEqual(result_dict["g"], 0.98)

    def test_result_error_message(self) -> None:
        """Verifica manejo de mensajes de error."""
        error_msg = "Parámetro inválido"
        result = TSTResult(
            success=False,
            error_message=error_msg,
        )

        self.assertEqual(result.error_message, error_msg)
        self.assertFalse(result.success)


class TestTSTCalculator(unittest.TestCase):
    """Pruebas del calculador TST principal."""

    def test_calculator_initialization_without_params(self) -> None:
        """Verifica inicialización del calculador sin parámetros."""
        calculator = TST()

        self.assertIsNotNone(calculator.constants)
        self.assertIsNone(calculator.input_params)
        self.assertIsNone(calculator.result)

    def test_calculator_initialization_with_params(self) -> None:
        """Verifica inicialización con parámetros automáticamente calcula."""
        calculator = TST(
            delta_zpe=-8.2,
            barrier_zpe=3.5,
            frequency=625,
            temperature=298.15,
        )

        self.assertIsNotNone(calculator.input_params)
        self.assertIsNotNone(calculator.result)
        self.assertTrue(calculator.result.success)

    def test_calculation_with_standard_values(self) -> None:
        """Prueba cálculo con valores estándar del ejemplo original."""
        calculator = TST(
            delta_zpe=-8.2,
            barrier_zpe=3.5,
            frequency=625,
            temperature=298.15,
        )

        result = calculator.result
        self.assertIsNotNone(result)
        self.assertTrue(result.success)
        self.assertFalse(math.isnan(result.alpha_1))
        self.assertFalse(math.isnan(result.alpha_2))
        self.assertFalse(math.isnan(result.u))
        self.assertFalse(math.isnan(result.g))

    def test_set_parameters_method(self) -> None:
        """Verifica método set_parameters."""
        calculator = TST()
        result = calculator.set_parameters(
            delta_zpe=-8.2,
            barrier_zpe=3.5,
            frequency=625,
            temperature=298.15,
        )

        self.assertTrue(result.success)
        self.assertIsNotNone(calculator.result)

    def test_negative_frequency_error(self) -> None:
        """Verifica que frecuencia negativa lanza error."""
        calculator = TST()
        result = calculator.set_parameters(
            delta_zpe=-8.2,
            barrier_zpe=3.5,
            frequency=-625,  # Frecuencia negativa
            temperature=298.15,
        )

        self.assertFalse(result.success)
        self.assertIsNotNone(result.error_message)
        self.assertIn("negativo", result.error_message.lower())

    def test_get_result_before_calculation(self) -> None:
        """Verifica get_result() antes de cualquier cálculo."""
        calculator = TST()
        result = calculator.get_result()

        self.assertIsNone(result)

    def test_get_result_after_calculation(self) -> None:
        """Verifica get_result() después del cálculo."""
        calculator = TST(
            delta_zpe=-8.2,
            barrier_zpe=3.5,
            frequency=625,
            temperature=298.15,
        )
        result = calculator.get_result()

        self.assertIsNotNone(result)
        self.assertTrue(result.success)

    def test_gauss_nodes_initialization(self) -> None:
        """Verifica que los nodos de Gauss se inicialicen correctamente."""
        calculator = TST()

        self.assertEqual(len(calculator.gauss_nodes), 40)
        self.assertEqual(len(calculator.gauss_weights), 40)

        # Verifica simétricos
        self.assertAlmostEqual(calculator.gauss_nodes[0], -calculator.gauss_nodes[-1])
        self.assertAlmostEqual(
            calculator.gauss_weights[0], calculator.gauss_weights[-1]
        )

    def test_result_string_representation(self) -> None:
        """Verifica representación en string del resultado."""
        result = TSTResult(
            alpha_1=1.234,
            alpha_2=5.678,
            u=2.5,
            g=0.98,
            success=True,
        )

        result_str = str(result)
        self.assertIn("U:", result_str)
        self.assertIn("Alpha 1:", result_str)
        self.assertIn("Alpha 2:", result_str)
        self.assertIn("G:", result_str)

    def test_calculator_string_representation(self) -> None:
        """Verifica representación en string del calculador."""
        calculator = TST(
            delta_zpe=-8.2,
            barrier_zpe=3.5,
            frequency=625,
            temperature=298.15,
        )

        calc_str = str(calculator)
        self.assertIn("U:", calc_str)
        self.assertIn("Alpha", calc_str)

    def test_multiple_calculations_sequence(self) -> None:
        """Verifica cálculos secuenciales con diferentes parámetros."""
        calculator = TST()

        # Primer cálculo
        result1 = calculator.set_parameters(
            delta_zpe=-8.2,
            barrier_zpe=3.5,
            frequency=625,
            temperature=298.15,
        )
        g_value1 = result1.g

        # Segundo cálculo con parámetros diferentes
        result2 = calculator.set_parameters(
            delta_zpe=-5.0,
            barrier_zpe=2.0,
            frequency=500,
            temperature=300.0,
        )
        g_value2 = result2.g

        # Valores deben ser diferentes
        self.assertNotEqual(g_value1, g_value2)
        self.assertTrue(result1.success)
        self.assertTrue(result2.success)

    def test_temperature_sensitivity(self) -> None:
        """Verifica sensibilidad a cambio de temperatura."""
        calc_low = TST(
            delta_zpe=-8.2,
            barrier_zpe=3.5,
            frequency=625,
            temperature=200.0,
        )
        g_low = calc_low.result.g

        calc_high = TST(
            delta_zpe=-8.2,
            barrier_zpe=3.5,
            frequency=625,
            temperature=500.0,
        )
        g_high = calc_high.result.g

        # Valores deben ser diferentes
        self.assertNotEqual(g_low, g_high)


class TestTSTResultOutput(unittest.TestCase):
    """Pruebas de formato de salida del resultado."""

    def test_result_output_format(self) -> None:
        """Verifica el formato de salida del resultado."""
        result = TSTResult(
            alpha_1=0.125,
            alpha_2=0.456,
            u=2.5,
            g=0.987,
            success=True,
        )

        output = str(result)
        lines = output.split("\n")

        # Verifica estructura
        self.assertGreater(len(lines), 4)
        non_empty_lines = [line for line in lines if line.strip()]
        self.assertGreater(len(non_empty_lines), 4)
        self.assertIn(
            "_________________________________________________", non_empty_lines[0]
        )
        self.assertIn(
            "_________________________________________________", non_empty_lines[-1]
        )


if __name__ == "__main__":
    unittest.main()
