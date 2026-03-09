"""services.py: Casos de uso del dominio de jobs sin acoplamiento HTTP."""

import logging
from uuid import UUID

from .cache import generate_job_hash
from .models import ScientificCacheEntry, ScientificJob
from .types import JSONMap

logger = logging.getLogger(__name__)


class JobService:
    """Servicio de orquestacion para ciclo de vida de ScientificJob."""

    @staticmethod
    def create_job(
        plugin_name: str, version: str, parameters: JSONMap
    ) -> ScientificJob:
        """Crea job y aplica cache temprano para evitar encolado innecesario."""
        job_hash = generate_job_hash(plugin_name, version, parameters)

        cached_entry: ScientificCacheEntry | None = ScientificCacheEntry.objects.filter(
            job_hash=job_hash,
            plugin_name=plugin_name,
            algorithm_version=version,
        ).first()

        if cached_entry is not None:
            cached_entry.hit_count += 1
            cached_entry.save(update_fields=["hit_count", "last_accessed_at"])
            return ScientificJob.objects.create(
                plugin_name=plugin_name,
                algorithm_version=version,
                job_hash=job_hash,
                parameters=parameters,
                status="completed",
                cache_hit=True,
                cache_miss=False,
                results=cached_entry.result_payload,
            )

        return ScientificJob.objects.create(
            plugin_name=plugin_name,
            algorithm_version=version,
            job_hash=job_hash,
            parameters=parameters,
            status="pending",
            cache_hit=False,
            cache_miss=True,
        )

    @staticmethod
    def run_job(job_id: str) -> None:
        """Ejecuta job en segundo plano y persiste resultado/cache de forma segura."""
        try:
            parsed_job_id: UUID = UUID(job_id)
            job: ScientificJob = ScientificJob.objects.get(id=parsed_job_id)
        except ValueError:
            logger.error("Invalid job id format: %s", job_id)
            return
        except ScientificJob.DoesNotExist:
            logger.error("Job %s not found.", job_id)
            return

        cached_entry: ScientificCacheEntry | None = ScientificCacheEntry.objects.filter(
            job_hash=job.job_hash,
            plugin_name=job.plugin_name,
            algorithm_version=job.algorithm_version,
        ).first()

        if cached_entry is not None:
            cached_entry.hit_count += 1
            cached_entry.save(update_fields=["hit_count", "last_accessed_at"])
            job.status = "completed"
            job.cache_hit = True
            job.cache_miss = False
            job.results = cached_entry.result_payload
            job.save(
                update_fields=[
                    "status",
                    "cache_hit",
                    "cache_miss",
                    "results",
                    "updated_at",
                ]
            )
            logger.info("Cache hit retrieved for job %s", job_id)
            return

        job.status = "running"
        job.save(update_fields=["status", "updated_at"])

        try:
            from .processing import PluginRegistry

            result_payload: JSONMap = PluginRegistry.execute(
                job.plugin_name, job.parameters
            )

            ScientificCacheEntry.objects.update_or_create(
                job_hash=job.job_hash,
                defaults={
                    "plugin_name": job.plugin_name,
                    "algorithm_version": job.algorithm_version,
                    "result_payload": result_payload,
                },
            )

            job.status = "completed"
            job.results = result_payload
            job.cache_hit = False
            job.cache_miss = True
            job.save(
                update_fields=[
                    "status",
                    "results",
                    "cache_hit",
                    "cache_miss",
                    "updated_at",
                ]
            )
            logger.info("Execution successful for job %s", job_id)
        except (
            ValueError,
            TypeError,
            KeyError,
            ZeroDivisionError,
            RuntimeError,
        ) as service_error:
            job.status = "failed"
            job.error_trace = str(service_error)
            job.save(update_fields=["status", "error_trace", "updated_at"])
            logger.error("Execution failed for job %s: %s", job_id, service_error)
