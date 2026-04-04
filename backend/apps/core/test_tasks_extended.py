"""test_tasks_extended.py: Pruebas unitarias para la capa de tareas Celery de core.

Objetivo del archivo:
- Cubrir flujos de despacho y recuperación en `tasks.py` sin requerir broker real.

Cómo se usa:
- Ejecutar con pytest para verificar tolerancia a fallos de broker y ejecución
  de tareas periódicas de recuperación/purga.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase, override_settings
from kombu.exceptions import OperationalError
from redis.exceptions import ConnectionError as RedisConnectionError

from apps.core.tasks import (
    dispatch_scientific_job,
    execute_scientific_job,
    purge_expired_artifact_chunks,
    run_active_recovery,
)


class DispatchScientificJobTests(SimpleTestCase):
    """Valida comportamiento de despacho resiliente ante fallos de broker."""

    @patch("apps.core.tasks.execute_scientific_job.delay")
    def test_dispatch_returns_true_when_enqueue_succeeds(
        self, mocked_delay: MagicMock
    ) -> None:
        mocked_delay.return_value = None

        dispatched = dispatch_scientific_job("job-1")

        self.assertTrue(dispatched)
        mocked_delay.assert_called_once_with("job-1")

    @patch("apps.core.tasks.execute_scientific_job.delay")
    def test_dispatch_returns_false_for_operational_error(
        self,
        mocked_delay: MagicMock,
    ) -> None:
        mocked_delay.side_effect = OperationalError("broker down")

        dispatched = dispatch_scientific_job("job-2")

        self.assertFalse(dispatched)

    @patch("apps.core.tasks.execute_scientific_job.delay")
    def test_dispatch_returns_false_for_redis_connection_error(
        self,
        mocked_delay: MagicMock,
    ) -> None:
        mocked_delay.side_effect = RedisConnectionError("redis down")

        dispatched = dispatch_scientific_job("job-3")

        self.assertFalse(dispatched)


class ExecuteScientificJobTests(SimpleTestCase):
    """Valida orquestación de ejecución asíncrona y recuperación activa."""

    @override_settings(JOB_RECOVERY_ENABLED=True)
    @patch("apps.core.tasks.JobService.run_job")
    @patch("apps.core.tasks.run_active_recovery")
    def test_execute_job_runs_recovery_when_enabled(
        self,
        mocked_recovery: MagicMock,
        mocked_run_job: MagicMock,
    ) -> None:
        execute_scientific_job.run("job-10")

        mocked_recovery.assert_called_once_with(exclude_job_id="job-10")
        mocked_run_job.assert_called_once_with("job-10")

    @override_settings(JOB_RECOVERY_ENABLED=False)
    @patch("apps.core.tasks.JobService.run_job")
    @patch("apps.core.tasks.run_active_recovery")
    def test_execute_job_skips_recovery_when_disabled(
        self,
        mocked_recovery: MagicMock,
        mocked_run_job: MagicMock,
    ) -> None:
        execute_scientific_job.run("job-11")

        mocked_recovery.assert_not_called()
        mocked_run_job.assert_called_once_with("job-11")


class RunActiveRecoveryTests(SimpleTestCase):
    """Cubre los caminos habilitado/deshabilitado de recuperación activa."""

    @override_settings(JOB_RECOVERY_ENABLED=False)
    def test_run_active_recovery_returns_disabled_summary(self) -> None:
        summary = run_active_recovery.run(exclude_job_id="job-x")

        self.assertEqual(summary["stale_running_detected"], 0)
        self.assertEqual(summary["requeued_successfully"], 0)
        self.assertEqual(summary["marked_failed_by_retries"], 0)

    @override_settings(
        JOB_RECOVERY_ENABLED=True,
        JOB_RECOVERY_STALE_SECONDS=33,
        JOB_RECOVERY_INCLUDE_PENDING=False,
    )
    @patch("apps.core.tasks.JobService.run_active_recovery")
    def test_run_active_recovery_calls_service_with_expected_parameters(
        self,
        mocked_run_active_recovery: MagicMock,
    ) -> None:
        mocked_run_active_recovery.return_value = {
            "stale_running_detected": 2,
            "stale_pending_detected": 1,
            "requeued_successfully": 2,
            "requeue_failed": 0,
            "marked_failed_by_retries": 1,
        }

        summary = run_active_recovery.run(exclude_job_id="job-200")

        self.assertEqual(summary["stale_running_detected"], 2)
        self.assertEqual(summary["stale_pending_detected"], 1)
        self.assertEqual(summary["requeued_successfully"], 2)
        mocked_run_active_recovery.assert_called_once()


class PurgeExpiredArtifactChunksTests(SimpleTestCase):
    """Valida integración de tarea de purga con servicio de artefactos."""

    @patch("apps.core.artifacts.ScientificInputArtifactStorageService")
    def test_purge_expired_artifact_chunks_returns_service_summary(
        self,
        mocked_storage_service_class: MagicMock,
    ) -> None:
        mocked_storage_service = mocked_storage_service_class.return_value
        mocked_storage_service.purge_expired_chunks.return_value = {
            "purged_artifacts": 3,
            "bytes_freed": 1024,
            "errors": 0,
        }

        summary = purge_expired_artifact_chunks.run()

        self.assertEqual(summary["purged_artifacts"], 3)
        self.assertEqual(summary["bytes_freed"], 1024)
        self.assertEqual(summary["errors"], 0)
