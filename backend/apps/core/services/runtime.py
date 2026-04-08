"""services/runtime.py: Clase principal RuntimeJobService con composición.

RuntimeJobService es un dataclass que inyecta puertos de infraestructura
y delega en módulos especializados para cada responsabilidad del servicio.
Mantiene la misma interfaz pública que el monolito original para
compatibilidad con tests y consumidores existentes.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from uuid import UUID

from django.db import DatabaseError
from django.utils import timezone

from ..app_registry import ScientificAppRegistry
from ..cache import generate_job_hash
from ..models import ScientificJob
from ..ports import (
    CacheRepositoryPort,
    JobLogPublisherPort,
    JobProgressPublisherPort,
    JobProgressUpdate,
    PluginExecutionPort,
)
from ..realtime import broadcast_job_update
from ..types import (
    JobLogLevel,
    JobProgressStage,
    JobRecoverySummary,
    JSONMap,
    PluginControlAction,
)
from . import cache_operations, callbacks, execution, job_control, recovery
from .config import get_max_recovery_attempts, get_result_cache_payload_limit_bytes
from .log_helpers import publish_job_log

logger = logging.getLogger(__name__)
CACHE_LOG_SOURCE = "core.cache"


@dataclass(slots=True)
class RuntimeJobService:
    """Orquesta ejecución de jobs usando puertos de infraestructura.

    Esta clase contiene el flujo de negocio completo: creación con cache
    temprano, transición de estados, publicación de progreso y manejo de error.
    Se mantiene desacoplada para que sea reutilizable y testeable.
    """

    cache_repository: CacheRepositoryPort
    plugin_execution: PluginExecutionPort
    progress_publisher: JobProgressPublisherPort
    log_publisher: JobLogPublisherPort

    # ── Configuración (delegada a config.py) ──

    def _get_max_recovery_attempts(self) -> int:
        """Obtiene número máximo de reintentos de recuperación por job."""
        return get_max_recovery_attempts()

    def _get_result_cache_payload_limit_bytes(self, plugin_name: str) -> int:
        """Retorna límite de caché para un plugin con fallback al valor global."""
        return get_result_cache_payload_limit_bytes(plugin_name)

    # ── Estimación y validación de caché (delegada a cache_operations.py) ──

    def _estimate_json_payload_size_bytes(
        self,
        payload: object,
        limit_bytes: int,
    ) -> int:
        """Estima tamaño JSON del payload sin serializar el documento completo."""
        return cache_operations.estimate_json_payload_size_bytes(payload, limit_bytes)

    def _estimate_scalar_json_size_bytes(self, value: object) -> int:
        """Estima el tamaño JSON de un valor escalar o fallback serializable."""
        return cache_operations.estimate_scalar_json_size_bytes(value)

    def _is_cache_payload_usable_for_plugin(
        self,
        *,
        plugin_name: str,
        payload: JSONMap,
    ) -> bool:
        """Valida que un payload cacheado sea reutilizable por plugin."""
        return cache_operations.is_cache_payload_usable_for_plugin(
            plugin_name=plugin_name,
            payload=payload,
        )

    # ── Creación de jobs ──

    def create_job(
        self,
        plugin_name: str,
        version: str,
        parameters: JSONMap,
        *,
        owner_id: int | None = None,
        group_id: int | None = None,
    ) -> ScientificJob:
        """Crea un job y resuelve cache temprano para evitar encolado innecesario."""
        job_hash: str = generate_job_hash(plugin_name, version, parameters)
        cached_result_payload: JSONMap | None = self.cache_repository.get_cached_result(
            job_hash=job_hash,
            plugin_name=plugin_name,
            algorithm_version=version,
        )

        if (
            cached_result_payload is not None
            and self._is_cache_payload_usable_for_plugin(
                plugin_name=plugin_name,
                payload=cached_result_payload,
            )
        ):
            cached_job: ScientificJob = ScientificJob.objects.create(
                owner_id=owner_id,
                group_id=group_id,
                plugin_name=plugin_name,
                algorithm_version=version,
                job_hash=job_hash,
                parameters=parameters,
                status="completed",
                cache_hit=True,
                cache_miss=False,
                supports_pause_resume=ScientificAppRegistry.supports_pause_resume(
                    plugin_name
                ),
                results=cached_result_payload,
                progress_percentage=100,
                progress_stage="completed",
                progress_message="Resultado recuperado desde caché.",
                progress_event_index=1,
                recovery_attempts=0,
                max_recovery_attempts=self._get_max_recovery_attempts(),
                last_heartbeat_at=timezone.now(),
            )
            self._publish_job_log(
                cached_job,
                level="info",
                source="core.runtime",
                message="Job completado en creación por cache hit temprano.",
                payload={
                    "plugin_name": plugin_name,
                    "algorithm_version": version,
                    "cache_hit": True,
                },
            )
            broadcast_job_update(cached_job)
            return cached_job

        created_job: ScientificJob = ScientificJob.objects.create(
            owner_id=owner_id,
            group_id=group_id,
            plugin_name=plugin_name,
            algorithm_version=version,
            job_hash=job_hash,
            parameters=parameters,
            status="pending",
            cache_hit=False,
            cache_miss=True,
            supports_pause_resume=ScientificAppRegistry.supports_pause_resume(
                plugin_name
            ),
            results=None,
            progress_percentage=0,
            progress_stage="pending",
            progress_message="Job creado y en espera de encolado.",
            progress_event_index=1,
            recovery_attempts=0,
            max_recovery_attempts=self._get_max_recovery_attempts(),
            last_heartbeat_at=timezone.now(),
        )
        self._publish_job_log(
            created_job,
            level="info",
            source="core.runtime",
            message="Job creado y pendiente de encolado.",
            payload={
                "plugin_name": plugin_name,
                "algorithm_version": version,
                "cache_hit": False,
            },
        )
        if cached_result_payload is not None:
            self._publish_job_log(
                created_job,
                level="warning",
                source=CACHE_LOG_SOURCE,
                message="Cache hit descartado por payload no reutilizable para este plugin.",
                payload={"plugin_name": plugin_name},
            )
        broadcast_job_update(created_job)
        return created_job

    # ── Registro de despacho ──

    def register_dispatch_result(self, job_id: str, was_dispatched: bool) -> None:
        """Registra trazabilidad del intento de encolado para depuración operativa."""
        job: ScientificJob | None = self._get_job_or_none(job_id)
        if job is None or job.status != "pending":
            return

        if was_dispatched:
            self.progress_publisher.publish(
                job,
                JobProgressUpdate(
                    percentage=5,
                    stage="queued",
                    message="Job encolado correctamente en Celery.",
                ),
            )
            self._publish_job_log(
                job,
                level="info",
                source="core.dispatch",
                message="Job encolado correctamente.",
                payload={"job_id": str(job.id)},
            )
            return

        self.progress_publisher.publish(
            job,
            JobProgressUpdate(
                percentage=0,
                stage="pending",
                message="Broker no disponible. El job permanece pendiente.",
            ),
        )
        self._publish_job_log(
            job,
            level="warning",
            source="core.dispatch",
            message="No se pudo encolar el job; broker no disponible.",
            payload={"job_id": str(job.id)},
        )

    # ── Ejecución (delegada a execution.py) ──

    def run_job(self, job_id: str) -> None:
        """Ejecuta un job en background y persiste progreso, resultado y errores."""
        job: ScientificJob | None = self._get_job_or_none(job_id)
        if job is None:
            return

        execution.run_job(
            job,
            job_id,
            cache_repository=self.cache_repository,
            plugin_execution=self.plugin_execution,
            progress_publisher=self.progress_publisher,
            log_publisher=self.log_publisher,
            persist_result_fn=self._persist_result_in_cache_positional,
        )

    # ── Recuperación (delegada a recovery.py) ──

    def run_active_recovery(
        self,
        *,
        dispatch_callback: Callable[[str], bool],
        stale_seconds: int,
        include_pending_jobs: bool,
        exclude_job_id: str | None = None,
    ) -> JobRecoverySummary:
        """Detecta jobs potencialmente huérfanos y reintenta su ejecución."""
        return recovery.run_active_recovery(
            dispatch_callback=dispatch_callback,
            stale_seconds=stale_seconds,
            include_pending_jobs=include_pending_jobs,
            exclude_job_id=exclude_job_id,
            progress_publisher=self.progress_publisher,
            log_publisher=self.log_publisher,
            register_dispatch_fn=self.register_dispatch_result,
        )

    # ── Control de ciclo de vida (delegado a job_control.py) ──

    def request_pause(self, job_id: str) -> ScientificJob:
        """Solicita pausa cooperativa para un job."""
        job: ScientificJob | None = self._get_job_or_none(job_id)
        if job is None:
            raise ValueError("No se encontró el job solicitado para pausar.")
        return job_control.request_pause(
            job_id,
            job=job,
            progress_publisher=self.progress_publisher,
            log_publisher=self.log_publisher,
        )

    def cancel_job(self, job_id: str) -> ScientificJob:
        """Cancela un job de forma irreversible desde cualquier estado activo."""
        job: ScientificJob | None = self._get_job_or_none(job_id)
        if job is None:
            raise ValueError("No se encontró el job solicitado para cancelar.")
        return job_control.cancel_job(
            job_id,
            job=job,
            progress_publisher=self.progress_publisher,
            log_publisher=self.log_publisher,
        )

    def resume_job(self, job_id: str) -> ScientificJob:
        """Reanuda un job pausado dejándolo listo para reencolado."""
        job: ScientificJob | None = self._get_job_or_none(job_id)
        if job is None:
            raise ValueError("No se encontró el job solicitado para reanudar.")
        return job_control.resume_job(
            job_id,
            job=job,
            progress_publisher=self.progress_publisher,
            log_publisher=self.log_publisher,
        )

    # ── Callbacks para plugins (delegados a callbacks.py) ──

    def _build_plugin_progress_callback(
        self,
        job: ScientificJob,
    ) -> Callable[[int, JobProgressStage, str], None]:
        """Construye callback de progreso para mapear porcentaje del plugin."""
        return callbacks.build_plugin_progress_callback(job, self.progress_publisher)

    def _build_plugin_log_callback(
        self,
        job: ScientificJob,
    ) -> Callable[[JobLogLevel, str, str, JSONMap | None], None]:
        """Construye callback de logging correlacionado para el job en ejecución."""
        return callbacks.build_plugin_log_callback(job, self.log_publisher)

    def _build_plugin_control_callback(
        self,
        job_id: str,
    ) -> Callable[[], PluginControlAction]:
        """Construye callback de control cooperativo (continue/pause)."""
        return callbacks.build_plugin_control_callback(job_id)

    # ── Helpers internos ──

    def _get_job_or_none(self, job_id: str) -> ScientificJob | None:
        """Recupera un job por UUID y retorna None si no existe o es inválido."""
        try:
            parsed_job_id: UUID = UUID(job_id)
        except ValueError:
            logger.error("Formato inválido de job id: %s", job_id)
            return None

        try:
            return ScientificJob.objects.get(id=parsed_job_id)
        except ScientificJob.DoesNotExist:
            logger.error("Job %s no fue encontrado.", job_id)
            return None

    def _publish_job_log(
        self,
        job: ScientificJob,
        *,
        level: JobLogLevel,
        source: str,
        message: str,
        payload: JSONMap | None = None,
    ) -> None:
        """Publica un evento de log del job sin romper el flujo principal."""
        publish_job_log(
            job,
            level=level,
            source=source,
            message=message,
            payload=payload,
            log_publisher=self.log_publisher,
        )

    def _persist_result_in_cache_positional(
        self,
        job: ScientificJob,
        result_payload: JSONMap,
    ) -> None:
        """Wrapper posicional para usar como callback desde execution.py."""
        self._persist_result_in_cache(job=job, result_payload=result_payload)

    def _persist_result_in_cache(
        self,
        *,
        job: ScientificJob,
        result_payload: JSONMap,
    ) -> None:
        """Persiste el resultado exitoso en caché y publica trazabilidad.

        Usa métodos de instancia para estimación de tamaño y límites,
        permitiendo que tests puedan mock.patch estos métodos.
        """
        self.progress_publisher.publish(
            job,
            JobProgressUpdate(
                percentage=80,
                stage="caching",
                message="Persistiendo resultado en caché.",
            ),
        )
        self._publish_job_log(
            job,
            level="info",
            source=CACHE_LOG_SOURCE,
            message="Persistiendo resultado calculado en caché.",
        )

        payload_limit_bytes: int = self._get_result_cache_payload_limit_bytes(
            job.plugin_name
        )
        estimated_payload_bytes: int = self._estimate_json_payload_size_bytes(
            result_payload,
            payload_limit_bytes,
        )
        if estimated_payload_bytes > payload_limit_bytes:
            self._publish_job_log(
                job,
                level="warning",
                source=CACHE_LOG_SOURCE,
                message="Se omite persistencia en caché por tamaño de resultado excesivo.",
                payload={
                    "estimated_payload_bytes": estimated_payload_bytes,
                    "payload_limit_bytes": payload_limit_bytes,
                },
            )
            return

        try:
            self.cache_repository.store_cached_result(
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
            self._publish_job_log(
                job,
                level="warning",
                source=CACHE_LOG_SOURCE,
                message="Se omite persistencia en caché por error de almacenamiento.",
                payload={
                    "error_type": exc.__class__.__name__,
                    "error": str(exc),
                },
            )
