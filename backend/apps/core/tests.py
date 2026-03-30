"""tests.py: Pruebas unitarias e integracion API para core y cache de jobs.

Objetivo del archivo:
- Cubrir flujo end-to-end del motor de jobs: hashing, cache, ejecución,
    recuperación activa, broadcasting realtime, registro de plugins y contrato HTTP.

Cómo se usa:
- Ejecutar con `python manage.py test apps.core`.
- También funciona como especificación ejecutable para nuevas apps que usen
    arquitectura por capas y puertos/adaptadores del core.
"""

from __future__ import annotations

import hashlib
import io
from collections.abc import Callable, Iterator
from datetime import timedelta
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4
from zipfile import ZipFile

from django.core.exceptions import ImproperlyConfigured
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from .adapters import DjangoJobLogPublisherAdapter
from .app_registry import ScientificAppDefinition, ScientificAppRegistry
from .artifacts import ScientificInputArtifactStorageService
from .cache import generate_job_hash
from .models import (
    ScientificCacheEntry,
    ScientificJob,
    ScientificJobInputArtifact,
    ScientificJobLogEvent,
)
from .ports import JobLogUpdate
from .processing import PluginRegistry
from .realtime import (
    broadcast_job_log,
    broadcast_job_update,
    build_job_log_entry,
    build_job_progress_snapshot,
    build_scientific_job_payload,
)
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
            "apps.core.routers.viewset.dispatch_scientific_job"
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
