"""services/recovery.py: Recuperación activa de jobs huérfanos.

Detecta jobs potencialmente abandonados (stale) y reintenta su ejecución
o los marca como fallidos si exceden el límite de reintentos.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import timedelta

from django.utils import timezone

from ..models import ScientificJob
from ..ports import JobLogPublisherPort, JobProgressPublisherPort, JobProgressUpdate
from ..types import JobRecoverySummary
from .log_helpers import publish_job_log
from .terminal_states import finish_with_failure


def run_active_recovery(
    *,
    dispatch_callback: Callable[[str], bool],
    stale_seconds: int,
    include_pending_jobs: bool,
    exclude_job_id: str | None = None,
    progress_publisher: JobProgressPublisherPort,
    log_publisher: JobLogPublisherPort,
    register_dispatch_fn: Callable[[str, bool], None],
) -> JobRecoverySummary:
    """Detecta jobs potencialmente huérfanos y reintenta su ejecución."""
    now_value = timezone.now()
    stale_threshold = now_value - timedelta(seconds=max(5, stale_seconds))
    summary: JobRecoverySummary = {
        "stale_running_detected": 0,
        "stale_pending_detected": 0,
        "requeued_successfully": 0,
        "requeue_failed": 0,
        "marked_failed_by_retries": 0,
    }

    stale_running_jobs = ScientificJob.objects.filter(
        status="running",
        updated_at__lt=stale_threshold,
    ).order_by("created_at")

    pending_queryset = ScientificJob.objects.none()
    if include_pending_jobs:
        pending_queryset = ScientificJob.objects.filter(
            status="pending",
            updated_at__lt=stale_threshold,
        ).order_by("created_at")

    candidate_jobs: list[ScientificJob] = list(stale_running_jobs) + list(
        pending_queryset
    )

    seen_job_ids: set[str] = set()
    for job in candidate_jobs:
        normalized_job_id: str = str(job.id)
        if normalized_job_id in seen_job_ids:
            continue
        seen_job_ids.add(normalized_job_id)

        if exclude_job_id is not None and normalized_job_id == exclude_job_id:
            continue

        if job.status == "running":
            summary["stale_running_detected"] += 1
        else:
            summary["stale_pending_detected"] += 1

        if int(job.recovery_attempts) >= int(job.max_recovery_attempts):
            finish_with_failure(
                job=job,
                job_id=normalized_job_id,
                error_message=(
                    "Límite de recuperación automática alcanzado tras caída o "
                    "estado inconsistente."
                ),
                progress_publisher=progress_publisher,
                log_publisher=log_publisher,
            )
            summary["marked_failed_by_retries"] += 1
            publish_job_log(
                job,
                level="error",
                source="core.recovery",
                message="Job marcado como failed por exceder reintentos de recuperación.",
                payload={
                    "recovery_attempts": int(job.recovery_attempts),
                    "max_recovery_attempts": int(job.max_recovery_attempts),
                },
                log_publisher=log_publisher,
            )
            continue

        job.status = "pending"
        job.recovery_attempts = int(job.recovery_attempts) + 1
        job.last_recovered_at = now_value
        job.last_heartbeat_at = now_value
        job.save(
            update_fields=[
                "status",
                "recovery_attempts",
                "last_recovered_at",
                "last_heartbeat_at",
                "updated_at",
            ]
        )

        progress_publisher.publish(
            job,
            JobProgressUpdate(
                percentage=max(10, int(job.progress_percentage)),
                stage="recovering",
                message=(
                    "Recuperación activa detectó job interrumpido y está "
                    "reencolando la ejecución."
                ),
            ),
        )
        publish_job_log(
            job,
            level="warning",
            source="core.recovery",
            message="Job marcado para recuperación activa y reencolado.",
            payload={
                "recovery_attempt": int(job.recovery_attempts),
                "stale_threshold_seconds": int(stale_seconds),
            },
            log_publisher=log_publisher,
        )

        was_dispatched: bool = dispatch_callback(normalized_job_id)
        register_dispatch_fn(normalized_job_id, was_dispatched)
        if was_dispatched:
            summary["requeued_successfully"] += 1
        else:
            summary["requeue_failed"] += 1

    return summary
