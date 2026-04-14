"""test_job_control_extended.py: Tests extendidos de control de ciclo de vida de jobs.

Objetivo del archivo:
- Cubrir ramas no testeadas en job_control.py y terminal_states.py:
  pausa de job ya pausado, cancelación de estados terminales,
  reanudación de no-paused, finish_with_failure, finish_with_pause.

Cómo se usa:
- Ejecutar con `python manage.py test apps.core.test_job_control_extended`.
"""

from __future__ import annotations

from datetime import timedelta
from unittest.mock import MagicMock

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from apps.core.models import (
    GroupMembership,
    ScientificJob,
    UserIdentityProfile,
    WorkGroup,
)
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
            plugin_name="molar-fractions",
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
            plugin_name="molar-fractions",
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


class DeleteAndRestoreJobControlTests(TestCase):
    """Tests para hard delete, soft delete, restore y purga oportunista."""

    def setUp(self) -> None:
        self.user_model = get_user_model()
        self.group = WorkGroup.objects.create(name="Alpha", slug="alpha")
        owner_password = "owner-" + str(timezone.now().timestamp())
        admin_password = "admin-" + str(timezone.now().timestamp())
        other_password = "other-" + str(timezone.now().timestamp())
        self.owner_user = self.user_model.objects.create_user(
            username="owner-delete",
            email="owner-delete@test.local",
            password=owner_password,
        )
        self.admin_user = self.user_model.objects.create_user(
            username="admin-delete",
            email="admin-delete@test.local",
            password=admin_password,
        )
        self.other_user = self.user_model.objects.create_user(
            username="other-delete",
            email="other-delete@test.local",
            password=other_password,
        )

        UserIdentityProfile.objects.create(
            user=self.owner_user,
            role=UserIdentityProfile.ROLE_USER,
            account_status=UserIdentityProfile.STATUS_ACTIVE,
            primary_group=self.group,
        )
        UserIdentityProfile.objects.create(
            user=self.admin_user,
            role=UserIdentityProfile.ROLE_ADMIN,
            account_status=UserIdentityProfile.STATUS_ACTIVE,
            primary_group=self.group,
        )
        UserIdentityProfile.objects.create(
            user=self.other_user,
            role=UserIdentityProfile.ROLE_USER,
            account_status=UserIdentityProfile.STATUS_ACTIVE,
            primary_group=self.group,
        )
        GroupMembership.objects.create(
            user=self.admin_user,
            group=self.group,
            role_in_group=GroupMembership.ROLE_ADMIN,
        )
        GroupMembership.objects.create(
            user=self.owner_user,
            group=self.group,
            role_in_group=GroupMembership.ROLE_MEMBER,
        )

    def _create_terminal_job(self, *, owner_id: int) -> ScientificJob:
        """Crea un job terminal apto para pruebas de borrado y restauración."""
        return ScientificJob.objects.create(
            owner_id=owner_id,
            group=self.group,
            plugin_name="calculator",
            algorithm_version="1.0.0",
            job_hash=f"trash-test-{owner_id}-{timezone.now().timestamp()}",
            parameters={"owner_id": owner_id},
            status="completed",
            results={"answer": 42},
        )

    def test_owner_hard_deletes_terminal_job(self) -> None:
        """El autor original elimina definitivamente su job terminal."""
        job = self._create_terminal_job(owner_id=self.owner_user.id)

        result = JobService.delete_job(str(job.id), actor=self.owner_user)

        self.assertEqual(result["deletion_mode"], "hard")
        self.assertFalse(ScientificJob.objects.filter(id=job.id).exists())

    def test_admin_soft_deletes_foreign_job(self) -> None:
        """Un admin mueve a papelera un job ajeno dentro de su grupo."""
        job = self._create_terminal_job(owner_id=self.owner_user.id)

        result = JobService.delete_job(str(job.id), actor=self.admin_user)

        self.assertEqual(result["deletion_mode"], "soft")
        job.refresh_from_db()
        self.assertIsNotNone(job.deleted_at)
        self.assertEqual(job.deleted_by_id, self.admin_user.id)
        self.assertEqual(job.deletion_mode, ScientificJob.DELETION_MODE_SOFT)
        self.assertIsNotNone(job.scheduled_hard_delete_at)

    def test_admin_soft_deletes_own_job_first(self) -> None:
        """Admin también usa papelera en la primera eliminación de un job propio."""
        job = self._create_terminal_job(owner_id=self.admin_user.id)

        result = JobService.delete_job(str(job.id), actor=self.admin_user)

        self.assertEqual(result["deletion_mode"], "soft")
        job.refresh_from_db()
        self.assertTrue(job.is_deleted)

    def test_admin_can_hard_delete_job_from_trash(self) -> None:
        """Un segundo delete sobre un job en papelera lo elimina definitivamente."""
        job = self._create_terminal_job(owner_id=self.owner_user.id)

        first_delete_result = JobService.delete_job(str(job.id), actor=self.admin_user)
        second_delete_result = JobService.delete_job(str(job.id), actor=self.admin_user)

        self.assertEqual(first_delete_result["deletion_mode"], "soft")
        self.assertEqual(second_delete_result["deletion_mode"], "hard")
        self.assertFalse(ScientificJob.objects.filter(id=job.id).exists())

    def test_delete_active_job_requires_cancel_first(self) -> None:
        """No se permite eliminar jobs todavía activos sin cancelarlos antes."""
        job = ScientificJob.objects.create(
            owner=self.owner_user,
            group=self.group,
            plugin_name="calculator",
            algorithm_version="1.0.0",
            job_hash="trash-active-job",
            parameters={"active": True},
            status="running",
        )

        with self.assertRaises(ValueError):
            JobService.delete_job(str(job.id), actor=self.owner_user)

    def test_restore_soft_deleted_job_clears_trash_metadata(self) -> None:
        """La restauración limpia metadatos de papelera y conserva el job."""
        job = self._create_terminal_job(owner_id=self.owner_user.id)
        JobService.delete_job(str(job.id), actor=self.admin_user)

        restored_job = JobService.restore_job(str(job.id), actor=self.admin_user)

        self.assertEqual(restored_job.id, job.id)
        restored_job.refresh_from_db()
        self.assertIsNone(restored_job.deleted_at)
        self.assertIsNone(restored_job.deleted_by)
        self.assertEqual(restored_job.deletion_mode, "")
        self.assertIsNone(restored_job.scheduled_hard_delete_at)

    def test_purge_expired_deleted_jobs_removes_expired_records(self) -> None:
        """La purga oportunista elimina definitivamente jobs vencidos en papelera."""
        expired_job = self._create_terminal_job(owner_id=self.owner_user.id)
        future_job = self._create_terminal_job(owner_id=self.other_user.id)

        ScientificJob.objects.filter(id=expired_job.id).update(
            deleted_at=timezone.now() - timedelta(days=21),
            deleted_by=self.admin_user,
            deletion_mode=ScientificJob.DELETION_MODE_SOFT,
            scheduled_hard_delete_at=timezone.now() - timedelta(days=1),
            original_status="completed",
        )
        ScientificJob.objects.filter(id=future_job.id).update(
            deleted_at=timezone.now() - timedelta(days=1),
            deleted_by=self.admin_user,
            deletion_mode=ScientificJob.DELETION_MODE_SOFT,
            scheduled_hard_delete_at=timezone.now() + timedelta(days=19),
            original_status="completed",
        )

        purged_jobs = JobService.purge_expired_deleted_jobs()

        self.assertEqual(purged_jobs, 1)
        self.assertFalse(ScientificJob.objects.filter(id=expired_job.id).exists())
        self.assertTrue(ScientificJob.objects.filter(id=future_job.id).exists())
