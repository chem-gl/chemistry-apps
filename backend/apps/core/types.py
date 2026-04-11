"""types.py: Tipos compartidos para tipado estricto del dominio cientifico.

Objetivo del archivo:
- Centralizar aliases JSON, snapshots de dominio, errores tipados y abstracciones
    funcionales (Result/Task/JobHandle) usadas por todo `apps.core`.

Cómo se usa:
- Importar tipos desde aquí evita divergencias semánticas entre servicios,
    routers, adapters, tasks y pruebas.
- Cualquier nuevo contrato transversal debe definirse aquí antes de propagarse.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Callable
from typing import Literal, TypedDict

type JSONPrimitive = str | int | float | bool | None
type JSONValue = JSONPrimitive | list[JSONValue] | dict[str, JSONValue]
type JSONMap = dict[str, JSONValue]

# Monadic types for declarative consumption API
type JobStatus = Literal[
    "pending",
    "running",
    "paused",
    "completed",
    "failed",
    "cancelled",
]
type JobDeletionMode = Literal["hard", "soft"]
type JobProgressStage = Literal[
    "pending",
    "queued",
    "running",
    "paused",
    "recovering",
    "caching",
    "completed",
    "failed",
    "cancelled",
]
type PluginProgressCallback = Callable[[int, JobProgressStage, str], None]
type JobLogLevel = Literal["debug", "info", "warning", "error"]
type PluginLogCallback = Callable[[JobLogLevel, str, str, JSONMap | None], None]
type PluginControlAction = Literal["continue", "pause"]
type PluginControlCallback = Callable[[], PluginControlAction]


class JobCreatePayload(TypedDict):
    """Estructura tipada para crear un ScientificJob desde capa API."""

    plugin_name: str
    version: str
    parameters: JSONMap


class JobProgressSnapshot(TypedDict):
    """Snapshot tipado del progreso de un job para API y SSE."""

    job_id: str
    status: JobStatus
    progress_percentage: int
    progress_stage: JobProgressStage
    progress_message: str
    progress_event_index: int
    updated_at: str


class JobControlSnapshot(TypedDict):
    """Snapshot tipado de control cooperativo de ejecución de un job."""

    job_id: str
    pause_requested: bool
    supports_pause_resume: bool
    status: JobStatus


class JobLogEntry(TypedDict):
    """Evento tipado de logging en tiempo real por job."""

    job_id: str
    event_index: int
    level: JobLogLevel
    source: str
    message: str
    payload: JSONMap
    created_at: str


class JobLogListResponse(TypedDict):
    """Respuesta tipada para listado paginado de logs por job."""

    job_id: str
    count: int
    next_after_event_index: int
    results: list[JobLogEntry]


class JobDeleteResult(TypedDict):
    """Resultado tipado de una operación de borrado de job."""

    job_id: str
    deletion_mode: JobDeletionMode
    scheduled_hard_delete_at: str | None


class JobRecoverySummary(TypedDict):
    """Resumen tipado de ejecución de recuperación activa de jobs."""

    stale_running_detected: int
    stale_pending_detected: int
    requeued_successfully: int
    requeue_failed: int
    marked_failed_by_retries: int


# === DOMAIN ERROR TYPES FOR EXTERNAL CONSUMERS ===


class DomainError(Exception):
    """Base exception for domain errors in declarative API."""

    pass


class JobExecutionError(DomainError):
    """Plugin execution failed with domain exception (ValueError, etc)."""

    def __init__(
        self,
        *,
        plugin_name: str,
        job_id: str,
        reason: str,
        error_trace: str | None = None,
    ) -> None:
        self.plugin_name = plugin_name
        self.job_id = job_id
        self.reason = reason
        self.error_trace = error_trace
        super().__init__(f"Job {job_id} ({plugin_name}) failed: {reason}")


class JobDispatchError(DomainError):
    """Enqueue to broker failed (Redis down, etc)."""

    def __init__(self, *, job_id: str, reason: str) -> None:
        self.job_id = job_id
        self.reason = reason
        super().__init__(f"Failed to dispatch job {job_id}: {reason}")


class JobTimeoutError(DomainError):
    """Wait for completion exceeded timeout."""

    def __init__(self, *, job_id: str, timeout_seconds: int) -> None:
        self.job_id = job_id
        self.timeout_seconds = timeout_seconds
        super().__init__(
            f"Job {job_id} did not complete within {timeout_seconds} seconds"
        )


class JobValidationError(DomainError):
    """Input parameters failed domain validation."""

    def __init__(self, *, plugin_name: str, reason: str) -> None:
        self.plugin_name = plugin_name
        self.reason = reason
        super().__init__(f"Validation failed for {plugin_name}: {reason}")


class JobPauseNotSupportedError(DomainError):
    """Plugin does not support pause/resume."""

    def __init__(self, *, plugin_name: str) -> None:
        self.plugin_name = plugin_name
        super().__init__(f"Plugin {plugin_name} does not support pause/resume")


class JobCancelError(DomainError):
    """Job cannot be cancelled (already in terminal state)."""

    def __init__(self, *, job_id: str, reason: str) -> None:
        self.job_id = job_id
        self.reason = reason
        super().__init__(f"Cannot cancel job {job_id}: {reason}")


# === MONADIC TYPES FOR DECLARATIVE CONSUMPTION ===


class Result[S, E](ABC):
    """Monad for success/failure handling without exceptions.

    Supports map, flat_map, recover, fold for functional composition.
    Borrowed from Rust Result and Scala Either patterns.
    """

    @abstractmethod
    def is_success(self) -> bool:
        """True if result contains success value."""
        pass

    @abstractmethod
    def is_failure(self) -> bool:
        """True if result contains error value."""
        pass

    @abstractmethod
    def get_or_else(self, default_value: S) -> S:
        """Extract success value or return default."""
        pass

    @abstractmethod
    def map[T](self, f: Callable[[S], T]) -> Result[T, E]:
        """Transform success value; pass failure through."""
        pass

    @abstractmethod
    def flat_map[T](self, f: Callable[[S], Result[T, E]]) -> Result[T, E]:
        """Chain operations returning Result."""
        pass

    @abstractmethod
    def recover(self, f: Callable[[E], S]) -> Result[S, E]:
        """Transform error to success value."""
        pass

    @abstractmethod
    def recover_with(self, f: Callable[[E], Result[S, E]]) -> Result[S, E]:
        """Chain recovery operation returning Result."""
        pass

    @abstractmethod
    def fold[T](self, on_failure: Callable[[E], T], on_success: Callable[[S], T]) -> T:
        """Apply one of two functions based on success/failure."""
        pass


class Success[S, E](Result[S, E]):
    """Result containing a success value."""

    def __init__(self, value: S) -> None:
        self._value = value

    def is_success(self) -> bool:
        return True

    def is_failure(self) -> bool:
        return False

    def get_or_else(self, default_value: S) -> S:
        return self._value

    def map[T](self, f: Callable[[S], T]) -> Result[T, E]:
        return Success(f(self._value))

    def flat_map[T](self, f: Callable[[S], Result[T, E]]) -> Result[T, E]:
        return f(self._value)

    def recover(self, f: Callable[[E], S]) -> Result[S, E]:
        return self

    def recover_with(self, f: Callable[[E], Result[S, E]]) -> Result[S, E]:
        return self

    def fold[T](self, on_failure: Callable[[E], T], on_success: Callable[[S], T]) -> T:
        return on_success(self._value)


class Failure[S, E](Result[S, E]):
    """Result containing an error value."""

    def __init__(self, error: E) -> None:
        self._error = error

    def is_success(self) -> bool:
        return False

    def is_failure(self) -> bool:
        return True

    def get_or_else(self, default_value: S) -> S:
        return default_value

    def map[T](self, f: Callable[[S], T]) -> Result[T, E]:
        return Failure(self._error)

    def flat_map[T](self, f: Callable[[S], Result[T, E]]) -> Result[T, E]:
        return Failure(self._error)

    def recover(self, f: Callable[[E], S]) -> Result[S, E]:
        return Success(f(self._error))

    def recover_with(self, f: Callable[[E], Result[S, E]]) -> Result[S, E]:
        return f(self._error)

    def fold[T](self, on_failure: Callable[[E], T], on_success: Callable[[S], T]) -> T:
        return on_failure(self._error)


class Task[S, E](ABC):
    """Monad for deferred computation with error handling.

    Represents a computation that can be composed and run later.
    Similar to Haskell IO or Scala Task.
    """

    @abstractmethod
    def run(self) -> Result[S, E]:
        """Execute the computation and return result."""
        pass

    @abstractmethod
    def map[T](self, f: Callable[[S], T]) -> Task[T, E]:
        """Transform success value; defer execution."""
        pass

    @abstractmethod
    def flat_map[T](self, f: Callable[[S], Task[T, E]]) -> Task[T, E]:
        """Chain operations; defer execution."""
        pass


class PureTask[S, E](Task[S, E]):
    """Task that returns a fixed result without side effects."""

    def __init__(self, result: Result[S, E]) -> None:
        self._result = result

    def run(self) -> Result[S, E]:
        return self._result

    def map[T](self, f: Callable[[S], T]) -> Task[T, E]:
        return PureTask(self._result.map(f))

    def flat_map[T](self, f: Callable[[S], Task[T, E]]) -> Task[T, E]:
        def compute() -> Result[T, E]:
            return self._result.fold(
                on_failure=lambda err: Failure(err),
                on_success=lambda val: f(val).run(),
            )

        return DeferredTask(compute)


class DeferredTask[S, E](Task[S, E]):
    """Task that defers computation to run time."""

    def __init__(self, computation: Callable[[], Result[S, E]]) -> None:
        self._computation = computation

    def run(self) -> Result[S, E]:
        return self._computation()

    def map[T](self, f: Callable[[S], T]) -> Task[T, E]:
        def mapped_computation() -> Result[T, E]:
            return self._computation().map(f)

        return DeferredTask(mapped_computation)

    def flat_map[T](self, f: Callable[[S], Task[T, E]]) -> Task[T, E]:
        def chained_computation() -> Result[T, E]:
            result = self._computation()
            match result:
                case Success(value):
                    return f(value).run()
                case Failure(error):
                    return Failure(error)

        return DeferredTask(chained_computation)


# === JOB HANDLE FOR CAPABILITY-AWARE OPERATIONS ===


class JobHandle[S](ABC):
    """Typed handle for safe job operations with capability awareness.

    Provides type-safe access to job state, progress, logs, and control operations.
    Only exposes operations supported by the job (pause/resume capability).
    """

    @property
    @abstractmethod
    def job_id(self) -> str:
        """Unique identifier of the job."""
        pass

    @property
    @abstractmethod
    def status(self) -> JobStatus:
        """Current job status: pending, running, paused, completed, failed."""
        pass

    @property
    @abstractmethod
    def supports_pause_resume(self) -> bool:
        """Whether this job supports cooperative pause/resume."""
        pass

    @abstractmethod
    def get_progress(self) -> JobProgressSnapshot:
        """Get current progress snapshot without blocking."""
        pass

    @abstractmethod
    def get_logs(
        self, after_event_index: int = 0, limit: int = 100
    ) -> JobLogListResponse:
        """Retrieve paginated logs for this job."""
        pass

    @abstractmethod
    def wait_for_terminal(
        self, timeout_seconds: int = 60
    ) -> Result[JSONMap, DomainError]:
        """Block until job reaches terminal state (completed/failed/paused).

        Returns Result[JSONMap, DomainError] where success is the final result.
        Timeout raises JobTimeoutError.
        """
        pass

    @abstractmethod
    def request_pause(self) -> Task[None, DomainError]:
        """Request pause if job supports it. Returns deferred task."""
        pass

    @abstractmethod
    def resume(self) -> Task[None, DomainError]:
        """Resume if job is paused and supports it. Returns deferred task."""
        pass
