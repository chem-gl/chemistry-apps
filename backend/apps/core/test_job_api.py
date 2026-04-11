"""test_job_api.py: Tests de integración del API HTTP de jobs científicos.

Cubre: creación, listado, filtrado, recuperación, progreso, eventos SSE,
logs paginados, pausa, reanudación, cancelación y normalización de contratos HTTP.
"""

from __future__ import annotations

from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .models import (
    GroupMembership,
    ScientificJob,
    ScientificJobLogEvent,
    UserIdentityProfile,
    WorkGroup,
)
from .services import JobService
from .types import JSONMap


class JobApiTests(TestCase):
    """Verifica endpoints principales y contrato HTTP de jobs."""

    def setUp(self) -> None:
        self.client = APIClient()

    def _create_job_record(self, plugin_name: str, status_value: str) -> ScientificJob:
        """Crea un job persistido para validar escenarios de listado y filtrado."""
        return ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name=plugin_name,
            algorithm_version="1.0.0",
            status=status_value,
            cache_hit=False,
            cache_miss=True,
            parameters={"plugin_name": plugin_name},
            results={"ok": True} if status_value == "completed" else None,
        )

    def _create_log_event(
        self,
        *,
        job: ScientificJob,
        event_index: int,
        message: str,
        level: str = "info",
    ) -> ScientificJobLogEvent:
        """Crea un evento de log para validar endpoints de observabilidad."""
        return ScientificJobLogEvent.objects.create(
            job=job,
            event_index=event_index,
            level=level,
            source="tests.core",
            message=message,
            payload={"event_index": event_index},
        )

    def test_create_and_retrieve_job(self) -> None:
        payload: JSONMap = {
            "plugin_name": "calculator",
            "version": "1.0.0",
            "parameters": {"op": "add", "a": 8, "b": 5},
        }

        with patch(
            "apps.core.routers.viewset.dispatch_scientific_job"
        ) as dispatch_mock:
            dispatch_mock.return_value = True
            create_response = self.client.post("/api/jobs/", payload, format="json")
            self.assertEqual(create_response.status_code, 201)
            created_job_id: str = str(create_response.data["id"])
            dispatch_mock.assert_called_once_with(created_job_id)

        JobService.run_job(created_job_id)

        retrieve_response = self.client.get(f"/api/jobs/{created_job_id}/")
        self.assertEqual(retrieve_response.status_code, 200)
        self.assertEqual(retrieve_response.data["status"], "completed")
        self.assertEqual(retrieve_response.data["plugin_name"], "calculator")

    def test_list_jobs_returns_all_apps_and_statuses(self) -> None:
        first_job: ScientificJob = self._create_job_record(
            plugin_name="calculator", status_value="pending"
        )
        second_job: ScientificJob = self._create_job_record(
            plugin_name="thermodynamics", status_value="completed"
        )

        list_response = self.client.get("/api/jobs/")

        self.assertEqual(list_response.status_code, 200)
        returned_job_ids: set[str] = {str(item["id"]) for item in list_response.data}
        self.assertIn(str(first_job.id), returned_job_ids)
        self.assertIn(str(second_job.id), returned_job_ids)

        job_status_by_id: dict[str, str] = {
            str(item["id"]): str(item["status"]) for item in list_response.data
        }
        self.assertEqual(job_status_by_id[str(first_job.id)], "pending")
        self.assertEqual(job_status_by_id[str(second_job.id)], "completed")

    def test_list_jobs_supports_filters_and_invalid_status(self) -> None:
        self._create_job_record(plugin_name="calculator", status_value="completed")
        self._create_job_record(plugin_name="calculator", status_value="failed")
        self._create_job_record(plugin_name="calculator", status_value="paused")
        self._create_job_record(plugin_name="kinetics", status_value="completed")

        filtered_response = self.client.get(
            "/api/jobs/", {"plugin_name": "calculator", "status": "completed"}
        )
        self.assertEqual(filtered_response.status_code, 200)
        self.assertEqual(len(filtered_response.data), 1)
        self.assertEqual(filtered_response.data[0]["plugin_name"], "calculator")
        self.assertEqual(filtered_response.data[0]["status"], "completed")

        invalid_status_response = self.client.get("/api/jobs/", {"status": "done"})
        self.assertEqual(invalid_status_response.status_code, 400)
        self.assertIn("Invalid status filter", invalid_status_response.data["detail"])

        paused_response = self.client.get("/api/jobs/", {"status": "paused"})
        self.assertEqual(paused_response.status_code, 200)
        self.assertEqual(len(paused_response.data), 1)
        self.assertEqual(paused_response.data[0]["status"], "paused")

    def test_jobs_endpoints_accept_requests_without_trailing_slash(self) -> None:
        payload: JSONMap = {
            "plugin_name": "calculator",
            "version": "1.0.0",
            "parameters": {"op": "add", "a": 1, "b": 2},
        }

        with patch(
            "apps.core.routers.viewset.dispatch_scientific_job"
        ) as dispatch_mock:
            dispatch_mock.return_value = True
            create_response = self.client.post("/api/jobs", payload, format="json")

        self.assertEqual(create_response.status_code, 201)
        created_job_id: str = str(create_response.data["id"])

        retrieve_response = self.client.get(f"/api/jobs/{created_job_id}")
        self.assertEqual(retrieve_response.status_code, 200)

        list_response = self.client.get("/api/jobs")
        self.assertEqual(list_response.status_code, 200)

    def test_create_job_keeps_pending_when_dispatch_is_unavailable(self) -> None:
        payload: JSONMap = {
            "plugin_name": "calculator",
            "version": "1.0.0",
            "parameters": {"op": "add", "a": 2, "b": 3},
        }

        with patch(
            "apps.core.routers.viewset.dispatch_scientific_job"
        ) as dispatch_mock:
            dispatch_mock.return_value = False
            create_response = self.client.post("/api/jobs/", payload, format="json")

        self.assertEqual(create_response.status_code, 201)
        self.assertEqual(create_response.data["status"], "pending")
        self.assertEqual(create_response.data["progress_stage"], "pending")
        self.assertIn("Broker no disponible", create_response.data["progress_message"])

    def test_retrieve_job_normalizes_legacy_terminal_progress_fields(self) -> None:
        completed_job: ScientificJob = ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="calculator",
            algorithm_version="1.0.0",
            status="completed",
            cache_hit=False,
            cache_miss=True,
            parameters={"op": "add", "a": 1, "b": 2},
            results={"final_result": 3},
            progress_percentage=0,
            progress_stage="pending",
            progress_message="Estado legado inconsistente.",
            progress_event_index=1,
        )

        response = self.client.get(f"/api/jobs/{completed_job.id}/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "completed")
        self.assertEqual(response.data["progress_percentage"], 100)
        self.assertEqual(response.data["progress_stage"], "completed")

    def test_progress_endpoint_returns_job_snapshot(self) -> None:
        job: ScientificJob = self._create_job_record(
            plugin_name="calculator",
            status_value="pending",
        )

        response = self.client.get(f"/api/jobs/{job.id}/progress/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(str(response.data["job_id"]), str(job.id))
        self.assertIn("progress_percentage", response.data)
        self.assertIn("progress_stage", response.data)
        self.assertIn("progress_message", response.data)
        self.assertIn("progress_event_index", response.data)

    def test_events_endpoint_returns_sse_payload(self) -> None:
        job: ScientificJob = self._create_job_record(
            plugin_name="calculator",
            status_value="completed",
        )

        response = self.client.get(
            f"/api/jobs/{job.id}/events/",
            {"timeout_seconds": 1},
            HTTP_ACCEPT="text/event-stream",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "text/event-stream")
        stream_payload_text: str = b"".join(response.streaming_content).decode("utf-8")
        self.assertIn("event: job.progress", stream_payload_text)
        self.assertIn(str(job.id), stream_payload_text)

    def test_logs_endpoint_returns_paginated_events(self) -> None:
        job: ScientificJob = self._create_job_record(
            plugin_name="calculator",
            status_value="completed",
        )
        self._create_log_event(job=job, event_index=1, message="Job iniciado")
        self._create_log_event(job=job, event_index=2, message="Plugin ejecutado")
        self._create_log_event(job=job, event_index=3, message="Job completado")

        response = self.client.get(f"/api/jobs/{job.id}/logs/", {"limit": 2})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 2)
        self.assertEqual(len(response.data["results"]), 2)
        self.assertEqual(response.data["results"][0]["event_index"], 1)
        self.assertEqual(response.data["results"][1]["event_index"], 2)
        self.assertEqual(response.data["next_after_event_index"], 2)

    def test_logs_endpoint_returns_events_for_running_job(self) -> None:
        job: ScientificJob = self._create_job_record(
            plugin_name="random-numbers",
            status_value="running",
        )
        ScientificJob.objects.filter(id=job.id).update(
            progress_percentage=55,
            progress_stage="running",
            progress_message="Generados 11/20 números aleatorios.",
        )
        self._create_log_event(
            job=job, event_index=1, message="Procesando lote de generación"
        )
        self._create_log_event(
            job=job, event_index=2, message="Número generado correctamente"
        )

        response = self.client.get(f"/api/jobs/{job.id}/logs/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 2)
        self.assertEqual(
            response.data["results"][0]["message"], "Procesando lote de generación"
        )
        self.assertEqual(
            response.data["results"][1]["message"], "Número generado correctamente"
        )

    def test_logs_events_endpoint_returns_sse_log_payload(self) -> None:
        job: ScientificJob = self._create_job_record(
            plugin_name="calculator",
            status_value="completed",
        )
        self._create_log_event(job=job, event_index=1, message="Job finalizado")

        response = self.client.get(
            f"/api/jobs/{job.id}/logs/events/",
            {"timeout_seconds": 1},
            HTTP_ACCEPT="text/event-stream",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "text/event-stream")
        stream_payload_text: str = b"".join(response.streaming_content).decode("utf-8")
        self.assertIn("event: job.log", stream_payload_text)
        self.assertIn(str(job.id), stream_payload_text)

    def test_pause_endpoint_pauses_supported_job(self) -> None:
        job: ScientificJob = ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="random-numbers",
            algorithm_version="1.0.0",
            status="pending",
            supports_pause_resume=True,
            cache_hit=False,
            cache_miss=True,
            parameters={"seed_url": "https://example.com/seed.txt"},
            progress_percentage=0,
            progress_stage="pending",
            progress_message="Job creado.",
            progress_event_index=1,
        )

        response = self.client.post(f"/api/jobs/{job.id}/pause/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["job"]["status"], "paused")
        self.assertEqual(response.data["job"]["progress_stage"], "paused")

    def test_resume_endpoint_requeues_paused_job(self) -> None:
        job: ScientificJob = ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="random-numbers",
            algorithm_version="1.0.0",
            status="paused",
            supports_pause_resume=True,
            cache_hit=False,
            cache_miss=True,
            parameters={"seed_url": "https://example.com/seed.txt"},
            progress_percentage=42,
            progress_stage="paused",
            progress_message="Pausado.",
            progress_event_index=2,
        )

        with patch(
            "apps.core.routers._job_control_mixin.dispatch_scientific_job"
        ) as dispatch_mock:
            dispatch_mock.return_value = True
            response = self.client.post(f"/api/jobs/{job.id}/resume/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["job"]["status"], "pending")
        self.assertEqual(response.data["job"]["progress_stage"], "queued")

    def test_pause_endpoint_rejects_job_without_pause_support(self) -> None:
        job: ScientificJob = ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="calculator",
            algorithm_version="1.0.0",
            status="running",
            supports_pause_resume=False,
            cache_hit=False,
            cache_miss=True,
            parameters={"op": "add", "a": 1, "b": 2},
            progress_percentage=20,
            progress_stage="running",
            progress_message="Ejecutando.",
            progress_event_index=2,
        )

        response = self.client.post(f"/api/jobs/{job.id}/pause/")

        self.assertEqual(response.status_code, 400)
        self.assertIn("no soporta pausa", str(response.data["detail"]).lower())

    def test_cancel_endpoint_cancels_pending_job(self) -> None:
        """Verifica que se puede cancelar un job en estado pending."""
        job: ScientificJob = ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="calculator",
            algorithm_version="1.0.0",
            status="pending",
            supports_pause_resume=False,
            cache_hit=False,
            cache_miss=True,
            parameters={"op": "add", "a": 1, "b": 2},
            progress_percentage=0,
            progress_stage="pending",
            progress_message="Job creado.",
            progress_event_index=1,
        )

        response = self.client.post(f"/api/jobs/{job.id}/cancel/")

        self.assertEqual(response.status_code, 200)
        job.refresh_from_db()
        self.assertEqual(job.status, "cancelled")
        self.assertEqual(response.data["job"]["status"], "cancelled")
        self.assertEqual(response.data["job"]["progress_stage"], "cancelled")

    def test_cancel_endpoint_cancels_running_job(self) -> None:
        """Verifica que se puede cancelar un job en estado running."""
        job: ScientificJob = ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="calculator",
            algorithm_version="1.0.0",
            status="running",
            supports_pause_resume=False,
            cache_hit=False,
            cache_miss=True,
            parameters={"op": "add", "a": 1, "b": 2},
            progress_percentage=30,
            progress_stage="running",
            progress_message="Ejecutando.",
            progress_event_index=3,
        )

        response = self.client.post(f"/api/jobs/{job.id}/cancel/")

        self.assertEqual(response.status_code, 200)
        job.refresh_from_db()
        self.assertEqual(job.status, "cancelled")

    def test_cancel_endpoint_cancels_paused_job(self) -> None:
        """Verifica que se puede cancelar un job en estado paused."""
        job: ScientificJob = ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="random-numbers",
            algorithm_version="1.0.0",
            status="paused",
            supports_pause_resume=True,
            cache_hit=False,
            cache_miss=True,
            parameters={"seed_url": "https://example.com/seed.txt"},
            progress_percentage=50,
            progress_stage="paused",
            progress_message="Pausado.",
            progress_event_index=5,
        )

        response = self.client.post(f"/api/jobs/{job.id}/cancel/")

        self.assertEqual(response.status_code, 200)
        job.refresh_from_db()
        self.assertEqual(job.status, "cancelled")
        self.assertIn("irreversible", response.data["detail"].lower())

    def test_cancel_endpoint_rejects_completed_job(self) -> None:
        """Verifica que no se puede cancelar un job ya completado."""
        job: ScientificJob = ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="calculator",
            algorithm_version="1.0.0",
            status="completed",
            supports_pause_resume=False,
            cache_hit=False,
            cache_miss=True,
            parameters={"op": "add", "a": 1, "b": 2},
            results={"result": 3.0},
            progress_percentage=100,
            progress_stage="completed",
            progress_message="Completado.",
            progress_event_index=8,
        )

        response = self.client.post(f"/api/jobs/{job.id}/cancel/")

        self.assertEqual(response.status_code, 400)
        self.assertIn("terminal", response.data["detail"].lower())

    def test_cancel_endpoint_rejects_failed_job(self) -> None:
        """Verifica que no se puede cancelar un job fallido."""
        job: ScientificJob = ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="calculator",
            algorithm_version="1.0.0",
            status="failed",
            supports_pause_resume=False,
            cache_hit=False,
            cache_miss=True,
            parameters={"op": "divide", "a": 1, "b": 0},
            progress_percentage=100,
            progress_stage="failed",
            progress_message="Error.",
            progress_event_index=4,
        )

        response = self.client.post(f"/api/jobs/{job.id}/cancel/")

        self.assertEqual(response.status_code, 400)
        self.assertIn("terminal", response.data["detail"].lower())

    def test_cancel_endpoint_rejects_already_cancelled_job(self) -> None:
        """Verifica que no se puede cancelar un job ya cancelado (idempotencia negativa)."""
        job: ScientificJob = ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="calculator",
            algorithm_version="1.0.0",
            status="cancelled",
            supports_pause_resume=False,
            cache_hit=False,
            cache_miss=True,
            parameters={"op": "add", "a": 1, "b": 2},
            progress_percentage=100,
            progress_stage="cancelled",
            progress_message="Cancelado.",
            progress_event_index=3,
        )

        response = self.client.post(f"/api/jobs/{job.id}/cancel/")

        self.assertEqual(response.status_code, 400)
        self.assertIn("terminal", response.data["detail"].lower())

    def test_resume_endpoint_rejects_cancelled_job(self) -> None:
        """Verifica que no se puede reanudar un job cancelado."""
        job: ScientificJob = ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="random-numbers",
            algorithm_version="1.0.0",
            status="cancelled",
            supports_pause_resume=True,
            cache_hit=False,
            cache_miss=True,
            parameters={"seed_url": "https://example.com/seed.txt"},
            progress_percentage=100,
            progress_stage="cancelled",
            progress_message="Cancelado.",
            progress_event_index=5,
        )

        response = self.client.post(f"/api/jobs/{job.id}/resume/")

        self.assertEqual(response.status_code, 400)
        self.assertIn("cancelado", response.data["detail"].lower())

    def test_list_jobs_filter_by_cancelled_status(self) -> None:
        """Verifica que el filtro por estado cancelled funciona correctamente."""
        ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="calculator",
            algorithm_version="1.0.0",
            status="cancelled",
            supports_pause_resume=False,
            cache_hit=False,
            cache_miss=True,
            parameters={"op": "add", "a": 1, "b": 2},
            progress_percentage=100,
            progress_stage="cancelled",
            progress_message="Cancelado.",
            progress_event_index=2,
        )
        ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="calculator",
            algorithm_version="1.0.0",
            status="completed",
            supports_pause_resume=False,
            cache_hit=False,
            cache_miss=True,
            parameters={"op": "add", "a": 1, "b": 2},
            results={"result": 3.0},
            progress_percentage=100,
            progress_stage="completed",
            progress_message="Completado.",
            progress_event_index=5,
        )

        response = self.client.get("/api/jobs/?status=cancelled")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["status"], "cancelled")


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
