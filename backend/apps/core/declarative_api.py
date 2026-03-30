"""declarative_api.py: API declarativa protegida para consumo multicanal de jobs.

Este módulo expone una interfaz segura para crear, monitorear y controlar jobs
desde cualquier punto del código (HTTP, workers, scripts, servicios externos)
sin acoplarse a Django ORM, HTTP o Celery directamente.

La API se basa en monadas Result y Task para permitir composición funcional
y manejo de errores declarativo.

Uso esperado:
    from apps.core.declarative_api import DeclarativeJobAPI

    api = DeclarativeJobAPI()

    # Crear y ejecutar job de forma no-wait (recomendado)
    submit_result = api.submit_job(
        plugin="calculator",
        parameters={"op": "add", "a": 2.0, "b": 3.0},
    ).run()

    if submit_result.is_success():
        job_handle = submit_result.get_or_else(None)
        print(f"Job encolado: {job_handle.job_id}")

    # Esperar resultado con timeout (opcional, solo HTTP)
    wait_result = job_handle.wait_for_terminal(timeout_seconds=30).fold(
        on_failure=lambda err: {"error": str(err)},
        on_success=lambda result: {"success": result},
    )
"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import cast

from .app_registry import ScientificAppRegistry
from .models import ScientificJob
from .services import JobService
from .tasks import dispatch_scientific_job
from .types import (
    DeferredTask,
    DomainError,
    Failure,
    JobCancelError,
    JobDispatchError,
    JobExecutionError,
    JobHandle,
    JobLogLevel,
    JobLogListResponse,
    JobPauseNotSupportedError,
    JobProgressSnapshot,
    JobStatus,
    JobTimeoutError,
    JSONMap,
    Result,
    Success,
    Task,
)


class ConcreteJobHandle(JobHandle[JSONMap]):
    """Implementación concreta de JobHandle sobre ScientificJob ORM."""

    def __init__(
        self,
        job: ScientificJob,
        dispatch_callback: Callable[[str], bool] = dispatch_scientific_job,
    ) -> None:
        self._job = job
        self._dispatch_callback = dispatch_callback

    @property
    def job_id(self) -> str:
        return str(self._job.id)

    @property
    def status(self) -> JobStatus:
        return cast(JobStatus, self._job.status)

    @property
    def supports_pause_resume(self) -> bool:
        return bool(self._job.supports_pause_resume)

    def get_progress(self) -> JobProgressSnapshot:
        """Lee progreso actual del job sin polling/espera."""
        # Asegurar que el job está fresco desde BD
        self._job.refresh_from_db()
        return {
            "job_id": str(self._job.id),
            "status": cast(JobStatus, self._job.status),
            "progress_percentage": self._job.progress_percentage,
            "progress_stage": self._job.progress_stage,
            "progress_message": self._job.progress_message,
            "progress_event_index": self._job.progress_event_index,
            "updated_at": self._job.updated_at.isoformat().replace("+00:00", "Z"),
        }

    def get_logs(
        self, after_event_index: int = 0, limit: int = 100
    ) -> JobLogListResponse:
        """Obtiene logs del job de forma paginada."""
        log_events = self._job.log_events.filter(
            event_index__gt=after_event_index
        ).order_by("event_index")[:limit]

        next_index = 0
        last_event = log_events.last()
        if last_event is not None:
            next_index = int(last_event.event_index) + 1

        return {
            "job_id": str(self._job.id),
            "count": len(log_events),
            "next_after_event_index": next_index,
            "results": [
                {
                    "job_id": str(log_entry.job_id),
                    "event_index": log_entry.event_index,
                    "level": cast("JobLogLevel", log_entry.level),
                    "source": log_entry.source,
                    "message": log_entry.message,
                    "payload": log_entry.payload or {},
                    "created_at": log_entry.created_at.isoformat().replace(
                        "+00:00", "Z"
                    ),
                }
                for log_entry in log_events
            ],
        }

    def wait_for_terminal(
        self, timeout_seconds: int = 60
    ) -> Result[JSONMap, DomainError]:
        """Espera bloqueante hasta estado terminal o timeout.

        Esta operación es sincrónica y hace polling a BD cada 0.5s.
        Mantiene ejecución asíncrona en broker (no fallback inline).
        """
        start_time = time.time()
        poll_interval = 0.5

        while True:
            elapsed = time.time() - start_time
            if elapsed > timeout_seconds:
                return Failure(
                    JobTimeoutError(job_id=self.job_id, timeout_seconds=timeout_seconds)
                )

            # Refrescar estado desde BD
            self._job.refresh_from_db()

            # Chequear si alcanzó estado terminal
            if self._job.status in ("completed", "failed", "paused", "cancelled"):
                if self._job.status == "failed":
                    error_reason = self._job.error_trace or "Unknown error"
                    return Failure(
                        JobExecutionError(
                            plugin_name=self._job.plugin_name,
                            job_id=self.job_id,
                            reason=error_reason,
                            error_trace=self._job.error_trace,
                        )
                    )
                if self._job.status == "cancelled":
                    return Failure(
                        JobCancelError(
                            job_id=self.job_id,
                            reason="El job fue cancelado durante la ejecución.",
                        )
                    )
                # Completed o paused: retornar resultados
                results = self._job.results or {}
                return Success(results)

            # Aún en ejecución, esperar y reintentar
            time.sleep(poll_interval)

    def request_pause(self) -> Task[None, DomainError]:
        """Tarea diferida para solicitar pausa."""

        def pause_task() -> Result[None, DomainError]:
            if not self._job.supports_pause_resume:
                return Failure(
                    JobPauseNotSupportedError(plugin_name=self._job.plugin_name)
                )

            try:
                JobService.request_pause(str(self._job.id))
                return Success(None)
            except Exception as exc_value:
                return Failure(
                    DomainError(
                        f"Failed to request pause for job {self.job_id}: {exc_value}"
                    )
                )

        return DeferredTask(pause_task)

    def resume(self) -> Task[None, DomainError]:
        """Tarea diferida para reanudar ejecución."""

        def resume_task() -> Result[None, DomainError]:
            if not self._job.supports_pause_resume:
                return Failure(
                    JobPauseNotSupportedError(plugin_name=self._job.plugin_name)
                )

            # Validar que esté en paused
            self._job.refresh_from_db()
            if self._job.status != "paused":
                return Failure(
                    DomainError(
                        f"Job {self.job_id} is not paused (status: {self._job.status})"
                    )
                )

            try:
                JobService.resume_job(str(self._job.id))
                was_dispatched = self._dispatch_callback(str(self._job.id))
                if not was_dispatched:
                    return Failure(
                        JobDispatchError(
                            job_id=self.job_id,
                            reason="Broker unavailable after resume",
                        )
                    )
                return Success(None)
            except Exception as exc_value:
                return Failure(
                    DomainError(f"Failed to resume job {self.job_id}: {exc_value}")
                )

        return DeferredTask(resume_task)

    def cancel(self) -> Task[None, DomainError]:
        """Tarea diferida para cancelar el job de forma irreversible."""

        def cancel_task() -> Result[None, DomainError]:
            self._job.refresh_from_db()

            if self._job.status in {"completed", "failed", "cancelled"}:
                return Failure(
                    JobCancelError(
                        job_id=self.job_id,
                        reason=f"El job ya está en estado terminal: {self._job.status}",
                    )
                )

            try:
                JobService.cancel_job(str(self._job.id))
                self._job.refresh_from_db()
                return Success(None)
            except Exception as exc_value:
                return Failure(
                    DomainError(f"Failed to cancel job {self.job_id}: {exc_value}")
                )

        return DeferredTask(cancel_task)

    def dispatch_if_pending(self) -> Task[None, DomainError]:
        """Tarea diferida para despachar el job si todavía está pendiente.

        Úsalo después de almacenar artefactos de entrada cuando el flujo de
        creación se realiza en dos pasos con ``DeclarativeJobAPI.prepare_job()``.
        Los jobs con cache hit (status != pending) se ignoran silenciosamente.
        """

        def dispatch_task() -> Result[None, DomainError]:
            self._job.refresh_from_db()
            if self._job.status != "pending":
                # Cache hit o estado ya cambiado: nada que despachar
                return Success(None)

            try:
                was_dispatched = self._dispatch_callback(str(self._job.id))
                JobService.register_dispatch_result(str(self._job.id), was_dispatched)
                return Success(None)
            except Exception as exc_value:
                return Failure(
                    DomainError(f"Failed to dispatch job {self.job_id}: {exc_value}")
                )

        return DeferredTask(dispatch_task)


class DeclarativeJobAPI:
    """API declarativa protegida para acceso multicanal a jobs."""

    def __init__(
        self,
        dispatch_callback: Callable[[str], bool] = dispatch_scientific_job,
    ) -> None:
        """Inicializa API con callback de encolado configurable."""
        self._dispatch_callback = dispatch_callback

    def submit_job(
        self,
        *,
        plugin: str,
        parameters: JSONMap,
        version: str = "1.0",
    ) -> Task[JobHandle[JSONMap], DomainError]:
        """Tarea diferida para crear, encolar y retornar handle de job.

        Esta es la operación recomendada para consumo externo.
        No espera finalización (no-wait).
        """

        def submit_computation() -> Result[JobHandle[JSONMap], DomainError]:
            try:
                # Validar que plugin existe y está disponible
                app_def = ScientificAppRegistry.get_definition_by_plugin(plugin)
                if not app_def:
                    return Failure(
                        DomainError(f"Plugin '{plugin}' not found in registry")
                    )

                # Crear job (con early cache hit automático)
                job = JobService.create_job(
                    plugin_name=plugin, version=version, parameters=parameters
                )

                # Intentar encolar (broker puede fallar, pero es tolerable)
                was_dispatched = self._dispatch_callback(str(job.id))

                # Registrar resultado del dispatch
                JobService.register_dispatch_result(str(job.id), was_dispatched)

                # Retornar handle aunque dispatch haya fallado
                handle = ConcreteJobHandle(
                    job=job,
                    dispatch_callback=self._dispatch_callback,
                )
                return Success(handle)

            except Exception as exc_value:
                return Failure(DomainError(f"Failed to submit job: {exc_value}"))

        return DeferredTask(submit_computation)

    def get_job_handle(self, *, job_id: str) -> Result[JobHandle[JSONMap], DomainError]:
        """Obtiene handle para job existente."""
        try:
            job = ScientificJob.objects.get(id=job_id)
            handle = ConcreteJobHandle(
                job=job,
                dispatch_callback=self._dispatch_callback,
            )
            return Success(handle)
        except ScientificJob.DoesNotExist:
            return Failure(DomainError(f"Job {job_id} not found"))
        except Exception as exc_value:
            return Failure(DomainError(f"Failed to get job handle: {exc_value}"))

    def prepare_job(
        self,
        *,
        plugin: str,
        parameters: JSONMap,
        version: str = "1.0",
    ) -> Task[JobHandle[JSONMap], DomainError]:
        """Tarea diferida que crea el job sin encolarlo.

        Usa este método cuando necesitas realizar pasos intermedios (por
        ejemplo, persistir artefactos de entrada) antes de despachar al broker.
        Después de los pasos intermedios, usa ``handle.dispatch_if_pending()``
        para encolar la ejecución.
        """

        def prepare_computation() -> Result[JobHandle[JSONMap], DomainError]:
            try:
                app_def = ScientificAppRegistry.get_definition_by_plugin(plugin)
                if not app_def:
                    return Failure(
                        DomainError(f"Plugin '{plugin}' not found in registry")
                    )

                job = JobService.create_job(
                    plugin_name=plugin, version=version, parameters=parameters
                )

                handle = ConcreteJobHandle(
                    job=job,
                    dispatch_callback=self._dispatch_callback,
                )
                return Success(handle)

            except Exception as exc_value:
                return Failure(DomainError(f"Failed to prepare job: {exc_value}"))

        return DeferredTask(prepare_computation)

    def submit_and_wait(
        self,
        *,
        plugin: str,
        parameters: JSONMap,
        version: str = "1.0",
        timeout_seconds: int = 60,
    ) -> Task[JSONMap, DomainError]:
        """Tarea diferida que crea, encola y espera resultado con timeout.

        Útil para integraciones síncronas que necesitan resultado final.
        """

        def submit_and_wait_computation() -> Result[JSONMap, DomainError]:
            # Paso 1: submit
            submit_task = self.submit_job(
                plugin=plugin, parameters=parameters, version=version
            )
            submit_result = submit_task.run()

            if submit_result.is_failure():
                submit_error: DomainError = submit_result.fold(
                    on_failure=lambda error_value: error_value,
                    on_success=lambda _: DomainError("Unexpected submit state"),
                )
                return Failure(submit_error)

            handle = submit_result.get_or_else(None)
            if not handle:
                return Failure(DomainError("Failed to create job handle"))

            # Paso 2: wait
            return handle.wait_for_terminal(timeout_seconds=timeout_seconds)

        return DeferredTask(submit_and_wait_computation)

    def list_jobs(
        self,
        *,
        plugin_name: str | None = None,
        status: JobStatus | None = None,
        limit: int = 100,
    ) -> Result[list[JobHandle[JSONMap]], DomainError]:
        """Lista jobs con filtros opcionales (no diferido)."""
        try:
            query = ScientificJob.objects.all()

            if plugin_name is not None:
                query = query.filter(plugin_name=plugin_name)

            if status is not None:
                query = query.filter(status=status)

            jobs = query.order_by("-created_at")[:limit]
            handles = [
                ConcreteJobHandle(
                    job=job,
                    dispatch_callback=self._dispatch_callback,
                )
                for job in jobs
            ]
            return Success(handles)

        except Exception as exc_value:
            return Failure(DomainError(f"Failed to list jobs: {exc_value}"))
