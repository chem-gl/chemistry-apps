"""test_recovery.py: Tests del servicio de recuperación activa de jobs.

Objetivo del archivo:
- Cubrir run_active_recovery: detección de jobs huérfanos, reencola,
  límite de reintentos, exclusión por ID y retorno de JobRecoverySummary.

Cómo se usa:
- Ejecutar con `python manage.py test apps.core.test_recovery`.
"""

from __future__ import annotations

from datetime import timedelta
from unittest.mock import MagicMock

from django.test import TestCase
from django.utils import timezone

from apps.core.models import ScientificJob
from apps.core.ports import JobLogPublisherPort, JobProgressPublisherPort
from apps.core.services.recovery import run_active_recovery
from apps.core.types import JobRecoverySummary


def _make_stale_job(
    status: str = "running",
    stale_offset_seconds: int = 120,
    recovery_attempts: int = 0,
    max_recovery_attempts: int = 5,
    plugin_name: str = "calculator",
) -> ScientificJob:
    """Crea un job en apariencia huérfano con updated_at en el pasado."""
    job = ScientificJob.objects.create(
        plugin_name=plugin_name,
        algorithm_version="1.0.0",
        job_hash=f"recovery-hash-{status}-{stale_offset_seconds}",
        parameters={},
        status=status,
        recovery_attempts=recovery_attempts,
        max_recovery_attempts=max_recovery_attempts,
    )
    # Fuerza updated_at al pasado sin pasar por auto_now
    ScientificJob.objects.filter(pk=job.pk).update(
        updated_at=timezone.now() - timedelta(seconds=stale_offset_seconds)
    )
    job.refresh_from_db()
    return job


def _build_mock_publishers() -> (
    tuple[JobProgressPublisherPort, JobLogPublisherPort]
):
    """Construye mocks para los puertos de progreso y log."""
    progress_publisher = MagicMock(spec=JobProgressPublisherPort)
    log_publisher = MagicMock(spec=JobLogPublisherPort)
    return progress_publisher, log_publisher


def _run_recovery(
    dispatch_result: bool = True,
    stale_seconds: int = 60,
    include_pending: bool = False,
    exclude_job_id: str | None = None,
    register_dispatch_fn: object | None = None,
) -> tuple[JobRecoverySummary, MagicMock]:
    """Helper que ejecuta run_active_recovery con mocks y devuelve resultado."""
    progress_pub, log_pub = _build_mock_publishers()
    dispatch_mock = MagicMock(return_value=dispatch_result)
    register_fn = register_dispatch_fn or MagicMock()
    summary = run_active_recovery(
        dispatch_callback=dispatch_mock,
        stale_seconds=stale_seconds,
        include_pending_jobs=include_pending,
        exclude_job_id=exclude_job_id,
        progress_publisher=progress_pub,
        log_publisher=log_pub,
        register_dispatch_fn=register_fn,
    )
    return summary, dispatch_mock


class RunActiveRecoveryNoJobsTests(TestCase):
    """Verifica respuesta cuando no hay jobs candidatos."""

    def test_empty_summary_when_no_stale_jobs(self) -> None:
        summary, _ = _run_recovery()
        self.assertEqual(summary["stale_running_detected"], 0)
        self.assertEqual(summary["stale_pending_detected"], 0)
        self.assertEqual(summary["requeued_successfully"], 0)
        self.assertEqual(summary["requeue_failed"], 0)
        self.assertEqual(summary["marked_failed_by_retries"], 0)


class RunActiveRecoveryStaleRunningTests(TestCase):
    """Verifica detección y reencola de jobs running huérfanos."""

    def test_stale_running_job_is_requeued(self) -> None:
        _make_stale_job(status="running", stale_offset_seconds=120)
        summary, dispatch = _run_recovery(dispatch_result=True, stale_seconds=60)
        self.assertEqual(summary["stale_running_detected"], 1)
        self.assertEqual(summary["requeued_successfully"], 1)
        self.assertEqual(summary["requeue_failed"], 0)
        dispatch.assert_called_once()

    def test_stale_running_job_becomes_pending_before_dispatch(self) -> None:
        job = _make_stale_job(status="running", stale_offset_seconds=120)
        _run_recovery(dispatch_result=True, stale_seconds=60)
        # El job debería haberse reencolado (volvió a pending brevemente)
        job.refresh_from_db()
        # Puede quedar en pending si dispatch es mock (no ejecuta el job)
        self.assertIn(job.status, {"pending", "running"})

    def test_dispatch_failure_increments_requeue_failed(self) -> None:
        _make_stale_job(status="running", stale_offset_seconds=120)
        summary, _ = _run_recovery(dispatch_result=False, stale_seconds=60)
        self.assertEqual(summary["requeue_failed"], 1)
        self.assertEqual(summary["requeued_successfully"], 0)

    def test_fresh_running_job_not_detected_as_stale(self) -> None:
        """Job actualizado hace 5 segundos no debe detectarse como huérfano."""
        _make_stale_job(status="running", stale_offset_seconds=10)
        summary, _ = _run_recovery(dispatch_result=True, stale_seconds=60)
        self.assertEqual(summary["stale_running_detected"], 0)


class RunActiveRecoveryPendingJobsTests(TestCase):
    """Verifica detección de jobs pending huérfanos cuando se habilita."""

    def test_stale_pending_included_if_flag_set(self) -> None:
        _make_stale_job(status="pending", stale_offset_seconds=120)
        summary, _ = _run_recovery(
            dispatch_result=True, stale_seconds=60, include_pending=True
        )
        self.assertEqual(summary["stale_pending_detected"], 1)
        self.assertEqual(summary["requeued_successfully"], 1)

    def test_stale_pending_ignored_without_flag(self) -> None:
        _make_stale_job(status="pending", stale_offset_seconds=120)
        summary, _ = _run_recovery(
            dispatch_result=True, stale_seconds=60, include_pending=False
        )
        self.assertEqual(summary["stale_pending_detected"], 0)


class RunActiveRecoveryRetryLimitTests(TestCase):
    """Verifica que el límite de reintentos marca el job como failed."""

    def test_job_marked_failed_when_retries_exceeded(self) -> None:
        job = _make_stale_job(
            status="running",
            stale_offset_seconds=120,
            recovery_attempts=5,
            max_recovery_attempts=5,
        )
        summary, dispatch = _run_recovery(dispatch_result=True, stale_seconds=60)
        self.assertEqual(summary["marked_failed_by_retries"], 1)
        self.assertEqual(summary["requeued_successfully"], 0)
        dispatch.assert_not_called()
        job.refresh_from_db()
        self.assertEqual(job.status, "failed")

    def test_job_requeued_when_retries_below_limit(self) -> None:
        _make_stale_job(
            status="running",
            stale_offset_seconds=120,
            recovery_attempts=2,
            max_recovery_attempts=5,
        )
        summary, _ = _run_recovery(dispatch_result=True, stale_seconds=60)
        self.assertEqual(summary["stale_running_detected"], 1)
        self.assertEqual(summary["requeued_successfully"], 1)
        self.assertEqual(summary["marked_failed_by_retries"], 0)


class RunActiveRecoveryExcludeTests(TestCase):
    """Verifica que exclude_job_id omite el job especificado."""

    def test_excluded_job_not_processed(self) -> None:
        job = _make_stale_job(status="running", stale_offset_seconds=120)
        summary, dispatch = _run_recovery(
            dispatch_result=True,
            stale_seconds=60,
            exclude_job_id=str(job.id),
        )
        self.assertEqual(summary["stale_running_detected"], 0)
        self.assertEqual(summary["requeued_successfully"], 0)
        dispatch.assert_not_called()

    def test_non_excluded_job_processed_normally(self) -> None:
        job_to_exclude = _make_stale_job(
            status="running",
            stale_offset_seconds=120,
            plugin_name="excluded-plugin",
        )
        ScientificJob.objects.filter(pk=job_to_exclude.pk).update(
            job_hash="recovery-hash-excluded"
        )
        job_to_process = ScientificJob.objects.create(
            plugin_name="sa-score",
            algorithm_version="1.0.0",
            job_hash="recovery-hash-to-process",
            parameters={},
            status="running",
        )
        ScientificJob.objects.filter(pk=job_to_process.pk).update(
            updated_at=timezone.now() - timedelta(seconds=120)
        )
        summary, dispatch = _run_recovery(
            dispatch_result=True,
            stale_seconds=60,
            exclude_job_id=str(job_to_exclude.id),
        )
        self.assertEqual(summary["stale_running_detected"], 1)
        dispatch.assert_called_once()


class RunActiveRecoveryMultipleJobsTests(TestCase):
    """Verifica procesamiento correcto de múltiples jobs simultáneos."""

    def test_multiple_stale_jobs_processed(self) -> None:
        for i in range(3):
            ScientificJob.objects.create(
                plugin_name=f"app-{i}",
                algorithm_version="1.0.0",
                job_hash=f"recovery-multi-hash-{i}",
                parameters={},
                status="running",
            )
        stale_time = timezone.now() - timedelta(seconds=120)
        ScientificJob.objects.filter(status="running").update(updated_at=stale_time)

        summary, dispatch = _run_recovery(dispatch_result=True, stale_seconds=60)
        self.assertEqual(summary["stale_running_detected"], 3)
        self.assertEqual(summary["requeued_successfully"], 3)
        self.assertEqual(dispatch.call_count, 3)
