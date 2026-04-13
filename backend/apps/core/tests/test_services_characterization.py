"""test_services_characterization.py: Tests de caracterización para services.py.

Objetivo: Fijar el comportamiento actual de RuntimeJobService previo a
la modularización. Cubren métodos internos, callbacks, estados terminales,
cancelación y estimación de tamaño de payload para garantizar que el
refactoring no rompa la semántica existente.
"""

from __future__ import annotations

from unittest.mock import patch
from uuid import uuid4

from django.test import TestCase

from ..models import ScientificJob, ScientificJobLogEvent
from ..services import JobService, RuntimeJobService
from ..types import JobPauseRequested, JSONMap


class PayloadSizeEstimationTests(TestCase):
    """Verifica la estimación de tamaño JSON sin serializar el documento completo."""

    def setUp(self) -> None:
        self.service: RuntimeJobService = JobService._get_runtime_service()

    def test_empty_dict_estimates_two_bytes(self) -> None:
        result = self.service._estimate_json_payload_size_bytes({}, 1024)
        self.assertEqual(result, 2)

    def test_empty_list_estimates_two_bytes(self) -> None:
        result = self.service._estimate_json_payload_size_bytes([], 1024)
        self.assertEqual(result, 2)

    def test_simple_dict_with_string_values(self) -> None:
        payload: JSONMap = {"key": "value"}
        result = self.service._estimate_json_payload_size_bytes(payload, 1024)
        # 2 (dict) + 3 (str "key") + 5 (str "value") = 10
        self.assertEqual(result, 10)

    def test_nested_dict_accumulates_correctly(self) -> None:
        payload: JSONMap = {"a": {"b": "c"}}
        result = self.service._estimate_json_payload_size_bytes(payload, 1024)
        # Externo: 2 (dict) + 1 (str "a") + Interno: 2 (dict) + 1 (str "b") + 1 (str "c") = 7
        self.assertEqual(result, 7)

    def test_list_of_integers(self) -> None:
        payload = [1, 22, 333]
        result = self.service._estimate_json_payload_size_bytes(payload, 1024)
        # 2 (list) + 1 (int 1) + 2 (int 22) + 3 (int 333) = 8
        self.assertEqual(result, 8)

    def test_early_exit_when_exceeding_limit(self) -> None:
        """Debe cortar temprano si el acumulado supera el límite."""
        large_payload: list[str] = ["x" * 100 for _ in range(100)]
        result = self.service._estimate_json_payload_size_bytes(large_payload, 50)
        self.assertGreater(result, 50)

    def test_none_value_estimates_four_bytes(self) -> None:
        result = self.service._estimate_json_payload_size_bytes({"x": None}, 1024)
        # 2 (dict) + 1 (str "x") + 4 (None) = 7
        self.assertEqual(result, 7)

    def test_boolean_true_estimates_four_bytes(self) -> None:
        result = self.service._estimate_scalar_json_size_bytes(True)
        self.assertEqual(result, 4)

    def test_boolean_false_estimates_five_bytes(self) -> None:
        result = self.service._estimate_scalar_json_size_bytes(False)
        self.assertEqual(result, 5)

    def test_integer_scalar_size(self) -> None:
        self.assertEqual(self.service._estimate_scalar_json_size_bytes(42), 2)
        self.assertEqual(self.service._estimate_scalar_json_size_bytes(0), 1)
        self.assertEqual(self.service._estimate_scalar_json_size_bytes(12345), 5)

    def test_utf8_string_size(self) -> None:
        # "ñ" codifica como 2 bytes en utf-8
        result = self.service._estimate_scalar_json_size_bytes("ñ")
        self.assertEqual(result, 2)


class CachePayloadUsabilityTests(TestCase):
    """Verifica filtrado de payloads cacheados degradados por plugin."""

    def setUp(self) -> None:
        self.service: RuntimeJobService = JobService._get_runtime_service()

    def test_non_toxicity_plugin_always_usable(self) -> None:
        payload: JSONMap = {"anything": "goes"}
        result = self.service._is_cache_payload_usable_for_plugin(
            plugin_name="calculator", payload=payload
        )
        self.assertTrue(result)

    def test_toxicity_all_error_rows_is_not_usable(self) -> None:
        payload: JSONMap = {
            "molecules": [
                {"smiles": "C", "error_message": "Timeout"},
                {"smiles": "CC", "error_message": "Service down"},
            ]
        }
        result = self.service._is_cache_payload_usable_for_plugin(
            plugin_name="toxicity-properties", payload=payload
        )
        self.assertFalse(result)

    def test_toxicity_mixed_rows_is_usable(self) -> None:
        payload: JSONMap = {
            "molecules": [
                {"smiles": "C", "error_message": "Timeout"},
                {"smiles": "CC", "ld50": 500.0},
            ]
        }
        result = self.service._is_cache_payload_usable_for_plugin(
            plugin_name="toxicity-properties", payload=payload
        )
        self.assertTrue(result)

    def test_toxicity_no_error_rows_is_usable(self) -> None:
        payload: JSONMap = {
            "molecules": [
                {"smiles": "C", "ld50": 1000.0},
            ]
        }
        result = self.service._is_cache_payload_usable_for_plugin(
            plugin_name="toxicity-properties", payload=payload
        )
        self.assertTrue(result)

    def test_toxicity_empty_molecules_is_not_usable(self) -> None:
        payload: JSONMap = {"molecules": []}
        result = self.service._is_cache_payload_usable_for_plugin(
            plugin_name="toxicity-properties", payload=payload
        )
        self.assertFalse(result)

    def test_toxicity_missing_molecules_key_is_not_usable(self) -> None:
        payload: JSONMap = {"results": []}
        result = self.service._is_cache_payload_usable_for_plugin(
            plugin_name="toxicity-properties", payload=payload
        )
        self.assertFalse(result)

    def test_toxicity_non_dict_row_is_not_usable(self) -> None:
        payload: JSONMap = {"molecules": ["str_row"]}
        result = self.service._is_cache_payload_usable_for_plugin(
            plugin_name="toxicity-properties", payload=payload
        )
        self.assertFalse(result)

    def test_toxicity_whitespace_error_message_not_counted(self) -> None:
        """error_message con solo espacios no se cuenta como error."""
        payload: JSONMap = {"molecules": [{"smiles": "C", "error_message": "   "}]}
        result = self.service._is_cache_payload_usable_for_plugin(
            plugin_name="toxicity-properties", payload=payload
        )
        self.assertTrue(result)


class PluginProgressCallbackTests(TestCase):
    """Verifica el mapeo de porcentaje del plugin al rango global 35-79%."""

    def setUp(self) -> None:
        self.service: RuntimeJobService = JobService._get_runtime_service()
        self.job: ScientificJob = ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="calculator",
            algorithm_version="1.0.0",
            status="running",
            cache_hit=False,
            cache_miss=True,
            parameters={"op": "add", "a": 1, "b": 2},
            progress_percentage=35,
            progress_stage="running",
            progress_message="Ejecutando.",
            progress_event_index=3,
        )

    def test_zero_percent_maps_to_35(self) -> None:
        callback = self.service._build_plugin_progress_callback(self.job)
        with patch.object(self.service.progress_publisher, "publish") as pub_mock:
            callback(0, "running", "Starting")
            published_update = pub_mock.call_args[0][1]
            self.assertEqual(published_update.percentage, 35)

    def test_fifty_percent_maps_to_57(self) -> None:
        callback = self.service._build_plugin_progress_callback(self.job)
        with patch.object(self.service.progress_publisher, "publish") as pub_mock:
            callback(50, "running", "Halfway")
            published_update = pub_mock.call_args[0][1]
            self.assertEqual(published_update.percentage, 57)

    def test_hundred_percent_maps_to_79(self) -> None:
        callback = self.service._build_plugin_progress_callback(self.job)
        with patch.object(self.service.progress_publisher, "publish") as pub_mock:
            callback(100, "running", "Done")
            published_update = pub_mock.call_args[0][1]
            self.assertEqual(published_update.percentage, 79)

    def test_negative_percent_clamped_to_zero(self) -> None:
        callback = self.service._build_plugin_progress_callback(self.job)
        with patch.object(self.service.progress_publisher, "publish") as pub_mock:
            callback(-10, "running", "Under")
            published_update = pub_mock.call_args[0][1]
            self.assertEqual(published_update.percentage, 35)

    def test_over_hundred_percent_clamped_to_hundred(self) -> None:
        callback = self.service._build_plugin_progress_callback(self.job)
        with patch.object(self.service.progress_publisher, "publish") as pub_mock:
            callback(150, "running", "Over")
            published_update = pub_mock.call_args[0][1]
            self.assertEqual(published_update.percentage, 79)


class PluginControlCallbackTests(TestCase):
    """Verifica callback de control cooperativo pause/continue."""

    def setUp(self) -> None:
        self.service: RuntimeJobService = JobService._get_runtime_service()

    def test_control_returns_continue_for_running_job(self) -> None:
        job: ScientificJob = ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="random-numbers",
            algorithm_version="1.0.0",
            status="running",
            supports_pause_resume=True,
            pause_requested=False,
            cache_hit=False,
            cache_miss=True,
            parameters={"seed_url": "https://example.com/seed.txt"},
        )
        callback = self.service._build_plugin_control_callback(str(job.id))
        self.assertEqual(callback(), "continue")

    def test_control_returns_pause_when_pause_requested(self) -> None:
        job: ScientificJob = ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="random-numbers",
            algorithm_version="1.0.0",
            status="running",
            supports_pause_resume=True,
            pause_requested=True,
            cache_hit=False,
            cache_miss=True,
            parameters={"seed_url": "https://example.com/seed.txt"},
        )
        callback = self.service._build_plugin_control_callback(str(job.id))
        self.assertEqual(callback(), "pause")

    def test_control_returns_pause_for_paused_status(self) -> None:
        job: ScientificJob = ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="random-numbers",
            algorithm_version="1.0.0",
            status="paused",
            supports_pause_resume=True,
            pause_requested=False,
            cache_hit=False,
            cache_miss=True,
            parameters={"seed_url": "https://example.com/seed.txt"},
        )
        callback = self.service._build_plugin_control_callback(str(job.id))
        self.assertEqual(callback(), "pause")

    def test_control_returns_pause_for_nonexistent_job(self) -> None:
        fake_id = str(uuid4())
        callback = self.service._build_plugin_control_callback(fake_id)
        self.assertEqual(callback(), "pause")


class CancelJobServiceTests(TestCase):
    """Verifica cancel_job directamente en la capa de servicio."""

    def test_cancel_pending_job_transitions_to_cancelled(self) -> None:
        job: ScientificJob = ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="calculator",
            algorithm_version="1.0.0",
            status="pending",
            cache_hit=False,
            cache_miss=True,
            parameters={"op": "add", "a": 1, "b": 2},
        )
        cancelled = JobService.cancel_job(str(job.id))
        self.assertEqual(cancelled.status, "cancelled")
        self.assertEqual(cancelled.progress_stage, "cancelled")
        self.assertEqual(cancelled.progress_percentage, 100)

    def test_cancel_running_job_transitions_to_cancelled(self) -> None:
        job: ScientificJob = ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="calculator",
            algorithm_version="1.0.0",
            status="running",
            cache_hit=False,
            cache_miss=True,
            parameters={"op": "add", "a": 1, "b": 2},
            progress_percentage=40,
            progress_stage="running",
            progress_message="Ejecutando.",
        )
        cancelled = JobService.cancel_job(str(job.id))
        self.assertEqual(cancelled.status, "cancelled")

        # Verificar log de cancelación
        log_exists = ScientificJobLogEvent.objects.filter(
            job=job,
            source="core.control",
            message="Job cancelado manualmente por el usuario.",
        ).exists()
        self.assertTrue(log_exists)

    def test_cancel_completed_job_raises_value_error(self) -> None:
        job: ScientificJob = ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="calculator",
            algorithm_version="1.0.0",
            status="completed",
            cache_hit=False,
            cache_miss=True,
            parameters={"op": "add", "a": 1, "b": 2},
            results={"result": 3.0},
        )
        with self.assertRaises(ValueError) as ctx:
            JobService.cancel_job(str(job.id))
        self.assertIn("terminal", str(ctx.exception).lower())

    def test_cancel_nonexistent_job_raises_value_error(self) -> None:
        with self.assertRaises(ValueError):
            JobService.cancel_job(str(uuid4()))


class FinishWithPauseTests(TestCase):
    """Verifica persistencia de checkpoint al pausar durante ejecución."""

    def test_finish_with_pause_saves_checkpoint(self) -> None:
        """Simula un plugin que lanza JobPauseRequested con checkpoint."""
        payload: JSONMap = {"op": "add", "a": 1, "b": 2}
        job: ScientificJob = JobService.create_job("calculator", "1.0.0", payload)

        checkpoint_data: JSONMap = {"step": 5, "partial": [1, 2, 3]}

        with patch(
            "apps.core.adapters.DjangoPluginExecutionAdapter.execute",
            side_effect=JobPauseRequested(
                message="Pausa por usuario", checkpoint=checkpoint_data
            ),
        ):
            JobService.run_job(str(job.id))

        refreshed = ScientificJob.objects.get(id=job.id)
        self.assertEqual(refreshed.status, "paused")
        self.assertEqual(refreshed.runtime_state, checkpoint_data)
        self.assertEqual(refreshed.progress_stage, "paused")

    def test_finish_with_pause_without_checkpoint_saves_empty_dict(self) -> None:
        payload: JSONMap = {"op": "add", "a": 1, "b": 2}
        job: ScientificJob = JobService.create_job("calculator", "1.0.0", payload)

        with patch(
            "apps.core.adapters.DjangoPluginExecutionAdapter.execute",
            side_effect=JobPauseRequested(message="Pausa sin estado"),
        ):
            JobService.run_job(str(job.id))

        refreshed = ScientificJob.objects.get(id=job.id)
        self.assertEqual(refreshed.status, "paused")
        self.assertEqual(refreshed.runtime_state, {})
