"""definitions.py: Constantes globales del dominio core para rutas y estados."""

from typing import Final

CORE_JOBS_ROUTE_PREFIX: Final[str] = "jobs"
CORE_JOBS_ROUTE_BASENAME: Final[str] = "job"
CORE_JOBS_API_BASE_PATH: Final[str] = "/api/jobs/"

ALLOWED_JOB_STATUS_FILTERS: Final[tuple[str, ...]] = (
    "pending",
    "running",
    "completed",
    "failed",
)
