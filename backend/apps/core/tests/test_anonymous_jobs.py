"""test_anonymous_jobs.py: Tests de la política de jobs anónimos (apps libres).

Cubre la resolución de expiración al crear jobs, las reglas de acceso por
capability URL y la purga periódica de jobs anónimos vencidos.
"""

from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone

from ..anonymous import (
    can_access_public_job,
    get_anonymous_job_ttl_hours,
    is_anonymous_job,
    is_expired_anonymous_job,
    purge_expired_anonymous_jobs,
    resolve_job_expiration,
)
from ..models import ScientificJob, ScientificJobLogEvent
from ..services import JobService
from ..tasks import purge_expired_anonymous_jobs as purge_anonymous_task
from .test_job_service import _register_calculator_test_plugin

_register_calculator_test_plugin()

TTL_TOLERANCE = timedelta(minutes=1)


def _create_job(**overrides: object) -> ScientificJob:
    """Crea un job mínimo persistido para pruebas de política."""
    defaults: dict[str, object] = {
        "job_hash": uuid4().hex,
        "plugin_name": "calculator",
        "algorithm_version": "1.0.0",
        "status": "completed",
        "parameters": {"op": "add", "a": 1, "b": 2},
    }
    defaults.update(overrides)
    return ScientificJob.objects.create(**defaults)


class AnonymousExpirationResolutionTests(TestCase):
    """Verifica el cálculo de `expires_at` según el dueño del job."""

    def test_anonymous_job_expires_in_default_ttl(self) -> None:
        before = timezone.now()
        expires_at = resolve_job_expiration(None)

        self.assertIsNotNone(expires_at)
        expected = before + timedelta(hours=get_anonymous_job_ttl_hours())
        self.assertLess(abs(expires_at - expected), TTL_TOLERANCE)  # type: ignore[operator]

    def test_job_with_owner_never_expires(self) -> None:
        self.assertIsNone(resolve_job_expiration(7))

    @override_settings(ANONYMOUS_JOB_TTL_HOURS=2)
    def test_ttl_is_configurable_by_settings(self) -> None:
        self.assertEqual(get_anonymous_job_ttl_hours(), 2)

        before = timezone.now()
        expires_at = resolve_job_expiration(None)

        self.assertIsNotNone(expires_at)
        expected = before + timedelta(hours=2)
        self.assertLess(abs(expires_at - expected), TTL_TOLERANCE)  # type: ignore[operator]

    @override_settings(ANONYMOUS_JOB_TTL_HOURS=0)
    def test_ttl_has_minimum_of_one_hour(self) -> None:
        self.assertEqual(get_anonymous_job_ttl_hours(), 1)


class AnonymousJobPolicyTests(TestCase):
    """Verifica las reglas de acceso público por capability URL."""

    def test_anonymous_job_is_detected_by_missing_owner(self) -> None:
        self.assertTrue(is_anonymous_job(_create_job()))

    def test_job_with_owner_is_not_anonymous(self) -> None:
        user = get_user_model().objects.create_user(username="policy-owner")
        self.assertFalse(is_anonymous_job(_create_job(owner=user)))

    def test_expired_anonymous_job_is_detected(self) -> None:
        expired_job = _create_job(expires_at=timezone.now() - timedelta(hours=1))
        self.assertTrue(is_expired_anonymous_job(expired_job))

    def test_fresh_anonymous_job_is_accessible(self) -> None:
        fresh_job = _create_job(expires_at=timezone.now() + timedelta(hours=1))
        self.assertTrue(can_access_public_job(fresh_job))

    def test_expired_anonymous_job_is_not_accessible(self) -> None:
        expired_job = _create_job(expires_at=timezone.now() - timedelta(hours=1))
        self.assertFalse(can_access_public_job(expired_job))

    def test_owned_job_is_never_accessible_publicly(self) -> None:
        user = get_user_model().objects.create_user(username="policy-owner-2")
        owned_job = _create_job(owner=user)
        self.assertFalse(can_access_public_job(owned_job))

    def test_deleted_anonymous_job_is_not_accessible(self) -> None:
        deleted_job = _create_job(
            expires_at=timezone.now() + timedelta(hours=1),
            deleted_at=timezone.now(),
        )
        self.assertFalse(can_access_public_job(deleted_job))


class PurgeExpiredAnonymousJobsTests(TestCase):
    """Verifica el borrado físico de jobs anónimos vencidos."""

    def test_purge_removes_only_expired_anonymous_jobs(self) -> None:
        expired_job = _create_job(expires_at=timezone.now() - timedelta(hours=2))
        fresh_job = _create_job(expires_at=timezone.now() + timedelta(hours=2))
        user = get_user_model().objects.create_user(username="purge-owner")
        owned_job = _create_job(owner=user)

        purged = purge_expired_anonymous_jobs()

        self.assertEqual(purged, 1)
        self.assertFalse(ScientificJob.objects.filter(id=expired_job.id).exists())
        self.assertTrue(ScientificJob.objects.filter(id=fresh_job.id).exists())
        self.assertTrue(ScientificJob.objects.filter(id=owned_job.id).exists())

    def test_purge_ignores_jobs_without_expiration(self) -> None:
        no_expiration_job = _create_job(expires_at=None)

        purged = purge_expired_anonymous_jobs()

        self.assertEqual(purged, 0)
        self.assertTrue(ScientificJob.objects.filter(id=no_expiration_job.id).exists())

    def test_purge_cascades_log_events(self) -> None:
        expired_job = _create_job(expires_at=timezone.now() - timedelta(hours=1))
        ScientificJobLogEvent.objects.create(
            job=expired_job,
            event_index=1,
            level="info",
            source="test",
            message="evento de prueba",
        )

        purge_expired_anonymous_jobs()

        self.assertEqual(
            ScientificJobLogEvent.objects.filter(job_id=expired_job.id).count(), 0
        )

    def test_purge_processes_multiple_batches(self) -> None:
        for _ in range(3):
            _create_job(expires_at=timezone.now() - timedelta(hours=1))

        purged = purge_expired_anonymous_jobs(batch_size=1, max_batches=10)

        self.assertEqual(purged, 3)

    def test_periodic_task_returns_purge_summary(self) -> None:
        _create_job(expires_at=timezone.now() - timedelta(hours=1))

        summary = purge_anonymous_task()

        self.assertEqual(summary, {"purged_jobs": 1})

    def test_beat_schedule_registers_anonymous_purge(self) -> None:
        schedule_entry = settings.CELERY_BEAT_SCHEDULE["purge-expired-anonymous-jobs"]

        self.assertEqual(
            schedule_entry["task"], "apps.core.tasks.purge_expired_anonymous_jobs"
        )


class JobServiceExpirationTests(TestCase):
    """Verifica que la creación de jobs anónimos fije su expiración."""

    def test_create_job_without_owner_sets_expiration(self) -> None:
        job = JobService.create_job(
            plugin_name="calculator",
            version="1.0.0",
            parameters={"op": "add", "a": 2, "b": 5, "unique": uuid4().hex},
        )

        self.assertIsNone(job.owner_id)
        self.assertIsNotNone(job.expires_at)

    def test_create_job_with_owner_keeps_no_expiration(self) -> None:
        user = get_user_model().objects.create_user(username="service-owner")
        job = JobService.create_job(
            plugin_name="calculator",
            version="1.0.0",
            parameters={"op": "add", "a": 3, "b": 4, "unique": uuid4().hex},
            owner_id=user.id,
        )

        self.assertEqual(job.owner_id, user.id)
        self.assertIsNone(job.expires_at)
