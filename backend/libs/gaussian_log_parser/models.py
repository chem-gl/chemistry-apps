"""
# gaussian_log_parser/models.py

Modelos de dominio para representar datos extraídos de logs de Gaussian.
Usa dataclasses para mantener estructura clara y tipada.

Uso:
    from libs.gaussian_log_parser.models import GaussianExecution
    execution = GaussianExecution(checkpoint_file="file.chk")
"""

from dataclasses import dataclass, field
from typing import Optional

type GaussianScalarValue = str | int | float | bool


@dataclass
class GaussianExecution:
    """
    Representa una ejecución de cálculo Gaussian extraída de un log.
    Contiene todos los parámetros y resultados de un cálculo.

    Atributos:
        checkpoint_file: Archivo checkpoint del cálculo
        command: Comando de ejecución
        job_title: Título/descripción del cálculo
        charge: Carga eléctrica del sistema
        multiplicity: Multiplicidad de espín (2S+1)
        negative_frequencies: Cantidad de frecuencias imaginarias
        imaginary_frequency: Valor de la primera frecuencia imaginaria
        zero_point_energy: Energía de punto cero (ZPE) en Hartree
        thermal_enthalpies: Entalpías térmicas corregidas en Hartree
        free_energies: Energías libres de Gibbs en Hartree
        temperature: Temperatura del cálculo en Kelvin
        is_opt_freq: Si es un cálculo de optimización+frecuencias
        scf_energy: Energía SCF final en Hartree
        is_optimization: Si es un cálculo de optimización
        normal_termination: Si finalizó correctamente
        raw_data: Datos adicionales no procesados
    """

    checkpoint_file: str = ""
    command: str = ""
    job_title: str = ""
    charge: int = 0
    multiplicity: int = 1
    negative_frequencies: int = 0
    imaginary_frequency: float = float("nan")
    zero_point_energy: float = float("nan")
    thermal_enthalpies: float = float("nan")
    free_energies: float = float("nan")
    temperature: float = float("nan")
    is_opt_freq: bool = False
    scf_energy: float = float("nan")
    is_optimization: bool = False
    normal_termination: bool = False
    raw_data: dict[str, GaussianScalarValue] = field(default_factory=dict)

    def has_imaginary_frequencies(self) -> bool:
        """Verifica si hay frecuencias imaginarias."""
        return self.negative_frequencies > 0

    def is_valid(self) -> bool:
        """Verifica si los datos críticos están presentes."""
        # Una ejecución es válida si tiene al menos checkpoint o comando
        return bool(self.checkpoint_file or self.command)

    def to_dict(self) -> dict[str, GaussianScalarValue]:
        """Convierte el objeto a diccionario para serialización."""
        return {
            "checkpoint_file": self.checkpoint_file,
            "command": self.command,
            "job_title": self.job_title,
            "charge": self.charge,
            "multiplicity": self.multiplicity,
            "negative_frequencies": self.negative_frequencies,
            "imaginary_frequency": self.imaginary_frequency,
            "zero_point_energy": self.zero_point_energy,
            "thermal_enthalpies": self.thermal_enthalpies,
            "free_energies": self.free_energies,
            "temperature": self.temperature,
            "is_opt_freq": self.is_opt_freq,
            "scf_energy": self.scf_energy,
            "is_optimization": self.is_optimization,
            "normal_termination": self.normal_termination,
        }


@dataclass
class GaussianLogParserResult:
    """
    Resultado completo del parseo de un log de Gaussian.

    Atributos:
        executions: Lista de ejecuciones Gaussian encontradas
        parse_successful: Si el parseo completó sin errores
        errors: Lista de mensajes de error durante el parseo
    """

    executions: list[GaussianExecution] = field(default_factory=list)
    parse_successful: bool = True
    errors: list[str] = field(default_factory=list)

    @property
    def execution_count(self) -> int:
        """Retorna el número de ejecuciones encontradas."""
        return len(self.executions)

    def add_error(self, error_message: str) -> None:
        """Agrega un mensaje de error a la lista."""
        self.errors.append(error_message)
        self.parse_successful = False

    def first_execution(self) -> Optional[GaussianExecution]:
        """Retorna la primera ejecución o None si no hay."""
        return self.executions[0] if self.executions else None

    def last_execution(self) -> Optional[GaussianExecution]:
        """Retorna la última ejecución o None si no hay."""
        return self.executions[-1] if self.executions else None
