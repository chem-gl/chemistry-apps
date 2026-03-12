"""definitions.py: Constantes de integración de la app random_numbers.

Objetivo del archivo:
- Reunir todos los valores estáticos que definen identidad de app, rutas API,
  nombre del plugin y límites de validación.

Cómo se usa:
- `apps.py` consume constantes de registro en `ScientificAppRegistry`.
- `routers.py` y `urls.py` reutilizan prefijos/base paths sin hardcode.
- `schemas.py` usa límites máximos para validar payloads HTTP.
"""

from typing import Final

APP_CONFIG_NAME: Final[str] = "apps.random_numbers"
APP_ROUTE_PREFIX: Final[str] = "random-numbers/jobs"
APP_ROUTE_BASENAME: Final[str] = "random-number-job"
APP_API_BASE_PATH: Final[str] = "/api/random-numbers/jobs/"

PLUGIN_NAME: Final[str] = "random-numbers"
DEFAULT_ALGORITHM_VERSION: Final[str] = "1.0.0"
MAX_TOTAL_NUMBERS: Final[int] = 1000
MAX_INTERVAL_SECONDS: Final[int] = 3600
MAX_NUMBERS_PER_BATCH: Final[int] = 500
