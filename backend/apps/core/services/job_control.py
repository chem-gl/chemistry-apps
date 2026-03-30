"""services/job_control.py: Acciones de control de ciclo de vida del job.

Funciones para solicitar pausa, cancelar y reanudar jobs, manejando
las transiciones de estado válidas y la publicación de eventos.
"""

from __future__ import annotations

import logging

from django.utils import timezone

from ..models import ScientificJob
from ..ports import JobLogPublisherPort, JobProgressPublisherPort, JobProgressUpdate
from ..realtime import broadcast_job_update
from .log_helpers import publish_job_log

logger = logging.getLogger(__name__)


def request_pause(
    job_id: str,
    *,
    job: ScientificJob,
    progress_publisher: JobProgressPublisherPort,
    log_publisher: JobLogPublisherPort,
) -> ScientificJob:
    """Solicita pausa cooperativa para un job o lo pausa de inmediato si está pending."""
    if not bool(job.supports_pause_resume):
        raise ValueError("El plugin de este job no soporta pausa/reanudación.")

    if job.status in {"completed", "failed"}:
        raise ValueError("No es posible pausar un job finalizado.")

    if job.status == "paused":
        return job

    if job.status == "pending":
        job.status = "paused"
        job.pause_requested = False
        job.progress_stage = "paused"
        job.progress_message = "Job pausado antes de iniciar ejecución."
        job.paused_at = timezone.now()
        job.save(
            update_fields=[
                "status",
                "pause_requested",
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
                message="Job pausado antes de iniciar ejecución.",
            ),
        )
        publish_job_log(
            job,
            level="warning",
            source="core.control",
            message="Job pausado manualmente en estado pending.",
            log_publisher=log_publisher,
        )
        return job

    job.pause_requested = True
    job.progress_message = "Pausa solicitada. Esperando confirmación cooperativa."
    job.save(update_fields=["pause_requested", "progress_message", "updated_at"])
    broadcast_job_update(job)
    publish_job_log(
        job,
        level="warning",
        source="core.control",
        message="Solicitud de pausa registrada para el job en ejecución.",
        log_publisher=log_publisher,
    )
    return job


def cancel_job(
    job_id: str,
    *,
    job: ScientificJob,
    progress_publisher: JobProgressPublisherPort,
    log_publisher: JobLogPublisherPort,
) -> ScientificJob:
    """Cancela un job de forma irreversible desde cualquier estado activo.

    Solo cancela jobs en estado pending/running/paused. Los jobs en estado
    completed, failed o cancelled no se pueden cancelar.
    """
    if job.status in {"completed", "failed", "cancelled"}:
        raise ValueError(
            "No es posible cancelar un job en estado terminal "
            f"(estado actual: {job.status})."
        )

    previous_status: str = str(job.status)
    job.status = "cancelled"
    job.pause_requested = False
    job.progress_percentage = 100
    job.progress_stage = "cancelled"
    job.progress_message = "Job cancelado por el usuario. Operación irreversible."
    job.save(
        update_fields=[
            "status",
            "pause_requested",
            "progress_percentage",
            "progress_stage",
            "progress_message",
            "updated_at",
        ]
    )
    broadcast_job_update(job)
    progress_publisher.publish(
        job,
        JobProgressUpdate(
            percentage=100,
            stage="cancelled",
            message="Job cancelado por el usuario. Operación irreversible.",
        ),
    )
    publish_job_log(
        job,
        level="warning",
        source="core.control",
        message="Job cancelado manualmente por el usuario.",
        payload={"previous_status": previous_status},
        log_publisher=log_publisher,
    )
    logger.info("Job %s cancelado manualmente.", job_id)
    return job


def resume_job(
    job_id: str,
    *,
    job: ScientificJob,
    progress_publisher: JobProgressPublisherPort,
    log_publisher: JobLogPublisherPort,
) -> ScientificJob:
    """Reanuda un job pausado dejándolo listo para reencolado."""
    if not bool(job.supports_pause_resume):
        raise ValueError("El plugin de este job no soporta pausa/reanudación.")

    if job.status == "cancelled":
        raise ValueError("No es posible reanudar un job cancelado.")

    if job.status != "paused":
        raise ValueError("Solo se pueden reanudar jobs en estado paused.")

    job.status = "pending"
    job.pause_requested = False
    job.progress_stage = "queued"
    job.progress_message = "Reanudación solicitada. Preparando reencolado del job."
    job.resumed_at = timezone.now()
    job.last_heartbeat_at = timezone.now()
    job.save(
        update_fields=[
            "status",
            "pause_requested",
            "progress_stage",
            "progress_message",
            "resumed_at",
            "last_heartbeat_at",
            "updated_at",
        ]
    )
    broadcast_job_update(job)
    publish_job_log(
        job,
        level="info",
        source="core.control",
        message="Job marcado como pending para reanudar ejecución.",
        log_publisher=log_publisher,
    )
    return job
