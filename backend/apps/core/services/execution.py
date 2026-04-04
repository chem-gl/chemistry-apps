"""services/execution.py: Orquestación de ejecución de jobs científicos.

Funciones para ejecutar un job completo: validación de estado, preparación
de parámetros, intento de cache, ejecución del plugin y gestión de errores.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import cast

from django.utils import timezone

from ..exceptions import JobPauseRequested
from ..models import ScientificJob
from ..ports import (
    CacheRepositoryPort,
    JobLogPublisherPort,
    JobProgressPublisherPort,
    JobProgressUpdate,
    PluginExecutionPort,
)
from ..types import JSONMap
from .cache_operations import is_cache_payload_usable_for_plugin
from .callbacks import (
    build_plugin_control_callback,
    build_plugin_log_callback,
    build_plugin_progress_callback,
)
from .log_helpers import publish_job_log
from .terminal_states import finish_with_failure, finish_with_pause, finish_with_result

logger = logging.getLogger(__name__)
RUNTIME_LOG_SOURCE = "core.runtime"
CACHE_LOG_SOURCE = "core.cache"


def run_job(
    job: ScientificJob,
    job_id: str,
    *,
    cache_repository: CacheRepositoryPort,
    plugin_execution: PluginExecutionPort,
    progress_publisher: JobProgressPublisherPort,
    log_publisher: JobLogPublisherPort,
    persist_result_fn: Callable[[ScientificJob, JSONMap], None],
) -> None:
    """Ejecuta un job en background y persiste progreso, resultado y errores."""
    if _should_skip_execution(
        job=job,
        job_id=job_id,
        log_publisher=log_publisher,
    ):
        return

    execution_parameters: JSONMap = _prepare_execution_parameters(
        job,
        progress_publisher=progress_publisher,
        log_publisher=log_publisher,
    )

    if _try_finish_job_from_cache(
        job=job,
        job_id=job_id,
        cache_repository=cache_repository,
        progress_publisher=progress_publisher,
        log_publisher=log_publisher,
    ):
        return

    _publish_plugin_execution_start(
        job,
        progress_publisher=progress_publisher,
        log_publisher=log_publisher,
    )
    _execute_runtime_plugin_flow(
        job=job,
        job_id=job_id,
        execution_parameters=execution_parameters,
        plugin_execution=plugin_execution,
        progress_publisher=progress_publisher,
        log_publisher=log_publisher,
        persist_result_fn=persist_result_fn,
    )


def _should_skip_execution(
    *,
    job: ScientificJob,
    job_id: str,
    log_publisher: JobLogPublisherPort,
) -> bool:
    """Determina si el job no debe ejecutarse por estar en estado terminal."""
    if job.status not in {"completed", "failed", "paused"}:
        return False

    logger.info("Job %s ya estaba finalizado con estado %s", job_id, job.status)
    publish_job_log(
        job,
        level="debug",
        source=RUNTIME_LOG_SOURCE,
        message="Ejecución omitida porque el job ya está finalizado.",
        payload={"status": job.status},
        log_publisher=log_publisher,
    )
    return True


def _prepare_execution_parameters(
    job: ScientificJob,
    *,
    progress_publisher: JobProgressPublisherPort,
    log_publisher: JobLogPublisherPort,
) -> JSONMap:
    """Prepara contexto de ejecución, marca estado running y adjunta checkpoint."""
    _mark_job_as_running(
        job,
        progress_publisher=progress_publisher,
        log_publisher=log_publisher,
    )

    execution_parameters: JSONMap = dict(cast(JSONMap, job.parameters))
    execution_parameters["__job_id"] = str(job.id)
    execution_parameters["__plugin_name"] = job.plugin_name

    runtime_state_value: JSONMap = cast(JSONMap, job.runtime_state)
    if len(runtime_state_value) > 0:
        execution_parameters["__runtime_state"] = runtime_state_value
        publish_job_log(
            job,
            level="info",
            source=RUNTIME_LOG_SOURCE,
            message="Reanudando ejecución desde estado persistido.",
            payload={"runtime_state_keys": list(runtime_state_value.keys())},
            log_publisher=log_publisher,
        )

    return execution_parameters


def _mark_job_as_running(
    job: ScientificJob,
    *,
    progress_publisher: JobProgressPublisherPort,
    log_publisher: JobLogPublisherPort,
) -> None:
    """Actualiza estado inicial de ejecución y publica evento de arranque."""
    job.status = "running"
    job.last_heartbeat_at = timezone.now()
    job.save(update_fields=["status", "last_heartbeat_at", "updated_at"])

    progress_publisher.publish(
        job,
        JobProgressUpdate(
            percentage=10,
            stage="running",
            message="Job en ejecución por worker asíncrono.",
        ),
    )
    publish_job_log(
        job,
        level="info",
        source=RUNTIME_LOG_SOURCE,
        message="Job iniciado en worker asíncrono.",
        log_publisher=log_publisher,
    )


def _try_finish_job_from_cache(
    *,
    job: ScientificJob,
    job_id: str,
    cache_repository: CacheRepositoryPort,
    progress_publisher: JobProgressPublisherPort,
    log_publisher: JobLogPublisherPort,
) -> bool:
    """Intenta resolver resultado desde caché y cerrar el job inmediatamente."""
    cached_result_payload: JSONMap | None = cache_repository.get_cached_result(
        job_hash=job.job_hash,
        plugin_name=job.plugin_name,
        algorithm_version=job.algorithm_version,
    )
    if cached_result_payload is None:
        return False

    if not is_cache_payload_usable_for_plugin(
        plugin_name=job.plugin_name,
        payload=cached_result_payload,
    ):
        publish_job_log(
            job,
            level="warning",
            source=CACHE_LOG_SOURCE,
            message="Cache hit descartado durante ejecución por payload no reutilizable.",
            payload={"plugin_name": job.plugin_name},
            log_publisher=log_publisher,
        )
        return False

    publish_job_log(
        job,
        level="info",
        source=CACHE_LOG_SOURCE,
        message="Resultado recuperado desde caché durante ejecución.",
        log_publisher=log_publisher,
    )
    finish_with_result(
        job=job,
        job_id=job_id,
        result_payload=cached_result_payload,
        from_cache=True,
        progress_publisher=progress_publisher,
        log_publisher=log_publisher,
    )
    return True


def _publish_plugin_execution_start(
    job: ScientificJob,
    *,
    progress_publisher: JobProgressPublisherPort,
    log_publisher: JobLogPublisherPort,
) -> None:
    """Publica transición de estado para inicio de ejecución del plugin."""
    progress_publisher.publish(
        job,
        JobProgressUpdate(
            percentage=35,
            stage="running",
            message="Ejecutando plugin científico.",
        ),
    )
    publish_job_log(
        job,
        level="info",
        source=RUNTIME_LOG_SOURCE,
        message="Iniciando ejecución de plugin científico.",
        payload={"plugin_name": job.plugin_name},
        log_publisher=log_publisher,
    )


def _execute_runtime_plugin_flow(
    *,
    job: ScientificJob,
    job_id: str,
    execution_parameters: JSONMap,
    plugin_execution: PluginExecutionPort,
    progress_publisher: JobProgressPublisherPort,
    log_publisher: JobLogPublisherPort,
    persist_result_fn: Callable[[ScientificJob, JSONMap], None],
) -> None:
    """Ejecuta plugin con callbacks tipados y gestiona los estados terminales."""
    try:
        result_payload: JSONMap = plugin_execution.execute(
            job.plugin_name,
            execution_parameters,
            progress_callback=build_plugin_progress_callback(job, progress_publisher),
            log_callback=build_plugin_log_callback(job, log_publisher),
            control_callback=build_plugin_control_callback(job_id),
        )
        persist_result_fn(job, result_payload)
        finish_with_result(
            job=job,
            job_id=job_id,
            result_payload=result_payload,
            from_cache=False,
            progress_publisher=progress_publisher,
            log_publisher=log_publisher,
        )
    except JobPauseRequested as pause_signal:
        finish_with_pause(
            job=job,
            job_id=job_id,
            pause_message=str(pause_signal),
            checkpoint=pause_signal.checkpoint,
            progress_publisher=progress_publisher,
            log_publisher=log_publisher,
        )
    except (
        ValueError,
        TypeError,
        KeyError,
        ZeroDivisionError,
        RuntimeError,
    ) as service_error:
        publish_job_log(
            job,
            level="error",
            source=RUNTIME_LOG_SOURCE,
            message="Error durante ejecución del job.",
            payload={"error": str(service_error)},
            log_publisher=log_publisher,
        )
        finish_with_failure(
            job=job,
            job_id=job_id,
            error_message=str(service_error),
            progress_publisher=progress_publisher,
            log_publisher=log_publisher,
        )
