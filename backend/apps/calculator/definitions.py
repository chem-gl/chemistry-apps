"""definitions.py: Constantes reutilizables de la plantilla de calculadora."""

from typing import Final

APP_CONFIG_NAME: Final[str] = "apps.calculator"
APP_ROUTE_PREFIX: Final[str] = "calculator/jobs"
APP_ROUTE_BASENAME: Final[str] = "calculator-job"
APP_API_BASE_PATH: Final[str] = "/api/calculator/jobs/"

PLUGIN_NAME: Final[str] = "calculator"
DEFAULT_ALGORITHM_VERSION: Final[str] = "1.0"
SUPPORTED_OPERATIONS: Final[frozenset[str]] = frozenset(
    {"add", "sub", "mul", "div", "pow", "factorial"}
)
