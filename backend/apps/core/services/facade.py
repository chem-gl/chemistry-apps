"""services/facade.py: Fachada estática JobService para consumidores externos.

Mantiene compatibilidad con routers, tasks y pruebas existentes.
Es la API recomendada para integrar core desde otras apps del proyecto.
"""

from __future__ import annotations

from collections.abc import Callable

from ..models import ScientificJob
from ..types import JobRecoverySummary, JSONMap
from .runtime import RuntimeJobService


class JobService:
    """Fachada estática para mantener compatibilidad en routers, tasks y pruebas.

    Esta fachada evita que las apps consumidoras conozcan detalles de factoría
    o wiring interno. Es la API recomendada para integrar `core` desde otras
    apps del proyecto.
    """

    @staticmethod
    def create_job(
        plugin_name: str,
        version: str,
        parameters: JSONMap,
        *,
        owner_id: int | None = None,
        group_id: int | None = None,
    ) -> ScientificJob:
        """Crea un job usando la instancia runtime compuesta por la factoría."""
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
        from ..factory import build_job_service

        return build_job_service()

    @staticmethod
    def cancel_job(job_id: str) -> ScientificJob:
        """Cancela un job de forma irreversible desde cualquier estado activo."""
        runtime_service: RuntimeJobService = JobService._get_runtime_service()
        return runtime_service.cancel_job(job_id)

    @staticmethod
    def request_pause(job_id: str) -> ScientificJob:
        """Solicita pausa de un job reutilizable desde routers, tasks u otros módulos."""
        runtime_service: RuntimeJobService = JobService._get_runtime_service()
        return runtime_service.request_pause(job_id)

    @staticmethod
    def resume_job(job_id: str) -> ScientificJob:
        """Reanuda un job pausado para permitir su reencolado desde cualquier capa."""
        runtime_service: RuntimeJobService = JobService._get_runtime_service()
        return runtime_service.resume_job(job_id)
