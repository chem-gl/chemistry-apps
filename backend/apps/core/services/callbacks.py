"""services/callbacks.py: Construcción de callbacks tipados para plugins.

Funciones que construyen callbacks de progreso, logging y control
cooperativo para inyectar en la ejecución del plugin científico.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from uuid import UUID

from ..models import ScientificJob
from ..ports import JobLogPublisherPort, JobProgressPublisherPort, JobProgressUpdate
from ..types import JobLogLevel, JobProgressStage, JSONMap, PluginControlAction
from .log_helpers import publish_job_log

logger = logging.getLogger(__name__)


def build_plugin_progress_callback(
    job: ScientificJob,
    progress_publisher: JobProgressPublisherPort,
) -> Callable[[int, JobProgressStage, str], None]:
    """Construye callback de progreso para mapear porcentaje del plugin."""

    def report_plugin_progress(
        plugin_percentage: int,
        plugin_stage: JobProgressStage,
        plugin_message: str,
    ) -> None:
        normalized_percentage: int = max(0, min(100, int(plugin_percentage)))
        mapped_runtime_percentage: int = 35 + int(normalized_percentage * 44 / 100)

        progress_publisher.publish(
            job,
            JobProgressUpdate(
                percentage=mapped_runtime_percentage,
                stage=plugin_stage,
                message=plugin_message,
            ),
        )

    return report_plugin_progress


def build_plugin_log_callback(
    job: ScientificJob,
    log_publisher: JobLogPublisherPort,
) -> Callable[[JobLogLevel, str, str, JSONMap | None], None]:
    """Construye callback de logging correlacionado para el job en ejecución."""

    def report_plugin_log(
        level: JobLogLevel,
        source: str,
        message: str,
        payload: JSONMap | None,
    ) -> None:
        publish_job_log(
            job,
            level=level,
            source=source,
            message=message,
            payload=payload,
            log_publisher=log_publisher,
        )

    return report_plugin_log


def build_plugin_control_callback(
    job_id: str,
) -> Callable[[], PluginControlAction]:
    """Construye callback de control cooperativo (continue/pause).

    Consulta el estado actual del job en BD para decidir si el plugin
    debe continuar o pausarse cooperativamente.
    """

    def report_plugin_control() -> PluginControlAction:
        try:
            parsed_job_id: UUID = UUID(job_id)
        except ValueError:
            return "pause"

        try:
            refreshed_job = ScientificJob.objects.get(id=parsed_job_id)
        except ScientificJob.DoesNotExist:
            return "pause"

        if bool(refreshed_job.pause_requested):
            return "pause"

        if refreshed_job.status == "paused":
            return "pause"

        return "continue"

    return report_plugin_control
