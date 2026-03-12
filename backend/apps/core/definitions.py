"""definitions.py: Constantes globales del dominio core para rutas y estados.

Objetivo del archivo:
- Centralizar contratos estáticos compartidos por routers, serializers,
    consumers y documentación OpenAPI/SSE.

Cómo se usa:
- `routers.py` consume prefijos/sufijos para construir endpoints consistentes.
- `routing.py` utiliza `CORE_JOBS_WEBSOCKET_ROUTE_PATH` para WebSocket.
- Validaciones de filtros y etapas de progreso reutilizan las tuplas `ALLOWED_*`
    para evitar duplicar literales en múltiples módulos.
"""

from typing import Final

CORE_JOBS_ROUTE_PREFIX: Final[str] = "jobs"
CORE_JOBS_ROUTE_BASENAME: Final[str] = "job"
CORE_JOBS_API_BASE_PATH: Final[str] = "/api/jobs/"
CORE_JOBS_PROGRESS_ROUTE_SUFFIX: Final[str] = "progress"
CORE_JOBS_EVENTS_ROUTE_SUFFIX: Final[str] = "events"
CORE_JOBS_LOGS_ROUTE_SUFFIX: Final[str] = "logs"
CORE_JOBS_LOGS_EVENTS_ROUTE_SUFFIX: Final[str] = "logs/events"
CORE_JOBS_PAUSE_ROUTE_SUFFIX: Final[str] = "pause"
CORE_JOBS_RESUME_ROUTE_SUFFIX: Final[str] = "resume"
CORE_JOBS_WEBSOCKET_ROUTE_PATH: Final[str] = "ws/jobs/stream/"

ALLOWED_JOB_STATUS_FILTERS: Final[tuple[str, ...]] = (
    "pending",
    "running",
    "paused",
    "completed",
    "failed",
)

ALLOWED_JOB_PROGRESS_STAGES: Final[tuple[str, ...]] = (
    "pending",
    "queued",
    "running",
    "paused",
    "recovering",
    "caching",
    "completed",
    "failed",
)

DEFAULT_SSE_TIMEOUT_SECONDS: Final[int] = 30
MAX_SSE_TIMEOUT_SECONDS: Final[int] = 120
SSE_POLL_INTERVAL_SECONDS: Final[float] = 0.5
