"""definitions.py: Constantes de identidad y límites para molar_fractions.

Objetivo del archivo:
- Centralizar constantes de integración para ruta API, plugin y validaciones.

Cómo se usa:
- `apps.py` registra estas constantes en `ScientificAppRegistry`.
- `routers.py` y `config/urls.py` reutilizan prefijos sin hardcode.
- `schemas.py` valida tamaños y límites de cálculo.
"""

from typing import Final

APP_CONFIG_NAME: Final[str] = "apps.molar_fractions"
APP_ROUTE_PREFIX: Final[str] = "molar-fractions/jobs"
APP_ROUTE_BASENAME: Final[str] = "molar-fractions-job"
APP_API_BASE_PATH: Final[str] = "/api/molar-fractions/jobs/"

PLUGIN_NAME: Final[str] = "molar-fractions"
DEFAULT_ALGORITHM_VERSION: Final[str] = "1.0.0"
DEFAULT_LABEL: Final[str] = "A"
DEFAULT_INITIAL_CHARGE: Final[str] = "q"

MAX_PKA_VALUES: Final[int] = 6
MIN_PKA_VALUES: Final[int] = 1
MIN_PH_STEP: Final[float] = 0.05
MIN_PH_RANGE_POINTS: Final[int] = 8
MAX_PH_POINTS: Final[int] = 350
DEFAULT_SINGLE_PH_STEP: Final[float] = 0.1
