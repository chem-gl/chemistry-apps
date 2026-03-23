"""definitions.py: Constantes de integración de la app SA Score.

Objetivo del archivo:
- Reunir todos los valores estáticos que definen identidad de app, rutas API,
  nombre del plugin y métodos de SA score soportados.

Cómo se usa:
- `apps.py` consume constantes de registro en `ScientificAppRegistry`.
- `routers.py` y `urls.py` reutilizan prefijos/base paths sin hardcode.
- `plugin.py` usa SA_SCORE_METHODS para validar métodos solicitados.
"""

from typing import Final

# --- Identidad de la app ---
APP_CONFIG_NAME: Final[str] = "apps.sa_score"
APP_ROUTE_PREFIX: Final[str] = "sa-score/jobs"
APP_ROUTE_BASENAME: Final[str] = "sa-score-job"
APP_API_BASE_PATH: Final[str] = "/api/sa-score/jobs/"

# --- Plugin ---
PLUGIN_NAME: Final[str] = "sa-score"
DEFAULT_ALGORITHM_VERSION: Final[str] = "1.0.0"

# --- Métodos de SA score disponibles ---
SA_SCORE_METHOD_AMBIT: Final[str] = "ambit"
SA_SCORE_METHOD_BRSA: Final[str] = "brsa"
SA_SCORE_METHOD_RDKIT: Final[str] = "rdkit"
SA_SCORE_METHODS: Final[tuple[str, ...]] = (
    SA_SCORE_METHOD_AMBIT,
    SA_SCORE_METHOD_BRSA,
    SA_SCORE_METHOD_RDKIT,
)

# --- Límites de seguridad ---
MAX_SMILES_PER_JOB: Final[int] = 500
