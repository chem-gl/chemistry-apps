"""tests.py: Pruebas unitarias e integracion API para core y cache de jobs."""

from __future__ import annotations

from collections.abc import Callable
from datetime import timedelta
from pathlib import Path
from unittest.mock import MagicMock, patch
from uuid import uuid4

from django.core.exceptions import ImproperlyConfigured
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .app_registry import ScientificAppDefinition, ScientificAppRegistry
from .cache import generate_job_hash
from .models import ScientificCacheEntry, ScientificJob, ScientificJobLogEvent
from .processing import PluginRegistry
from .services import JobService
from .types import JSONMap

PluginSourceCallable = Callable[[JSONMap], JSONMap]


class HashingTests(TestCase):
    """Valida fingerprint reproducible del motor de cache."""

    def test_hash_is_deterministic_for_same_payload(self) -> None:
        first_payload: JSONMap = {"op": "add", "a": 2, "b": 3}
        second_payload: JSONMap = {"b": 3, "a": 2, "op": "add"}

        hash_one: str = generate_job_hash("calculator", "1.0.0", first_payload)
        hash_two: str = generate_job_hash("calculator", "1.0.0", second_payload)

        self.assertEqual(hash_one, hash_two)


class JobServiceTests(TestCase):
    """Prueba flujo de ejecucion y cache en capa de servicios."""

    def test_run_job_creates_cache_entry(self) -> None:
        payload: JSONMap = {"op": "mul", "a": 4, "b": 6}
        job: ScientificJob = JobService.create_job("calculator", "1.0.0", payload)

        JobService.run_job(str(job.id))

        refreshed_job: ScientificJob = ScientificJob.objects.get(id=job.id)
        self.assertEqual(refreshed_job.status, "completed")
        self.assertFalse(refreshed_job.cache_hit)
        self.assertTrue(refreshed_job.cache_miss)

        cache_entry_exists: bool = ScientificCacheEntry.objects.filter(
            job_hash=refreshed_job.job_hash,
            plugin_name="calculator",
            algorithm_version="1.0.0",
        ).exists()
        self.assertTrue(cache_entry_exists)

    def test_run_job_persists_terminal_progress_when_completed(self) -> None:
        payload: JSONMap = {"op": "add", "a": 4, "b": 6}
        job: ScientificJob = JobService.create_job("calculator", "1.0.0", payload)

        JobService.run_job(str(job.id))

        refreshed_job: ScientificJob = ScientificJob.objects.get(id=job.id)
        self.assertEqual(refreshed_job.status, "completed")
        self.assertEqual(refreshed_job.progress_percentage, 100)
        self.assertEqual(refreshed_job.progress_stage, "completed")

    def test_run_job_persists_terminal_progress_when_failed(self) -> None:
        payload: JSONMap = {"op": "div", "a": 10, "b": 0}
        job: ScientificJob = JobService.create_job("calculator", "1.0.0", payload)

        JobService.run_job(str(job.id))

        refreshed_job: ScientificJob = ScientificJob.objects.get(id=job.id)
        self.assertEqual(refreshed_job.status, "failed")
        self.assertEqual(refreshed_job.progress_percentage, 100)
        self.assertEqual(refreshed_job.progress_stage, "failed")

    def test_create_job_uses_early_cache_hit(self) -> None:
        payload: JSONMap = {"op": "sub", "a": 10, "b": 3}
        base_job: ScientificJob = JobService.create_job("calculator", "1.0.0", payload)
        JobService.run_job(str(base_job.id))

        cached_job: ScientificJob = JobService.create_job(
            "calculator", "1.0.0", payload
        )

        self.assertEqual(cached_job.status, "completed")
        self.assertTrue(cached_job.cache_hit)
        self.assertFalse(cached_job.cache_miss)

    def test_active_recovery_requeues_stale_running_job(self) -> None:
        stale_job: ScientificJob = ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="calculator",
            algorithm_version="1.0.0",
            status="running",
            cache_hit=False,
            cache_miss=True,
            parameters={"op": "add", "a": 2, "b": 3},
            progress_percentage=40,
            progress_stage="running",
            progress_message="Ejecutando plugin científico.",
            progress_event_index=2,
            recovery_attempts=0,
            max_recovery_attempts=2,
        )
        ScientificJob.objects.filter(id=stale_job.id).update(
            updated_at=timezone.now() - timedelta(seconds=180)
        )

        summary = JobService.run_active_recovery(
            dispatch_callback=lambda _job_id: True,
            stale_seconds=60,
            include_pending_jobs=True,
        )

        stale_job.refresh_from_db()
        self.assertEqual(summary["stale_running_detected"], 1)
        self.assertEqual(summary["requeued_successfully"], 1)
        self.assertEqual(stale_job.status, "pending")
        self.assertEqual(stale_job.recovery_attempts, 1)
        self.assertEqual(stale_job.progress_stage, "queued")

    def test_active_recovery_marks_failed_when_retry_limit_exceeded(self) -> None:
        stale_job: ScientificJob = ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="calculator",
            algorithm_version="1.0.0",
            status="running",
            cache_hit=False,
            cache_miss=True,
            parameters={"op": "add", "a": 2, "b": 3},
            progress_percentage=55,
            progress_stage="running",
            progress_message="Ejecutando plugin científico.",
            progress_event_index=3,
            recovery_attempts=2,
            max_recovery_attempts=2,
        )
        ScientificJob.objects.filter(id=stale_job.id).update(
            updated_at=timezone.now() - timedelta(seconds=200)
        )

        summary = JobService.run_active_recovery(
            dispatch_callback=lambda _job_id: True,
            stale_seconds=60,
            include_pending_jobs=False,
        )

        stale_job.refresh_from_db()
        self.assertEqual(summary["marked_failed_by_retries"], 1)
        self.assertEqual(stale_job.status, "failed")
        self.assertIn("Límite de recuperación automática", str(stale_job.error_trace))

    def test_active_recovery_requeues_stale_pending_job(self) -> None:
        pending_job: ScientificJob = ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="calculator",
            algorithm_version="1.0.0",
            status="pending",
            cache_hit=False,
            cache_miss=True,
            parameters={"op": "add", "a": 2, "b": 3},
            progress_percentage=0,
            progress_stage="pending",
            progress_message="Broker no disponible. El job permanece pendiente.",
            progress_event_index=1,
            recovery_attempts=0,
            max_recovery_attempts=3,
        )
        ScientificJob.objects.filter(id=pending_job.id).update(
            updated_at=timezone.now() - timedelta(seconds=180)
        )

        summary = JobService.run_active_recovery(
            dispatch_callback=lambda _job_id: True,
            stale_seconds=60,
            include_pending_jobs=True,
        )

        pending_job.refresh_from_db()
        self.assertEqual(summary["stale_pending_detected"], 1)
        self.assertEqual(summary["requeued_successfully"], 1)
        self.assertEqual(pending_job.recovery_attempts, 1)
        self.assertEqual(pending_job.progress_stage, "queued")


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

        with patch("apps.core.routers.dispatch_scientific_job") as dispatch_mock:
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

    def test_jobs_endpoints_accept_requests_without_trailing_slash(self) -> None:
        payload: JSONMap = {
            "plugin_name": "calculator",
            "version": "1.0.0",
            "parameters": {"op": "add", "a": 1, "b": 2},
        }

        with patch("apps.core.routers.dispatch_scientific_job") as dispatch_mock:
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

        with patch("apps.core.routers.dispatch_scientific_job") as dispatch_mock:
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
        stream_payload_text: str = response.content.decode("utf-8")
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
        stream_payload_text: str = response.content.decode("utf-8")
        self.assertIn("event: job.log", stream_payload_text)
        self.assertIn(str(job.id), stream_payload_text)


class CalculatorTemplateIntegrationTests(TestCase):
    """Valida integración de la app calculadora como plantilla desacoplada."""

    def test_calculator_plugin_is_registered_and_executes(self) -> None:
        calculator_parameters: JSONMap = {"op": "mul", "a": 7, "b": 6}

        execution_result: JSONMap = PluginRegistry.execute(
            "calculator", calculator_parameters
        )

        self.assertEqual(execution_result["final_result"], 42.0)


class PluginRegistryValidationTests(TestCase):
    """Asegura validación de colisiones en registro de plugins."""

    def setUp(self) -> None:
        self.original_plugins: dict[str, PluginSourceCallable] = dict(
            PluginRegistry._plugins
        )
        self.original_plugin_sources: dict[str, str] = dict(
            PluginRegistry._plugin_sources
        )
        PluginRegistry._plugins.clear()
        PluginRegistry._plugin_sources.clear()

    def tearDown(self) -> None:
        PluginRegistry._plugins = self.original_plugins
        PluginRegistry._plugin_sources = self.original_plugin_sources

    def test_register_raises_for_duplicated_name_from_different_source(self) -> None:
        def first_plugin(parameters: JSONMap) -> JSONMap:
            return {"origin": "first", "parameters": parameters}

        def second_plugin(parameters: JSONMap) -> JSONMap:
            return {"origin": "second", "parameters": parameters}

        PluginRegistry.register("duplicated-plugin")(first_plugin)

        with self.assertRaises(ImproperlyConfigured):
            PluginRegistry.register("duplicated-plugin")(second_plugin)


class ScientificAppRegistryValidationTests(TestCase):
    """Verifica unicidad de metadatos de app científica al levantar el sistema."""

    def setUp(self) -> None:
        self.original_by_plugin: dict[str, ScientificAppDefinition] = dict(
            ScientificAppRegistry._definitions_by_plugin
        )
        self.original_by_route_prefix: dict[str, ScientificAppDefinition] = dict(
            ScientificAppRegistry._definitions_by_route_prefix
        )
        self.original_by_api_base_path: dict[str, ScientificAppDefinition] = dict(
            ScientificAppRegistry._definitions_by_api_base_path
        )
        ScientificAppRegistry._definitions_by_plugin.clear()
        ScientificAppRegistry._definitions_by_route_prefix.clear()
        ScientificAppRegistry._definitions_by_api_base_path.clear()

    def tearDown(self) -> None:
        ScientificAppRegistry._definitions_by_plugin = self.original_by_plugin
        ScientificAppRegistry._definitions_by_route_prefix = (
            self.original_by_route_prefix
        )
        ScientificAppRegistry._definitions_by_api_base_path = (
            self.original_by_api_base_path
        )

    def test_register_raises_for_duplicate_plugin_name(self) -> None:
        first_definition: ScientificAppDefinition = ScientificAppDefinition(
            app_config_name="apps.calculator",
            plugin_name="calculator",
            api_route_prefix="calculator/jobs",
            api_base_path="/api/calculator/jobs/",
            route_basename="calculator-job",
        )
        second_definition: ScientificAppDefinition = ScientificAppDefinition(
            app_config_name="apps.thermo",
            plugin_name="calculator",
            api_route_prefix="thermo/jobs",
            api_base_path="/api/thermo/jobs/",
            route_basename="thermo-job",
        )

        ScientificAppRegistry.register(first_definition)
        with self.assertRaises(ImproperlyConfigured):
            ScientificAppRegistry.register(second_definition)

    def test_register_raises_for_duplicate_api_base_path(self) -> None:
        first_definition: ScientificAppDefinition = ScientificAppDefinition(
            app_config_name="apps.calculator",
            plugin_name="calculator",
            api_route_prefix="calculator/jobs",
            api_base_path="/api/shared/jobs/",
            route_basename="calculator-job",
        )
        second_definition: ScientificAppDefinition = ScientificAppDefinition(
            app_config_name="apps.kinetics",
            plugin_name="kinetics",
            api_route_prefix="kinetics/jobs",
            api_base_path="/api/shared/jobs/",
            route_basename="kinetics-job",
        )

        ScientificAppRegistry.register(first_definition)
        with self.assertRaises(ImproperlyConfigured):
            ScientificAppRegistry.register(second_definition)


class DevelopmentUpCommandTests(TestCase):
    """Valida el comando `manage.py up` para levantar servicios locales."""

    @patch("apps.core.management.commands.up.sleep")
    @patch("apps.core.management.commands.up.subprocess.Popen")
    def test_up_command_can_run_without_celery(
        self,
        popen_mock: MagicMock,
        sleep_mock: MagicMock,
    ) -> None:
        del sleep_mock

        runserver_process: MagicMock = MagicMock()
        runserver_process.wait.return_value = 0
        runserver_process.poll.return_value = 0
        popen_mock.return_value = runserver_process

        call_command(
            "up",
            "--without-celery",
            "--host",
            "127.0.0.1",
            "--port",
            "8000",
        )

        self.assertEqual(popen_mock.call_count, 1)
        called_command: list[str] = list(popen_mock.call_args.args[0])
        called_cwd: Path = Path(str(popen_mock.call_args.kwargs["cwd"]))
        self.assertEqual(
            called_command[-2:],
            ["runserver", "127.0.0.1:8000"],
        )
        self.assertEqual(called_cwd.name, "backend")

    @patch("apps.core.management.commands.up.sleep")
    @patch("apps.core.management.commands.up.subprocess.Popen")
    @patch("apps.core.management.commands.up.Command._is_broker_reachable")
    def test_up_command_starts_celery_and_runserver(
        self,
        broker_reachable_mock: MagicMock,
        popen_mock: MagicMock,
        sleep_mock: MagicMock,
    ) -> None:
        del sleep_mock
        broker_reachable_mock.return_value = True

        celery_process: MagicMock = MagicMock()
        celery_process.poll.side_effect = [None, None]

        runserver_process: MagicMock = MagicMock()
        runserver_process.wait.return_value = 0
        runserver_process.poll.return_value = 0

        popen_mock.side_effect = [celery_process, runserver_process]

        call_command("up")

        self.assertEqual(popen_mock.call_count, 2)
        first_call_command: list[str] = list(popen_mock.call_args_list[0].args[0])
        second_call_command: list[str] = list(popen_mock.call_args_list[1].args[0])
        first_call_cwd: Path = Path(str(popen_mock.call_args_list[0].kwargs["cwd"]))
        second_call_cwd: Path = Path(str(popen_mock.call_args_list[1].kwargs["cwd"]))

        self.assertEqual(
            first_call_command[1:6], ["-m", "celery", "-A", "config", "worker"]
        )
        self.assertEqual(second_call_command[-2:], ["runserver", "127.0.0.1:8000"])
        self.assertEqual(first_call_cwd.name, "backend")
        self.assertEqual(second_call_cwd.name, "backend")
        celery_process.terminate.assert_called_once()

    @patch("apps.core.management.commands.up.sleep")
    @patch("apps.core.management.commands.up.subprocess.Popen")
    @patch("apps.core.management.commands.up.Command._wait_for_broker_reachable")
    @patch("apps.core.management.commands.up.Command._is_broker_reachable")
    def test_up_command_starts_redis_if_broker_is_down(
        self,
        broker_reachable_mock: MagicMock,
        wait_broker_mock: MagicMock,
        popen_mock: MagicMock,
        sleep_mock: MagicMock,
    ) -> None:
        del sleep_mock
        broker_reachable_mock.return_value = False
        wait_broker_mock.return_value = True

        redis_process: MagicMock = MagicMock()
        redis_process.poll.side_effect = [None, None]

        celery_process: MagicMock = MagicMock()
        celery_process.poll.side_effect = [None, None]

        runserver_process: MagicMock = MagicMock()
        runserver_process.wait.return_value = 0
        runserver_process.poll.return_value = 0

        popen_mock.side_effect = [redis_process, celery_process, runserver_process]

        call_command("up")

        self.assertEqual(popen_mock.call_count, 3)
        first_call_command: list[str] = list(popen_mock.call_args_list[0].args[0])
        second_call_command: list[str] = list(popen_mock.call_args_list[1].args[0])
        third_call_command: list[str] = list(popen_mock.call_args_list[2].args[0])

        self.assertEqual(first_call_command[0], "redis-server")
        self.assertEqual(
            second_call_command[1:6],
            ["-m", "celery", "-A", "config", "worker"],
        )
        self.assertEqual(third_call_command[-2:], ["runserver", "127.0.0.1:8000"])
        redis_process.terminate.assert_called_once()
        celery_process.terminate.assert_called_once()

    @patch("apps.core.management.commands.up.subprocess.Popen")
    @patch("apps.core.management.commands.up.Command._is_broker_reachable")
    def test_up_command_raises_error_if_redis_binary_is_missing(
        self,
        broker_reachable_mock: MagicMock,
        popen_mock: MagicMock,
    ) -> None:
        broker_reachable_mock.return_value = False
        popen_mock.side_effect = [
            FileNotFoundError("redis-server"),
            FileNotFoundError("valkey-server"),
        ]

        with self.assertRaises(CommandError):
            call_command("up")

    @patch("apps.core.management.commands.up.sleep")
    @patch("apps.core.management.commands.up.subprocess.Popen")
    @patch("apps.core.management.commands.up.Command._wait_for_broker_reachable")
    @patch("apps.core.management.commands.up.Command._is_broker_reachable")
    def test_up_command_uses_valkey_if_redis_binary_is_missing(
        self,
        broker_reachable_mock: MagicMock,
        wait_broker_mock: MagicMock,
        popen_mock: MagicMock,
        sleep_mock: MagicMock,
    ) -> None:
        del sleep_mock
        broker_reachable_mock.return_value = False
        wait_broker_mock.return_value = True

        redis_not_found_error = FileNotFoundError("redis-server")

        valkey_process: MagicMock = MagicMock()
        valkey_process.poll.side_effect = [None, None]

        celery_process: MagicMock = MagicMock()
        celery_process.poll.side_effect = [None, None]

        runserver_process: MagicMock = MagicMock()
        runserver_process.wait.return_value = 0
        runserver_process.poll.return_value = 0

        popen_mock.side_effect = [
            redis_not_found_error,
            valkey_process,
            celery_process,
            runserver_process,
        ]

        call_command("up")

        self.assertEqual(popen_mock.call_count, 4)
        second_call_command: list[str] = list(popen_mock.call_args_list[1].args[0])
        self.assertEqual(second_call_command[0], "valkey-server")
        valkey_process.terminate.assert_called_once()
