"""definitions.py: Constantes de identidad y límites de la app Tunnel.

Objetivo del archivo:
- Centralizar constantes de integración de plugin, rutas API y validaciones.

Cómo se usa:
- `apps.py` registra estas constantes en `ScientificAppRegistry`.
- `urls.py` y `routers.py` consumen los prefijos sin hardcodear valores.
"""

from typing import Final

APP_CONFIG_NAME: Final[str] = "apps.tunnel"
APP_ROUTE_PREFIX: Final[str] = "tunnel/jobs"
APP_ROUTE_BASENAME: Final[str] = "tunnel-job"
APP_API_BASE_PATH: Final[str] = "/api/tunnel/jobs/"

PLUGIN_NAME: Final[str] = "tunnel-effect"
DEFAULT_ALGORITHM_VERSION: Final[str] = "2.0.0"

MAX_INPUT_CHANGE_EVENTS: Final[int] = 2000
