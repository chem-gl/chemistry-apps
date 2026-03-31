"""routers/test_viewset.py: Tests del ViewSet HTTP para jobs científicos.

Objetivo del archivo:
- Cubrir todos los endpoints del JobViewSet: list, create, retrieve,
  pause, resume, cancel, progress, logs, logs_events (SSE), events (SSE).

Cómo se usa:
- Ejecutar con `python manage.py test apps.core.routers.test_viewset`.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from apps.core.definitions import CORE_JOBS_API_BASE_PATH
from apps.core.models import ScientificJob, ScientificJobLogEvent
from apps.core.services import JobService

API = CORE_JOBS_API_BASE_PATH  # "/api/jobs/"


def _create_job(plugin_name: str = "calculator", run: bool = False) -> ScientificJob:
    """Crea un job de prueba en base de datos."""
    job: ScientificJob = ScientificJob.objects.create(
        plugin_name=plugin_name,
        algorithm_version="1.0.0",
        job_hash=f"testhash-{plugin_name}",
        parameters={"op": "add", "a": 1, "b": 2},
    )
    if run:
        JobService.run_job(str(job.id))
        job.refresh_from_db()
    return job


class ListJobsViewTests(TestCase):
    """Pruebas del endpoint GET /api/jobs/ con filtros."""

    def setUp(self) -> None:
        self.client = APIClient()

    def test_list_returns_empty_when_no_jobs(self) -> None:
        response = self.client.get(API)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data, [])

    def test_list_returns_existing_jobs(self) -> None:
        _create_job("calculator")
        _create_job("sa-score")
        response = self.client.get(API)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 2)

    def test_list_filters_by_plugin_name(self) -> None:
        _create_job("calculator")
        _create_job("sa-score")
        response = self.client.get(API, {"plugin_name": "calculator"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["plugin_name"], "calculator")

    def test_list_filters_by_status(self) -> None:
        pending_job = _create_job("calculator")
        self.assertEqual(pending_job.status, "pending")
        response = self.client.get(API, {"status": "pending"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(any(str(j["id"]) == str(pending_job.id) for j in response.data))

    def test_list_rejects_invalid_status_filter(self) -> None:
        response = self.client.get(API, {"status": "invalid_state"})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("detail", response.data)


class CreateJobViewTests(TestCase):
    """Pruebas del endpoint POST /api/jobs/ (create)."""

    def setUp(self) -> None:
        self.client = APIClient()

    def test_create_job_returns_201(self) -> None:
        payload = {
            "plugin_name": "calculator",
            "version": "1.0.0",
            "parameters": {"op": "add", "a": 1, "b": 2},
        }
        with patch("apps.core.routers.viewset.dispatch_scientific_job") as mock_d:
            mock_d.return_value = True
            response = self.client.post(API, payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["plugin_name"], "calculator")
        self.assertEqual(response.data["status"], "pending")

    def test_create_job_dispatches_task(self) -> None:
        payload = {
            "plugin_name": "calculator",
            "version": "1.0.0",
            "parameters": {"op": "add", "a": 1, "b": 2},
        }
        with patch("apps.core.routers.viewset.dispatch_scientific_job") as mock_d:
            mock_d.return_value = True
            self.client.post(API, payload, format="json")
            mock_d.assert_called_once()

    def test_create_job_handles_broker_failure(self) -> None:
        """Si dispatch retorna False, job queda en failed (no dispatcher disponible)."""
        payload = {
            "plugin_name": "calculator",
            "version": "1.0.0",
            "parameters": {"op": "add", "a": 1, "b": 2},
        }
        with patch("apps.core.routers.viewset.dispatch_scientific_job") as mock_d:
            mock_d.return_value = False
            response = self.client.post(API, payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_create_job_rejects_missing_fields(self) -> None:
        response = self.client.post(API, {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class RetrieveJobViewTests(TestCase):
    """Pruebas del endpoint GET /api/jobs/{id}/."""

    def setUp(self) -> None:
        self.client = APIClient()

    def test_retrieve_existing_job_returns_200(self) -> None:
        job = _create_job("calculator")
        response = self.client.get(f"{API}{job.id}/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(str(response.data["id"]), str(job.id))

    def test_retrieve_non_existing_job_returns_404(self) -> None:
        from uuid import uuid4

        response = self.client.get(f"{API}{uuid4()}/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_retrieve_completed_job_includes_results(self) -> None:
        job = _create_job("calculator", run=True)
        response = self.client.get(f"{API}{job.id}/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], "completed")
        self.assertIsNotNone(response.data["results"])


class PauseJobViewTests(TestCase):
    """Pruebas del endpoint POST /api/jobs/{id}/pause/."""

    def setUp(self) -> None:
        self.client = APIClient()

    def test_pause_pending_job_returns_200(self) -> None:
        job = ScientificJob.objects.create(
            plugin_name="random-numbers",
            algorithm_version="1.0.0",
            job_hash="testhash-rng-pause",
            parameters={"count": 5},
            supports_pause_resume=True,
        )
        response = self.client.post(f"{API}{job.id}/pause/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("detail", response.data)
        self.assertIn("job", response.data)

    def test_pause_non_existing_job_returns_404(self) -> None:
        from uuid import uuid4

        response = self.client.post(f"{API}{uuid4()}/pause/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_pause_completed_job_returns_400(self) -> None:
        job = _create_job("calculator", run=True)
        response = self.client.post(f"{API}{job.id}/pause/")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_pause_job_without_pause_support_returns_400(self) -> None:
        job = ScientificJob.objects.create(
            plugin_name="calculator",
            algorithm_version="1.0.0",
            job_hash="testhash-calc-no-pause",
            parameters={"op": "add", "a": 1, "b": 2},
            supports_pause_resume=False,
        )
        response = self.client.post(f"{API}{job.id}/pause/")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class ResumeJobViewTests(TestCase):
    """Pruebas del endpoint POST /api/jobs/{id}/resume/."""

    def setUp(self) -> None:
        self.client = APIClient()

    def test_resume_paused_job_returns_200(self) -> None:
        job = ScientificJob.objects.create(
            plugin_name="random-numbers",
            algorithm_version="1.0.0",
            job_hash="testhash-rng-resume",
            parameters={"count": 5},
            status="paused",
            supports_pause_resume=True,
        )
        with patch("apps.core.routers.viewset.dispatch_scientific_job") as mock_d:
            mock_d.return_value = True
            response = self.client.post(f"{API}{job.id}/resume/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("detail", response.data)

    def test_resume_pending_job_returns_400(self) -> None:
        job = ScientificJob.objects.create(
            plugin_name="calculator",
            algorithm_version="1.0.0",
            job_hash="testhash-calc-resume-fail",
            parameters={"op": "add", "a": 1, "b": 2},
            supports_pause_resume=True,
        )
        response = self.client.post(f"{API}{job.id}/resume/")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_resume_non_existing_job_returns_404(self) -> None:
        from uuid import uuid4

        response = self.client.post(f"{API}{uuid4()}/resume/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class CancelJobViewTests(TestCase):
    """Pruebas del endpoint POST /api/jobs/{id}/cancel/."""

    def setUp(self) -> None:
        self.client = APIClient()

    def test_cancel_pending_job_returns_200(self) -> None:
        job = _create_job("calculator")
        response = self.client.post(f"{API}{job.id}/cancel/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("detail", response.data)
        job.refresh_from_db()
        self.assertEqual(job.status, "cancelled")

    def test_cancel_completed_job_returns_400(self) -> None:
        job = _create_job("calculator", run=True)
        response = self.client.post(f"{API}{job.id}/cancel/")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_cancel_non_existing_job_returns_404(self) -> None:
        from uuid import uuid4

        response = self.client.post(f"{API}{uuid4()}/cancel/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_cancel_already_cancelled_job_returns_400(self) -> None:
        job = ScientificJob.objects.create(
            plugin_name="calculator",
            algorithm_version="1.0.0",
            job_hash="testhash-already-cancelled",
            parameters={},
            status="cancelled",
        )
        response = self.client.post(f"{API}{job.id}/cancel/")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class ProgressJobViewTests(TestCase):
    """Pruebas del endpoint GET /api/jobs/{id}/progress/."""

    def setUp(self) -> None:
        self.client = APIClient()

    def test_progress_returns_snapshot(self) -> None:
        job = _create_job("calculator")
        response = self.client.get(f"{API}{job.id}/progress/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("job_id", response.data)
        self.assertIn("status", response.data)
        self.assertIn("progress_percentage", response.data)
        self.assertIn("progress_stage", response.data)

    def test_progress_non_existing_job_returns_404(self) -> None:
        from uuid import uuid4

        response = self.client.get(f"{API}{uuid4()}/progress/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class LogsJobViewTests(TestCase):
    """Pruebas del endpoint GET /api/jobs/{id}/logs/."""

    def setUp(self) -> None:
        self.client = APIClient()

    def test_logs_returns_empty_list_for_new_job(self) -> None:
        job = _create_job("calculator")
        response = self.client.get(f"{API}{job.id}/logs/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 0)
        self.assertEqual(response.data["results"], [])

    def test_logs_returns_entries_after_run(self) -> None:
        job = _create_job("calculator", run=True)
        response = self.client.get(f"{API}{job.id}/logs/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("job_id", response.data)
        self.assertIn("next_after_event_index", response.data)

    def test_logs_after_event_index_filters_correctly(self) -> None:
        job = _create_job("calculator", run=True)
        response_all = self.client.get(f"{API}{job.id}/logs/")
        total_count = response_all.data["count"]
        response_filtered = self.client.get(
            f"{API}{job.id}/logs/", {"after_event_index": 9999}
        )
        self.assertEqual(response_filtered.status_code, status.HTTP_200_OK)
        self.assertEqual(response_filtered.data["count"], 0)
        self.assertGreaterEqual(total_count, 0)

    def test_logs_non_existing_job_returns_404(self) -> None:
        from uuid import uuid4

        response = self.client.get(f"{API}{uuid4()}/logs/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_logs_limit_parameter_respected(self) -> None:
        job = _create_job("calculator", run=True)
        response = self.client.get(f"{API}{job.id}/logs/", {"limit": "2"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertLessEqual(response.data["count"], 2)


class SseLogsEventsViewTests(TestCase):
    """Pruebas del endpoint GET /api/jobs/{id}/logs/events/ (SSE)."""

    def setUp(self) -> None:
        self.client = APIClient()

    def test_logs_events_returns_streaming_response(self) -> None:
        job = _create_job("calculator", run=True)
        mock_gen = iter(["id: 0\nevent: job.log\ndata: {}\n\n"])
        with patch(
            "apps.core.routers.viewset.stream_job_log_events",
            return_value=mock_gen,
        ):
            response = self.client.get(f"{API}{job.id}/logs/events/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_logs_events_non_existing_job_returns_404(self) -> None:
        from uuid import uuid4

        response = self.client.get(f"{API}{uuid4()}/logs/events/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_logs_events_with_timeout_param(self) -> None:
        job = _create_job("calculator")
        mock_gen = iter(["id: 0\nevent: job.log\ndata: {}\n\n"])
        with patch(
            "apps.core.routers.viewset.stream_job_log_events",
            return_value=mock_gen,
        ):
            response = self.client.get(
                f"{API}{job.id}/logs/events/", {"timeout_seconds": "10"}
            )
        self.assertEqual(response.status_code, status.HTTP_200_OK)


class SseEventsViewTests(TestCase):
    """Pruebas del endpoint GET /api/jobs/{id}/events/ (SSE de progreso)."""

    def setUp(self) -> None:
        self.client = APIClient()

    def test_events_returns_streaming_response(self) -> None:
        job = _create_job("calculator")
        mock_gen = iter(["id: 0\nevent: job.progress\ndata: {}\n\n"])
        with patch(
            "apps.core.routers.viewset.stream_job_events",
            return_value=mock_gen,
        ):
            response = self.client.get(f"{API}{job.id}/events/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_events_non_existing_job_returns_404(self) -> None:
        from uuid import uuid4

        response = self.client.get(f"{API}{uuid4()}/events/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_events_with_last_event_id_header(self) -> None:
        job = _create_job("calculator")
        mock_gen = iter(["id: 5\nevent: job.progress\ndata: {}\n\n"])
        with patch(
            "apps.core.routers.viewset.stream_job_events",
            return_value=mock_gen,
        ) as mock_stream:
            self.client.get(
                f"{API}{job.id}/events/",
                HTTP_LAST_EVENT_ID="5",
            )
            mock_stream.assert_called_once()
            call_kwargs = mock_stream.call_args.kwargs
            self.assertEqual(call_kwargs["last_event_index"], 5)

    def test_events_with_timeout_param(self) -> None:
        job = _create_job("calculator")
        mock_gen = iter([])
        with patch(
            "apps.core.routers.viewset.stream_job_events",
            return_value=mock_gen,
        ) as mock_stream:
            self.client.get(f"{API}{job.id}/events/", {"timeout_seconds": "60"})
            call_kwargs = mock_stream.call_args.kwargs
            self.assertEqual(call_kwargs["timeout_seconds"], 60)
