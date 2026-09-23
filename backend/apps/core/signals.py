"""signals.py: Señales de Celery que liberan recursos del modo libre.

El cupo de concurrencia anónima se reserva en la request HTTP, pero el trabajo
termina en el worker: la liberación debe ocurrir aquí, no en la vista.

Se usan dos señales porque `task_postrun` no siempre se emite (por ejemplo si el
proceso muere): el TTL del lease es la última red de seguridad. Ambas rutas son
idempotentes (`ZREM` del propio token).
"""

from __future__ import annotations

import logging

from celery.signals import task_failure, task_postrun

logger = logging.getLogger(__name__)

EXECUTE_JOB_TASK_NAME = "apps.core.tasks.execute_scientific_job"


def _extract_job_id(args: object, kwargs: object) -> str | None:
    """Extrae el `job_id` con el que se encoló `execute_scientific_job`."""
    if isinstance(args, (list, tuple)) and len(args) > 0:
        return str(args[0])

    if isinstance(kwargs, dict) and kwargs.get("job_id") is not None:
        return str(kwargs["job_id"])

    return None


def _release_lease_for_job_id(job_id: str | None) -> None:
    """Libera el lease del job si existe; nunca propaga errores al worker."""
    if not job_id:
        return

    from .concurrency import release_job_lease
    from .models import ScientificJob

    job = ScientificJob.objects.filter(pk=job_id).first()
    if job is None:
        return

    try:
        release_job_lease(job)
    except Exception:  # noqa: BLE001
        logger.warning(
            "No se pudo liberar el lease de concurrencia del job %s.", job_id, exc_info=True
        )


@task_postrun.connect
def release_concurrency_lease_after_task(
    sender: object = None,
    args: object = None,
    kwargs: object = None,
    **_extra: object,
) -> None:
    """Libera el cupo cuando la tarea termina (con éxito o con error)."""
    if getattr(sender, "name", "") != EXECUTE_JOB_TASK_NAME:
        return

    _release_lease_for_job_id(_extract_job_id(args, kwargs))


@task_failure.connect
def release_concurrency_lease_on_failure(
    sender: object = None,
    args: object = None,
    kwargs: object = None,
    **_extra: object,
) -> None:
    """Red de seguridad adicional ante fallos que interrumpen `task_postrun`."""
    if getattr(sender, "name", "") != EXECUTE_JOB_TASK_NAME:
        return

    _release_lease_for_job_id(_extract_job_id(args, kwargs))
