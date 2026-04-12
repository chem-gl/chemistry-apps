"""services/__init__.py: API pública del paquete services del dominio core.

Mantiene compatibilidad con todas las importaciones existentes de la forma
`from .services import JobService` o `from apps.core.services import RuntimeJobService`.
"""

from __future__ import annotations

from collections.abc import Callable

from django.contrib.auth.models import AbstractUser

from ..models import ScientificJob
from ..types import JobDeleteResult, JobRecoverySummary, JSONMap
from .runtime import RuntimeJobService


class JobService:
    """Fachada estática para mantener compatibilidad en routers, tasks y pruebas."""

    @staticmethod
    def create_job(
        plugin_name: str,
        version: str,
        parameters: JSONMap,
        *,
        owner_id: int | None = None,
        group_id: int | None = None,
    ) -> ScientificJob:
        runtime_service: RuntimeJobService = JobService._get_runtime_service()
        return runtime_service.create_job(
            plugin_name,
            version,
            parameters,
            owner_id=owner_id,
            group_id=group_id,
        )

    @staticmethod
    def register_dispatch_result(job_id: str, was_dispatched: bool) -> None:
        runtime_service: RuntimeJobService = JobService._get_runtime_service()
        runtime_service.register_dispatch_result(job_id, was_dispatched)

    @staticmethod
    def run_job(job_id: str) -> None:
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
        runtime_service: RuntimeJobService = JobService._get_runtime_service()
        return runtime_service.run_active_recovery(
            dispatch_callback=dispatch_callback,
            stale_seconds=stale_seconds,
            include_pending_jobs=include_pending_jobs,
            exclude_job_id=exclude_job_id,
        )

    @staticmethod
    def _get_runtime_service() -> RuntimeJobService:
        from ..factory import build_job_service

        return build_job_service()

    @staticmethod
    def cancel_job(job_id: str) -> ScientificJob:
        runtime_service: RuntimeJobService = JobService._get_runtime_service()
        return runtime_service.cancel_job(job_id)

    @staticmethod
    def request_pause(job_id: str) -> ScientificJob:
        runtime_service: RuntimeJobService = JobService._get_runtime_service()
        return runtime_service.request_pause(job_id)

    @staticmethod
    def resume_job(job_id: str) -> ScientificJob:
        runtime_service: RuntimeJobService = JobService._get_runtime_service()
        return runtime_service.resume_job(job_id)

    @staticmethod
    def delete_job(job_id: str, *, actor: AbstractUser) -> JobDeleteResult:
        runtime_service: RuntimeJobService = JobService._get_runtime_service()
        return runtime_service.delete_job(job_id, actor=actor)

    @staticmethod
    def restore_job(job_id: str, *, actor: AbstractUser) -> ScientificJob:
        runtime_service: RuntimeJobService = JobService._get_runtime_service()
        return runtime_service.restore_job(job_id, actor=actor)

    @staticmethod
    def purge_expired_deleted_jobs() -> int:
        runtime_service: RuntimeJobService = JobService._get_runtime_service()
        return runtime_service.purge_expired_deleted_jobs()


__all__ = ["JobService", "RuntimeJobService"]
