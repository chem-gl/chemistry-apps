"""routers/streaming.py: Generadores SSE para progreso y logs de jobs.

Funciones generadoras que producen eventos Server-Sent Events (SSE)
para streaming en tiempo real de progreso y logs de jobs científicos.
"""

from time import monotonic, sleep
from typing import Iterator

from ..definitions import SSE_POLL_INTERVAL_SECONDS
from ..models import ScientificJob, ScientificJobLogEvent
from ..types import JobLogEntry, JobProgressSnapshot
from .helpers import (
    build_job_log_entry,
    build_progress_snapshot,
    serialize_sse_log_event,
    serialize_sse_progress_event,
)


def stream_job_events(
    *,
    job_id: str,
    last_event_index: int,
    timeout_seconds: int,
) -> Iterator[str]:
    """Genera eventos SSE de progreso para un job hasta timeout o estado terminal."""
    started_at: float = monotonic()
    observed_event_index: int = last_event_index
    next_heartbeat_at: float = started_at + 10.0

    try:
        while (monotonic() - started_at) < float(timeout_seconds):
            refreshed_job: ScientificJob | None = ScientificJob.objects.filter(
                id=job_id
            ).first()

            if refreshed_job is None:
                yield (
                    "event: job.error\n"
                    'data: {"detail":"Job no encontrado durante stream"}\n\n'
                )
                return

            snapshot: JobProgressSnapshot = build_progress_snapshot(refreshed_job)
            if snapshot["progress_event_index"] > observed_event_index:
                yield serialize_sse_progress_event(snapshot)
                observed_event_index = snapshot["progress_event_index"]

                if snapshot["status"] in {"completed", "failed", "paused"}:
                    return

            now: float = monotonic()
            if now >= next_heartbeat_at:
                yield ": keep-alive\n\n"
                next_heartbeat_at = now + 10.0

            sleep(SSE_POLL_INTERVAL_SECONDS)

        if observed_event_index == last_event_index:
            final_job: ScientificJob | None = ScientificJob.objects.filter(
                id=job_id
            ).first()
            if final_job is not None:
                yield serialize_sse_progress_event(build_progress_snapshot(final_job))
    except (GeneratorExit, BrokenPipeError, ConnectionResetError):
        return


def stream_job_log_events(
    *,
    job_id: str,
    last_event_index: int,
    timeout_seconds: int,
) -> Iterator[str]:
    """Genera eventos SSE de logs de job hasta timeout o fin de ejecución."""
    started_at: float = monotonic()
    observed_event_index: int = last_event_index
    next_heartbeat_at: float = started_at + 10.0

    try:
        while (monotonic() - started_at) < float(timeout_seconds):
            refreshed_job: ScientificJob | None = ScientificJob.objects.filter(
                id=job_id
            ).first()

            if refreshed_job is None:
                yield (
                    "event: job.error\n"
                    'data: {"detail":"Job no encontrado durante stream"}\n\n'
                )
                return

            pending_events = ScientificJobLogEvent.objects.filter(
                job_id=job_id,
                event_index__gt=observed_event_index,
            ).order_by("event_index")

            for pending_event in pending_events:
                log_entry: JobLogEntry = build_job_log_entry(pending_event)
                yield serialize_sse_log_event(log_entry)
                observed_event_index = pending_event.event_index

            if refreshed_job.status in {"completed", "failed", "paused"}:
                return

            now: float = monotonic()
            if now >= next_heartbeat_at:
                yield ": keep-alive\n\n"
                next_heartbeat_at = now + 10.0

            sleep(SSE_POLL_INTERVAL_SECONDS)
    except (GeneratorExit, BrokenPipeError, ConnectionResetError):
        return
