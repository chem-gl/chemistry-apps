"""test_core_components.py: Tests de componentes transversales del core.

Cubre: RealtimeHelpersTests (serialización y broadcasting WebSocket),
CalculatorTemplateIntegrationTests (integración de la app plantilla),
PluginRegistryValidationTests (unicidad de plugins),
ScientificAppRegistryValidationTests (unicidad de definiciones de app),
DevelopmentUpCommandTests (comando manage.py up para desarrollo local).
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from django.core.exceptions import ImproperlyConfigured
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from .app_registry import ScientificAppDefinition, ScientificAppRegistry
from .models import ScientificJob, ScientificJobLogEvent
from .processing import PluginRegistry
from .realtime import (
    broadcast_job_log,
    broadcast_job_update,
    build_job_log_entry,
    build_job_progress_snapshot,
    build_scientific_job_payload,
)
from .types import JSONMap

PluginSourceCallable = Callable[[JSONMap], JSONMap]


class RealtimeHelpersTests(TestCase):
    """Valida serialización y broadcasting del canal realtime de jobs."""

    def test_build_scientific_job_payload_normalizes_terminal_state(self) -> None:
        job: ScientificJob = ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="calculator",
            algorithm_version="1.0.0",
            status="completed",
            cache_hit=False,
            cache_miss=True,
            parameters={"op": "add", "a": 2, "b": 3},
            results={"final_result": 5},
            progress_percentage=0,
            progress_stage="pending",
            progress_message="Estado legado.",
            progress_event_index=3,
        )

        payload = build_scientific_job_payload(job)

        self.assertEqual(payload["id"], str(job.id))
        self.assertEqual(payload["status"], "completed")
        self.assertEqual(payload["progress_percentage"], 100)
        self.assertEqual(payload["progress_stage"], "completed")

    def test_build_progress_and_log_payloads_preserve_contract_shape(self) -> None:
        job: ScientificJob = ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="random-numbers",
            algorithm_version="1.0.0",
            status="running",
            cache_hit=False,
            cache_miss=True,
            parameters={"seed_url": "https://example.com/seed.txt"},
            progress_percentage=45,
            progress_stage="running",
            progress_message="Generando lote actual.",
            progress_event_index=8,
        )
        log_event: ScientificJobLogEvent = ScientificJobLogEvent.objects.create(
            job=job,
            event_index=5,
            level="info",
            source="tests.realtime",
            message="Evento realtime de prueba.",
            payload={"batch": 2},
        )

        progress_snapshot = build_job_progress_snapshot(job)
        log_entry = build_job_log_entry(log_event)

        self.assertEqual(progress_snapshot["job_id"], str(job.id))
        self.assertEqual(progress_snapshot["progress_event_index"], 8)
        self.assertEqual(log_entry["event_index"], 5)
        self.assertEqual(log_entry["payload"]["batch"], 2)

    def test_broadcast_job_update_and_log_publish_to_expected_groups(self) -> None:
        job: ScientificJob = ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="calculator",
            algorithm_version="1.0.0",
            status="running",
            cache_hit=False,
            cache_miss=True,
            parameters={"op": "mul", "a": 4, "b": 5},
            progress_percentage=20,
            progress_stage="running",
            progress_message="Procesando cálculo.",
            progress_event_index=2,
        )
        log_event: ScientificJobLogEvent = ScientificJobLogEvent.objects.create(
            job=job,
            event_index=1,
            level="info",
            source="tests.realtime",
            message="Log realtime.",
            payload={},
        )
        mocked_group_send = AsyncMock()
        mocked_channel_layer = MagicMock(group_send=mocked_group_send)

        with patch(
            "apps.core.realtime.get_channel_layer",
            return_value=mocked_channel_layer,
        ):
            broadcast_job_update(job)
            broadcast_job_log(log_event)

        self.assertEqual(mocked_group_send.await_count, 6)


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
            called_command[-3:],
            ["runserver", "--noreload", "127.0.0.1:8000"],
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
        self.assertEqual(
            second_call_command[-3:],
            ["runserver", "--noreload", "0.0.0.0:8000"],
        )
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
        self.assertEqual(
            third_call_command[-3:],
            ["runserver", "--noreload", "0.0.0.0:8000"],
        )
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
