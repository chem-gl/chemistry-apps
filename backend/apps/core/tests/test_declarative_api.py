"""test_declarative_api.py: Pruebas de ConcreteJobHandle y DeclarativeJobAPI.

Valida que ConcreteJobHandle y DeclarativeJobAPI funcionan correctamente
para consumo multicanal sin acoplamiento HTTP.
"""

from __future__ import annotations

from unittest.mock import patch

from django.test import TestCase

from ..declarative_api import ConcreteJobHandle, DeclarativeJobAPI
from ..models import ScientificJob, ScientificJobLogEvent


class ConcreteJobHandleTests(TestCase):
    """Pruebas de comportamiento del handle concreto sobre ScientificJob."""

    def _create_job(
        self,
        *,
        status: str = "running",
        supports_pause_resume: bool = False,
        results: dict[str, object] | None = None,
        error_trace: str = "",
    ) -> ScientificJob:
        return ScientificJob.objects.create(
            job_hash="job-hash-declarative",
            plugin_name="calculator",
            algorithm_version="1.0",
            status=status,
            supports_pause_resume=supports_pause_resume,
            parameters={"op": "add", "a": 2, "b": 3},
            results=results,
            error_trace=error_trace,
            progress_percentage=30,
            progress_stage="running",
            progress_message="ejecutando",
            progress_event_index=4,
        )

    def test_get_progress_and_get_logs_return_expected_payloads(self) -> None:
        job = self._create_job()
        ScientificJobLogEvent.objects.create(
            job=job,
            event_index=1,
            level="info",
            source="core.runtime",
            message="inicio",
            payload={"step": 1},
        )

        handle = ConcreteJobHandle(job)
        progress = handle.get_progress()
        logs = handle.get_logs(after_event_index=0, limit=10)

        self.assertEqual(progress["job_id"], str(job.id))
        self.assertEqual(progress["status"], "running")
        self.assertEqual(logs["count"], 1)
        self.assertEqual(logs["results"][0]["message"], "inicio")
        self.assertFalse(handle.supports_pause_resume)

    @patch("apps.core.declarative_api.time.sleep", return_value=None)
    @patch("apps.core.declarative_api.time.time")
    def test_wait_for_terminal_returns_timeout_error_for_non_terminal_job(
        self,
        mocked_time: object,
        _mocked_sleep: object,
    ) -> None:
        mocked_time.side_effect = [0.0, 100.0]
        job = self._create_job(status="running")
        handle = ConcreteJobHandle(job)

        result = handle.wait_for_terminal(timeout_seconds=10)

        self.assertTrue(result.is_failure())
        self.assertIn(
            "did not complete", str(result.fold(lambda err: err, lambda _: ""))
        )

    @patch("apps.core.declarative_api.time.sleep", return_value=None)
    @patch("apps.core.declarative_api.time.time")
    def test_wait_for_terminal_returns_failure_for_failed_job(
        self,
        mocked_time: object,
        _mocked_sleep: object,
    ) -> None:
        mocked_time.side_effect = [0.0, 0.0]
        job = self._create_job(status="failed", error_trace="boom")
        handle = ConcreteJobHandle(job)

        result = handle.wait_for_terminal(timeout_seconds=10)

        self.assertTrue(result.is_failure())
        self.assertIn("failed", str(result.fold(lambda err: err, lambda _: "")))

    @patch("apps.core.declarative_api.time.sleep", return_value=None)
    @patch("apps.core.declarative_api.time.time")
    def test_wait_for_terminal_returns_success_for_completed_job(
        self,
        mocked_time: object,
        _mocked_sleep: object,
    ) -> None:
        mocked_time.side_effect = [0.0, 0.0]
        job = self._create_job(status="completed", results={"value": 5})
        handle = ConcreteJobHandle(job)

        result = handle.wait_for_terminal(timeout_seconds=10)

        self.assertTrue(result.is_success())
        self.assertEqual(result.get_or_else({}), {"value": 5})

    @patch("apps.core.declarative_api.time.sleep", return_value=None)
    @patch("apps.core.declarative_api.time.time")
    def test_wait_for_terminal_returns_failure_for_cancelled_job(
        self,
        mocked_time: object,
        _mocked_sleep: object,
    ) -> None:
        mocked_time.side_effect = [0.0, 0.0]
        job = self._create_job(status="cancelled")
        handle = ConcreteJobHandle(job)

        result = handle.wait_for_terminal(timeout_seconds=10)

        self.assertTrue(result.is_failure())
        self.assertIn("cancel", str(result.fold(lambda err: err, lambda _: "")))

    @patch("apps.core.declarative_api.JobService.request_pause")
    def test_request_pause_returns_failure_when_pause_not_supported(
        self,
        mocked_request_pause: object,
    ) -> None:
        job = self._create_job(supports_pause_resume=False)
        handle = ConcreteJobHandle(job)

        result = handle.request_pause().run()

        self.assertTrue(result.is_failure())
        mocked_request_pause.assert_not_called()

    @patch("apps.core.declarative_api.JobService.request_pause")
    def test_request_pause_returns_success_when_supported(
        self, mocked_request_pause: object
    ) -> None:
        job = self._create_job(supports_pause_resume=True)
        handle = ConcreteJobHandle(job)

        result = handle.request_pause().run()

        self.assertTrue(result.is_success())
        mocked_request_pause.assert_called_once_with(str(job.id))

    @patch("apps.core.declarative_api.JobService.request_pause")
    def test_request_pause_returns_failure_on_service_exception(
        self, mocked_request_pause: object
    ) -> None:
        mocked_request_pause.side_effect = RuntimeError("pause unavailable")
        job = self._create_job(supports_pause_resume=True)
        handle = ConcreteJobHandle(job)

        result = handle.request_pause().run()

        self.assertTrue(result.is_failure())
        self.assertIn(
            "pause unavailable", str(result.fold(lambda err: err, lambda _: ""))
        )

    def test_resume_returns_failure_when_pause_not_supported(self) -> None:
        job = self._create_job(status="paused", supports_pause_resume=False)
        handle = ConcreteJobHandle(job)

        result = handle.resume().run()

        self.assertTrue(result.is_failure())

    @patch("apps.core.declarative_api.JobService.resume_job")
    def test_resume_returns_failure_when_dispatch_after_resume_fails(
        self,
        mocked_resume_job: object,
    ) -> None:
        job = self._create_job(status="paused", supports_pause_resume=True)
        handle = ConcreteJobHandle(job, dispatch_callback=lambda _job_id: False)

        result = handle.resume().run()

        self.assertTrue(result.is_failure())
        mocked_resume_job.assert_called_once_with(str(job.id))

    @patch("apps.core.declarative_api.JobService.resume_job")
    def test_resume_returns_failure_when_service_raises_exception(
        self,
        mocked_resume_job: object,
    ) -> None:
        mocked_resume_job.side_effect = RuntimeError("resume broken")
        job = self._create_job(status="paused", supports_pause_resume=True)
        handle = ConcreteJobHandle(job)

        result = handle.resume().run()

        self.assertTrue(result.is_failure())
        self.assertIn("resume broken", str(result.fold(lambda err: err, lambda _: "")))

    @patch("apps.core.declarative_api.JobService.resume_job")
    def test_resume_returns_failure_when_status_is_not_paused(
        self,
        mocked_resume_job: object,
    ) -> None:
        job = self._create_job(status="running", supports_pause_resume=True)
        handle = ConcreteJobHandle(job)

        result = handle.resume().run()

        self.assertTrue(result.is_failure())
        mocked_resume_job.assert_not_called()

    @patch("apps.core.declarative_api.JobService.cancel_job")
    def test_cancel_returns_failure_for_terminal_job(
        self, mocked_cancel_job: object
    ) -> None:
        job = self._create_job(status="completed")
        handle = ConcreteJobHandle(job)

        result = handle.cancel().run()

        self.assertTrue(result.is_failure())
        mocked_cancel_job.assert_not_called()

    @patch("apps.core.declarative_api.JobService.cancel_job")
    def test_cancel_returns_success_for_non_terminal_job(
        self, mocked_cancel_job: object
    ) -> None:
        job = self._create_job(status="running")
        handle = ConcreteJobHandle(job)

        result = handle.cancel().run()

        self.assertTrue(result.is_success())
        mocked_cancel_job.assert_called_once_with(str(job.id))

    @patch("apps.core.declarative_api.JobService.cancel_job")
    def test_cancel_returns_failure_when_service_raises_exception(
        self, mocked_cancel_job: object
    ) -> None:
        mocked_cancel_job.side_effect = RuntimeError("cancel broken")
        job = self._create_job(status="running")
        handle = ConcreteJobHandle(job)

        result = handle.cancel().run()

        self.assertTrue(result.is_failure())
        self.assertIn("cancel broken", str(result.fold(lambda err: err, lambda _: "")))

    @patch("apps.core.declarative_api.JobService.register_dispatch_result")
    def test_dispatch_if_pending_registers_dispatch_result(
        self, mocked_register_dispatch: object
    ) -> None:
        job = self._create_job(status="pending")
        handle = ConcreteJobHandle(job, dispatch_callback=lambda _job_id: True)

        result = handle.dispatch_if_pending().run()

        self.assertTrue(result.is_success())
        mocked_register_dispatch.assert_called_once_with(str(job.id), True)

    @patch("apps.core.declarative_api.JobService.register_dispatch_result")
    def test_dispatch_if_pending_skips_dispatch_for_non_pending_job(
        self, mocked_register_dispatch: object
    ) -> None:
        job = self._create_job(status="completed")
        handle = ConcreteJobHandle(job)

        result = handle.dispatch_if_pending().run()

        self.assertTrue(result.is_success())
        mocked_register_dispatch.assert_not_called()

    def test_dispatch_if_pending_returns_failure_when_dispatch_raises(self) -> None:
        job = self._create_job(status="pending")

        def raise_dispatch(_job_id: str) -> bool:
            raise RuntimeError("dispatch unavailable")

        handle = ConcreteJobHandle(job, dispatch_callback=raise_dispatch)

        result = handle.dispatch_if_pending().run()

        self.assertTrue(result.is_failure())
        self.assertIn(
            "dispatch unavailable", str(result.fold(lambda err: err, lambda _: ""))
        )


class DeclarativeJobAPITests(TestCase):
    """Pruebas de API declarativa para submit, lookup y listado."""

    def _create_job(self, plugin_name: str = "calculator") -> ScientificJob:
        return ScientificJob.objects.create(
            job_hash="job-hash-api",
            plugin_name=plugin_name,
            algorithm_version="1.0",
            status="pending",
            parameters={"a": 1},
            results=None,
            progress_percentage=0,
            progress_stage="pending",
            progress_message="pending",
            progress_event_index=0,
        )

    @patch("apps.core.declarative_api.JobService.register_dispatch_result")
    @patch("apps.core.declarative_api.JobService.create_job")
    @patch("apps.core.declarative_api.ScientificAppRegistry.get_definition_by_plugin")
    def test_submit_job_returns_handle_when_plugin_exists(
        self,
        mocked_get_definition: object,
        mocked_create_job: object,
        mocked_register_dispatch: object,
    ) -> None:
        mocked_get_definition.return_value = object()
        created_job = self._create_job("calculator")
        mocked_create_job.return_value = created_job

        api = DeclarativeJobAPI(dispatch_callback=lambda _job_id: True)
        result = api.submit_job(plugin="calculator", parameters={"a": 1}).run()

        self.assertTrue(result.is_success())
        self.assertEqual(result.get_or_else(None).job_id, str(created_job.id))
        mocked_register_dispatch.assert_called_once_with(str(created_job.id), True)

    @patch("apps.core.declarative_api.JobService.register_dispatch_result")
    @patch("apps.core.declarative_api.JobService.create_job")
    @patch("apps.core.declarative_api.ScientificAppRegistry.get_definition_by_plugin")
    def test_submit_job_propagates_owner_and_group_scope(
        self,
        mocked_get_definition: object,
        mocked_create_job: object,
        mocked_register_dispatch: object,
    ) -> None:
        """Verifica que submit_job conserva owner/group para autorización posterior."""
        mocked_get_definition.return_value = object()
        created_job = self._create_job("calculator")
        mocked_create_job.return_value = created_job

        api = DeclarativeJobAPI(dispatch_callback=lambda _job_id: True)
        result = api.submit_job(
            plugin="calculator",
            parameters={"a": 1},
            owner_id=17,
            group_id=5,
        ).run()

        self.assertTrue(result.is_success())
        mocked_create_job.assert_called_once_with(
            plugin_name="calculator",
            version="1.0",
            parameters={"a": 1},
            owner_id=17,
            group_id=5,
        )
        mocked_register_dispatch.assert_called_once_with(str(created_job.id), True)

    @patch("apps.core.declarative_api.ScientificAppRegistry.get_definition_by_plugin")
    def test_submit_job_returns_failure_when_plugin_missing(
        self,
        mocked_get_definition: object,
    ) -> None:
        mocked_get_definition.return_value = None
        api = DeclarativeJobAPI()

        result = api.submit_job(plugin="unknown", parameters={}).run()

        self.assertTrue(result.is_failure())

    def test_get_job_handle_returns_failure_for_missing_job(self) -> None:
        api = DeclarativeJobAPI()
        result = api.get_job_handle(job_id="00000000-0000-0000-0000-000000000000")
        self.assertTrue(result.is_failure())

    def test_get_job_handle_returns_success_for_existing_job(self) -> None:
        created_job = self._create_job(plugin_name="calculator")
        api = DeclarativeJobAPI()

        result = api.get_job_handle(job_id=str(created_job.id))

        self.assertTrue(result.is_success())
        self.assertEqual(result.get_or_else(None).job_id, str(created_job.id))

    @patch("apps.core.declarative_api.ScientificJob.objects.get")
    def test_get_job_handle_returns_failure_for_unexpected_exception(
        self, mocked_get: object
    ) -> None:
        mocked_get.side_effect = RuntimeError("db broken")
        api = DeclarativeJobAPI()

        result = api.get_job_handle(job_id="irrelevant")

        self.assertTrue(result.is_failure())
        self.assertIn("db broken", str(result.fold(lambda err: err, lambda _: "")))

    @patch("apps.core.declarative_api.JobService.create_job")
    @patch("apps.core.declarative_api.ScientificAppRegistry.get_definition_by_plugin")
    def test_submit_job_returns_failure_when_create_job_raises(
        self,
        mocked_get_definition: object,
        mocked_create_job: object,
    ) -> None:
        mocked_get_definition.return_value = object()
        mocked_create_job.side_effect = RuntimeError("create failed")

        api = DeclarativeJobAPI()
        result = api.submit_job(plugin="calculator", parameters={"a": 1}).run()

        self.assertTrue(result.is_failure())
        self.assertIn("create failed", str(result.fold(lambda err: err, lambda _: "")))

    @patch("apps.core.declarative_api.JobService.create_job")
    @patch("apps.core.declarative_api.ScientificAppRegistry.get_definition_by_plugin")
    def test_prepare_job_returns_failure_when_plugin_missing(
        self,
        mocked_get_definition: object,
        _mocked_create_job: object,
    ) -> None:
        mocked_get_definition.return_value = None
        api = DeclarativeJobAPI()

        result = api.prepare_job(plugin="missing", parameters={}).run()

        self.assertTrue(result.is_failure())

    @patch("apps.core.declarative_api.JobService.create_job")
    @patch("apps.core.declarative_api.ScientificAppRegistry.get_definition_by_plugin")
    def test_prepare_job_returns_success_for_existing_plugin(
        self,
        mocked_get_definition: object,
        mocked_create_job: object,
    ) -> None:
        mocked_get_definition.return_value = object()
        created_job = self._create_job(plugin_name="calculator")
        mocked_create_job.return_value = created_job

        api = DeclarativeJobAPI()
        result = api.prepare_job(plugin="calculator", parameters={"a": 1}).run()

        self.assertTrue(result.is_success())
        self.assertEqual(result.get_or_else(None).job_id, str(created_job.id))

    def test_submit_and_wait_returns_failure_when_submit_fails(self) -> None:
        api = DeclarativeJobAPI()
        result = api.submit_and_wait(
            plugin="unknown", parameters={}, timeout_seconds=1
        ).run()

        self.assertTrue(result.is_failure())

    @patch("apps.core.declarative_api.ScientificJob.objects.all")
    def test_list_jobs_returns_failure_when_query_raises(
        self, mocked_all: object
    ) -> None:
        mocked_all.side_effect = RuntimeError("query broken")
        api = DeclarativeJobAPI()

        result = api.list_jobs()

        self.assertTrue(result.is_failure())
        self.assertIn("query broken", str(result.fold(lambda err: err, lambda _: "")))

    def test_list_jobs_filters_by_plugin(self) -> None:
        self._create_job(plugin_name="calculator")
        self._create_job(plugin_name="sa_score")
        api = DeclarativeJobAPI()

        result = api.list_jobs(plugin_name="calculator", limit=20)

        self.assertTrue(result.is_success())
        handles = result.get_or_else([])
        self.assertEqual(len(handles), 1)
        self.assertEqual(handles[0].status, "pending")

    def test_list_jobs_filters_by_status(self) -> None:
        self._create_job(plugin_name="calculator")
        ScientificJob.objects.create(
            job_hash="job-hash-api-completed",
            plugin_name="calculator",
            algorithm_version="1.0",
            status="completed",
            parameters={"a": 1},
            results={"done": True},
            progress_percentage=100,
            progress_stage="completed",
            progress_message="done",
            progress_event_index=10,
        )
        api = DeclarativeJobAPI()

        result = api.list_jobs(status="completed", limit=20)

        self.assertTrue(result.is_success())
        handles = result.get_or_else([])
        self.assertEqual(len(handles), 1)
        self.assertEqual(handles[0].status, "completed")
