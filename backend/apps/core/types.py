"""types.py: Tipos compartidos para tipado estricto del dominio cientifico."""

from __future__ import annotations

from collections.abc import Callable
from typing import Literal, TypeAlias, TypedDict

JSONPrimitive: TypeAlias = str | int | float | bool | None
JSONValue: TypeAlias = JSONPrimitive | list["JSONValue"] | dict[str, "JSONValue"]
JSONMap: TypeAlias = dict[str, JSONValue]
JobStatus: TypeAlias = Literal["pending", "running", "completed", "failed"]
JobProgressStage: TypeAlias = Literal[
    "pending",
    "queued",
    "running",
    "recovering",
    "caching",
    "completed",
    "failed",
]
PluginProgressCallback: TypeAlias = Callable[[int, JobProgressStage, str], None]
JobLogLevel: TypeAlias = Literal["debug", "info", "warning", "error"]
PluginLogCallback: TypeAlias = Callable[[JobLogLevel, str, str, JSONMap | None], None]


class JobCreatePayload(TypedDict):
    """Estructura tipada para crear un ScientificJob desde capa API."""

    plugin_name: str
    version: str
    parameters: JSONMap


class JobProgressSnapshot(TypedDict):
    """Snapshot tipado del progreso de un job para API y SSE."""

    job_id: str
    status: JobStatus
    progress_percentage: int
    progress_stage: JobProgressStage
    progress_message: str
    progress_event_index: int
    updated_at: str


class JobLogEntry(TypedDict):
    """Evento tipado de logging en tiempo real por job."""

    job_id: str
    event_index: int
    level: JobLogLevel
    source: str
    message: str
    payload: JSONMap
    created_at: str


class JobLogListResponse(TypedDict):
    """Respuesta tipada para listado paginado de logs por job."""

    job_id: str
    count: int
    next_after_event_index: int
    results: list[JobLogEntry]


class JobRecoverySummary(TypedDict):
    """Resumen tipado de ejecución de recuperación activa de jobs."""

    stale_running_detected: int
    stale_pending_detected: int
    requeued_successfully: int
    requeue_failed: int
    marked_failed_by_retries: int
