"""definitions.py: Constantes de integración de la app smileit.

Objetivo del archivo:
- Reunir todos los valores estáticos que definen identidad de app, rutas API,
  nombre del plugin y límites de seguridad para la generación combinatoria.

Cómo se usa:
- `apps.py` consume constantes de registro en `ScientificAppRegistry`.
- `routers.py` y `urls.py` reutilizan prefijos/base paths sin hardcode.
- `schemas.py` y `plugin.py` usan los límites para validación y control de explosión.
"""

from typing import Final

# --- Identidad de la app ---
APP_CONFIG_NAME: Final[str] = "apps.smileit"
APP_ROUTE_PREFIX: Final[str] = "smileit/jobs"
APP_ROUTE_BASENAME: Final[str] = "smileit-job"
APP_API_BASE_PATH: Final[str] = "/api/smileit/jobs/"

# --- Plugin ---
PLUGIN_NAME: Final[str] = "smileit"
DEFAULT_ALGORITHM_VERSION: Final[str] = "1.0.0"

# --- Límites de seguridad combinatoria ---
MAX_GENERATED_STRUCTURES: Final[int] = 5000
MAX_R_SUBSTITUTES: Final[int] = 10
MAX_SUBSTITUENTS_IN_LIST: Final[int] = 50
MAX_SELECTED_ATOMS: Final[int] = 20
MAX_NUM_BONDS: Final[int] = 3

# --- Dimensiones de imagen PNG ---
IMAGE_WIDTH: Final[int] = 400
IMAGE_HEIGHT: Final[int] = 400
