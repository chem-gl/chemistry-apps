"""test_job_service_edge_cases.py: Edge cases del servicio de jobs.

Cubre: recuperación segura de jobs por UUID, edge cases de run_job,
request_pause, resume_job y configuración desde settings.
"""

from __future__ import annotations

from unittest.mock import patch
from uuid import uuid4

from django.test import TestCase, override_settings

from ..models import ScientificJob
from ..services import JobService, RuntimeJobService
from ..types import JSONMap


class GetJobOrNoneTests(TestCase):
    """Verifica recuperación segura de jobs con UUIDs válidos/inválidos."""

    def setUp(self) -> None:
        self.service: RuntimeJobService = JobService._get_runtime_service()

    def test_valid_uuid_returns_job(self) -> None:
        job: ScientificJob = ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="calculator",
            algorithm_version="1.0.0",
            status="pending",
            cache_hit=False,
            cache_miss=True,
            parameters={"op": "add", "a": 1, "b": 2},
        )
        result = self.service._get_job_or_none(str(job.id))
        self.assertIsNotNone(result)
        self.assertEqual(str(result.id), str(job.id))

    def test_invalid_uuid_returns_none(self) -> None:
        result = self.service._get_job_or_none("not-a-uuid")
        self.assertIsNone(result)

    def test_nonexistent_uuid_returns_none(self) -> None:
        result = self.service._get_job_or_none(str(uuid4()))
        self.assertIsNone(result)


class RunJobEdgeCaseTests(TestCase):
    """Verifica edge cases de run_job: jobs terminados, inexistentes."""

    def test_run_job_skips_already_completed_job(self) -> None:
        job: ScientificJob = ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="calculator",
            algorithm_version="1.0.0",
            status="completed",
            cache_hit=True,
            cache_miss=False,
            parameters={"op": "add", "a": 1, "b": 2},
            results={"result": 3.0},
            progress_percentage=100,
            progress_stage="completed",
            progress_message="Done.",
        )
        JobService.run_job(str(job.id))
        refreshed = ScientificJob.objects.get(id=job.id)
        self.assertEqual(refreshed.status, "completed")

    def test_run_job_with_nonexistent_job_does_not_raise(self) -> None:
        JobService.run_job(str(uuid4()))

    def test_run_job_with_runtime_state_injects_checkpoint(self) -> None:
        """Verifica que runtime_state se inyecta en los parámetros de ejecución."""
        job: ScientificJob = ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="calculator",
            algorithm_version="1.0.0",
            status="pending",
            cache_hit=False,
            cache_miss=True,
            parameters={"op": "add", "a": 1, "b": 2},
            runtime_state={"step": 3, "partial": [1, 2]},
        )

        captured_params: list[JSONMap] = []

        def capture_execute(
            plugin_name,
            params,
            progress_callback=None,
            log_callback=None,
            control_callback=None,
        ):
            captured_params.append(dict(params))
            return {"result": 3.0}

        with patch(
            "apps.core.adapters.DjangoPluginExecutionAdapter.execute",
            side_effect=capture_execute,
        ):
            JobService.run_job(str(job.id))

        self.assertEqual(len(captured_params), 1)
        self.assertIn("__runtime_state", captured_params[0])
        self.assertEqual(captured_params[0]["__runtime_state"]["step"], 3)


class RequestPauseEdgeCaseTests(TestCase):
    """Verifica edge cases del request_pause del servicio."""

    def test_pause_already_paused_job_returns_same_job(self) -> None:
        job: ScientificJob = ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="molar-fractions",
            algorithm_version="1.0.0",
            status="paused",
            supports_pause_resume=True,
            cache_hit=False,
            cache_miss=True,
            parameters={"seed_url": "https://example.com/seed.txt"},
        )
        result = JobService.request_pause(str(job.id))
        self.assertEqual(result.status, "paused")
        self.assertEqual(str(result.id), str(job.id))

    def test_pause_running_job_sets_pause_requested_flag(self) -> None:
        job: ScientificJob = ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="molar-fractions",
            algorithm_version="1.0.0",
            status="running",
            supports_pause_resume=True,
            cache_hit=False,
            cache_miss=True,
            parameters={"seed_url": "https://example.com/seed.txt"},
        )
        result = JobService.request_pause(str(job.id))
        self.assertTrue(bool(result.pause_requested))
        self.assertEqual(result.status, "running")

    def test_pause_completed_job_raises_value_error(self) -> None:
        job: ScientificJob = ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="molar-fractions",
            algorithm_version="1.0.0",
            status="completed",
            supports_pause_resume=True,
            cache_hit=False,
            cache_miss=True,
            parameters={"seed_url": "https://example.com/seed.txt"},
            results={"data": [1, 2, 3]},
        )
        with self.assertRaises(ValueError):
            JobService.request_pause(str(job.id))

    def test_pause_nonexistent_job_raises_value_error(self) -> None:
        with self.assertRaises(ValueError):
            JobService.request_pause(str(uuid4()))

    def test_pause_job_without_support_raises_value_error(self) -> None:
        job: ScientificJob = ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="calculator",
            algorithm_version="1.0.0",
            status="running",
            supports_pause_resume=False,
            cache_hit=False,
            cache_miss=True,
            parameters={"op": "add", "a": 1, "b": 2},
        )
        with self.assertRaises(ValueError):
            JobService.request_pause(str(job.id))


class ResumeJobEdgeCaseTests(TestCase):
    """Verifica edge cases del resume_job del servicio."""

    def test_resume_running_job_raises_value_error(self) -> None:
        job: ScientificJob = ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="molar-fractions",
            algorithm_version="1.0.0",
            status="running",
            supports_pause_resume=True,
            cache_hit=False,
            cache_miss=True,
            parameters={"seed_url": "https://example.com/seed.txt"},
        )
        with self.assertRaises(ValueError):
            JobService.resume_job(str(job.id))

    def test_resume_cancelled_job_raises_value_error(self) -> None:
        job: ScientificJob = ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="molar-fractions",
            algorithm_version="1.0.0",
            status="cancelled",
            supports_pause_resume=True,
            cache_hit=False,
            cache_miss=True,
            parameters={"seed_url": "https://example.com/seed.txt"},
        )
        with self.assertRaises(ValueError):
            JobService.resume_job(str(job.id))

    def test_resume_nonexistent_job_raises_value_error(self) -> None:
        with self.assertRaises(ValueError):
            JobService.resume_job(str(uuid4()))

    def test_resume_job_without_support_raises_value_error(self) -> None:
        job: ScientificJob = ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="calculator",
            algorithm_version="1.0.0",
            status="paused",
            supports_pause_resume=False,
            cache_hit=False,
            cache_miss=True,
            parameters={"op": "add", "a": 1, "b": 2},
        )
        with self.assertRaises(ValueError):
            JobService.resume_job(str(job.id))


class ConfigurationTests(TestCase):
    """Verifica lectura de configuración de settings."""

    def setUp(self) -> None:
        self.service: RuntimeJobService = JobService._get_runtime_service()

    @override_settings(JOB_RECOVERY_MAX_ATTEMPTS=10)
    def test_max_recovery_attempts_from_settings(self) -> None:
        self.assertEqual(self.service._get_max_recovery_attempts(), 10)

    @override_settings(JOB_RECOVERY_MAX_ATTEMPTS=0)
    def test_max_recovery_attempts_minimum_is_one(self) -> None:
        self.assertEqual(self.service._get_max_recovery_attempts(), 1)

    @override_settings(JOB_RESULT_CACHE_MAX_PAYLOAD_BYTES=4096)
    def test_global_cache_limit(self) -> None:
        limit = self.service._get_result_cache_payload_limit_bytes("any-plugin")
        self.assertEqual(limit, 4096)

    @override_settings(
        JOB_RESULT_CACHE_MAX_PAYLOAD_BYTES=8 * 1024 * 1024,
        JOB_RESULT_CACHE_MAX_PAYLOAD_BYTES_BY_PLUGIN={"smileit": "2048"},
    )
    def test_plugin_limit_from_string_value(self) -> None:
        """settings de tipo string se parsean como int."""
        limit = self.service._get_result_cache_payload_limit_bytes("smileit")
        self.assertEqual(limit, 2048)

    @override_settings(
        JOB_RESULT_CACHE_MAX_PAYLOAD_BYTES=8 * 1024 * 1024,
        JOB_RESULT_CACHE_MAX_PAYLOAD_BYTES_BY_PLUGIN={"smileit": 500},
    )
    def test_plugin_limit_minimum_is_1024(self) -> None:
        """Un plugin con valor por debajo de 1024 se ajusta al mínimo."""
        limit = self.service._get_result_cache_payload_limit_bytes("smileit")
        self.assertEqual(limit, 1024)
