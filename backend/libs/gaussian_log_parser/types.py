"""
# gaussian_log_parser/types.py

Definiciones de tipos estrictos para el parseoador de logs de Gaussian.
Contiene TypeDicts y TypeAlias que definen contratos explícitos para entrada,
metadatos, resultados y payloads del parser.

Uso:
    from libs.gaussian_log_parser.types import GaussianLogResult
    result: GaussianLogResult = parser.parse(...)
"""

from typing import TypedDict


class GaussianAttributeValue(TypedDict, total=False):
    """
    Representa un atributo extraído del log de Gaussian.

    Atributos:
        value: Valor numérico o string del atributo
        found: Si se encontró el atributo en el log
        line_number: Número de línea donde se encontró
    """

    value: float | str
    found: bool
    line_number: int


class GaussianExecutionData(TypedDict, total=False):
    """
    Datos de una ejecución de Gaussian extraída de un log.
    Representa toda la información relevante de un cálculo.

    Atributos:
        checkpoint_file: Archivo checkpoint (%chk=)
        command: Comando de ejecución
        job_title: Título del cálculo
        charge: Carga del sistema
        multiplicity: Multiplicidad de espín
        negative_frequencies: Número de frecuencias imaginarias
        imaginary_frequency: Primera frecuencia imaginaria (si existe)
        zero_point_energy: Energía de punto cero
        thermal_enthalpies: Entalpías térmicas
        free_energies: Energías libres térmicas
        temperature: Temperatura del cálculo
        is_opt_freq: Si es un cálculo opt+freq
        scf_energy: Energía SCF
        is_optimization: Si es optimización
        normal_termination: Si terminó normalmente
    """

    checkpoint_file: str
    command: str
    job_title: str
    charge: int
    multiplicity: int
    negative_frequencies: int
    imaginary_frequency: float
    zero_point_energy: float
    thermal_enthalpies: float
    free_energies: float
    temperature: float
    is_opt_freq: bool
    scf_energy: float
    is_optimization: bool
    normal_termination: bool


class GaussianLogResult(TypedDict, total=False):
    """
    Resultado completo del parseo de un log de Gaussian.
    Contiene lista de ejecuciones encontradas y metadatos.

    Atributos:
        executions: Lista de ejecuciones extraídas
        execution_count: Total de ejecuciones encontradas
        parse_successful: Si el parseo fue exitoso
        errors: Lista de errores encontrados durante el parseo
    """

    executions: list[GaussianExecutionData]
    execution_count: int
    parse_successful: bool
    errors: list[str]


# Type aliases para mejorar legibilidad
FilePath = str
LogContent = str
ExecutionID = int
