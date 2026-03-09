"""definitions.py: Constantes reutilizables de la plantilla de calculadora."""

from typing import Final

PLUGIN_NAME: Final[str] = "calculator"
DEFAULT_ALGORITHM_VERSION: Final[str] = "1.0"
SUPPORTED_OPERATIONS: Final[frozenset[str]] = frozenset({"add", "sub", "mul", "div"})
