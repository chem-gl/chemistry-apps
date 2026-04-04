"""
# gaussian_log_parser/parsers.py

Parser principal para logs de Gaussian.
Lee archivos o strings de logs y extrae información de cálculos Gaussian.

Uso:
    from libs.gaussian_log_parser.parsers import GaussianLogParser

    parser = GaussianLogParser()
    result = parser.parse_file("ruta/al/archivo.log")

    for execution in result.executions:
        print(f"Carga: {execution.charge}")
        print(f"Multiplicidad: {execution.multiplicity}")
        print(f"Energía: {execution.scf_energy}")
"""

from pathlib import Path
from typing import Optional

from .attributes import (
    ChargeMultiplicityAttribute,
    CheckpointFileAttribute,
    CommandAttribute,
    ImaginaryFrequencyAttribute,
    IsOptFreqAttribute,
    JobTitleAttribute,
    NegativeFrequenciesAttribute,
    NormalTerminationAttribute,
    SCFEnergyAttribute,
    TemperatureAttribute,
    ThermalEnthalpiesAttribute,
    ThermalFreeEnergiesAttribute,
    ZeroPointEnergyAttribute,
)
from .attributes.base import GaussianAttribute
from .models import GaussianExecution, GaussianLogParserResult


class GaussianLogParser:
    """
    Parser para archivos de logs de Gaussian.

    Extrae múltiples ejecuciones de un log y proporciona acceso
    a todos los atributos relevantes de forma estructurada.

    Atributos:
        _attributes: Lista de extractores de atributos
    """

    def __init__(self) -> None:
        """Inicializa el parser con todos los atributos a extraer."""
        self._attributes = [
            CheckpointFileAttribute(),
            CommandAttribute(),
            JobTitleAttribute(),
            ChargeMultiplicityAttribute(),
            NegativeFrequenciesAttribute(),
            ImaginaryFrequencyAttribute(),
            ZeroPointEnergyAttribute(),
            ThermalEnthalpiesAttribute(),
            ThermalFreeEnergiesAttribute(),
            TemperatureAttribute(),
            IsOptFreqAttribute(),
            SCFEnergyAttribute(),
            NormalTerminationAttribute(),
        ]

    def _reset_attributes(self) -> None:
        """Reinicia todos los atributos para nueva ejecución."""
        for attr in self._attributes:
            attr.reset()

    def parse_file(self, filepath: str) -> GaussianLogParserResult:
        """
        Parsea un archivo de log de Gaussian.

        Args:
            filepath: Ruta al archivo .log

        Returns:
            GaussianLogParserResult con las ejecuciones encontradas
        """
        try:
            content = Path(filepath).read_text(encoding="utf-8", errors="ignore")
            return self.parse_content(content)
        except FileNotFoundError:
            result = GaussianLogParserResult()
            result.add_error(f"Archivo no encontrado: {filepath}")
            return result
        except Exception as e:
            result = GaussianLogParserResult()
            result.add_error(f"Error al leer archivo: {str(e)}")
            return result

    def parse_blob(
        self,
        blob: bytes | bytearray | memoryview | str,
        encoding: str = "utf-8",
        errors: str = "ignore",
    ) -> GaussianLogParserResult:
        """
        Parsea contenido entregado como texto o blob binario.

        Este método es útil cuando el log llega desde APIs, mensajería,
        almacenamiento remoto o formularios que entregan bytes en memoria.

        Args:
            blob: Contenido del log como str, bytes, bytearray o memoryview.
            encoding: Codificación usada para decodificar bytes.
            errors: Estrategia de errores al decodificar bytes.

        Returns:
            GaussianLogParserResult con las ejecuciones encontradas.
        """
        if isinstance(blob, str):
            return self.parse_content(blob)

        try:
            blob_bytes = blob.tobytes() if isinstance(blob, memoryview) else bytes(blob)
            text_content = blob_bytes.decode(encoding=encoding, errors=errors)
            return self.parse_content(text_content)
        except Exception as e:
            result = GaussianLogParserResult()
            result.add_error(f"Error al procesar blob: {str(e)}")
            return result

    def parse_content(self, content: str) -> GaussianLogParserResult:
        """
        Parsea el contenido de un log de Gaussian.

        Args:
            content: Contenido del log como string

        Returns:
            GaussianLogParserResult con las ejecuciones encontradas
        """
        result = GaussianLogParserResult()

        if not content:
            result.add_error("Contenido vacío")
            return result

        lines = content.split("\n")
        current_execution: Optional[GaussianExecution] = None

        try:
            for line_num, line in enumerate(lines, 1):
                # Detectar inicio de nueva ejecución
                if "Initial command:" in line:
                    # Guardar ejecución anterior si existe
                    if current_execution is not None and current_execution.is_valid():
                        result.executions.append(current_execution)

                    # Reiniciar atributos y crear nueva ejecución
                    self._reset_attributes()
                    current_execution = GaussianExecution()

                # Procesar línea si hay ejecución activa
                if current_execution is not None:
                    self._process_line(current_execution, line, line_num)

            # Guardar última ejecución
            if current_execution is not None and current_execution.is_valid():
                result.executions.append(current_execution)

        except Exception as e:
            result.add_error(f"Error durante parseo: {str(e)}")

        return result

    def _process_line(
        self, execution: GaussianExecution, line: str, line_num: int
    ) -> None:
        """
        Procesa una línea del log con todos los atributos.

        Args:
            execution: Ejecución actual siendo construida
            line: Línea a procesar
            line_num: Número de línea
        """
        for attr in self._attributes:
            if attr.active and attr.process(line):
                attr.set_line_number(line_num)
                self._set_execution_value(execution, attr)

    def _set_execution_value(
        self, execution: GaussianExecution, attr: GaussianAttribute
    ) -> None:
        """
        Asigna el valor extraído del atributo a la ejecución.

        Args:
            execution: Ejecución a actualizar
            attr: Atributo que contiene el valor
        """
        if not attr.found:
            return

        value = attr.value

        string_by_type: dict[type[GaussianAttribute], str] = {
            CheckpointFileAttribute: "checkpoint_file",
            CommandAttribute: "command",
            JobTitleAttribute: "job_title",
        }
        float_by_type: dict[type[GaussianAttribute], str] = {
            ImaginaryFrequencyAttribute: "imaginary_frequency",
            ZeroPointEnergyAttribute: "zero_point_energy",
            ThermalEnthalpiesAttribute: "thermal_enthalpies",
            ThermalFreeEnergiesAttribute: "free_energies",
            TemperatureAttribute: "temperature",
            SCFEnergyAttribute: "scf_energy",
        }
        bool_by_type: dict[type[GaussianAttribute], str] = {
            IsOptFreqAttribute: "is_opt_freq",
            NormalTerminationAttribute: "normal_termination",
        }

        attr_type = type(attr)

        if attr_type in string_by_type:
            setattr(execution, string_by_type[attr_type], str(value))
            return

        if isinstance(attr, ChargeMultiplicityAttribute):
            execution.charge = attr.charge
            execution.multiplicity = attr.multiplicity
            return

        if isinstance(attr, NegativeFrequenciesAttribute):
            numeric_value = self._safe_float(value)
            if numeric_value is not None:
                execution.negative_frequencies = int(numeric_value)
            return

        if attr_type in float_by_type:
            numeric_value = self._safe_float(value)
            if numeric_value is not None:
                setattr(execution, float_by_type[attr_type], numeric_value)
            return

        if attr_type in bool_by_type:
            setattr(execution, bool_by_type[attr_type], str(value).lower() == "true")

    @staticmethod
    def _safe_float(value: float | str | None) -> float | None:
        """Convierte un valor a float de forma segura."""
        if value is None:
            return None
        try:
            return float(value)
        except (ValueError, TypeError):
            return None
