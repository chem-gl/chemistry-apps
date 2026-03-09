"""tasks.py: Tareas Celery para ejecucion asincrona de jobs cientificos."""

import logging

from celery import shared_task
from celery.app.task import Task

from .services import JobService

logger = logging.getLogger(__name__)


@shared_task(bind=True)
def execute_scientific_job(self: Task, job_id: str) -> None:
    logger.info(f"Starting async processing for job {job_id}")
    JobService.run_job(job_id)
