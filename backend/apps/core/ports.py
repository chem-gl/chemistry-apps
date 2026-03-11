"""ports.py: Puertos del dominio core para servicios, cache, plugins y progreso."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from .models import ScientificJob
from .types import JobProgressStage, JSONMap


@dataclass(frozen=True, slots=True)
class JobProgressUpdate:
    """Representa una actualización de progreso tipada para un job científico."""

    percentage: int
    stage: JobProgressStage
    message: str


class CacheRepositoryPort(Protocol):
    """Puerto para consultar y persistir resultados cacheados por hash."""

    def get_cached_result(
        self,
        *,
        job_hash: str,
        plugin_name: str,
        algorithm_version: str,
    ) -> JSONMap | None:
        """Retorna payload cacheado o None si no existe una entrada válida."""

    def store_cached_result(
        self,
        *,
        job_hash: str,
        plugin_name: str,
        algorithm_version: str,
        result_payload: JSONMap,
    ) -> None:
        """Guarda o actualiza el resultado cacheado para un hash dado."""


class PluginExecutionPort(Protocol):
    """Puerto de ejecución de plugins científicos."""

    def execute(self, plugin_name: str, parameters: JSONMap) -> JSONMap:
        """Ejecuta un plugin registrado y retorna un payload JSON tipado."""


class JobProgressPublisherPort(Protocol):
    """Puerto para publicar y persistir cambios de progreso de un job."""

    def publish(self, job: ScientificJob, progress_update: JobProgressUpdate) -> None:
        """Persiste una actualización de progreso en el job recibido."""
