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
DEFAULT_ALGORITHM_VERSION: Final[str] = "2.0.0"

# --- Políticas de asignación por bloques ---
SITE_OVERLAP_POLICY_LAST_BLOCK_WINS: Final[str] = "last_block_wins"
SITE_OVERLAP_POLICY_CHOICES: Final[tuple[str, ...]] = (
    SITE_OVERLAP_POLICY_LAST_BLOCK_WINS,
)
MAX_ASSIGNMENT_BLOCKS: Final[int] = 30
MAX_CATEGORIES_PER_BLOCK: Final[int] = 12
MAX_SUBSTITUENT_REFS_PER_BLOCK: Final[int] = 120
MAX_MANUAL_SUBSTITUENTS_PER_BLOCK: Final[int] = 120

# --- Límites de seguridad combinatoria ---
MAX_R_SUBSTITUTES: Final[int] = 10
MAX_SUBSTITUENTS_IN_LIST: Final[int] = 50
MAX_SELECTED_ATOMS: Final[int] = 20
MAX_NUM_BONDS: Final[int] = 3
DEFAULT_EXPORT_PADDING: Final[int] = 5
MIN_EXPORT_PADDING: Final[int] = 3
MAX_EXPORT_PADDING: Final[int] = 9

# --- Catálogo y patrones persistentes ---
MAX_SUBSTITUENT_NAME_LENGTH: Final[int] = 120
MAX_SUBSTITUENT_SMILES_LENGTH: Final[int] = 2000
MAX_PATTERN_SMARTS_LENGTH: Final[int] = 2000
MAX_PATTERN_CAPTION_LENGTH: Final[int] = 300
MAX_PATTERN_NAME_LENGTH: Final[int] = 140

# --- Dimensiones de imagen PNG ---
IMAGE_WIDTH: Final[int] = 400
IMAGE_HEIGHT: Final[int] = 400
