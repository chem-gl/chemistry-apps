"""definitions.py: Constantes de integración para la app CADMA Py.

Centraliza la identidad pública de la app, su plugin y los nombres de métricas
usados por el motor de selección inspirado en el protocolo legado de CADMA.
"""

from typing import Final

APP_CONFIG_NAME: Final[str] = "apps.cadma_py"
APP_ROUTE_PREFIX: Final[str] = "cadma-py/jobs"
APP_ROUTE_BASENAME: Final[str] = "cadma-py-job"
APP_API_BASE_PATH: Final[str] = "/api/cadma-py/jobs/"

PLUGIN_NAME: Final[str] = "cadma-py"
DEFAULT_ALGORITHM_VERSION: Final[str] = "1.0.0"

ADME_METRIC_NAMES: Final[tuple[str, ...]] = (
    "MW",
    "logP",
    "MR",
    "AtX",
    "HBLA",
    "HBLD",
    "RB",
    "PSA",
)
TOXICITY_METRIC_NAMES: Final[tuple[str, ...]] = ("DT", "M", "LD50")
OPTIONAL_METRIC_NAMES: Final[tuple[str, ...]] = ("SA",)
ALL_METRIC_NAMES: Final[tuple[str, ...]] = (
    *ADME_METRIC_NAMES,
    *TOXICITY_METRIC_NAMES,
    *OPTIONAL_METRIC_NAMES,
)

ROOT_SAMPLE_SOURCE_REFERENCE: Final[str] = "root"
# En el CADMA.py original, la línea de referencia visible para S_S se dibuja en 1.0.
DEFAULT_SCORE_REFERENCE_LINE: Final[float] = 1.0
