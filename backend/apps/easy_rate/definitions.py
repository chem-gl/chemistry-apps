"""definitions.py: Constantes de identidad y contrato para la app Easy-rate.

Objetivo del archivo:
- Centralizar rutas, nombre de plugin y valores por defecto para integración
  consistente con el core desacoplado.

Cómo se usa:
- `apps.py` registra esta definición en `ScientificAppRegistry`.
- `routers.py` reutiliza prefijos sin hardcodear.
"""

from typing import Final

APP_CONFIG_NAME: Final[str] = "apps.easy_rate"
APP_ROUTE_PREFIX: Final[str] = "easy-rate/jobs"
APP_ROUTE_BASENAME: Final[str] = "easy-rate-job"
APP_API_BASE_PATH: Final[str] = "/api/easy-rate/jobs/"

PLUGIN_NAME: Final[str] = "easy-rate"
DEFAULT_ALGORITHM_VERSION: Final[str] = "2.0.0"

SOLVENT_CHOICES: Final[tuple[str, ...]] = (
    "",
    "Benzene",
    "Gas phase (Air)",
    "Pentyl ethanoate",
    "Water",
    "Other",
)
