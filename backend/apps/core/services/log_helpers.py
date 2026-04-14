"""services/log_helpers.py: Publicación de logs de job centralizada.

Función auxiliar para publicar eventos de log del job sin
romper el flujo principal de ejecución.
"""

from __future__ import annotations

import logging

from ..models import ScientificJob
from ..ports import JobLogPublisherPort, JobLogUpdate
from ..types import JobLogLevel, JSONMap

logger = logging.getLogger(__name__)


def publish_job_log(
    job: ScientificJob,
    *,
    level: JobLogLevel,
    source: str,
    message: str,
    payload: JSONMap | None = None,
    log_publisher: JobLogPublisherPort,
) -> None:
    """Publica un evento de log del job sin romper el flujo principal."""
    try:
        log_publisher.publish(
            job,
            JobLogUpdate(
                level=level,
                source=source,
                message=message,
                payload=payload,
            ),
        )
    except Exception as exc_value:
        logger.warning(
            "No se pudo persistir el log auxiliar del job %s desde %s: %s",
            job.id,
            source,
            exc_value,
        )
