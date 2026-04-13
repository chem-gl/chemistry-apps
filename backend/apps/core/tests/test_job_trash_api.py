"""test_job_trash_api.py: Tests HTTP para papelera, restauración y borrado de jobs.

Cubre: eliminación hard/soft, restauración, restricciones de rol y purga automática
de registros vencidos al acceder a la papelera.
"""

from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from ..models import (
    GroupMembership,
    ScientificJob,
    UserIdentityProfile,
    WorkGroup,
)
from ..services import JobService


class JobTrashApiTests(TestCase):
    """Pruebas HTTP para delete, restore y papelera de jobs."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.user_model = get_user_model()
        self.group_alpha = WorkGroup.objects.create(name="Alpha", slug="alpha")
        self.group_beta = WorkGroup.objects.create(name="Beta", slug="beta")
        root_password = "root-" + uuid4().hex
        admin_password = "admin-" + uuid4().hex
        owner_password = "owner-" + uuid4().hex
        other_password = "other-" + uuid4().hex

        self.root_user = self.user_model.objects.create_user(
            username="root-jobs",
            email="root-jobs@test.local",
            password=root_password,
            is_superuser=True,
            is_staff=True,
        )
        self.admin_user = self.user_model.objects.create_user(
            username="admin-jobs",
            email="admin-jobs@test.local",
            password=admin_password,
        )
        self.owner_user = self.user_model.objects.create_user(
            username="owner-jobs",
            email="owner-jobs@test.local",
            password=owner_password,
        )
        self.other_user = self.user_model.objects.create_user(
            username="other-jobs",
            email="other-jobs@test.local",
            password=other_password,
        )

        UserIdentityProfile.objects.create(
            user=self.admin_user,
            role=UserIdentityProfile.ROLE_ADMIN,
            account_status=UserIdentityProfile.STATUS_ACTIVE,
            primary_group=self.group_alpha,
        )
        UserIdentityProfile.objects.create(
            user=self.owner_user,
            role=UserIdentityProfile.ROLE_USER,
            account_status=UserIdentityProfile.STATUS_ACTIVE,
            primary_group=self.group_alpha,
        )
        UserIdentityProfile.objects.create(
            user=self.other_user,
            role=UserIdentityProfile.ROLE_USER,
            account_status=UserIdentityProfile.STATUS_ACTIVE,
            primary_group=self.group_beta,
        )
        GroupMembership.objects.create(
            user=self.admin_user,
            group=self.group_alpha,
            role_in_group=GroupMembership.ROLE_ADMIN,
        )
        GroupMembership.objects.create(
            user=self.owner_user,
            group=self.group_alpha,
            role_in_group=GroupMembership.ROLE_MEMBER,
        )

    def _authenticate(self, user) -> None:
        """Autentica el cliente con el usuario indicado para el escenario actual."""
        self.client.force_authenticate(user=user)

    def _create_job(
        self, *, owner, group, status_value: str = "completed"
    ) -> ScientificJob:
        """Crea un job terminal o activo para escenarios de eliminación."""
        return ScientificJob.objects.create(
            owner=owner,
            group=group,
            job_hash=uuid4().hex,
            plugin_name="calculator",
            algorithm_version="1.0.0",
            status=status_value,
            cache_hit=False,
            cache_miss=True,
            parameters={"plugin_name": "calculator"},
            results={"ok": True} if status_value == "completed" else None,
        )

    def test_owner_delete_endpoint_hard_deletes_terminal_job(self) -> None:
        """El autor autenticado recibe hard delete al eliminar su job terminal."""
        job = self._create_job(owner=self.owner_user, group=self.group_alpha)
        self._authenticate(self.owner_user)

        response = self.client.post(f"/api/jobs/{job.id}/delete/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["deletion_mode"], "hard")
        self.assertFalse(ScientificJob.objects.filter(id=job.id).exists())

    def test_admin_delete_endpoint_soft_deletes_job_from_same_group(self) -> None:
        """Un admin elimina lógicamente jobs ajenos de su grupo y estos salen del listado normal."""
        job = self._create_job(owner=self.owner_user, group=self.group_alpha)
        self._authenticate(self.admin_user)

        delete_response = self.client.post(f"/api/jobs/{job.id}/delete/")
        list_response = self.client.get("/api/jobs/")
        trash_response = self.client.get("/api/jobs/trash/")

        self.assertEqual(delete_response.status_code, 200)
        self.assertEqual(delete_response.data["deletion_mode"], "soft")
        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(trash_response.status_code, 200)
        self.assertNotIn(str(job.id), {str(item["id"]) for item in list_response.data})
        self.assertIn(str(job.id), {str(item["id"]) for item in trash_response.data})

    def test_admin_delete_endpoint_soft_deletes_own_job_first(self) -> None:
        """Admin también mueve a papelera su propio job en la primera eliminación."""
        job = self._create_job(owner=self.admin_user, group=self.group_alpha)
        self._authenticate(self.admin_user)

        response = self.client.post(f"/api/jobs/{job.id}/delete/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["deletion_mode"], "soft")
        job.refresh_from_db()
        self.assertTrue(job.is_deleted)

    def test_admin_can_hard_delete_job_from_trash(self) -> None:
        """Admin puede eliminar definitivamente un job ya enviado a papelera."""
        job = self._create_job(owner=self.owner_user, group=self.group_alpha)
        self._authenticate(self.admin_user)

        first_delete_response = self.client.post(f"/api/jobs/{job.id}/delete/")
        second_delete_response = self.client.post(f"/api/jobs/{job.id}/delete/")

        self.assertEqual(first_delete_response.status_code, 200)
        self.assertEqual(first_delete_response.data["deletion_mode"], "soft")
        self.assertEqual(second_delete_response.status_code, 200)
        self.assertEqual(second_delete_response.data["deletion_mode"], "hard")
        self.assertFalse(ScientificJob.objects.filter(id=job.id).exists())

    def test_delete_endpoint_requires_cancel_before_removing_active_job(self) -> None:
        """No se puede eliminar por HTTP un job aún running o paused."""
        job = self._create_job(
            owner=self.owner_user,
            group=self.group_alpha,
            status_value="running",
        )
        self._authenticate(self.owner_user)

        response = self.client.post(f"/api/jobs/{job.id}/delete/")

        self.assertEqual(response.status_code, 400)
        self.assertIn("cancelar", response.data["detail"].lower())

    def test_standard_user_cannot_delete_foreign_job(self) -> None:
        """Un usuario estándar no puede eliminar jobs de otros usuarios."""
        job = self._create_job(owner=self.other_user, group=self.group_beta)
        self._authenticate(self.owner_user)

        response = self.client.post(f"/api/jobs/{job.id}/delete/")

        self.assertEqual(response.status_code, 403)

    def test_admin_can_restore_job_from_trash(self) -> None:
        """Los admins restauran jobs en papelera dentro de su ámbito autorizado."""
        job = self._create_job(owner=self.owner_user, group=self.group_alpha)
        self._authenticate(self.admin_user)
        self.client.post(f"/api/jobs/{job.id}/delete/")

        restore_response = self.client.post(f"/api/jobs/{job.id}/restore/")

        self.assertEqual(restore_response.status_code, 200)
        job.refresh_from_db()
        self.assertIsNone(job.deleted_at)
        self.assertFalse(job.is_deleted)

    def test_standard_user_cannot_access_trash_or_restore(self) -> None:
        """La papelera y restore se reservan a root/admin, no a usuarios estándar."""
        job = self._create_job(owner=self.owner_user, group=self.group_alpha)
        JobService.delete_job(str(job.id), actor=self.admin_user)
        self._authenticate(self.owner_user)

        trash_response = self.client.get("/api/jobs/trash/")
        restore_response = self.client.post(f"/api/jobs/{job.id}/restore/")

        self.assertEqual(trash_response.status_code, 403)
        self.assertEqual(restore_response.status_code, 403)

    def test_standard_user_cannot_hard_delete_job_from_trash(self) -> None:
        """Un usuario estándar no puede borrar definitivamente elementos de papelera."""
        job = self._create_job(owner=self.owner_user, group=self.group_alpha)
        self._authenticate(self.admin_user)
        self.client.post(f"/api/jobs/{job.id}/delete/")

        self._authenticate(self.owner_user)
        delete_response = self.client.post(f"/api/jobs/{job.id}/delete/")

        self.assertEqual(delete_response.status_code, 403)
        self.assertTrue(ScientificJob.objects.filter(id=job.id).exists())

    def test_trash_endpoint_purges_expired_jobs_opportunistically(self) -> None:
        """Consultar la papelera elimina primero los registros ya vencidos."""
        expired_job = self._create_job(owner=self.owner_user, group=self.group_alpha)
        active_trash_job = self._create_job(
            owner=self.owner_user, group=self.group_alpha
        )
        ScientificJob.objects.filter(id=expired_job.id).update(
            deleted_at=timezone.now() - timedelta(days=21),
            deleted_by=self.admin_user,
            deletion_mode=ScientificJob.DELETION_MODE_SOFT,
            scheduled_hard_delete_at=timezone.now() - timedelta(hours=1),
            original_status="completed",
        )
        ScientificJob.objects.filter(id=active_trash_job.id).update(
            deleted_at=timezone.now() - timedelta(days=1),
            deleted_by=self.admin_user,
            deletion_mode=ScientificJob.DELETION_MODE_SOFT,
            scheduled_hard_delete_at=timezone.now() + timedelta(days=19),
            original_status="completed",
        )
        self._authenticate(self.admin_user)

        response = self.client.get("/api/jobs/trash/")

        self.assertEqual(response.status_code, 200)
        self.assertFalse(ScientificJob.objects.filter(id=expired_job.id).exists())
        self.assertIn(
            str(active_trash_job.id),
            {str(item["id"]) for item in response.data},
        )
