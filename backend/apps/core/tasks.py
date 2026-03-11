"""tasks.py: Tareas Celery para ejecución asíncrona de jobs científicos.

Este módulo define la frontera de ejecución en background.

Uso esperado desde apps:
1. El router crea job con `JobService.create_job`.
2. El router llama `dispatch_scientific_job(job_id)`.
3. Si el broker está disponible, Celery ejecuta `execute_scientific_job`.
4. Si el broker falla, la API no se rompe y el job queda en `pending` con
    mensaje de progreso que facilita observabilidad operativa.
"""

import logging

from celery import shared_task
from celery.app.task import Task
from kombu.exceptions import OperationalError
from redis.exceptions import ConnectionError as RedisConnectionError

from .services import JobService

logger = logging.getLogger(__name__)


def dispatch_scientific_job(job_id: str) -> bool:
    """Intenta encolar un job sin romper la API si el broker no está disponible.

    Retorna `True` si el broker aceptó el encolado y `False` en caso contrario.
    El caller debe registrar ese resultado para reflejar estado de progreso.
    """
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
    """Ejecuta en worker Celery la lógica científica de un job persistido.

    La tarea no conoce reglas de negocio detalladas: delega todo en `JobService`
    para mantener consistencia con ejecuciones iniciadas desde HTTP.
    """
    logger.info("Iniciando procesamiento asíncrono para job %s", job_id)
    JobService.run_job(job_id)
