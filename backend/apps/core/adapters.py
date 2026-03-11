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

from dataclasses import dataclass
from typing import cast

from django.db.models import F

from .models import ScientificCacheEntry, ScientificJob
from .ports import (
    CacheRepositoryPort,
    JobProgressPublisherPort,
    JobProgressUpdate,
    PluginExecutionPort,
)
from .types import JSONMap, PluginProgressCallback


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
    ) -> JSONMap:
        """Ejecuta el plugin en el registro global del dominio."""
        from .processing import PluginRegistry

        return PluginRegistry.execute(
            plugin_name,
            parameters,
            progress_callback=progress_callback,
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
        job.save(
            update_fields=[
                "progress_percentage",
                "progress_stage",
                "progress_message",
                "progress_event_index",
                "updated_at",
            ]
        )
