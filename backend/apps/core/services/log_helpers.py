"""services/log_helpers.py: Publicación de logs de job centralizada.

Función auxiliar para publicar eventos de log del job sin
romper el flujo principal de ejecución.
"""

from __future__ import annotations

from ..models import ScientificJob
from ..ports import JobLogPublisherPort, JobLogUpdate
from ..types import JobLogLevel, JSONMap


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
    log_publisher.publish(
        job,
        JobLogUpdate(
            level=level,
            source=source,
            message=message,
            payload=payload,
        ),
    )
