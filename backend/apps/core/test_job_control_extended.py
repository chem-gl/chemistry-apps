"""test_job_control_extended.py: Tests extendidos de control de ciclo de vida de jobs.

Objetivo del archivo:
- Cubrir ramas no testeadas en job_control.py y terminal_states.py:
  pausa de job ya pausado, cancelación de estados terminales,
  reanudación de no-paused, finish_with_failure, finish_with_pause.

Cómo se usa:
- Ejecutar con `python manage.py test apps.core.test_job_control_extended`.
"""

from __future__ import annotations

from unittest.mock import MagicMock

from django.test import TestCase
from django.utils import timezone

from apps.core.models import ScientificJob
from apps.core.ports import JobLogPublisherPort, JobProgressPublisherPort
from apps.core.services import JobService
from apps.core.services.terminal_states import (
    finish_with_failure,
    finish_with_pause,
    finish_with_result,
)


def _make_publishers() -> tuple[JobProgressPublisherPort, JobLogPublisherPort]:
    """Mocks para los puertos de progreso y log."""
    return MagicMock(spec=JobProgressPublisherPort), MagicMock(spec=JobLogPublisherPort)


def _create_job(status: str = "pending", supports_pause: bool = True) -> ScientificJob:
    """Crea job de prueba con estado específico."""
    return ScientificJob.objects.create(
        plugin_name="calculator",
        algorithm_version="1.0.0",
        job_hash=f"control-test-{status}-{supports_pause}",
        parameters={},
        status=status,
        supports_pause_resume=supports_pause,
    )


class PauseJobControlTests(TestCase):
    """Tests para JobService.request_pause y sus ramas de control."""

    def test_pause_pending_job_sets_paused(self) -> None:
        job = _create_job(status="pending", supports_pause=True)
        updated = JobService.request_pause(str(job.id))
        self.assertEqual(updated.status, "paused")

    def test_pause_already_paused_job_returns_same(self) -> None:
        """Pausar un job ya pausado devuelve el job sin error."""
        job = _create_job(status="paused", supports_pause=True)
        ScientificJob.objects.filter(pk=job.pk).update(
            job_hash="control-paused-idempotent"
        )
        job.refresh_from_db()
        updated = JobService.request_pause(str(job.id))
        self.assertEqual(updated.status, "paused")

    def test_pause_job_without_support_raises(self) -> None:
        """Plugin sin soporte de pausa lanza ValueError."""
        job = _create_job(status="pending", supports_pause=False)
        ScientificJob.objects.filter(pk=job.pk).update(job_hash="control-no-pause")
        with self.assertRaises(ValueError):
            JobService.request_pause(str(job.id))

    def test_pause_completed_job_raises(self) -> None:
        """Pausar job completado lanza ValueError."""
        job = _create_job(status="completed", supports_pause=True)
        ScientificJob.objects.filter(pk=job.pk).update(
            job_hash="control-pause-completed"
        )
        with self.assertRaises(ValueError):
            JobService.request_pause(str(job.id))

    def test_pause_failed_job_raises(self) -> None:
        """Pausar job fallido lanza ValueError."""
        job = _create_job(status="failed", supports_pause=True)
        ScientificJob.objects.filter(pk=job.pk).update(job_hash="control-pause-failed")
        with self.assertRaises(ValueError):
            JobService.request_pause(str(job.id))


class CancelJobControlTests(TestCase):
    """Tests para JobService.cancel_job y sus ramas de control."""

    def test_cancel_pending_job(self) -> None:
        job = _create_job(status="pending")
        ScientificJob.objects.filter(pk=job.pk).update(
            job_hash="control-cancel-pending"
        )
        cancelled = JobService.cancel_job(str(job.id))
        self.assertEqual(cancelled.status, "cancelled")

    def test_cancel_paused_job(self) -> None:
        job = _create_job(status="paused")
        ScientificJob.objects.filter(pk=job.pk).update(job_hash="control-cancel-paused")
        cancelled = JobService.cancel_job(str(job.id))
        self.assertEqual(cancelled.status, "cancelled")

    def test_cancel_completed_job_raises(self) -> None:
        """Cancelar job completado lanza ValueError."""
        job = _create_job(status="completed")
        ScientificJob.objects.filter(pk=job.pk).update(
            job_hash="control-cancel-completed"
        )
        with self.assertRaises(ValueError):
            JobService.cancel_job(str(job.id))

    def test_cancel_failed_job_raises(self) -> None:
        job = _create_job(status="failed")
        ScientificJob.objects.filter(pk=job.pk).update(job_hash="control-cancel-failed")
        with self.assertRaises(ValueError):
            JobService.cancel_job(str(job.id))

    def test_cancel_already_cancelled_raises(self) -> None:
        job = _create_job(status="cancelled")
        ScientificJob.objects.filter(pk=job.pk).update(
            job_hash="control-cancel-cancelled"
        )
        with self.assertRaises(ValueError):
            JobService.cancel_job(str(job.id))


class ResumeJobControlTests(TestCase):
    """Tests para JobService.resume_job y sus ramas."""

    def test_resume_paused_job_becomes_pending(self) -> None:
        job = _create_job(status="paused", supports_pause=True)
        ScientificJob.objects.filter(pk=job.pk).update(job_hash="control-resume-paused")
        resumed = JobService.resume_job(str(job.id))
        self.assertEqual(resumed.status, "pending")

    def test_resume_pending_job_raises(self) -> None:
        job = _create_job(status="pending", supports_pause=True)
        ScientificJob.objects.filter(pk=job.pk).update(
            job_hash="control-resume-pending"
        )
        with self.assertRaises(ValueError):
            JobService.resume_job(str(job.id))

    def test_resume_completed_job_raises(self) -> None:
        job = _create_job(status="completed", supports_pause=True)
        ScientificJob.objects.filter(pk=job.pk).update(
            job_hash="control-resume-completed"
        )
        with self.assertRaises(ValueError):
            JobService.resume_job(str(job.id))


class FinishWithResultTests(TestCase):
    """Tests para la función terminal finish_with_result."""

    def test_job_marked_completed_with_result(self) -> None:
        job = ScientificJob.objects.create(
            plugin_name="calculator",
            algorithm_version="1.0.0",
            job_hash="terminal-result-test",
            parameters={"op": "add", "a": 1, "b": 2},
            status="running",
        )
        progress_pub, log_pub = _make_publishers()
        result_payload = {"answer": 42}
        finish_with_result(
            job=job,
            job_id=str(job.id),
            result_payload=result_payload,
            from_cache=False,
            progress_publisher=progress_pub,
            log_publisher=log_pub,
        )
        job.refresh_from_db()
        self.assertEqual(job.status, "completed")
        self.assertEqual(job.results, result_payload)
        self.assertEqual(job.progress_percentage, 100)
        progress_pub.publish.assert_called()

    def test_job_from_cache_sets_cache_hit(self) -> None:
        job = ScientificJob.objects.create(
            plugin_name="calculator",
            algorithm_version="1.0.0",
            job_hash="terminal-cache-hit-test",
            parameters={},
            status="running",
        )
        progress_pub, log_pub = _make_publishers()
        finish_with_result(
            job=job,
            job_id=str(job.id),
            result_payload={"cached": True},
            from_cache=True,
            progress_publisher=progress_pub,
            log_publisher=log_pub,
        )
        job.refresh_from_db()
        self.assertTrue(job.cache_hit)
        self.assertFalse(job.cache_miss)


class FinishWithFailureTests(TestCase):
    """Tests para la función terminal finish_with_failure."""

    def test_job_marked_failed_with_error(self) -> None:
        job = ScientificJob.objects.create(
            plugin_name="calculator",
            algorithm_version="1.0.0",
            job_hash="terminal-failure-test",
            parameters={},
            status="running",
        )
        progress_pub, log_pub = _make_publishers()
        finish_with_failure(
            job=job,
            job_id=str(job.id),
            error_message="Error de ejecución simulado",
            progress_publisher=progress_pub,
            log_publisher=log_pub,
        )
        job.refresh_from_db()
        self.assertEqual(job.status, "failed")
        self.assertIn("Error", job.error_trace)
        progress_pub.publish.assert_called()


class FinishWithPauseTests(TestCase):
    """Tests para la función terminal finish_with_pause."""

    def test_job_marked_paused_with_checkpoint(self) -> None:
        job = ScientificJob.objects.create(
            plugin_name="random-numbers",
            algorithm_version="1.0.0",
            job_hash="terminal-pause-test",
            parameters={"count": 100},
            status="running",
            supports_pause_resume=True,
        )
        progress_pub, log_pub = _make_publishers()
        checkpoint = {"current_index": 42, "seed": 99}
        finish_with_pause(
            job=job,
            job_id=str(job.id),
            pause_message="Pausa en progreso.",
            checkpoint=checkpoint,
            progress_publisher=progress_pub,
            log_publisher=log_pub,
        )
        job.refresh_from_db()
        self.assertEqual(job.status, "paused")
        self.assertEqual(job.runtime_state, checkpoint)
        self.assertIsNotNone(job.paused_at)
        progress_pub.publish.assert_called()

    def test_pause_with_none_checkpoint_uses_empty_dict(self) -> None:
        job = ScientificJob.objects.create(
            plugin_name="random-numbers",
            algorithm_version="1.0.0",
            job_hash="terminal-pause-no-checkpoint",
            parameters={"count": 10},
            status="running",
            supports_pause_resume=True,
        )
        progress_pub, log_pub = _make_publishers()
        finish_with_pause(
            job=job,
            job_id=str(job.id),
            pause_message="Sin checkpoint.",
            checkpoint=None,
            progress_publisher=progress_pub,
            log_publisher=log_pub,
        )
        job.refresh_from_db()
        self.assertEqual(job.runtime_state, {})
