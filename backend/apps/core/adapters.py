"""adapters.py: Adaptadores de infraestructura Django para puertos del dominio core.

Estos adaptadores son la implementación concreta de los puertos definidos en
`ports.py`. En otras palabras, aquí se "aterriza" el dominio a Django ORM y al
registro de plugins.

Uso esperado:
1. No llamar estos adaptadores directamente desde routers de apps.
2. Usar `factory.build_job_service()` para inyectarlos en `RuntimeJobService`.
3. Si una app requiere otra infraestructura (ej. cache distribuida), implementar
    nuevos adaptadores sin modificar los casos de uso del dominio.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import cast

from django.db import IntegrityError, transaction
from django.db.models import F, Max
from django.utils import timezone

from .models import ScientificCacheEntry, ScientificJob, ScientificJobLogEvent
from .ports import (
    CacheRepositoryPort,
    JobLogPublisherPort,
    JobLogUpdate,
    JobProgressPublisherPort,
    JobProgressUpdate,
    PluginExecutionPort,
)
from .realtime import broadcast_job_log, broadcast_job_progress
from .types import (
    JSONMap,
    PluginControlCallback,
    PluginLogCallback,
    PluginProgressCallback,
)

logger = logging.getLogger(__name__)


class DjangoCacheRepositoryAdapter(CacheRepositoryPort):
    """Implementación de cache sobre ORM Django.

    La clave de cache se calcula en la capa de servicios y este adaptador solo
    resuelve persistencia y contadores de uso.
    """

    def get_cached_result(
        self,
        *,
        job_hash: str,
        plugin_name: str,
        algorithm_version: str,
    ) -> JSONMap | None:
        """Lee cache por hash y actualiza contadores de uso cuando hay hit."""
        cache_entry: ScientificCacheEntry | None = ScientificCacheEntry.objects.filter(
            job_hash=job_hash,
            plugin_name=plugin_name,
            algorithm_version=algorithm_version,
        ).first()

        if cache_entry is None:
            return None

        ScientificCacheEntry.objects.filter(pk=cache_entry.pk).update(
            hit_count=F("hit_count") + 1
        )
        cache_entry.refresh_from_db(fields=["hit_count", "last_accessed_at"])
        return cast(JSONMap, cache_entry.result_payload)

    def store_cached_result(
        self,
        *,
        job_hash: str,
        plugin_name: str,
        algorithm_version: str,
        result_payload: JSONMap,
    ) -> None:
        """Guarda resultado cacheado en una entrada única por hash."""
        ScientificCacheEntry.objects.update_or_create(
            job_hash=job_hash,
            defaults={
                "plugin_name": plugin_name,
                "algorithm_version": algorithm_version,
                "result_payload": result_payload,
            },
        )


class DjangoPluginExecutionAdapter(PluginExecutionPort):
    """Implementación de ejecución de plugin usando PluginRegistry.

    Este adaptador mantiene desacoplamiento: el servicio conoce el puerto,
    pero no depende directamente del módulo `processing`.
    """

    def execute(
        self,
        plugin_name: str,
        parameters: JSONMap,
        progress_callback: PluginProgressCallback | None = None,
        log_callback: PluginLogCallback | None = None,
        control_callback: PluginControlCallback | None = None,
    ) -> JSONMap:
        """Ejecuta el plugin en el registro global del dominio."""
        from .processing import PluginRegistry

        return PluginRegistry.execute(
            plugin_name,
            parameters,
            progress_callback=progress_callback,
            log_callback=log_callback,
            control_callback=control_callback,
        )


@dataclass(slots=True)
class DjangoJobProgressPublisherAdapter(JobProgressPublisherPort):
    """Publicador de progreso persistido en los campos del modelo ScientificJob.

    Estrategia actual: guardar progreso en la fila del job para que endpoints
    de snapshot y stream SSE puedan consultar sin estado adicional en memoria.
    """

    def publish(self, job: ScientificJob, progress_update: JobProgressUpdate) -> None:
        """Actualiza etapa, porcentaje, mensaje y contador de evento del job."""
        clamped_percentage: int = max(0, min(100, progress_update.percentage))
        next_event_index: int = int(job.progress_event_index) + 1

        job.progress_percentage = clamped_percentage
        job.progress_stage = progress_update.stage
        job.progress_message = progress_update.message
        job.progress_event_index = next_event_index
        job.last_heartbeat_at = timezone.now()
        job.save(
            update_fields=[
                "progress_percentage",
                "progress_stage",
                "progress_message",
                "progress_event_index",
                "last_heartbeat_at",
                "updated_at",
            ]
        )
        broadcast_job_progress(job)


class DjangoJobLogPublisherAdapter(JobLogPublisherPort):
    """Publicador persistente de eventos de log por job."""

    MAX_EVENT_INDEX_RETRIES: int = 5

    def _resolve_next_event_index(self, job: ScientificJob) -> int:
        """Calcula el siguiente índice incremental de logs para un job."""
        aggregate_result: dict[str, int | None] = ScientificJobLogEvent.objects.filter(
            job=job
        ).aggregate(max_event_index=Max("event_index"))
        current_max_event_index: int | None = aggregate_result["max_event_index"]
        return (
            1 if current_max_event_index is None else int(current_max_event_index) + 1
        )

    def publish(
        self,
        job: ScientificJob,
        log_update: JobLogUpdate,
    ) -> ScientificJobLogEvent:
        """Crea un evento incremental por job para stream e historial.

        Usa reintentos para resolver colisiones por concurrencia cuando varios
        workers publican logs del mismo job en ventanas de tiempo muy cortas.
        """
        normalized_payload: JSONMap = (
            log_update.payload if log_update.payload is not None else {}
        )

        retry_number: int
        for retry_number in range(1, self.MAX_EVENT_INDEX_RETRIES + 1):
            try:
                with transaction.atomic():
                    ScientificJob.objects.select_for_update().get(pk=job.pk)
                    next_event_index: int = self._resolve_next_event_index(job)
                    created_log_event: ScientificJobLogEvent = (
                        ScientificJobLogEvent.objects.create(
                            job=job,
                            event_index=next_event_index,
                            level=log_update.level,
                            source=log_update.source,
                            message=log_update.message,
                            payload=normalized_payload,
                        )
                    )

                broadcast_job_log(created_log_event)
                return created_log_event
            except IntegrityError:
                logger.warning(
                    "Colisión de event_index detectada para job %s (intento %s/%s).",
                    job.id,
                    retry_number,
                    self.MAX_EVENT_INDEX_RETRIES,
                )

        fallback_log_event: ScientificJobLogEvent | None = (
            ScientificJobLogEvent.objects.filter(job=job)
            .order_by("-event_index", "-created_at")
            .first()
        )
        if fallback_log_event is not None:
            logger.error(
                "No se pudo insertar nuevo log tras %s intentos para job %s; se retorna último evento existente.",
                self.MAX_EVENT_INDEX_RETRIES,
                job.id,
            )
            return fallback_log_event

        raise RuntimeError(
            f"No fue posible publicar log para job {job.id} tras {self.MAX_EVENT_INDEX_RETRIES} intentos."
        )
