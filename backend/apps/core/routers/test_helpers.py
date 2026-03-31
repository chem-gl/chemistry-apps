"""routers/test_helpers.py: Tests para funciones auxiliares y renderer SSE.

Objetivo del archivo:
- Cubrir build_progress_snapshot, build_job_log_entry,
  serialize_sse_progress_event, serialize_sse_log_event,
  parse_timeout_seconds, parse_non_negative_int y ServerSentEventsRenderer.

Cómo se usa:
- Ejecutar con `python manage.py test apps.core.routers.test_helpers`.
"""

from __future__ import annotations

import json

from django.test import TestCase
from django.utils import timezone

from apps.core.definitions import DEFAULT_SSE_TIMEOUT_SECONDS, MAX_SSE_TIMEOUT_SECONDS
from apps.core.models import ScientificJob, ScientificJobLogEvent
from apps.core.routers.helpers import (
    ServerSentEventsRenderer,
    build_job_log_entry,
    build_progress_snapshot,
    parse_non_negative_int,
    parse_timeout_seconds,
    serialize_sse_log_event,
    serialize_sse_progress_event,
)


def _make_job(**kwargs: object) -> ScientificJob:
    """Crea un ScientificJob con valores por defecto para pruebas."""
    defaults = {
        "plugin_name": "calculator",
        "algorithm_version": "1.0.0",
        "job_hash": "testhash-helpers",
        "parameters": {},
        "status": "running",
        "progress_percentage": 42,
        "progress_stage": "running",
        "progress_message": "En proceso",
        "progress_event_index": 7,
    }
    defaults.update(kwargs)  # type: ignore[arg-type]
    return ScientificJob.objects.create(**defaults)


class ParseTimeoutSecondsTests(TestCase):
    """Verifica normalización segura del timeout SSE."""

    def test_none_returns_default(self) -> None:
        self.assertEqual(parse_timeout_seconds(None), DEFAULT_SSE_TIMEOUT_SECONDS)

    def test_valid_integer_string(self) -> None:
        self.assertEqual(parse_timeout_seconds("45"), 45)

    def test_value_below_minimum_clamps_to_one(self) -> None:
        self.assertEqual(parse_timeout_seconds("0"), 1)
        self.assertEqual(parse_timeout_seconds("-5"), 1)

    def test_value_above_maximum_clamps_to_max(self) -> None:
        over = str(MAX_SSE_TIMEOUT_SECONDS + 100)
        self.assertEqual(parse_timeout_seconds(over), MAX_SSE_TIMEOUT_SECONDS)

    def test_max_boundary_accepted(self) -> None:
        self.assertEqual(
            parse_timeout_seconds(str(MAX_SSE_TIMEOUT_SECONDS)), MAX_SSE_TIMEOUT_SECONDS
        )

    def test_non_numeric_string_returns_default(self) -> None:
        self.assertEqual(parse_timeout_seconds("abc"), DEFAULT_SSE_TIMEOUT_SECONDS)
        self.assertEqual(parse_timeout_seconds("1.5"), DEFAULT_SSE_TIMEOUT_SECONDS)


class ParseNonNegativeIntTests(TestCase):
    """Verifica parseo seguro de enteros no negativos."""

    def test_none_returns_default(self) -> None:
        self.assertEqual(parse_non_negative_int(None, 99), 99)

    def test_valid_positive_string(self) -> None:
        self.assertEqual(parse_non_negative_int("10", 0), 10)

    def test_zero_is_accepted(self) -> None:
        self.assertEqual(parse_non_negative_int("0", 5), 0)

    def test_negative_value_returns_default(self) -> None:
        self.assertEqual(parse_non_negative_int("-3", 7), 7)

    def test_non_numeric_string_returns_default(self) -> None:
        self.assertEqual(parse_non_negative_int("abc", 3), 3)

    def test_float_string_returns_default(self) -> None:
        self.assertEqual(parse_non_negative_int("3.14", 1), 1)


class BuildProgressSnapshotTests(TestCase):
    """Verifica que el snapshot de progreso contenga todos los campos requeridos."""

    def test_contains_all_required_keys(self) -> None:
        job = _make_job(job_hash="testhash-snapshot-1")
        snapshot = build_progress_snapshot(job)
        expected_keys = {
            "job_id",
            "status",
            "progress_percentage",
            "progress_stage",
            "progress_message",
            "progress_event_index",
            "updated_at",
        }
        self.assertEqual(set(snapshot.keys()), expected_keys)

    def test_job_id_is_string(self) -> None:
        job = _make_job(job_hash="testhash-snapshot-2")
        snapshot = build_progress_snapshot(job)
        self.assertIsInstance(snapshot["job_id"], str)

    def test_progress_percentage_as_int(self) -> None:
        job = _make_job(progress_percentage=55, job_hash="testhash-snapshot-3")
        snapshot = build_progress_snapshot(job)
        self.assertEqual(snapshot["progress_percentage"], 55)

    def test_updated_at_iso_format(self) -> None:
        job = _make_job(job_hash="testhash-snapshot-4")
        snapshot = build_progress_snapshot(job)
        updated_at = snapshot["updated_at"]
        self.assertIsInstance(updated_at, str)
        # Verifica formato ISO 8601 con Z al final en lugar de +00:00
        self.assertTrue(updated_at.endswith("Z") or "+" not in updated_at)


class BuildJobLogEntryTests(TestCase):
    """Verifica que el contrato de entrada de log sea correcto."""

    def test_contains_all_required_keys(self) -> None:
        job = _make_job(job_hash="testhash-logentry-1")
        log_event = ScientificJobLogEvent.objects.create(
            job=job,
            event_index=1,
            level="info",
            source="test.source",
            message="Mensaje de prueba",
            payload={"key": "value"},
        )
        entry = build_job_log_entry(log_event)
        expected_keys = {
            "job_id",
            "event_index",
            "level",
            "source",
            "message",
            "payload",
            "created_at",
        }
        self.assertEqual(set(entry.keys()), expected_keys)

    def test_job_id_is_string(self) -> None:
        job = _make_job(job_hash="testhash-logentry-2")
        log_event = ScientificJobLogEvent.objects.create(
            job=job,
            event_index=1,
            level="warning",
            source="test.source",
            message="Test",
            payload={},
        )
        entry = build_job_log_entry(log_event)
        self.assertIsInstance(entry["job_id"], str)

    def test_payload_is_dict(self) -> None:
        job = _make_job(job_hash="testhash-logentry-3")
        payload_data = {"batch": 5, "total": 20}
        log_event = ScientificJobLogEvent.objects.create(
            job=job,
            event_index=2,
            level="debug",
            source="test",
            message="Debug msg",
            payload=payload_data,
        )
        entry = build_job_log_entry(log_event)
        self.assertEqual(entry["payload"], payload_data)


class SerializeSseProgressEventTests(TestCase):
    """Verifica el formato SSE de evento de progreso."""

    def test_sse_format_structure(self) -> None:
        job = _make_job(
            job_hash="testhash-sse-progress",
            progress_event_index=4,
            progress_percentage=35,
        )
        snapshot = build_progress_snapshot(job)
        sse_text = serialize_sse_progress_event(snapshot)
        self.assertIn("id: 4\n", sse_text)
        self.assertIn("event: job.progress\n", sse_text)
        self.assertIn("data: ", sse_text)
        self.assertTrue(sse_text.endswith("\n\n"))

    def test_sse_data_is_valid_json(self) -> None:
        job = _make_job(job_hash="testhash-sse-progress-json")
        snapshot = build_progress_snapshot(job)
        sse_text = serialize_sse_progress_event(snapshot)
        data_line = [
            line for line in sse_text.split("\n") if line.startswith("data: ")
        ][0]
        json_str = data_line[len("data: ") :]
        parsed = json.loads(json_str)
        self.assertIn("job_id", parsed)
        self.assertIn("status", parsed)


class SerializeSseLogEventTests(TestCase):
    """Verifica el formato SSE de evento de log."""

    def test_sse_format_structure(self) -> None:
        job = _make_job(job_hash="testhash-sse-log")
        log_event = ScientificJobLogEvent.objects.create(
            job=job,
            event_index=12,
            level="info",
            source="test.source",
            message="Test log message",
            payload={},
        )
        entry = build_job_log_entry(log_event)
        sse_text = serialize_sse_log_event(entry)
        self.assertIn("id: 12\n", sse_text)
        self.assertIn("event: job.log\n", sse_text)
        self.assertIn("data: ", sse_text)
        self.assertTrue(sse_text.endswith("\n\n"))

    def test_sse_log_data_is_valid_json(self) -> None:
        job = _make_job(job_hash="testhash-sse-log-json")
        log_event = ScientificJobLogEvent.objects.create(
            job=job,
            event_index=3,
            level="error",
            source="test",
            message="Error occurred",
            payload={"error": "desc"},
        )
        entry = build_job_log_entry(log_event)
        sse_text = serialize_sse_log_event(entry)
        data_line = [
            line for line in sse_text.split("\n") if line.startswith("data: ")
        ][0]
        parsed = json.loads(data_line[len("data: ") :])
        self.assertIn("job_id", parsed)
        self.assertIn("level", parsed)


class ServerSentEventsRendererTests(TestCase):
    """Verifica configuración del renderer SSE para DRF."""

    def test_media_type_is_event_stream(self) -> None:
        renderer = ServerSentEventsRenderer()
        self.assertEqual(renderer.media_type, "text/event-stream")

    def test_format_is_sse(self) -> None:
        renderer = ServerSentEventsRenderer()
        self.assertEqual(renderer.format, "sse")

    def test_charset_is_none(self) -> None:
        renderer = ServerSentEventsRenderer()
        self.assertIsNone(renderer.charset)
