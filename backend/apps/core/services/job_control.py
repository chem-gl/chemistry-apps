"""services/job_control.py: Acciones de control de ciclo de vida del job.

Funciones para solicitar pausa, cancelar y reanudar jobs, manejando
las transiciones de estado válidas y la publicación de eventos.
"""

from __future__ import annotations

import logging
from datetime import timedelta

from django.contrib.auth.models import AbstractUser
from django.utils import timezone

from ..identity.services import AuthorizationService
from ..models import ScientificJob
from ..ports import JobLogPublisherPort, JobProgressPublisherPort, JobProgressUpdate
from ..realtime import broadcast_job_update
from ..types import JobDeleteResult
from .log_helpers import publish_job_log

logger = logging.getLogger(__name__)
CONTROL_LOG_SOURCE = "core.control"
PAUSED_PENDING_MESSAGE = "Job pausado antes de iniciar ejecución."
CANCELLED_MESSAGE = "Job cancelado por el usuario. Operación irreversible."
SOFT_DELETED_MESSAGE = "Job enviado a la papelera de reciclaje."
RESTORED_MESSAGE = "Job restaurado desde la papelera de reciclaje."


def request_pause(
    job_id: str,
    *,
    job: ScientificJob,
    progress_publisher: JobProgressPublisherPort,
    log_publisher: JobLogPublisherPort,
) -> ScientificJob:
    """Solicita pausa cooperativa para un job o lo pausa de inmediato si está pending."""
    logger.info("Solicitud de pausa recibida para job %s", job_id)
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
        job.progress_message = PAUSED_PENDING_MESSAGE
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
                message=PAUSED_PENDING_MESSAGE,
            ),
        )
        publish_job_log(
            job,
            level="warning",
            source=CONTROL_LOG_SOURCE,
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
        source=CONTROL_LOG_SOURCE,
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
    job.progress_message = CANCELLED_MESSAGE
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
            message=CANCELLED_MESSAGE,
        ),
    )
    publish_job_log(
        job,
        level="warning",
        source=CONTROL_LOG_SOURCE,
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
    logger.info("Solicitud de reanudación recibida para job %s", job_id)
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
    progress_publisher.publish(
        job,
        JobProgressUpdate(
            percentage=int(job.progress_percentage),
            stage="queued",
            message="Job reanudado y en espera de ejecución.",
        ),
    )
    publish_job_log(
        job,
        level="info",
        source=CONTROL_LOG_SOURCE,
        message="Job marcado como pending para reanudar ejecución.",
        log_publisher=log_publisher,
    )
    return job


def purge_expired_deleted_jobs(*, retention_cutoff=None) -> int:
    """Elimina definitivamente jobs de papelera cuyo vencimiento ya expiró."""
    current_time = retention_cutoff or timezone.now()
    expired_jobs_queryset = ScientificJob.objects.filter(
        deleted_at__isnull=False,
        scheduled_hard_delete_at__isnull=False,
        scheduled_hard_delete_at__lte=current_time,
    )
    expired_job_ids: list[str] = list(
        expired_jobs_queryset.values_list("id", flat=True)
    )
    if len(expired_job_ids) == 0:
        return 0

    deleted_count, _ = expired_jobs_queryset.delete()
    logger.info(
        "Purga oportunista eliminó %s jobs vencidos de la papelera.",
        len(expired_job_ids),
    )
    _ = deleted_count
    return len(expired_job_ids)


def delete_job(
    job_id: str,
    *,
    actor: AbstractUser,
    job: ScientificJob,
    retention_days: int,
    progress_publisher: JobProgressPublisherPort,
    log_publisher: JobLogPublisherPort,
) -> JobDeleteResult:
    """Borra un job definitivamente o lo envía a papelera según jerarquía.

    Reglas:
    - user propietario (job no borrado): hard delete directo.
    - admin/root (job no borrado): soft delete hacia papelera.
    - job en papelera: hard delete definitivo (solo permitido por autorización previa).
    """
    _ = progress_publisher

    if job.deleted_at is not None:
        deleted_job_id = str(job.id)
        job.delete()
        logger.info(
            "Job %s eliminado definitivamente desde papelera por actor %s.",
            job_id,
            actor.id,
        )
        return {
            "job_id": deleted_job_id,
            "deletion_mode": "hard",
            "scheduled_hard_delete_at": None,
        }

    if job.status in {"pending", "running", "paused"}:
        raise ValueError(
            "Debes cancelar el job antes de eliminarlo cuando aún está activo."
        )

    if AuthorizationService.should_use_hard_delete(actor=actor, job=job):
        deleted_job_id = str(job.id)
        job.delete()
        logger.info("Job %s eliminado definitivamente por su autor.", job_id)
        return {
            "job_id": deleted_job_id,
            "deletion_mode": "hard",
            "scheduled_hard_delete_at": None,
        }

    now = timezone.now()
    hard_delete_deadline = now + timedelta(days=retention_days)
    job.deleted_at = now
    job.deleted_by = actor
    job.deletion_mode = ScientificJob.DELETION_MODE_SOFT
    job.scheduled_hard_delete_at = hard_delete_deadline
    job.original_status = str(job.status)
    job.save(
        update_fields=[
            "deleted_at",
            "deleted_by",
            "deletion_mode",
            "scheduled_hard_delete_at",
            "original_status",
            "updated_at",
        ]
    )
    publish_job_log(
        job,
        level="warning",
        source=CONTROL_LOG_SOURCE,
        message=SOFT_DELETED_MESSAGE,
        payload={
            "deleted_by_id": actor.id,
            "scheduled_hard_delete_at": hard_delete_deadline.isoformat(),
        },
        log_publisher=log_publisher,
    )
    logger.info("Job %s enviado a la papelera por actor %s.", job_id, actor.id)
    return {
        "job_id": str(job.id),
        "deletion_mode": "soft",
        "scheduled_hard_delete_at": hard_delete_deadline.isoformat(),
    }


def restore_job(
    job_id: str,
    *,
    actor: AbstractUser,
    job: ScientificJob,
    progress_publisher: JobProgressPublisherPort,
    log_publisher: JobLogPublisherPort,
) -> ScientificJob:
    """Restaura un job desde papelera preservando su estado funcional original."""
    _ = progress_publisher

    if job.deleted_at is None:
        raise ValueError("El job no se encuentra en la papelera de reciclaje.")

    job.deleted_at = None
    job.deleted_by = None
    job.deletion_mode = ""
    job.scheduled_hard_delete_at = None
    job.original_status = ""
    job.save(
        update_fields=[
            "deleted_at",
            "deleted_by",
            "deletion_mode",
            "scheduled_hard_delete_at",
            "original_status",
            "updated_at",
        ]
    )
    publish_job_log(
        job,
        level="info",
        source=CONTROL_LOG_SOURCE,
        message=RESTORED_MESSAGE,
        payload={"restored_by_id": actor.id},
        log_publisher=log_publisher,
    )
    broadcast_job_update(job)
    logger.info("Job %s restaurado desde papelera por actor %s.", job_id, actor.id)
    return job
