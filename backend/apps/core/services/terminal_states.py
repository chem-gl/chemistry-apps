"""services/terminal_states.py: Transiciones a estados terminales de un job.

Funciones que finalizan un job con resultado exitoso, pausa cooperativa
o error, persistiendo el estado y publicando eventos de progreso y log.
"""

from __future__ import annotations

import logging

from django.utils import timezone

from ..models import ScientificJob
from ..ports import JobLogPublisherPort, JobProgressPublisherPort, JobProgressUpdate
from ..types import JSONMap
from .log_helpers import publish_job_log

logger = logging.getLogger(__name__)


def finish_with_result(
    *,
    job: ScientificJob,
    job_id: str,
    result_payload: JSONMap,
    from_cache: bool,
    progress_publisher: JobProgressPublisherPort,
    log_publisher: JobLogPublisherPort,
) -> None:
    """Finaliza un job exitosamente y publica evento terminal de progreso."""
    completion_message: str = (
        "Resultado obtenido desde caché durante la ejecución."
        if from_cache
        else "Job completado correctamente."
    )

    job.status = "completed"
    job.results = result_payload
    job.cache_hit = from_cache
    job.cache_miss = not from_cache
    job.error_trace = None
    job.pause_requested = False
    job.runtime_state = {}
    job.progress_percentage = 100
    job.progress_stage = "completed"
    job.progress_message = completion_message
    job.save(
        update_fields=[
            "status",
            "results",
            "cache_hit",
            "cache_miss",
            "error_trace",
            "pause_requested",
            "runtime_state",
            "progress_percentage",
            "progress_stage",
            "progress_message",
            "updated_at",
        ]
    )
    progress_publisher.publish(
        job,
        JobProgressUpdate(
            percentage=100,
            stage="completed",
            message=completion_message,
        ),
    )
    publish_job_log(
        job,
        level="info",
        source="core.runtime",
        message="Job completado correctamente.",
        payload={"from_cache": from_cache},
        log_publisher=log_publisher,
    )
    logger.info("Ejecución completada para job %s", job_id)


def finish_with_pause(
    *,
    job: ScientificJob,
    job_id: str,
    pause_message: str,
    checkpoint: JSONMap | None,
    progress_publisher: JobProgressPublisherPort,
    log_publisher: JobLogPublisherPort,
) -> None:
    """Finaliza transición a paused conservando estado para reanudación."""
    checkpoint_payload: JSONMap = checkpoint if checkpoint is not None else {}

    job.status = "paused"
    job.pause_requested = False
    job.runtime_state = checkpoint_payload
    job.progress_stage = "paused"
    job.progress_message = pause_message
    job.paused_at = timezone.now()
    job.save(
        update_fields=[
            "status",
            "pause_requested",
            "runtime_state",
            "progress_stage",
            "progress_message",
            "paused_at",
            "updated_at",
        ]
    )

    progress_publisher.publish(
        job,
        JobProgressUpdate(
            percentage=int(job.progress_percentage),
            stage="paused",
            message=pause_message,
        ),
    )
    publish_job_log(
        job,
        level="warning",
        source="core.control",
        message="Job pausado cooperativamente con estado persistido.",
        payload={"runtime_state_keys": list(checkpoint_payload.keys())},
        log_publisher=log_publisher,
    )
    logger.info("Ejecución pausada para job %s", job_id)


def finish_with_failure(
    *,
    job: ScientificJob,
    job_id: str,
    error_message: str,
    progress_publisher: JobProgressPublisherPort,
    log_publisher: JobLogPublisherPort,
) -> None:
    """Finaliza un job con error manejado y deja trazabilidad para soporte."""
    job.status = "failed"
    job.results = None
    job.error_trace = error_message
    job.pause_requested = False
    job.progress_percentage = 100
    job.progress_stage = "failed"
    job.progress_message = "Job finalizado con error. Revisar error_trace."
    job.save(
        update_fields=[
            "status",
            "results",
            "error_trace",
            "pause_requested",
            "progress_percentage",
            "progress_stage",
            "progress_message",
            "updated_at",
        ]
    )

    progress_publisher.publish(
        job,
        JobProgressUpdate(
            percentage=100,
            stage="failed",
            message="Job finalizado con error. Revisar error_trace.",
        ),
    )
    publish_job_log(
        job,
        level="error",
        source="core.runtime",
        message="Job finalizado con error.",
        payload={"error": error_message},
        log_publisher=log_publisher,
    )
    logger.error("Ejecución fallida para job %s: %s", job_id, error_message)
