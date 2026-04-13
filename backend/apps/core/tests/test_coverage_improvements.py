"""test_coverage_improvements.py: Pruebas unitarias para mejorar cobertura del core.

Contiene pruebas enfocadas en utilidades puras y adaptadores DB-lite
"""

from __future__ import annotations

import hashlib
import os

from django.core.exceptions import ImproperlyConfigured
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings

from apps.core.adapters import (
    DjangoCacheRepositoryAdapter,
    DjangoJobLogPublisherAdapter,
)
from apps.core.app_registry import ScientificAppDefinition, ScientificAppRegistry
from apps.core.artifacts import (
    ScientificInputArtifactStorageService,
    build_file_descriptor,
    normalize_chunk_to_bytes,
    normalize_file_descriptors,
)
from apps.core.models import ScientificCacheEntry, ScientificJob, ScientificJobLogEvent
from apps.core.ports import JobLogUpdate


class ArtifactsUtilsTest(TestCase):
    """Pruebas para funciones utilitarias de artifacts.py.

    Estas pruebas no dependen de lógica externa y validan transformaciones
    y normalizaciones simples que suelen quedar fuera en tests E2E.
    """

    def test_normalize_chunk_to_bytes_variants(self) -> None:
        # bytes
        assert normalize_chunk_to_bytes(b"abc") == b"abc"

        # memoryview
        mv = memoryview(b"xyz")
        assert normalize_chunk_to_bytes(mv) == b"xyz"

        # str
        assert normalize_chunk_to_bytes("hola") == b"hola"

    def test_build_file_descriptor_and_sha256(self) -> None:
        content = b"hello-world"
        uploaded = SimpleUploadedFile("my.txt", content, content_type="text/plain")

        desc = build_file_descriptor("f1", uploaded)
        # Campos básicos presentes
        assert desc["field_name"] == "f1"
        assert desc["original_filename"] == "my.txt"
        assert desc["content_type"] == "text/plain"
        # SHA256 correcto
        expected = hashlib.sha256(content).hexdigest()
        assert desc["sha256"] == expected
        assert desc["size_bytes"] == len(content)

    def test_normalize_file_descriptors_valid_and_invalid(self) -> None:
        valid_raw = [
            {
                "field_name": "f",
                "original_filename": "a",
                "content_type": "ct",
                "sha256": "s",
                "size_bytes": "10",
            }
        ]
        normalized = normalize_file_descriptors(valid_raw)
        assert isinstance(normalized, list)
        assert normalized[0]["size_bytes"] == 10

        # Invalid types
        with self.assertRaises(ValueError):
            normalize_file_descriptors({})

    def test_normalize_filename_variants(self) -> None:
        cls = ScientificInputArtifactStorageService
        assert cls._normalize_filename("C:\\path\\to\\file.bin") == "file.bin"
        assert cls._normalize_filename("/unix/path/data.txt") == "data.txt"
        assert cls._normalize_filename("") == "uploaded-input.bin"


class AppRegistryTest(TestCase):
    """Pruebas para `ScientificAppRegistry` (registro y validaciones).

    IMPORTANTE: setUp guarda el estado original del registry antes de cada test
    y tearDown lo restaura. Esto permite que los tests agreguen plugins sin
    contaminar los registros legítimos de las apps de producción.
    """

    def setUp(self) -> None:
        # Guardar snapshot del estado original para restaurarlo después de cada test
        self._original_by_plugin = dict(ScientificAppRegistry._definitions_by_plugin)
        self._original_by_route_prefix = dict(
            ScientificAppRegistry._definitions_by_route_prefix
        )
        self._original_by_api_base_path = dict(
            ScientificAppRegistry._definitions_by_api_base_path
        )

    def tearDown(self) -> None:
        # Restaurar el registry al estado previo al test (no solo limpiar),
        # para no destruir las definiciones registradas por las apps reales.
        ScientificAppRegistry._definitions_by_plugin.clear()
        ScientificAppRegistry._definitions_by_plugin.update(self._original_by_plugin)
        ScientificAppRegistry._definitions_by_route_prefix.clear()
        ScientificAppRegistry._definitions_by_route_prefix.update(
            self._original_by_route_prefix
        )
        ScientificAppRegistry._definitions_by_api_base_path.clear()
        ScientificAppRegistry._definitions_by_api_base_path.update(
            self._original_by_api_base_path
        )

    def test_register_duplicate_plugin_raises(self) -> None:
        def1 = ScientificAppDefinition(
            app_config_name="app.a",
            plugin_name="plugin_x",
            api_route_prefix="/api/x",
            api_base_path="/x",
            route_basename="x",
        )
        def2 = ScientificAppDefinition(
            app_config_name="app.b",
            plugin_name="plugin_x",
            api_route_prefix="/api/x2",
            api_base_path="/x2",
            route_basename="x2",
        )

        ScientificAppRegistry.register(def1)
        with self.assertRaises(ImproperlyConfigured):
            ScientificAppRegistry.register(def2)

    def test_supports_pause_resume_flag(self) -> None:
        definition = ScientificAppDefinition(
            app_config_name="app.pause",
            plugin_name="plugin_pause",
            api_route_prefix="/api/pause",
            api_base_path="/pause",
            route_basename="pause",
            supports_pause_resume=True,
        )
        ScientificAppRegistry.register(definition)
        assert ScientificAppRegistry.supports_pause_resume("plugin_pause")


class AdaptersTest(TestCase):
    """Pruebas de adaptadores que interactúan con modelos Django.

    Estas pruebas usan la DB de test para validar comportamiento crítico
    como publicación de logs y almacenamiento/lectura de cache.
    """

    def test_job_log_publisher_publish_and_resolve(self) -> None:
        job = ScientificJob.objects.create(job_hash="h1", plugin_name="p1")
        adapter = DjangoJobLogPublisherAdapter()

        # Sin eventos previos, el siguiente índice debe ser 1
        assert adapter._resolve_next_event_index(job) == 1

        update = JobLogUpdate(level="info", source="tests", message="ok", payload=None)
        created = adapter.publish(job=job, log_update=update)
        assert isinstance(created, ScientificJobLogEvent)
        assert created.event_index == 1
        assert created.level == "info"

    def test_cache_repository_get_and_store(self) -> None:
        adapter = DjangoCacheRepositoryAdapter()
        payload = {"value": 123}

        adapter.store_cached_result(
            job_hash="jh-1",
            plugin_name="plug-1",
            algorithm_version="1.0",
            result_payload=payload,
        )

        entry = ScientificCacheEntry.objects.get(job_hash="jh-1")
        assert entry.hit_count == 0

        found = adapter.get_cached_result(
            job_hash="jh-1", plugin_name="plug-1", algorithm_version="1.0"
        )
        assert found == payload

        entry.refresh_from_db()
        assert entry.hit_count >= 1


class AppsHelpersTest(TestCase):
    """Pruebas ligeras para helpers en apps.py relacionadas con flags de entorno."""

    @override_settings(DEBUG=True)
    def test_runtime_tools_strict_check_default_debug_true(self) -> None:
        from apps.core.apps import _is_runtime_tools_strict_check_enabled

        os.environ.pop("RUNTIME_TOOLS_STRICT_CHECK", None)
        # En DEBUG True, el chequeo estricto debe estar desactivado.
        assert _is_runtime_tools_strict_check_enabled() is False

    @override_settings(DEBUG=False)
    def test_runtime_tools_strict_check_env_overrides(self) -> None:
        from apps.core.apps import _is_runtime_tools_strict_check_enabled

        os.environ["RUNTIME_TOOLS_STRICT_CHECK"] = "1"
        try:
            assert _is_runtime_tools_strict_check_enabled() is True
        finally:
            os.environ.pop("RUNTIME_TOOLS_STRICT_CHECK", None)
