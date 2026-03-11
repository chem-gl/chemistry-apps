"""definitions.py: Constantes globales del dominio core para rutas y estados."""

from typing import Final

CORE_JOBS_ROUTE_PREFIX: Final[str] = "jobs"
CORE_JOBS_ROUTE_BASENAME: Final[str] = "job"
CORE_JOBS_API_BASE_PATH: Final[str] = "/api/jobs/"
CORE_JOBS_PROGRESS_ROUTE_SUFFIX: Final[str] = "progress"
CORE_JOBS_EVENTS_ROUTE_SUFFIX: Final[str] = "events"

ALLOWED_JOB_STATUS_FILTERS: Final[tuple[str, ...]] = (
    "pending",
    "running",
    "completed",
    "failed",
)

ALLOWED_JOB_PROGRESS_STAGES: Final[tuple[str, ...]] = (
    "pending",
    "queued",
    "running",
    "caching",
    "completed",
    "failed",
)

DEFAULT_SSE_TIMEOUT_SECONDS: Final[int] = 30
MAX_SSE_TIMEOUT_SECONDS: Final[int] = 120
SSE_POLL_INTERVAL_SECONDS: Final[float] = 0.5
