"""definitions.py: Constantes reutilizables de la plantilla de calculadora.

Estas constantes representan el contrato de integración con `apps.core`.

Uso esperado:
- `APP_*` define cómo se enruta esta app dentro de la API global.
- `PLUGIN_NAME` define la llave usada por `PluginRegistry` para ejecutar
    operaciones.
- `SUPPORTED_OPERATIONS` define qué operaciones acepta el plugin y, por tanto,
    qué valores deben exponer serializers, tipos y pruebas.
"""

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


def validate_factorial_operand(value: float) -> None:
    """Valida que el operando para factorial sea un entero no negativo.

    Lanza ValueError si no cumple.
    """
    if value < 0 or not value.is_integer():
        raise ValueError("La operación factorial requiere un entero no negativo en a.")
