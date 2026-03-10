"""tasks.py: Tareas Celery para ejecucion asincrona de jobs cientificos."""

import logging

from celery import shared_task
from celery.app.task import Task
from kombu.exceptions import OperationalError
from redis.exceptions import ConnectionError as RedisConnectionError

from .services import JobService

logger = logging.getLogger(__name__)


def dispatch_scientific_job(job_id: str) -> bool:
    """Intenta encolar un job sin romper la API si el broker no está disponible."""
    try:
        execute_scientific_job.delay(job_id)
        return True
    except (RuntimeError, OperationalError, RedisConnectionError, OSError) as error:
        logger.warning(
            "No se pudo encolar el job %s en Celery. Se mantiene en pending: %s",
            job_id,
            error,
        )
        return False


@shared_task(bind=True)
def execute_scientific_job(self: Task, job_id: str) -> None:
    logger.info(f"Starting async processing for job {job_id}")
    JobService.run_job(job_id)
