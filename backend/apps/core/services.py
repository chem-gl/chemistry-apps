"""services.py: Casos de uso del dominio de jobs sin acoplamiento HTTP.

Este módulo representa la lógica de negocio principal de ejecución de jobs.
Regla de arquitectura aplicada:
- Los ViewSets y tasks llaman la fachada `JobService`.
- `JobService` delega en `RuntimeJobService`.
- `RuntimeJobService` usa puertos para cache, ejecución y progreso.

Cómo debe usarlo una app científica:
1. Crear jobs con `JobService.create_job(...)` desde su router.
2. Intentar encolado con `dispatch_scientific_job(...)`.
3. Registrar resultado de encolado con `JobService.register_dispatch_result(...)`.
4. Nunca ejecutar plugins directamente desde la capa HTTP.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta
from uuid import UUID

from django.conf import settings
from django.utils import timezone

from .cache import generate_job_hash
from .models import ScientificJob
from .ports import (
    CacheRepositoryPort,
    JobLogPublisherPort,
    JobLogUpdate,
    JobProgressPublisherPort,
    JobProgressUpdate,
    PluginExecutionPort,
)
from .types import JobLogLevel, JobProgressStage, JobRecoverySummary, JSONMap

logger = logging.getLogger(__name__)


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

    def _get_max_recovery_attempts(self) -> int:
        """Obtiene número máximo de reintentos de recuperación por job."""
        configured_max_attempts: int = int(
            getattr(settings, "JOB_RECOVERY_MAX_ATTEMPTS", 5)
        )
        return max(1, configured_max_attempts)

    def create_job(
        self, plugin_name: str, version: str, parameters: JSONMap
    ) -> ScientificJob:
        """Crea un job y resuelve cache temprano para evitar encolado innecesario."""
        job_hash: str = generate_job_hash(plugin_name, version, parameters)
        cached_result_payload: JSONMap | None = self.cache_repository.get_cached_result(
            job_hash=job_hash,
            plugin_name=plugin_name,
            algorithm_version=version,
        )

        if cached_result_payload is not None:
            cached_job: ScientificJob = ScientificJob.objects.create(
                plugin_name=plugin_name,
                algorithm_version=version,
                job_hash=job_hash,
                parameters=parameters,
                status="completed",
                cache_hit=True,
                cache_miss=False,
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
            return cached_job

        created_job: ScientificJob = ScientificJob.objects.create(
            plugin_name=plugin_name,
            algorithm_version=version,
            job_hash=job_hash,
            parameters=parameters,
            status="pending",
            cache_hit=False,
            cache_miss=True,
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
        return created_job

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

    def run_job(self, job_id: str) -> None:
        """Ejecuta un job en background y persiste progreso, resultado y errores."""
        job: ScientificJob | None = self._get_job_or_none(job_id)
        if job is None:
            return

        if job.status in {"completed", "failed"}:
            logger.info("Job %s ya estaba finalizado con estado %s", job_id, job.status)
            self._publish_job_log(
                job,
                level="debug",
                source="core.runtime",
                message="Ejecución omitida porque el job ya está finalizado.",
                payload={"status": job.status},
            )
            return

        job.status = "running"
        job.last_heartbeat_at = timezone.now()
        job.save(update_fields=["status", "last_heartbeat_at", "updated_at"])
        self.progress_publisher.publish(
            job,
            JobProgressUpdate(
                percentage=10,
                stage="running",
                message="Job en ejecución por worker asíncrono.",
            ),
        )
        self._publish_job_log(
            job,
            level="info",
            source="core.runtime",
            message="Job iniciado en worker asíncrono.",
        )

        cached_result_payload: JSONMap | None = self.cache_repository.get_cached_result(
            job_hash=job.job_hash,
            plugin_name=job.plugin_name,
            algorithm_version=job.algorithm_version,
        )
        if cached_result_payload is not None:
            self._publish_job_log(
                job,
                level="info",
                source="core.cache",
                message="Resultado recuperado desde caché durante ejecución.",
            )
            self._finish_with_result(
                job=job,
                job_id=job_id,
                result_payload=cached_result_payload,
                from_cache=True,
            )
            return

        self.progress_publisher.publish(
            job,
            JobProgressUpdate(
                percentage=35,
                stage="running",
                message="Ejecutando plugin científico.",
            ),
        )
        self._publish_job_log(
            job,
            level="info",
            source="core.runtime",
            message="Iniciando ejecución de plugin científico.",
            payload={"plugin_name": job.plugin_name},
        )

        try:

            def report_plugin_progress(
                plugin_percentage: int,
                plugin_stage: JobProgressStage,
                plugin_message: str,
            ) -> None:
                """Publica progreso granular del plugin dentro del rango de ejecución.

                Se mapea el rango [0, 100] del plugin al rango [35, 79] del flujo
                global para reservar 80% al paso de cache y 100% al cierre.
                """
                normalized_percentage: int = max(0, min(100, int(plugin_percentage)))
                mapped_runtime_percentage: int = 35 + int(
                    normalized_percentage * 44 / 100
                )

                self.progress_publisher.publish(
                    job,
                    JobProgressUpdate(
                        percentage=mapped_runtime_percentage,
                        stage=plugin_stage,
                        message=plugin_message,
                    ),
                )

            def report_plugin_log(
                level: JobLogLevel,
                source: str,
                message: str,
                payload: JSONMap | None,
            ) -> None:
                """Persiste logs del plugin de forma correlacionada por job."""
                self._publish_job_log(
                    job,
                    level=level,
                    source=source,
                    message=message,
                    payload=payload,
                )

            result_payload: JSONMap = self.plugin_execution.execute(
                job.plugin_name,
                job.parameters,
                progress_callback=report_plugin_progress,
                log_callback=report_plugin_log,
            )

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
                source="core.cache",
                message="Persistiendo resultado calculado en caché.",
            )

            self.cache_repository.store_cached_result(
                job_hash=job.job_hash,
                plugin_name=job.plugin_name,
                algorithm_version=job.algorithm_version,
                result_payload=result_payload,
            )

            self._finish_with_result(
                job=job,
                job_id=job_id,
                result_payload=result_payload,
                from_cache=False,
            )
        except (
            ValueError,
            TypeError,
            KeyError,
            ZeroDivisionError,
            RuntimeError,
        ) as service_error:
            self._publish_job_log(
                job,
                level="error",
                source="core.runtime",
                message="Error durante ejecución del job.",
                payload={"error": str(service_error)},
            )
            self._finish_with_failure(
                job=job, job_id=job_id, error_message=str(service_error)
            )

    def run_active_recovery(
        self,
        *,
        dispatch_callback: Callable[[str], bool],
        stale_seconds: int,
        include_pending_jobs: bool,
        exclude_job_id: str | None = None,
    ) -> JobRecoverySummary:
        """Detecta jobs potencialmente huérfanos y reintenta su ejecución."""
        now_value = timezone.now()
        stale_threshold = now_value - timedelta(seconds=max(5, stale_seconds))
        summary: JobRecoverySummary = {
            "stale_running_detected": 0,
            "stale_pending_detected": 0,
            "requeued_successfully": 0,
            "requeue_failed": 0,
            "marked_failed_by_retries": 0,
        }

        stale_running_jobs = ScientificJob.objects.filter(
            status="running",
            updated_at__lt=stale_threshold,
        ).order_by("created_at")

        pending_queryset = ScientificJob.objects.none()
        if include_pending_jobs:
            pending_queryset = ScientificJob.objects.filter(
                status="pending",
                updated_at__lt=stale_threshold,
            ).order_by("created_at")

        candidate_jobs: list[ScientificJob] = list(stale_running_jobs) + list(
            pending_queryset
        )

        seen_job_ids: set[str] = set()
        for job in candidate_jobs:
            normalized_job_id: str = str(job.id)
            if normalized_job_id in seen_job_ids:
                continue
            seen_job_ids.add(normalized_job_id)

            if exclude_job_id is not None and normalized_job_id == exclude_job_id:
                continue

            if job.status == "running":
                summary["stale_running_detected"] += 1
            else:
                summary["stale_pending_detected"] += 1

            if int(job.recovery_attempts) >= int(job.max_recovery_attempts):
                self._finish_with_failure(
                    job=job,
                    job_id=normalized_job_id,
                    error_message=(
                        "Límite de recuperación automática alcanzado tras caída o "
                        "estado inconsistente."
                    ),
                )
                summary["marked_failed_by_retries"] += 1
                self._publish_job_log(
                    job,
                    level="error",
                    source="core.recovery",
                    message="Job marcado como failed por exceder reintentos de recuperación.",
                    payload={
                        "recovery_attempts": int(job.recovery_attempts),
                        "max_recovery_attempts": int(job.max_recovery_attempts),
                    },
                )
                continue

            job.status = "pending"
            job.recovery_attempts = int(job.recovery_attempts) + 1
            job.last_recovered_at = now_value
            job.last_heartbeat_at = now_value
            job.save(
                update_fields=[
                    "status",
                    "recovery_attempts",
                    "last_recovered_at",
                    "last_heartbeat_at",
                    "updated_at",
                ]
            )

            self.progress_publisher.publish(
                job,
                JobProgressUpdate(
                    percentage=max(10, int(job.progress_percentage)),
                    stage="recovering",
                    message=(
                        "Recuperación activa detectó job interrumpido y está "
                        "reencolando la ejecución."
                    ),
                ),
            )
            self._publish_job_log(
                job,
                level="warning",
                source="core.recovery",
                message="Job marcado para recuperación activa y reencolado.",
                payload={
                    "recovery_attempt": int(job.recovery_attempts),
                    "stale_threshold_seconds": int(stale_seconds),
                },
            )

            was_dispatched: bool = dispatch_callback(normalized_job_id)
            self.register_dispatch_result(normalized_job_id, was_dispatched)
            if was_dispatched:
                summary["requeued_successfully"] += 1
            else:
                summary["requeue_failed"] += 1

        return summary

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

    def _finish_with_result(
        self,
        *,
        job: ScientificJob,
        job_id: str,
        result_payload: JSONMap,
        from_cache: bool,
    ) -> None:
        """Finaliza un job exitosamente y publica evento terminal de progreso."""
        completion_message: str = (
            "Resultado obtenido desde caché durante la ejecución."
            if from_cache
            else "Job completado correctamente."
        )

        job.status = "completed"
        job.results = result_payload
        job.cache_hit = from_cache
        job.cache_miss = not from_cache
        job.error_trace = None
        job.progress_percentage = 100
        job.progress_stage = "completed"
        job.progress_message = completion_message
        job.save(
            update_fields=[
                "status",
                "results",
                "cache_hit",
                "cache_miss",
                "error_trace",
                "progress_percentage",
                "progress_stage",
                "progress_message",
                "updated_at",
            ]
        )
        self.progress_publisher.publish(
            job,
            JobProgressUpdate(
                percentage=100,
                stage="completed",
                message=completion_message,
            ),
        )
        self._publish_job_log(
            job,
            level="info",
            source="core.runtime",
            message="Job completado correctamente.",
            payload={"from_cache": from_cache},
        )
        logger.info("Ejecución completada para job %s", job_id)

    def _finish_with_failure(
        self, *, job: ScientificJob, job_id: str, error_message: str
    ) -> None:
        """Finaliza un job con error manejado y deja trazabilidad para soporte."""
        job.status = "failed"
        job.results = None
        job.error_trace = error_message
        job.progress_percentage = 100
        job.progress_stage = "failed"
        job.progress_message = "Job finalizado con error. Revisar error_trace."
        job.save(
            update_fields=[
                "status",
                "results",
                "error_trace",
                "progress_percentage",
                "progress_stage",
                "progress_message",
                "updated_at",
            ]
        )

        self.progress_publisher.publish(
            job,
            JobProgressUpdate(
                percentage=100,
                stage="failed",
                message="Job finalizado con error. Revisar error_trace.",
            ),
        )
        self._publish_job_log(
            job,
            level="error",
            source="core.runtime",
            message="Job finalizado con error.",
            payload={"error": error_message},
        )
        logger.error("Ejecución fallida para job %s: %s", job_id, error_message)

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
        self.log_publisher.publish(
            job,
            JobLogUpdate(
                level=level,
                source=source,
                message=message,
                payload=payload,
            ),
        )


class JobService:
    """Fachada estática para mantener compatibilidad en routers, tasks y pruebas.

    Esta fachada evita que las apps consumidoras conozcan detalles de factoría
    o wiring interno. Es la API recomendada para integrar `core` desde otras
    apps del proyecto.
    """

    @staticmethod
    def create_job(
        plugin_name: str, version: str, parameters: JSONMap
    ) -> ScientificJob:
        """Crea un job usando la instancia runtime compuesta por la factoría."""
        runtime_service: RuntimeJobService = JobService._get_runtime_service()
        return runtime_service.create_job(plugin_name, version, parameters)

    @staticmethod
    def register_dispatch_result(job_id: str, was_dispatched: bool) -> None:
        """Persiste el resultado del intento de encolado del job."""
        runtime_service: RuntimeJobService = JobService._get_runtime_service()
        runtime_service.register_dispatch_result(job_id, was_dispatched)

    @staticmethod
    def run_job(job_id: str) -> None:
        """Ejecuta un job en segundo plano mediante el servicio runtime."""
        runtime_service: RuntimeJobService = JobService._get_runtime_service()
        runtime_service.run_job(job_id)

    @staticmethod
    def run_active_recovery(
        *,
        dispatch_callback: Callable[[str], bool],
        stale_seconds: int,
        include_pending_jobs: bool,
        exclude_job_id: str | None = None,
    ) -> JobRecoverySummary:
        """Ejecuta recuperación activa de jobs potencialmente huérfanos."""
        runtime_service: RuntimeJobService = JobService._get_runtime_service()
        return runtime_service.run_active_recovery(
            dispatch_callback=dispatch_callback,
            stale_seconds=stale_seconds,
            include_pending_jobs=include_pending_jobs,
            exclude_job_id=exclude_job_id,
        )

    @staticmethod
    def _get_runtime_service() -> RuntimeJobService:
        """Resuelve el servicio runtime lazily para evitar ciclos de importación."""
        from .factory import build_job_service

        return build_job_service()
