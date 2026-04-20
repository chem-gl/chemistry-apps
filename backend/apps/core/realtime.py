"""realtime.py: Serialización y broadcasting de eventos de jobs por WebSocket.

Objetivo del archivo:
- Construir payloads de transporte realtime y publicarlos en grupos de Channels
    (global, por plugin y por job).

Cómo se usa:
- `services.py` y `adapters.py` llaman `broadcast_job_update/progress/log`.
- `consumers.py` recibe esos eventos y los distribuye a clientes WebSocket.
"""

from __future__ import annotations

import logging
from typing import cast

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from .models import ScientificJob, ScientificJobLogEvent
from .types import JobLogEntry, JobProgressSnapshot, JobStatus, JSONMap

logger = logging.getLogger(__name__)

UTC_OFFSET_SUFFIX = "+00:00"
UTC_SUFFIX = "Z"


def _normalize_group_segment(raw_value: str) -> str:
    """Normaliza identificadores para nombres de grupo compatibles con Channels."""
    normalized_characters: list[str] = []

    for candidate_character in raw_value:
        if candidate_character.isalnum() or candidate_character in {"-", "."}:
            normalized_characters.append(candidate_character)
        elif candidate_character == "_":
            normalized_characters.append("-")
        else:
            normalized_characters.append("-")

    return "".join(normalized_characters)


def get_jobs_global_group_name() -> str:
    """Retorna el nombre del grupo global de jobs."""
    return "jobs.global"


def get_jobs_plugin_group_name(plugin_name: str) -> str:
    """Retorna el grupo de un plugin específico."""
    return f"jobs.plugin.{_normalize_group_segment(plugin_name)}"


def get_jobs_job_group_name(job_id: str) -> str:
    """Retorna el grupo específico para un job."""
    return f"jobs.job.{_normalize_group_segment(job_id)}"


def build_job_progress_snapshot(job: ScientificJob) -> JobProgressSnapshot:
    """Construye el snapshot tipado de progreso para transporte realtime."""
    return {
        "job_id": str(job.id),
        "status": cast(JobStatus, str(job.status)),
        "progress_percentage": int(job.progress_percentage),
        "progress_stage": str(job.progress_stage),
        "progress_message": str(job.progress_message),
        "progress_event_index": int(job.progress_event_index),
        "updated_at": job.updated_at.isoformat().replace(UTC_OFFSET_SUFFIX, UTC_SUFFIX),
    }


def build_job_log_entry(log_event: ScientificJobLogEvent) -> JobLogEntry:
    """Construye contrato tipado de un evento de log para transporte realtime."""
    return {
        "job_id": str(log_event.job_id),
        "event_index": int(log_event.event_index),
        "level": str(log_event.level),
        "source": str(log_event.source),
        "message": str(log_event.message),
        "payload": dict(log_event.payload),
        "created_at": log_event.created_at.isoformat().replace(
            UTC_OFFSET_SUFFIX, UTC_SUFFIX
        ),
    }


def build_scientific_job_payload(job: ScientificJob) -> JSONMap:
    """Serializa el job completo en un payload estable para frontend realtime."""
    normalized_progress_percentage: int = int(job.progress_percentage)
    normalized_progress_stage: str = str(job.progress_stage)
    normalized_progress_message: str = str(job.progress_message)

    if job.status in {"completed", "failed"}:
        normalized_progress_percentage = 100
        normalized_progress_stage = str(job.status)
        normalized_progress_message = (
            "Job completado correctamente."
            if job.status == "completed"
            else "Job finalizado con error. Revisar error_trace."
        )

    return {
        "id": str(job.id),
        "job_hash": str(job.job_hash),
        "plugin_name": str(job.plugin_name),
        "algorithm_version": str(job.algorithm_version),
        "status": str(job.status),
        "cache_hit": bool(job.cache_hit),
        "cache_miss": bool(job.cache_miss),
        "progress_percentage": normalized_progress_percentage,
        "progress_stage": normalized_progress_stage,
        "progress_message": normalized_progress_message,
        "progress_event_index": int(job.progress_event_index),
        "supports_pause_resume": bool(job.supports_pause_resume),
        "pause_requested": bool(job.pause_requested),
        "runtime_state": dict(job.runtime_state),
        "paused_at": (
            job.paused_at.isoformat().replace(UTC_OFFSET_SUFFIX, UTC_SUFFIX)
            if job.paused_at is not None
            else None
        ),
        "resumed_at": (
            job.resumed_at.isoformat().replace(UTC_OFFSET_SUFFIX, UTC_SUFFIX)
            if job.resumed_at is not None
            else None
        ),
        "parameters": dict(job.parameters),
        "results": dict(job.results) if job.results is not None else None,
        "error_trace": job.error_trace,
        "created_at": job.created_at.isoformat().replace(UTC_OFFSET_SUFFIX, UTC_SUFFIX),
        "updated_at": job.updated_at.isoformat().replace(UTC_OFFSET_SUFFIX, UTC_SUFFIX),
    }


def _broadcast_event(
    *,
    event_name: str,
    payload: JSONMap,
    job_id: str,
    plugin_name: str,
) -> None:
    """Publica un evento hacia grupos globales, por plugin y por job."""
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return

    target_groups: tuple[str, ...] = (
        get_jobs_global_group_name(),
        get_jobs_plugin_group_name(plugin_name),
        get_jobs_job_group_name(job_id),
    )

    for group_name in target_groups:
        try:
            async_to_sync(channel_layer.group_send)(
                group_name,
                {
                    "type": "jobs.stream.event",
                    "event_name": event_name,
                    "payload": payload,
                },
            )
        except Exception as error:  # noqa: BLE001
            logger.warning(
                "Se omite broadcast realtime para %s en %s por error de infraestructura: %s",
                event_name,
                group_name,
                error,
            )
            return


def broadcast_job_update(job: ScientificJob) -> None:
    """Publica el estado completo de un job para monitores globales."""
    _broadcast_event(
        event_name="job.updated",
        payload=build_scientific_job_payload(job),
        job_id=str(job.id),
        plugin_name=str(job.plugin_name),
    )


def broadcast_job_progress(job: ScientificJob) -> None:
    """Publica progreso tipado y snapshot completo del job."""
    _broadcast_event(
        event_name="job.progress",
        payload=build_job_progress_snapshot(job),
        job_id=str(job.id),
        plugin_name=str(job.plugin_name),
    )
    broadcast_job_update(job)


def broadcast_job_log(log_event: ScientificJobLogEvent) -> None:
    """Publica un evento de log del job en tiempo real."""
    _broadcast_event(
        event_name="job.log",
        payload=build_job_log_entry(log_event),
        job_id=str(log_event.job_id),
        plugin_name=str(log_event.job.plugin_name),
    )
