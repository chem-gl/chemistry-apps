"""routers/helpers.py: Funciones auxiliares y renderer SSE para endpoints de jobs.

Incluye serialización SSE de progreso y logs, parseo seguro de query params,
y el renderer DRF para negociación de contenido text/event-stream.
"""

import json
from typing import cast

from rest_framework.renderers import BaseRenderer

from ..definitions import DEFAULT_SSE_TIMEOUT_SECONDS, MAX_SSE_TIMEOUT_SECONDS
from ..models import ScientificJob, ScientificJobLogEvent
from ..types import (
    JobLogEntry,
    JobLogLevel,
    JobProgressSnapshot,
    JobProgressStage,
    JobStatus,
    JSONMap,
)

SSE_MEDIA_TYPE = "text/event-stream"


class ServerSentEventsRenderer(BaseRenderer):
    """Renderer DRF para habilitar negociación de contenido text/event-stream.

    El método render() gestiona respuestas no-streaming (ej. errores 404/500)
    que DRF intenta renderizar con este renderer cuando está en renderer_classes.
    """

    media_type = SSE_MEDIA_TYPE
    format = "sse"
    charset = None

    def render(
        self,
        data: object,
        accepted_media_type: str | None = None,  # noqa: ARG002
        renderer_context: dict | None = None,  # noqa: ARG002
    ) -> bytes:
        """Serializa a JSON bytes respuestas no-streaming (ej. error 404)."""
        if data is None:
            return b""
        return json.dumps(data, ensure_ascii=True).encode("utf-8")


def build_progress_snapshot(job: ScientificJob) -> JobProgressSnapshot:
    """Construye snapshot tipado y serializable del estado de progreso actual."""
    return {
        "job_id": str(job.id),
        "status": cast(JobStatus, job.status),
        "progress_percentage": int(job.progress_percentage),
        "progress_stage": cast(JobProgressStage, job.progress_stage),
        "progress_message": str(job.progress_message),
        "progress_event_index": int(job.progress_event_index),
        "updated_at": job.updated_at.isoformat().replace("+00:00", "Z"),
    }


def serialize_sse_progress_event(snapshot: JobProgressSnapshot) -> str:
    """Serializa snapshot a formato Server-Sent Events (SSE)."""
    payload: str = json.dumps(snapshot, ensure_ascii=True, separators=(",", ":"))
    return (
        f"id: {snapshot['progress_event_index']}\n"
        "event: job.progress\n"
        f"data: {payload}\n\n"
    )


def build_job_log_entry(log_event: ScientificJobLogEvent) -> JobLogEntry:
    """Construye contrato tipado de evento de log por job."""
    return {
        "job_id": str(log_event.job_id),
        "event_index": int(log_event.event_index),
        "level": cast(JobLogLevel, log_event.level),
        "source": str(log_event.source),
        "message": str(log_event.message),
        "payload": cast(JSONMap, log_event.payload),
        "created_at": log_event.created_at.isoformat().replace("+00:00", "Z"),
    }


def serialize_sse_log_event(log_entry: JobLogEntry) -> str:
    """Serializa evento de log al formato SSE para consumo en tiempo real."""
    payload: str = json.dumps(log_entry, ensure_ascii=True, separators=(",", ":"))
    return f"id: {log_entry['event_index']}\nevent: job.log\ndata: {payload}\n\n"


def parse_timeout_seconds(raw_timeout_seconds: str | None) -> int:
    """Normaliza timeout de stream SSE dentro de un rango seguro."""
    if raw_timeout_seconds is None:
        return DEFAULT_SSE_TIMEOUT_SECONDS

    try:
        parsed_timeout_seconds: int = int(raw_timeout_seconds)
    except ValueError:
        return DEFAULT_SSE_TIMEOUT_SECONDS

    if parsed_timeout_seconds < 1:
        return 1
    if parsed_timeout_seconds > MAX_SSE_TIMEOUT_SECONDS:
        return MAX_SSE_TIMEOUT_SECONDS
    return parsed_timeout_seconds


def parse_non_negative_int(raw_value: str | None, default_value: int) -> int:
    """Normaliza query params enteros no negativos con fallback seguro."""
    if raw_value is None:
        return default_value

    try:
        parsed_value: int = int(raw_value)
    except ValueError:
        return default_value

    if parsed_value < 0:
        return default_value
    return parsed_value
