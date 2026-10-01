"""definitions.py: Constantes de identidad y rutas de la app Server Calc.

Objetivo del archivo:
- Centralizar constantes de integración de plugin, rutas API y versión.

Cómo se usa:
- `apps.py` registra estas constantes en `ScientificAppRegistry`.
- `urls.py` y `routers.py` consumen los prefijos sin hardcodear valores.
"""

from typing import Final

APP_CONFIG_NAME: Final[str] = "apps.server_calc"
APP_ROUTE_PREFIX: Final[str] = "server-calc/jobs"
APP_ROUTE_BASENAME: Final[str] = "server-calc-job"
APP_API_BASE_PATH: Final[str] = "/api/server-calc/jobs/"

PLUGIN_NAME: Final[str] = "server-calc"
DEFAULT_ALGORITHM_VERSION: Final[str] = "1.2.0"
