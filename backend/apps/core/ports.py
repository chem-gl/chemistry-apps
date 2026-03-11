"""ports.py: Puertos del dominio core para servicios, cache, plugins y progreso.

Este módulo define interfaces (Protocol) para separar el dominio de su
infraestructura. La regla de uso es:
- `services.py` depende de puertos, no de ORM/Celery directamente.
- `adapters.py` implementa esos puertos usando tecnología concreta.
- `factory.py` conecta puertos + adaptadores para runtime.

Cuando una app quiera extender comportamiento (por ejemplo otro mecanismo de
cache o publicación de progreso), debe crear un nuevo adaptador que implemente
estos puertos, sin modificar el caso de uso principal.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from .models import ScientificJob, ScientificJobLogEvent
from .types import (
    JobLogLevel,
    JobProgressStage,
    JSONMap,
    PluginLogCallback,
    PluginProgressCallback,
)


@dataclass(frozen=True, slots=True)
class JobProgressUpdate:
    """Representa una actualización de progreso tipada para un job científico."""

    percentage: int
    stage: JobProgressStage
    message: str


@dataclass(frozen=True, slots=True)
class JobLogUpdate:
    """Representa una actualización de log tipada para un job científico."""

    level: JobLogLevel
    source: str
    message: str
    payload: JSONMap | None = None


class CacheRepositoryPort(Protocol):
    """Puerto para consultar y persistir resultados cacheados por hash.

    Responsabilidad: encapsular lectura/escritura de cache para que el servicio
    pueda operar sin conocer detalles de base de datos o motor externo.
    """

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
    """Puerto de ejecución de plugins científicos.

    Responsabilidad: ejecutar el plugin por nombre y retornar payload tipado.
    Permite reemplazar el mecanismo de ejecución en pruebas o escenarios de
    procesamiento especializado.
    """

    def execute(
        self,
        plugin_name: str,
        parameters: JSONMap,
        progress_callback: PluginProgressCallback | None = None,
        log_callback: PluginLogCallback | None = None,
    ) -> JSONMap:
        """Ejecuta un plugin registrado y retorna un payload JSON tipado."""


class JobProgressPublisherPort(Protocol):
    """Puerto para publicar y persistir cambios de progreso de un job.

    Responsabilidad: centralizar cómo se registra avance de ejecución (por
    ejemplo, persistencia en modelo, emisión a cola, notificación externa).
    """

    def publish(self, job: ScientificJob, progress_update: JobProgressUpdate) -> None:
        """Persiste una actualización de progreso en el job recibido."""


class JobLogPublisherPort(Protocol):
    """Puerto para persistir eventos de log correlacionados por job."""

    def publish(
        self,
        job: ScientificJob,
        log_update: JobLogUpdate,
    ) -> ScientificJobLogEvent:
        """Persiste un evento de log para el job recibido."""
