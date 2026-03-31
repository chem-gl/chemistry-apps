"""services/cache_operations.py: Estimación de tamaño y validación de caché.

Funciones para estimar el tamaño de payloads JSON sin serializar,
verificar la usabilidad de payloads cacheados por plugin, y
persistir resultados en caché con trazabilidad de errores.
"""

from __future__ import annotations

import logging

from django.db import DatabaseError

from ..models import ScientificJob
from ..ports import (
    CacheRepositoryPort,
    JobLogPublisherPort,
    JobProgressPublisherPort,
    JobProgressUpdate,
)
from ..types import JSONMap
from .config import get_result_cache_payload_limit_bytes
from .log_helpers import publish_job_log

logger = logging.getLogger(__name__)

CORE_CACHE_LOG_SOURCE = "core.cache"


def estimate_json_payload_size_bytes(
    payload: object,
    limit_bytes: int,
) -> int:
    """Estima tamaño JSON del payload sin serializar el documento completo.

    El cálculo es aproximado pero suficientemente estricto para cortar
    temprano resultados gigantes y evitar desbordes en SQLite/debug SQL.
    """
    total_bytes: int = 0
    pending_values: list[object] = [payload]
    visited_containers: set[int] = set()

    while len(pending_values) > 0:
        current_value = pending_values.pop()
        total_bytes += _estimate_value_size_and_enqueue(
            value=current_value,
            pending_values=pending_values,
            visited_containers=visited_containers,
        )

        if total_bytes > limit_bytes:
            return total_bytes

    return total_bytes


def _estimate_value_size_and_enqueue(
    *,
    value: object,
    pending_values: list[object],
    visited_containers: set[int],
) -> int:
    """Estima bytes del valor y encola hijos para recorrido iterativo."""
    if isinstance(value, dict):
        return _enqueue_mapping_values_for_size_estimation(
            mapping_value=value,
            pending_values=pending_values,
            visited_containers=visited_containers,
        )

    if isinstance(value, list | tuple | set):
        return _enqueue_iterable_values_for_size_estimation(
            iterable_value=value,
            pending_values=pending_values,
            visited_containers=visited_containers,
        )

    return estimate_scalar_json_size_bytes(value)


def estimate_scalar_json_size_bytes(value: object) -> int:
    """Estima el tamaño JSON de un valor escalar o fallback serializable."""
    if value is None:
        return 4
    if isinstance(value, bool):
        return 4 if value else 5
    if isinstance(value, int | float):
        return len(str(value))
    if isinstance(value, str):
        return len(value.encode("utf-8"))
    return len(str(value).encode("utf-8"))


def _register_container_if_not_seen(
    *,
    container_value: object,
    visited_containers: set[int],
) -> bool:
    """Registra contenedores visitados para evitar ciclos infinitos."""
    container_id = id(container_value)
    if container_id in visited_containers:
        return False
    visited_containers.add(container_id)
    return True


def _enqueue_mapping_values_for_size_estimation(
    *,
    mapping_value: dict[object, object],
    pending_values: list[object],
    visited_containers: set[int],
) -> int:
    """Encola claves/valores de dict y retorna bytes estructurales agregados."""
    if not _register_container_if_not_seen(
        container_value=mapping_value,
        visited_containers=visited_containers,
    ):
        return 0

    pending_values.extend(
        item
        for dict_key, dict_value in mapping_value.items()
        for item in (str(dict_key), dict_value)
    )
    return 2


def _enqueue_iterable_values_for_size_estimation(
    *,
    iterable_value: list[object] | tuple[object, ...] | set[object],
    pending_values: list[object],
    visited_containers: set[int],
) -> int:
    """Encola elementos de listas/tuplas/sets y retorna bytes estructurales."""
    if not _register_container_if_not_seen(
        container_value=iterable_value,
        visited_containers=visited_containers,
    ):
        return 0

    pending_values.extend(iterable_value)
    return 2


def is_cache_payload_usable_for_plugin(
    *,
    plugin_name: str,
    payload: JSONMap,
) -> bool:
    """Valida que un payload cacheado sea reutilizable por plugin.

    Para `toxicity-properties` descartamos entradas degradadas donde todas
    las filas tienen `error_message`, porque representan ejecuciones
    fallidas o entornos no saludables que no deben propagarse por caché.
    """
    if plugin_name != "toxicity-properties":
        return True

    molecules_value: object | None = payload.get("molecules")
    if not isinstance(molecules_value, list) or len(molecules_value) == 0:
        return False

    total_rows: int = len(molecules_value)
    rows_with_errors: int = 0

    for row_value in molecules_value:
        if not isinstance(row_value, dict):
            return False
        row_error_message: object | None = row_value.get("error_message")
        if isinstance(row_error_message, str) and row_error_message.strip() != "":
            rows_with_errors += 1

    return rows_with_errors < total_rows


def persist_result_in_cache(
    *,
    job: ScientificJob,
    result_payload: JSONMap,
    cache_repository: CacheRepositoryPort,
    progress_publisher: JobProgressPublisherPort,
    log_publisher: JobLogPublisherPort,
) -> None:
    """Persiste el resultado exitoso en caché y publica trazabilidad."""
    progress_publisher.publish(
        job,
        JobProgressUpdate(
            percentage=80,
            stage="caching",
            message="Persistiendo resultado en caché.",
        ),
    )
    publish_job_log(
        job,
        level="info",
        source=CORE_CACHE_LOG_SOURCE,
        message="Persistiendo resultado calculado en caché.",
        log_publisher=log_publisher,
    )

    payload_limit_bytes: int = get_result_cache_payload_limit_bytes(job.plugin_name)
    estimated_payload_bytes: int = estimate_json_payload_size_bytes(
        result_payload,
        payload_limit_bytes,
    )
    if estimated_payload_bytes > payload_limit_bytes:
        publish_job_log(
            job,
            level="warning",
            source=CORE_CACHE_LOG_SOURCE,
            message="Se omite persistencia en caché por tamaño de resultado excesivo.",
            payload={
                "estimated_payload_bytes": estimated_payload_bytes,
                "payload_limit_bytes": payload_limit_bytes,
            },
            log_publisher=log_publisher,
        )
        return

    try:
        cache_repository.store_cached_result(
            job_hash=job.job_hash,
            plugin_name=job.plugin_name,
            algorithm_version=job.algorithm_version,
            result_payload=result_payload,
        )
    except (
        OverflowError,
        DatabaseError,
        MemoryError,
        TypeError,
        ValueError,
    ) as exc:
        publish_job_log(
            job,
            level="warning",
            source=CORE_CACHE_LOG_SOURCE,
            message="Se omite persistencia en caché por error de almacenamiento.",
            payload={
                "error_type": exc.__class__.__name__,
                "error": str(exc),
            },
            log_publisher=log_publisher,
        )
