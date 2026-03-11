"""definitions.py: Constantes de integración de la app random_numbers."""

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
