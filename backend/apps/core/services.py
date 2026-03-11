"""services.py: Casos de uso del dominio de jobs sin acoplamiento HTTP."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from uuid import UUID

from .cache import generate_job_hash
from .models import ScientificJob
from .ports import (
    CacheRepositoryPort,
    JobProgressPublisherPort,
    JobProgressUpdate,
    PluginExecutionPort,
)
from .types import JSONMap

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class RuntimeJobService:
    """Orquesta ejecución de jobs usando puertos de infraestructura."""

    cache_repository: CacheRepositoryPort
    plugin_execution: PluginExecutionPort
    progress_publisher: JobProgressPublisherPort

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
            return ScientificJob.objects.create(
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
            )

        return ScientificJob.objects.create(
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
        )

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
            return

        self.progress_publisher.publish(
            job,
            JobProgressUpdate(
                percentage=0,
                stage="pending",
                message="Broker no disponible. El job permanece pendiente.",
            ),
        )

    def run_job(self, job_id: str) -> None:
        """Ejecuta un job en background y persiste progreso, resultado y errores."""
        job: ScientificJob | None = self._get_job_or_none(job_id)
        if job is None:
            return

        if job.status in {"completed", "failed"}:
            logger.info("Job %s ya estaba finalizado con estado %s", job_id, job.status)
            return

        job.status = "running"
        job.save(update_fields=["status", "updated_at"])
        self.progress_publisher.publish(
            job,
            JobProgressUpdate(
                percentage=10,
                stage="running",
                message="Job en ejecución por worker asíncrono.",
            ),
        )

        cached_result_payload: JSONMap | None = self.cache_repository.get_cached_result(
            job_hash=job.job_hash,
            plugin_name=job.plugin_name,
            algorithm_version=job.algorithm_version,
        )
        if cached_result_payload is not None:
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

        try:
            result_payload: JSONMap = self.plugin_execution.execute(
                job.plugin_name,
                job.parameters,
            )

            self.progress_publisher.publish(
                job,
                JobProgressUpdate(
                    percentage=80,
                    stage="caching",
                    message="Persistiendo resultado en caché.",
                ),
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
            self._finish_with_failure(
                job=job, job_id=job_id, error_message=str(service_error)
            )

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
        job.status = "completed"
        job.results = result_payload
        job.cache_hit = from_cache
        job.cache_miss = not from_cache
        job.error_trace = None
        job.save(
            update_fields=[
                "status",
                "results",
                "cache_hit",
                "cache_miss",
                "error_trace",
                "updated_at",
            ]
        )

        completion_message: str = (
            "Resultado obtenido desde caché durante la ejecución."
            if from_cache
            else "Job completado correctamente."
        )
        self.progress_publisher.publish(
            job,
            JobProgressUpdate(
                percentage=100,
                stage="completed",
                message=completion_message,
            ),
        )
        logger.info("Ejecución completada para job %s", job_id)

    def _finish_with_failure(
        self, *, job: ScientificJob, job_id: str, error_message: str
    ) -> None:
        """Finaliza un job con error manejado y deja trazabilidad para soporte."""
        job.status = "failed"
        job.results = None
        job.error_trace = error_message
        job.save(update_fields=["status", "results", "error_trace", "updated_at"])

        self.progress_publisher.publish(
            job,
            JobProgressUpdate(
                percentage=100,
                stage="failed",
                message="Job finalizado con error. Revisar error_trace.",
            ),
        )
        logger.error("Ejecución fallida para job %s: %s", job_id, error_message)


class JobService:
    """Fachada estática para mantener compatibilidad en routers, tasks y pruebas."""

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
    def _get_runtime_service() -> RuntimeJobService:
        """Resuelve el servicio runtime lazily para evitar ciclos de importación."""
        from .factory import build_job_service

        return build_job_service()
