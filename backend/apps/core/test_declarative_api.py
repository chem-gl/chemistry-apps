"""test_declarative_api.py: Pruebas de la API declarativa con monadas Result/Task.

Valida que Result[S, E], Task[S, E] y DeclarativeJobAPI funcionan
correctamente para consumo multicanal sin acoplamiento HTTP.
"""

from __future__ import annotations

from unittest.mock import patch

from django.test import TestCase

from .declarative_api import ConcreteJobHandle, DeclarativeJobAPI
from .models import ScientificJob, ScientificJobLogEvent
from .types import DeferredTask, Failure, PureTask, Result, Success, Task


class ResultMonadTests(TestCase):
    """Pruebas del monad Result para manejo funcional de éxito/error."""

    def test_success_value_wrapped_and_retrieved(self) -> None:
        result: Result[int, str] = Success(42)
        self.assertTrue(result.is_success())
        self.assertFalse(result.is_failure())
        self.assertEqual(result.get_or_else(0), 42)

    def test_failure_value_wrapped_and_default_retrieved(self) -> None:
        result: Result[int, str] = Failure("error")
        self.assertFalse(result.is_success())
        self.assertTrue(result.is_failure())
        self.assertEqual(result.get_or_else(999), 999)

    def test_success_map_transforms_value(self) -> None:
        result: Result[int, str] = Success(5).map(lambda x: x * 2)
        self.assertEqual(result.get_or_else(0), 10)

    def test_success_map_chains(self) -> None:
        result: Result[str, str] = (
            Success(3).map(lambda x: x * 2).map(lambda x: f"result: {x}")
        )
        self.assertEqual(result.get_or_else(""), "result: 6")

    def test_failure_map_passes_through(self) -> None:
        result: Result[int, str] = Failure("error").map(lambda x: x * 2)
        self.assertFalse(result.is_success())
        self.assertTrue(result.is_failure())

    def test_success_flat_map_chains_results(self) -> None:
        def double_if_positive(x: int) -> Result[int, str]:
            if x > 0:
                return Success(x * 2)
            return Failure("negative")

        result: Result[int, str] = Success(5).flat_map(double_if_positive)
        self.assertEqual(result.get_or_else(0), 10)

    def test_success_recover_ignored(self) -> None:
        result: Result[int, str] = Success(42).recover(lambda err: 0)
        self.assertEqual(result.get_or_else(0), 42)

    def test_failure_recover_transforms_error_to_success(self) -> None:
        result: Result[int, str] = Failure("error").recover(lambda _: 99)
        self.assertEqual(result.get_or_else(0), 99)
        self.assertTrue(result.is_success())

    def test_fold_on_success(self) -> None:
        result = Success(5).fold(
            on_failure=lambda err: f"failed: {err}",
            on_success=lambda val: f"success: {val}",
        )
        self.assertEqual(result, "success: 5")

    def test_fold_on_failure(self) -> None:
        result = Failure("oops").fold(
            on_failure=lambda err: f"failed: {err}",
            on_success=lambda val: f"success: {val}",
        )
        self.assertEqual(result, "failed: oops")


class TaskMonadTests(TestCase):
    """Pruebas del monad Task para composición diferida."""

    def test_pure_task_runs_immediately(self) -> None:
        task: Task[int, str] = PureTask(Success(42))
        result = task.run()
        self.assertEqual(result.get_or_else(0), 42)

    def test_deferred_task_delays_execution(self) -> None:
        call_count = 0

        def computation() -> Result[int, str]:
            nonlocal call_count
            call_count += 1
            return Success(42)

        task: Task[int, str] = DeferredTask(computation)
        self.assertEqual(call_count, 0)  # No ejecutado aún
        result = task.run()
        self.assertEqual(call_count, 1)  # Ejecutado en run()
        self.assertEqual(result.get_or_else(0), 42)

    def test_task_map_chains_transformations(self) -> None:
        task: Task[str, str] = (
            PureTask(Success(5)).map(lambda x: x * 2).map(lambda x: f"result: {x}")
        )
        result = task.run()
        self.assertEqual(result.get_or_else(""), "result: 10")

    def test_task_flat_map_chains_tasks(self) -> None:
        def make_task(x: int) -> Task[int, str]:
            return PureTask(Success(x * 10))

        task: Task[int, str] = PureTask(Success(5)).flat_map(make_task)
        result = task.run()
        self.assertEqual(result.get_or_else(0), 50)

    def test_deferred_task_failure_propagates(self) -> None:
        def computation() -> Result[int, str]:
            return Failure("error during execution")

        task: Task[int, str] = DeferredTask(computation)
        result = task.run()
        self.assertTrue(result.is_failure())


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

    def test_list_jobs_filters_by_plugin(self) -> None:
        self._create_job(plugin_name="calculator")
        self._create_job(plugin_name="sa_score")
        api = DeclarativeJobAPI()

        result = api.list_jobs(plugin_name="calculator", limit=20)

        self.assertTrue(result.is_success())
        handles = result.get_or_else([])
        self.assertEqual(len(handles), 1)
        self.assertEqual(handles[0].status, "pending")
