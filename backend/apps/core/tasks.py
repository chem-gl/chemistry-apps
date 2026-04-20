"""tasks.py: Tareas Celery para ejecución asíncrona de jobs científicos.

Este módulo define la frontera de ejecución en background.

Uso esperado desde apps:
1. El router crea job con `JobService.create_job`.
2. El router llama `dispatch_scientific_job(job_id)`.
3. Si el broker está disponible, Celery ejecuta `execute_scientific_job`.
4. Si el broker falla, la API no se rompe y el job queda en `pending` con
    mensaje de progreso que facilita observabilidad operativa.
5. La tarea periódica `purge_expired_artifact_chunks` corre una vez al día y
    elimina los chunks binarios de artefactos que superaron su TTL preservando
    los metadatos y el resultado del job.
"""

import logging

from celery import shared_task
from celery.app.task import Task
from django.conf import settings
from kombu.exceptions import OperationalError
from redis.exceptions import ConnectionError as RedisConnectionError

from .services import JobService

logger = logging.getLogger(__name__)


def dispatch_scientific_job(job_id: str) -> bool:
    """Intenta encolar un job sin romper la API si el broker no está disponible.

    Retorna `True` si el broker aceptó el encolado y `False` en caso contrario.
    El caller debe registrar ese resultado para reflejar estado de progreso.
    """
    if not bool(getattr(settings, "JOB_DISPATCH_ENABLED", True)):
        logger.debug(
            "Despacho de Celery deshabilitado por configuración para job %s.",
            job_id,
        )
        return False

    try:
        execute_scientific_job.delay(job_id)
        return True
    except (RuntimeError, OperationalError, RedisConnectionError, OSError) as error:
        logger.warning(
            "No se pudo encolar el job %s en Celery. Se mantiene en pending: %s",
            job_id,
            error,
        )

        should_run_inline: bool = bool(
            getattr(
                settings,
                "JOB_INLINE_EXECUTION_ON_BROKER_FAILURE",
                bool(getattr(settings, "DEBUG", False)),
            )
        )
        if not should_run_inline:
            return False

        logger.warning(
            "Activando ejecución inline de respaldo para job %s por indisponibilidad del broker.",
            job_id,
        )
        try:
            JobService.run_job(job_id)
            return True
        except Exception:  # noqa: BLE001
            logger.exception(
                "La ejecución inline de respaldo también falló para job %s.",
                job_id,
            )
            return False


@shared_task(bind=True)
def execute_scientific_job(self: Task, job_id: str) -> None:
    """Ejecuta en worker Celery la lógica científica de un job persistido.

    La tarea no conoce reglas de negocio detalladas: delega todo en `JobService`
    para mantener consistencia con ejecuciones iniciadas desde HTTP.
    """
    if getattr(settings, "JOB_RECOVERY_ENABLED", True):
        run_active_recovery(exclude_job_id=job_id)

    logger.info("Iniciando procesamiento asíncrono para job %s", job_id)
    JobService.run_job(job_id)


@shared_task(bind=True)
def run_active_recovery(
    self: Task, exclude_job_id: str | None = None
) -> dict[str, int]:
    """Ejecuta recuperación activa de jobs huérfanos por caída/reinicio."""
    del self
    if not getattr(settings, "JOB_RECOVERY_ENABLED", True):
        return {
            "stale_running_detected": 0,
            "stale_pending_detected": 0,
            "requeued_successfully": 0,
            "requeue_failed": 0,
            "marked_failed_by_retries": 0,
        }

    stale_seconds: int = int(getattr(settings, "JOB_RECOVERY_STALE_SECONDS", 60))
    include_pending_jobs: bool = bool(
        getattr(settings, "JOB_RECOVERY_INCLUDE_PENDING", True)
    )

    summary = JobService.run_active_recovery(
        dispatch_callback=dispatch_scientific_job,
        stale_seconds=stale_seconds,
        include_pending_jobs=include_pending_jobs,
        exclude_job_id=exclude_job_id,
    )
    logger.info(
        "Recuperación activa ejecutada: running=%s pending=%s requeued=%s failed_requeue=%s exceeded=%s",
        summary["stale_running_detected"],
        summary["stale_pending_detected"],
        summary["requeued_successfully"],
        summary["requeue_failed"],
        summary["marked_failed_by_retries"],
    )
    return {
        "stale_running_detected": int(summary["stale_running_detected"]),
        "stale_pending_detected": int(summary["stale_pending_detected"]),
        "requeued_successfully": int(summary["requeued_successfully"]),
        "requeue_failed": int(summary["requeue_failed"]),
        "marked_failed_by_retries": int(summary["marked_failed_by_retries"]),
    }


@shared_task(bind=True)
def purge_expired_artifact_chunks(self: Task) -> dict[str, int]:
    """Elimina chunks binarios de artefactos cuyo TTL expiró.

    Conserva metadatos (sha256, tamaño, nombre, campo) y los resultados del job
    para trazabilidad y reproducibilidad científica.

    Sólo afecta artefactos con expires_at <= ahora y chunks_purged_at nulo.
    Archivos ≤ ARTIFACT_INLINE_THRESHOLD_KB tienen expires_at=None y nunca se purgan.

    Retorna estadísticas: purged_artifacts, bytes_freed, errors.
    """
    del self
    from .artifacts import ScientificInputArtifactStorageService

    service = ScientificInputArtifactStorageService()
    summary: dict[str, int] = service.purge_expired_chunks()
    logger.info(
        "Purga de artefactos: purgados=%d  bytes_liberados=%d  errores=%d",
        summary.get("purged_artifacts", 0),
        summary.get("bytes_freed", 0),
        summary.get("errors", 0),
    )
    return summary
