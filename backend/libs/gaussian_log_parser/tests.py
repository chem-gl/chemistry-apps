"""
# gaussian_log_parser/tests.py

Tests unitarios para el parser de logs Gaussian.
Valida que los atributos se extraigan correctamente y que el parser integrado funcione.

Ejecución desde backend:
    python manage.py test libs.gaussian_log_parser.tests
    O simplemente:
    python -m pytest libs/gaussian_log_parser/tests.py -v
"""

import unittest
from pathlib import Path

from .attributes import (
    ChargeMultiplicityAttribute,
    CheckpointFileAttribute,
    CommandAttribute,
    IsOptFreqAttribute,
    NormalTerminationAttribute,
    SCFEnergyAttribute,
    TemperatureAttribute,
    ThermalEnthalpiesAttribute,
    ZeroPointEnergyAttribute,
)
from .models import GaussianExecution, GaussianLogParserResult
from .parsers import GaussianLogParser


class TestGaussianAttributes(unittest.TestCase):
    """Tests para atributos individuales."""

    def test_checkpoint_file_attribute(self) -> None:
        """Verifica extracción de archivo checkpoint."""
        attr = CheckpointFileAttribute()
        line = " %chk=1_ceto_f3_rad_+.chk"

        self.assertTrue(attr.revision_condition(line))
        attr.process(line)
        self.assertTrue(attr.found)
        self.assertEqual(attr.value, "1_ceto_f3_rad_+.chk")

    def test_command_attribute(self) -> None:
        """Verifica extracción del comando inicial."""
        attr = CommandAttribute()
        marker_line = " Initial command:"
        command_line = " /path/to/gaussian/g09/l1.exe input.inp"

        self.assertFalse(attr.revision_condition(marker_line))
        self.assertTrue(attr.process(command_line))
        self.assertEqual(attr.value, "/path/to/gaussian/g09/l1.exe input.inp")

    def test_charge_multiplicity_attribute(self) -> None:
        """Verifica extracción de carga y multiplicidad."""
        attr = ChargeMultiplicityAttribute()
        line = " Charge =  1 Multiplicity = 2"

        self.assertTrue(attr.revision_condition(line))
        attr.process(line)
        self.assertTrue(attr.found)
        self.assertEqual(attr.charge, 1)
        self.assertEqual(attr.multiplicity, 2)

    def test_zero_point_energy_attribute(self) -> None:
        """Verifica extracción de energía de punto cero."""
        attr = ZeroPointEnergyAttribute()
        line = " Sum of electronic and zero-point Energies= -542.123456"

        self.assertTrue(attr.revision_condition(line))
        attr.process(line)
        self.assertTrue(attr.found)
        self.assertAlmostEqual(attr.value, -542.123456, places=5)

    def test_thermal_enthalpies_attribute(self) -> None:
        """Verifica extracción de entalpías térmicas."""
        attr = ThermalEnthalpiesAttribute()
        line = " Sum of electronic and thermal Enthalpies= -542.098765"

        self.assertTrue(attr.revision_condition(line))
        attr.process(line)
        self.assertTrue(attr.found)
        self.assertAlmostEqual(attr.value, -542.098765, places=5)

    def test_scf_energy_attribute(self) -> None:
        """Verifica extracción de energía SCF."""
        attr = SCFEnergyAttribute()
        line = " SCF Done:  E(RM052X) =  -542.456789  A.U. after   15 cycles"

        self.assertTrue(attr.revision_condition(line))
        attr.process(line)
        self.assertTrue(attr.found)
        # SCF retorna el primer float que sea energéticamente razonable
        self.assertLess(attr.value, -100)  # Debe ser negativo y grande

    def test_temperature_attribute(self) -> None:
        """Verifica extracción de temperatura."""
        attr = TemperatureAttribute()
        line = " Temperature  298.150 Kelvin.  Pressure   1.00000 Atm."

        self.assertTrue(attr.revision_condition(line))
        attr.process(line)
        self.assertTrue(attr.found)
        self.assertAlmostEqual(attr.value, 298.15, places=1)

    def test_is_opt_freq_attribute(self) -> None:
        """Verifica detección de cálculo opt+freq."""
        attr = IsOptFreqAttribute()
        line = " #p opt freq 6-311+g(d,p) scrf=(smd,solvent=water) m052x"

        self.assertTrue(attr.revision_condition(line))
        attr.process(line)
        self.assertTrue(attr.found)
        self.assertEqual(attr.value, "true")

    def test_normal_termination_attribute(self) -> None:
        """Verifica detección de terminación normal."""
        attr = NormalTerminationAttribute()
        line = " Normal termination of Gaussian 09 at Fri Jan 28 03:25:33 2022."

        self.assertTrue(attr.revision_condition(line))
        attr.process(line)
        self.assertTrue(attr.found)
        self.assertEqual(attr.value, "true")


class TestGaussianExecution(unittest.TestCase):
    """Tests para el modelo GaussianExecution."""

    def test_execution_creation(self) -> None:
        """Verifica creación de ejecución con datos."""
        execution = GaussianExecution(
            checkpoint_file="test.chk", charge=1, multiplicity=2
        )

        self.assertEqual(execution.checkpoint_file, "test.chk")
        self.assertEqual(execution.charge, 1)
        self.assertEqual(execution.multiplicity, 2)
        # Ahora es válida si tiene checkpoint O comando
        self.assertTrue(execution.is_valid())

    def test_execution_has_imaginary_frequencies(self) -> None:
        """Verifica método de frecuencias imaginarias."""
        execution = GaussianExecution()
        self.assertFalse(execution.has_imaginary_frequencies())

        execution.negative_frequencies = 1
        self.assertTrue(execution.has_imaginary_frequencies())

    def test_execution_to_dict(self) -> None:
        """Verifica conversión a diccionario."""
        execution = GaussianExecution(
            checkpoint_file="test.chk", charge=1, multiplicity=2
        )

        data = execution.to_dict()
        self.assertEqual(data["checkpoint_file"], "test.chk")
        self.assertEqual(data["charge"], 1)
        self.assertEqual(data["multiplicity"], 2)


class TestGaussianLogParserResult(unittest.TestCase):
    """Tests para el resultado del parser."""

    def test_result_creation(self) -> None:
        """Verifica creación de resultado."""
        result = GaussianLogParserResult()
        self.assertTrue(result.parse_successful)
        self.assertEqual(result.execution_count, 0)

    def test_result_add_error(self) -> None:
        """Verifica adición de errores."""
        result = GaussianLogParserResult()
        result.add_error("Error de prueba")

        self.assertFalse(result.parse_successful)
        self.assertEqual(len(result.errors), 1)
        self.assertIn("Error de prueba", result.errors)

    def test_result_first_last_execution(self) -> None:
        """Verifica métodos first y last execution."""
        result = GaussianLogParserResult()
        exec1 = GaussianExecution(checkpoint_file="file1.chk")
        exec2 = GaussianExecution(checkpoint_file="file2.chk")

        result.executions.append(exec1)
        result.executions.append(exec2)

        self.assertEqual(result.first_execution().checkpoint_file, "file1.chk")
        self.assertEqual(result.last_execution().checkpoint_file, "file2.chk")


class TestGaussianLogParser(unittest.TestCase):
    """Tests de integración para el parser completo."""

    @classmethod
    def setUpClass(cls) -> None:
        """Prepara recursos para todos los tests."""
        cls.parser = GaussianLogParser()

        # Crear log de prueba mínimo
        cls.minimal_log = """
 Initial command:
 /path/to/gaussian
 %chk=test.chk
 #p opt freq 6-311+g(d,p)
 ---------------
 test_calculation
 ---------------
 Charge =  1 Multiplicity = 2
 SCF Done:  E(RM052X) =  -542.456789  A.U. after   15 cycles
 Sum of electronic and zero-point Energies= -542.123456
 Sum of electronic and thermal Enthalpies= -542.098765
 Sum of electronic and thermal Free Energies= -542.050000
 Temperature  298.150 Kelvin.  Pressure   1.00000 Atm.
 Normal termination of Gaussian 09 at Fri Jan 28 03:25:33 2022.
        """

    def test_parse_minimal_log(self) -> None:
        """Verifica parseo de log mínimo."""
        result = self.parser.parse_content(self.minimal_log)

        self.assertTrue(result.parse_successful)
        self.assertEqual(result.execution_count, 1)

    def test_parse_execution_values(self) -> None:
        """Verifica valores extraídos correctamente."""
        result = self.parser.parse_content(self.minimal_log)
        execution = result.first_execution()

        self.assertIsNotNone(execution)
        self.assertEqual(execution.checkpoint_file, "test.chk")
        self.assertEqual(execution.charge, 1)
        self.assertEqual(execution.multiplicity, 2)
        self.assertTrue(execution.is_opt_freq)
        self.assertTrue(execution.normal_termination)
        self.assertAlmostEqual(execution.scf_energy, -542.456789, places=5)
        self.assertAlmostEqual(execution.zero_point_energy, -542.123456, places=5)

    def test_parse_empty_content(self) -> None:
        """Verifica manejo de contenido vacío."""
        result = self.parser.parse_content("")

        self.assertFalse(result.parse_successful)
        self.assertEqual(len(result.errors), 1)

    def test_parse_missing_file(self) -> None:
        """Verifica manejo de archivo no encontrado."""
        result = self.parser.parse_file("/ruta/inexistente/archivo.log")

        self.assertFalse(result.parse_successful)
        self.assertEqual(len(result.errors), 1)
        self.assertIn("no encontrado", result.errors[0].lower())

    def test_parse_blob_from_bytes(self) -> None:
        """Verifica parseo cuando el contenido llega como bytes."""
        result = self.parser.parse_blob(self.minimal_log.encode("utf-8"))

        self.assertTrue(result.parse_successful)
        self.assertEqual(result.execution_count, 1)
        execution = result.first_execution()
        self.assertIsNotNone(execution)
        self.assertEqual(execution.checkpoint_file, "test.chk")

    def test_parse_blob_from_memoryview(self) -> None:
        """Verifica parseo cuando el contenido llega como memoryview."""
        blob_view = memoryview(self.minimal_log.encode("utf-8"))
        result = self.parser.parse_blob(blob_view)

        self.assertTrue(result.parse_successful)
        self.assertEqual(result.execution_count, 1)

    def test_parse_blob_from_text(self) -> None:
        """Verifica parseo cuando el blob se entrega directamente como texto."""
        result = self.parser.parse_blob(self.minimal_log)

        self.assertTrue(result.parse_successful)
        self.assertEqual(result.execution_count, 1)

    def test_parser_reset_attributes_per_execution(self) -> None:
        """Verifica que los atributos se reinician por ejecución."""
        multi_exec_log = f"{self.minimal_log}\n{self.minimal_log}"
        result = self.parser.parse_content(multi_exec_log)

        self.assertEqual(result.execution_count, 2)


class TestParserWithRealLog(unittest.TestCase):
    """Tests con archivo de log real si existe."""

    @classmethod
    def setUpClass(cls) -> None:
        """Prepara recursos."""
        cls.parser = GaussianLogParser()
        # Buscar archivo de prueba en la carpeta legacy
        cls.log_file = (
            Path(__file__).parent.parent.parent.parent
            / "legacy"
            / "deprecated"
            / "read_log_gaussian"
            / "1_ceto_f3_rad_+.log"
        )

    def test_parse_real_log_file_if_exists(self) -> None:
        """Parsea archivo de log real si existe."""
        if not self.log_file.exists():
            self.skipTest(f"Archivo de prueba no encontrado: {self.log_file}")

        result = self.parser.parse_file(str(self.log_file))

        self.assertTrue(result.parse_successful)
        self.assertGreater(result.execution_count, 0)

        execution = result.first_execution()
        self.assertIsNotNone(execution)
        self.assertEqual(execution.checkpoint_file, "1_ceto_f3_rad_+.chk")
        self.assertEqual(execution.charge, 1)
        self.assertEqual(execution.multiplicity, 2)
        self.assertTrue(execution.is_opt_freq)


def run_tests() -> None:
    """Función auxiliar para ejecutar tests."""
    unittest.main(argv=[""], exit=False, verbosity=2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
