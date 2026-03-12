"""
# gaussian_log_parser/__init__.py

Centro de exportación de la librería de parseo de logs Gaussian.
Facilita importaciones limpias y uso del módulo.

Uso:
    from libs.gaussian_log_parser import GaussianLogParser, GaussianExecution

    parser = GaussianLogParser()
    result = parser.parse_file("archivo.log")
"""

from .models import GaussianExecution, GaussianLogParserResult
from .parsers import GaussianLogParser
from .types import GaussianAttributeValue, GaussianExecutionData, GaussianLogResult

__all__ = [
    "GaussianLogParser",
    "GaussianExecution",
    "GaussianLogParserResult",
    "GaussianAttributeValue",
    "GaussianExecutionData",
    "GaussianLogResult",
]

__version__ = "1.0.0"
