"""definitions.py: Constantes de identidad para la app Marcus.

Objetivo del archivo:
- Centralizar rutas API, nombre de plugin y versión por defecto.
"""

from typing import Final

APP_CONFIG_NAME: Final[str] = "apps.marcus"
APP_ROUTE_PREFIX: Final[str] = "marcus/jobs"
APP_ROUTE_BASENAME: Final[str] = "marcus-job"
APP_API_BASE_PATH: Final[str] = "/api/marcus/jobs/"

PLUGIN_NAME: Final[str] = "marcus-kinetics"
DEFAULT_ALGORITHM_VERSION: Final[str] = "1.0.0"
