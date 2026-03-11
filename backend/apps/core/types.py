"""types.py: Tipos compartidos para tipado estricto del dominio cientifico."""

from __future__ import annotations

from typing import Literal, TypeAlias, TypedDict

JSONPrimitive: TypeAlias = str | int | float | bool | None
JSONValue: TypeAlias = JSONPrimitive | list["JSONValue"] | dict[str, "JSONValue"]
JSONMap: TypeAlias = dict[str, JSONValue]
JobStatus: TypeAlias = Literal["pending", "running", "completed", "failed"]
JobProgressStage: TypeAlias = Literal[
    "pending",
    "queued",
    "running",
    "caching",
    "completed",
    "failed",
]


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
