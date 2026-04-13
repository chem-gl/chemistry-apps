"""test_streaming_reporting_consumers.py: Pruebas de cobertura para streaming, reporting y consumer WebSocket.

Objetivo del archivo:
- Cubrir rutas críticas de baja cobertura en `core/routers/streaming.py`,
  `core/reporting.py` y `core/consumers.py`.

Cómo se usa:
- Ejecutar con pytest para validar serialización de eventos SSE, construcción
  de reportes de auditoría y comportamiento del consumer en conexión/desconexión.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from django.test import SimpleTestCase, TestCase, TransactionTestCase

from apps.core.consumers import JobsStreamConsumer
from apps.core.models import ScientificJob, ScientificJobLogEvent
from apps.core.reporting import (
    build_download_filename,
    build_job_error_report,
    build_job_log_report,
    build_text_download_response,
    escape_csv_cell,
    validate_job_for_csv_report,
)
from apps.core.routers.streaming import stream_job_events, stream_job_log_events


class ReportingUtilitiesTests(TestCase):
    """Valida utilidades de reportes de texto/CSV y exportación."""

    def _create_job(
        self,
        *,
        status: str = "completed",
        results: dict[str, object] | None = None,
        error_trace: str = "",
    ) -> ScientificJob:
        return ScientificJob.objects.create(
            job_hash="h-001",
            plugin_name="sa_score",
            algorithm_version="1.0",
            status=status,
            parameters={"smiles": ["CCO"]},
            results=results,
            error_trace=error_trace,
            progress_percentage=100 if status in {"completed", "failed"} else 20,
            progress_stage=status,
            progress_message="estado de prueba",
            progress_event_index=2,
        )

    def test_escape_csv_cell_quotes_when_needed(self) -> None:
        self.assertEqual(escape_csv_cell("value"), "value")
        self.assertEqual(escape_csv_cell("a,b"), '"a,b"')
        self.assertEqual(escape_csv_cell('a"b'), '"a""b"')

    def test_build_download_filename_normalizes_plugin(self) -> None:
        filename = build_download_filename("sa-score", "abc123", "report", "txt")
        self.assertEqual(filename, "sa_score_abc123_report.txt")

    def test_build_text_download_response_sets_content_disposition(self) -> None:
        response = build_text_download_response(
            content="contenido",
            filename="job_report.txt",
            content_type="text/plain; charset=utf-8",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response["Content-Disposition"], 'attachment; filename="job_report.txt"'
        )
        self.assertIn("contenido", response.content.decode("utf-8"))

    def test_validate_job_for_csv_report_rejects_non_completed_jobs(self) -> None:
        pending_job = self._create_job(status="pending", results={"value": 1})
        self.assertIsNotNone(validate_job_for_csv_report(pending_job))

    def test_validate_job_for_csv_report_rejects_jobs_without_results(self) -> None:
        completed_without_results = self._create_job(status="completed", results=None)
        self.assertEqual(
            validate_job_for_csv_report(completed_without_results),
            "El job no tiene resultados persistidos para exportar en CSV.",
        )

    def test_validate_job_for_csv_report_accepts_completed_job_with_results(
        self,
    ) -> None:
        completed_job = self._create_job(status="completed", results={"value": 99})
        self.assertIsNone(validate_job_for_csv_report(completed_job))

    def test_build_job_log_report_includes_core_sections_and_log_events(self) -> None:
        job = self._create_job(status="completed", results={"score": 0.8})
        ScientificJobLogEvent.objects.create(
            job=job,
            event_index=1,
            level="info",
            source="core.runtime",
            message="inicio",
            payload={"phase": "start"},
        )

        report = build_job_log_report(job, csv_content="a,b\n1,2")

        self.assertIn("=== JOB REPORT ===", report)
        self.assertIn("=== INPUT PARAMETERS ===", report)
        self.assertIn("=== RESULTS SNAPSHOT ===", report)
        self.assertIn("=== LOG EVENTS ===", report)
        self.assertIn('payload={"phase": "start"}', report)
        self.assertIn("=== CSV REPORT ===", report)

    def test_build_job_log_report_handles_missing_logs_and_error_trace(self) -> None:
        job = self._create_job(
            status="failed",
            results={"partial": True},
            error_trace="Traceback simulado",
        )

        report = build_job_log_report(job)

        self.assertIn("=== ERROR TRACE ===", report)
        self.assertIn("Traceback simulado", report)
        self.assertIn("No hay eventos de log persistidos para este job.", report)

    def test_build_job_error_report_only_returns_data_for_failed_jobs_with_trace(
        self,
    ) -> None:
        failed_job = self._create_job(
            status="failed",
            results={"partial": True},
            error_trace="error detalle",
        )
        self.assertIsNotNone(build_job_error_report(failed_job))

        completed_job = self._create_job(status="completed", results={"ok": True})
        self.assertIsNone(build_job_error_report(completed_job))


class StreamingGeneratorsTests(TestCase):
    """Prueba flujo SSE de progreso y logs bajo estados normales y de error."""

    def _create_job(
        self,
        *,
        status: str = "running",
        progress_event_index: int = 3,
    ) -> ScientificJob:
        return ScientificJob.objects.create(
            job_hash="stream-hash",
            plugin_name="calculator",
            algorithm_version="1.0",
            status=status,
            parameters={"a": 1},
            results={"value": 2} if status == "completed" else None,
            progress_percentage=100 if status == "completed" else 35,
            progress_stage="completed" if status == "completed" else "running",
            progress_message="stream",
            progress_event_index=progress_event_index,
        )

    def test_stream_job_events_returns_error_when_job_disappears(self) -> None:
        events = list(
            stream_job_events(
                job_id="00000000-0000-0000-0000-000000000000",
                last_event_index=0,
                timeout_seconds=1,
            )
        )
        self.assertEqual(len(events), 1)
        self.assertIn("event: job.error", events[0])

    @patch("apps.core.routers.streaming.sleep", return_value=None)
    def test_stream_job_events_emits_progress_and_stops_in_terminal_status(
        self, _sleep: object
    ) -> None:
        job = self._create_job(status="completed", progress_event_index=10)

        events = list(
            stream_job_events(
                job_id=str(job.id),
                last_event_index=0,
                timeout_seconds=1,
            )
        )

        self.assertEqual(len(events), 1)
        self.assertIn("event: job.progress", events[0])
        self.assertIn('"status":"completed"', events[0])

    def test_stream_job_events_emits_final_snapshot_when_timeout_without_new_events(
        self,
    ) -> None:
        job = self._create_job(status="running", progress_event_index=5)

        events = list(
            stream_job_events(
                job_id=str(job.id),
                last_event_index=5,
                timeout_seconds=0,
            )
        )

        self.assertEqual(len(events), 1)
        self.assertIn("event: job.progress", events[0])

    def test_stream_job_log_events_returns_error_when_job_not_found(self) -> None:
        events = list(
            stream_job_log_events(
                job_id="00000000-0000-0000-0000-000000000000",
                last_event_index=0,
                timeout_seconds=1,
            )
        )
        self.assertEqual(len(events), 1)
        self.assertIn("event: job.error", events[0])

    @patch("apps.core.routers.streaming.sleep", return_value=None)
    def test_stream_job_log_events_emits_pending_events(self, _sleep: object) -> None:
        job = self._create_job(status="completed", progress_event_index=2)
        ScientificJobLogEvent.objects.create(
            job=job,
            event_index=1,
            level="info",
            source="plugin",
            message="linea 1",
            payload={"x": 1},
        )
        ScientificJobLogEvent.objects.create(
            job=job,
            event_index=2,
            level="warning",
            source="plugin",
            message="linea 2",
            payload={"x": 2},
        )

        events = list(
            stream_job_log_events(
                job_id=str(job.id),
                last_event_index=0,
                timeout_seconds=1,
            )
        )

        self.assertEqual(len(events), 2)
        self.assertIn("event: job.log", events[0])
        self.assertIn('"event_index":1', events[0])
        self.assertIn('"event_index":2', events[1])


class JobsStreamConsumerTests(TestCase):
    """Valida comportamiento de filtros, grupos y envío en consumer WebSocket."""

    def _build_consumer(self, query_string: bytes) -> JobsStreamConsumer:
        consumer = JobsStreamConsumer()
        consumer.scope = {"query_string": query_string}
        consumer.channel_name = "test-channel"
        consumer.channel_layer = SimpleNamespace(
            group_add=AsyncMock(),
            group_discard=AsyncMock(),
        )
        consumer.accept = AsyncMock()
        consumer.send_json = AsyncMock()
        return consumer

    def test_read_bool_query_value_parses_variants(self) -> None:
        consumer = self._build_consumer(b"")
        query_values = {
            "v1": ["true"],
            "v2": ["1"],
            "v3": ["off"],
        }
        self.assertTrue(
            consumer._read_bool_query_value(query_values, "v1", default_value=False)
        )
        self.assertTrue(
            consumer._read_bool_query_value(query_values, "v2", default_value=False)
        )
        self.assertFalse(
            consumer._read_bool_query_value(query_values, "v3", default_value=True)
        )

    def test_resolve_group_names_prioritizes_job_over_plugin(self) -> None:
        consumer = self._build_consumer(b"")
        consumer.job_id_filter = "job-123"
        consumer.plugin_name_filter = "plugin-x"

        group_names = consumer._resolve_group_names()

        self.assertEqual(group_names, ["jobs.job.job-123"])

    def test_resolve_group_names_uses_plugin_filter_then_global(self) -> None:
        consumer = self._build_consumer(b"")
        consumer.job_id_filter = None
        consumer.plugin_name_filter = "sa_score"
        self.assertEqual(consumer._resolve_group_names(), ["jobs.plugin.sa-score"])

        consumer.plugin_name_filter = None
        self.assertEqual(consumer._resolve_group_names(), ["jobs.global"])

    def test_jobs_stream_event_skips_logs_when_include_logs_false(self) -> None:
        consumer = self._build_consumer(b"")
        consumer.include_logs = False
        asyncio.run(
            consumer.jobs_stream_event(
                {"event_name": "job.log", "payload": {"message": "hidden"}}
            )
        )
        consumer.send_json.assert_not_awaited()

    def test_jobs_stream_event_forwards_non_log_events(self) -> None:
        consumer = self._build_consumer(b"")
        consumer.include_logs = False
        asyncio.run(
            consumer.jobs_stream_event(
                {"event_name": "job.progress", "payload": {"progress": 50}}
            )
        )
        consumer.send_json.assert_awaited_once()

    def test_connect_subscribes_and_emits_snapshot_when_requested(self) -> None:
        consumer = self._build_consumer(
            b"plugin_name=sa_score&include_logs=false&include_snapshot=true"
        )
        consumer._load_initial_snapshot_items = AsyncMock(return_value=[{"id": "1"}])

        asyncio.run(consumer.connect())

        consumer.channel_layer.group_add.assert_awaited_once_with(
            "jobs.plugin.sa-score",
            "test-channel",
        )
        consumer.accept.assert_awaited_once()
        consumer.send_json.assert_awaited_once()

    def test_disconnect_discards_all_group_names(self) -> None:
        consumer = self._build_consumer(b"")
        consumer.group_names = ["jobs.global", "jobs.plugin.sa-score"]

        asyncio.run(consumer.disconnect(1000))

        self.assertEqual(consumer.channel_layer.group_discard.await_count, 2)


class JobsStreamConsumerSnapshotQueryTests(TransactionTestCase):
    """Prueba filtros del snapshot inicial consultado por el consumer."""

    def _create_job(self, plugin_name: str, status: str) -> ScientificJob:
        return ScientificJob.objects.create(
            job_hash=f"hash-{plugin_name}-{status}",
            plugin_name=plugin_name,
            algorithm_version="1.0",
            status=status,
            parameters={"key": "value"},
            results={"ok": True} if status == "completed" else None,
            progress_percentage=100 if status == "completed" else 20,
            progress_stage=status,
            progress_message="snapshot",
            progress_event_index=1,
        )

    def test_load_initial_snapshot_items_filters_by_plugin_and_active_only(
        self,
    ) -> None:
        running_job = self._create_job("sa_score", "running")
        self._create_job("sa_score", "completed")
        self._create_job("calculator", "running")

        consumer = JobsStreamConsumer()
        consumer.job_id_filter = None
        consumer.plugin_name_filter = "sa_score"
        consumer.active_only = True

        snapshot_items = asyncio.run(consumer._load_initial_snapshot_items())

        self.assertEqual(len(snapshot_items), 1)
        self.assertEqual(snapshot_items[0]["id"], str(running_job.id))


class JobsStreamConsumerReadValueTests(SimpleTestCase):
    """Prueba parseo de query params opcionales para cubrir casos borde."""

    def test_read_optional_query_value_returns_none_for_missing_or_blank(self) -> None:
        consumer = JobsStreamConsumer()
        self.assertIsNone(consumer._read_optional_query_value({}, "job_id"))
        self.assertIsNone(
            consumer._read_optional_query_value({"job_id": [" "]}, "job_id")
        )

    def test_read_optional_query_value_returns_trimmed_value(self) -> None:
        consumer = JobsStreamConsumer()
        value = consumer._read_optional_query_value({"job_id": ["  abc  "]}, "job_id")
        self.assertEqual(value, "abc")
