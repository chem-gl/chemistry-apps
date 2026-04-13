"""test_job_service.py: Tests de servicio de jobs, hashing de caché y artefactos.

Cubre: HashingTests (fingerprint de caché), JobServiceTests (ciclo de vida de jobs,
recuperación activa, publicador de logs, pausa/reanudación), InputArtifactStorageTests
(almacenamiento chunked y exportación zip de artefactos de entrada).
"""

from __future__ import annotations

import hashlib
import io
from collections.abc import Callable, Iterator
from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4
from zipfile import ZipFile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone

from ..adapters import DjangoJobLogPublisherAdapter
from ..artifacts import ScientificInputArtifactStorageService
from ..models import (
    ScientificCacheEntry,
    ScientificJob,
    ScientificJobInputArtifact,
    ScientificJobLogEvent,
)
from ..ports import JobLogUpdate
from ..processing import PluginRegistry
from ..services import JobService
from ..services.cache_operations import generate_job_hash
from ..types import JSONMap


def _factorial_value(operand: float) -> float:
    """Calcula factorial para tests garantizando operando entero no negativo."""
    integer_operand = int(operand)
    if integer_operand < 0:
        raise ValueError("factorial requires non-negative integer")

    factorial_result = 1
    for current_value in range(2, integer_operand + 1):
        factorial_result *= current_value
    return float(factorial_result)


def _resolve_binary_operation_result(
    operation: str,
    first_operand: float,
    second_operand: float,
) -> float:
    """Resuelve operaciones binarias de forma declarativa para tests."""
    operation_handlers: dict[str, Callable[[float, float], float]] = {
        "add": lambda left, right: left + right,
        "sub": lambda left, right: left - right,
        "mul": lambda left, right: left * right,
        "div": lambda left, right: left / right,
        "pow": lambda left, right: left**right,
    }
    operation_handler = operation_handlers.get(operation)
    if operation_handler is None:
        raise ValueError(f"unsupported operation: {operation}")
    return operation_handler(first_operand, second_operand)


def _register_calculator_test_plugin() -> None:
    """Registra un plugin de calculadora de prueba para tests del core."""
    if "calculator" in PluginRegistry._plugins:  # noqa: SLF001
        return

    @PluginRegistry.register("calculator")
    def _calculator_plugin(parameters: JSONMap) -> JSONMap:
        operation = str(parameters.get("op", "add"))
        a_value = float(parameters.get("a", 0))
        b_raw_value = parameters.get("b", 0)
        b_value = float(b_raw_value) if b_raw_value is not None else 0.0

        result_value = (
            _factorial_value(a_value)
            if operation == "factorial"
            else _resolve_binary_operation_result(operation, a_value, b_value)
        )

        # Mantener compatibilidad: algunas pruebas esperan la clave
        # `final_result` mientras que otras historically utilizaron `result`.
        return {
            "final_result": result_value,
            "result": result_value,
            "operation": operation,
            "operands": {"a": a_value, "b": b_value},
        }


_register_calculator_test_plugin()


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

    def test_run_job_skips_cache_when_result_payload_exceeds_limit(self) -> None:
        """Un resultado demasiado grande debe completar el job sin persistir cache."""
        payload: JSONMap = {"op": "mul", "a": 3, "b": 7}
        job: ScientificJob = JobService.create_job("calculator", "1.0.0", payload)

        with (
            patch(
                "apps.core.services.RuntimeJobService._get_result_cache_payload_limit_bytes",
                return_value=1024,
            ),
            patch(
                "apps.core.services.RuntimeJobService._estimate_json_payload_size_bytes",
                return_value=2048,
            ),
        ):
            JobService.run_job(str(job.id))

        refreshed_job: ScientificJob = ScientificJob.objects.get(id=job.id)
        self.assertEqual(refreshed_job.status, "completed")
        cache_entry_exists: bool = ScientificCacheEntry.objects.filter(
            job_hash=refreshed_job.job_hash,
            plugin_name="calculator",
            algorithm_version="1.0.0",
        ).exists()
        self.assertFalse(cache_entry_exists)

        warning_log_exists: bool = ScientificJobLogEvent.objects.filter(
            job=refreshed_job,
            source="core.cache",
            message="Se omite persistencia en caché por tamaño de resultado excesivo.",
        ).exists()
        self.assertTrue(warning_log_exists)

    def test_run_job_completes_when_cache_storage_raises_overflow(self) -> None:
        """Errores de almacenamiento de cache no deben tumbar la ejecución del job."""
        payload: JSONMap = {"op": "add", "a": 1, "b": 2}
        job: ScientificJob = JobService.create_job("calculator", "1.0.0", payload)

        with patch(
            "apps.core.adapters.DjangoCacheRepositoryAdapter.store_cached_result",
            side_effect=OverflowError("string longer than INT_MAX bytes"),
        ):
            JobService.run_job(str(job.id))

        refreshed_job: ScientificJob = ScientificJob.objects.get(id=job.id)
        self.assertEqual(refreshed_job.status, "completed")

        warning_log_exists: bool = ScientificJobLogEvent.objects.filter(
            job=refreshed_job,
            source="core.cache",
            message="Se omite persistencia en caché por error de almacenamiento.",
        ).exists()
        self.assertTrue(warning_log_exists)

    @override_settings(
        JOB_RESULT_CACHE_MAX_PAYLOAD_BYTES=8 * 1024 * 1024,
        JOB_RESULT_CACHE_MAX_PAYLOAD_BYTES_BY_PLUGIN={"smileit": 4096},
    )
    def test_get_result_cache_payload_limit_prefers_plugin_specific_value(self) -> None:
        """Debe priorizar límite por plugin cuando existe configuración específica."""
        runtime_service = JobService._get_runtime_service()
        smileit_limit = runtime_service._get_result_cache_payload_limit_bytes("smileit")
        calculator_limit = runtime_service._get_result_cache_payload_limit_bytes(
            "calculator"
        )

        self.assertEqual(smileit_limit, 4096)
        self.assertEqual(calculator_limit, 8 * 1024 * 1024)

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

    def test_log_publisher_retries_when_event_index_collides(self) -> None:
        job: ScientificJob = ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="calculator",
            algorithm_version="1.0.0",
            status="running",
            cache_hit=False,
            cache_miss=True,
            parameters={"op": "add", "a": 1, "b": 2},
            progress_percentage=20,
            progress_stage="running",
            progress_message="En ejecución",
            progress_event_index=1,
        )

        ScientificJobLogEvent.objects.create(
            job=job,
            event_index=1,
            level="info",
            source="tests.core",
            message="Evento inicial",
            payload={},
        )
        ScientificJobLogEvent.objects.create(
            job=job,
            event_index=2,
            level="info",
            source="tests.core",
            message="Evento concurrente",
            payload={},
        )

        publisher = DjangoJobLogPublisherAdapter()

        with patch.object(publisher, "_resolve_next_event_index", side_effect=[2, 3]):
            created_event: ScientificJobLogEvent = publisher.publish(
                job,
                JobLogUpdate(
                    level="warning",
                    source="tests.recovery",
                    message="Evento tras colisión",
                    payload={"phase": "retry"},
                ),
            )

        self.assertEqual(created_event.event_index, 3)
        self.assertEqual(created_event.level, "warning")
        self.assertEqual(
            ScientificJobLogEvent.objects.filter(job=job, event_index=3).count(),
            1,
        )

    def test_request_pause_on_pending_job_sets_paused_status(self) -> None:
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

        paused_job: ScientificJob = JobService.request_pause(str(job.id))

        self.assertEqual(paused_job.status, "paused")
        self.assertFalse(bool(paused_job.pause_requested))
        self.assertEqual(paused_job.progress_stage, "paused")

    def test_resume_job_moves_paused_job_to_pending(self) -> None:
        job: ScientificJob = ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="random-numbers",
            algorithm_version="1.0.0",
            status="paused",
            supports_pause_resume=True,
            pause_requested=False,
            runtime_state={"generated_count": 2},
            cache_hit=False,
            cache_miss=True,
            parameters={"seed_url": "https://example.com/seed.txt"},
            progress_percentage=25,
            progress_stage="paused",
            progress_message="Pausado por usuario.",
            progress_event_index=2,
        )

        resumed_job: ScientificJob = JobService.resume_job(str(job.id))

        self.assertEqual(resumed_job.status, "pending")
        self.assertFalse(bool(resumed_job.pause_requested))
        self.assertEqual(resumed_job.progress_stage, "queued")


class InputArtifactStorageTests(TestCase):
    """Valida persistencia chunked de artefactos de entrada en base de datos."""

    class _ChunkedUploadedFile(SimpleUploadedFile):
        """Archivo de prueba que fuerza entrega por chunks para validación."""

        def __init__(
            self,
            *,
            name: str,
            content: bytes,
            content_type: str,
            forced_chunk_size: int,
        ) -> None:
            super().__init__(name=name, content=content, content_type=content_type)
            self._forced_chunk_size: int = forced_chunk_size

        def chunks(self, chunk_size: int | None = None) -> Iterator[bytes]:
            del chunk_size
            payload: bytes = bytes(self.read())
            self.seek(0)
            for start in range(0, len(payload), self._forced_chunk_size):
                end: int = start + self._forced_chunk_size
                yield payload[start:end]

        def multiple_chunks(self, chunk_size: int | None = None) -> bool:
            del chunk_size
            return True

    def setUp(self) -> None:
        self.storage_service = ScientificInputArtifactStorageService()
        self.job: ScientificJob = ScientificJob.objects.create(
            job_hash=uuid4().hex,
            plugin_name="easy-rate",
            algorithm_version="1.0.0",
            status="pending",
            cache_hit=False,
            cache_miss=True,
            parameters={"title": "demo"},
        )

    def test_store_uploaded_file_persists_metadata_and_content(self) -> None:
        payload_bytes: bytes = b"first line\nsecond line\n"
        uploaded_file = SimpleUploadedFile(
            name="sample.log",
            content=payload_bytes,
            content_type="text/plain",
        )

        artifact: ScientificJobInputArtifact = self.storage_service.store_uploaded_file(
            job=self.job,
            uploaded_file=uploaded_file,
            field_name="reactant_1_file",
        )

        self.assertEqual(artifact.job_id, self.job.id)
        self.assertEqual(artifact.field_name, "reactant_1_file")
        self.assertEqual(artifact.original_filename, "sample.log")
        self.assertEqual(artifact.content_type, "text/plain")
        self.assertEqual(artifact.size_bytes, len(payload_bytes))
        self.assertEqual(artifact.chunk_count, 1)
        self.assertEqual(artifact.sha256, hashlib.sha256(payload_bytes).hexdigest())

        restored_bytes: bytes = self.storage_service.read_artifact_bytes(
            artifact=artifact
        )
        self.assertEqual(restored_bytes, payload_bytes)

    def test_store_uploaded_file_splits_content_in_multiple_chunks(self) -> None:
        service_with_small_chunks = ScientificInputArtifactStorageService(
            chunk_size_bytes=4
        )
        payload_bytes: bytes = b"1234567890"
        uploaded_file = self._ChunkedUploadedFile(
            name="chunks.log",
            content=payload_bytes,
            content_type="text/plain",
            forced_chunk_size=4,
        )

        artifact: ScientificJobInputArtifact = (
            service_with_small_chunks.store_uploaded_file(
                job=self.job,
                uploaded_file=uploaded_file,
                field_name="transition_state_file",
            )
        )

        self.assertEqual(artifact.chunk_count, 3)
        self.assertEqual(
            list(
                artifact.chunks.order_by("chunk_index").values_list(
                    "chunk_index", flat=True
                )
            ),
            [0, 1, 2],
        )
        self.assertEqual(
            service_with_small_chunks.read_artifact_bytes(artifact=artifact),
            payload_bytes,
        )

    def test_build_job_artifacts_zip_contains_manifest_and_files(self) -> None:
        first_payload: bytes = b"reactant data"
        second_payload: bytes = b"ts data"

        first_file = SimpleUploadedFile(
            name="shared-name.log",
            content=first_payload,
            content_type="text/plain",
        )
        second_file = SimpleUploadedFile(
            name="shared-name.log",
            content=second_payload,
            content_type="text/plain",
        )

        self.storage_service.store_uploaded_file(
            job=self.job,
            uploaded_file=first_file,
            field_name="reactant_file",
        )
        self.storage_service.store_uploaded_file(
            job=self.job,
            uploaded_file=second_file,
            field_name="transition_file",
        )

        zip_bytes: bytes = self.storage_service.build_job_artifacts_zip_bytes(
            job=self.job
        )
        with ZipFile(io.BytesIO(zip_bytes), mode="r") as zip_file:
            zip_entries: list[str] = zip_file.namelist()
            self.assertIn("manifest.json", zip_entries)

            content_by_entry: dict[str, bytes] = {
                entry: zip_file.read(entry)
                for entry in zip_entries
                if entry != "manifest.json"
            }

        reactant_entries: list[str] = [
            entry
            for entry in content_by_entry.keys()
            if entry.startswith("reactant_file/")
        ]
        transition_entries: list[str] = [
            entry
            for entry in content_by_entry.keys()
            if entry.startswith("transition_file/")
        ]

        self.assertEqual(len(reactant_entries), 1)
        self.assertEqual(len(transition_entries), 1)
        self.assertEqual(content_by_entry[reactant_entries[0]], first_payload)
        self.assertEqual(content_by_entry[transition_entries[0]], second_payload)
