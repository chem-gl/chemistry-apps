"""test_cache_operations.py: Pruebas unitarias para la capa de caché del core.

Objetivo del archivo:
- Cubrir estimación de tamaño JSON sin serialización completa.
- Validar si un payload cacheado puede reutilizarse para un plugin concreto.
- Asegurar que la persistencia en caché publica progreso y trazabilidad.

Cómo se usa:
- Ejecutar con `poetry run python manage.py test apps.core.test_cache_operations`.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from django.test import TestCase

from apps.core.models import ScientificJob
from apps.core.ports import JobLogPublisherPort, JobProgressPublisherPort
from apps.core.services.cache_operations import (
    estimate_json_payload_size_bytes,
    estimate_scalar_json_size_bytes,
    is_cache_payload_usable_for_plugin,
    persist_result_in_cache,
)
from apps.core.types import JSONMap


def _create_job(plugin_name: str = "calculator") -> ScientificJob:
    """Crea un job mínimo para probar persistencia de caché."""
    return ScientificJob.objects.create(
        job_hash=f"cache-test-{plugin_name}",
        plugin_name=plugin_name,
        algorithm_version="1.0.0",
        parameters={"op": "add", "a": 2, "b": 3},
    )


class EstimateJsonPayloadSizeTests(TestCase):
    """Verifica la estimación de tamaños JSON con estructuras simples y cíclicas."""

    def test_estimates_nested_payloads_and_scalars(self) -> None:
        """Un payload anidado debe acumular contenedores y escalares de forma estable."""
        payload: JSONMap = {"a": {"b": [1, "dos"]}, "c": True}

        total_bytes = estimate_json_payload_size_bytes(payload, limit_bytes=1024)

        self.assertGreater(total_bytes, 0)
        self.assertEqual(estimate_scalar_json_size_bytes(None), 4)
        self.assertEqual(estimate_scalar_json_size_bytes(False), 5)

    def test_estimates_recursive_containers_without_infinite_loop(self) -> None:
        """Un contenedor cíclico no debe provocar un recorrido infinito."""
        recursive_payload: list[object] = []
        recursive_payload.append(recursive_payload)

        total_bytes = estimate_json_payload_size_bytes(
            recursive_payload, limit_bytes=64
        )

        self.assertEqual(total_bytes, 2)


class CachePayloadUsabilityTests(TestCase):
    """Verifica reglas de reutilización de payloads cacheados por plugin."""

    def test_non_toxicity_plugins_are_always_usable(self) -> None:
        """Los plugins no específicos deben aceptar cualquier payload cacheado."""
        payload: JSONMap = {"any": "value"}

        self.assertTrue(
            is_cache_payload_usable_for_plugin(
                plugin_name="calculator", payload=payload
            )
        )

    def test_toxicity_payload_requires_mixed_row_health(self) -> None:
        """Toxicity-properties rechaza filas inválidas o datasets totalmente degradados."""
        degraded_payload: JSONMap = {
            "molecules": [
                {"smiles": "C", "error_message": "Timeout"},
                {"smiles": "CC", "error_message": "Service down"},
            ]
        }
        mixed_payload: JSONMap = {
            "molecules": [
                {"smiles": "C", "error_message": "Timeout"},
                {"smiles": "CC", "ld50": 500.0},
            ]
        }

        self.assertFalse(
            is_cache_payload_usable_for_plugin(
                plugin_name="toxicity-properties",
                payload=degraded_payload,
            )
        )
        self.assertTrue(
            is_cache_payload_usable_for_plugin(
                plugin_name="toxicity-properties",
                payload=mixed_payload,
            )
        )


class PersistResultInCacheTests(TestCase):
    """Verifica persistencia exitosa y ramas de omisión en caché."""

    def setUp(self) -> None:
        self.job = _create_job()
        self.cache_repository = MagicMock()
        self.progress_publisher = MagicMock(spec=JobProgressPublisherPort)
        self.log_publisher = MagicMock(spec=JobLogPublisherPort)

    @patch("apps.core.services.cache_operations.get_result_cache_payload_limit_bytes")
    @patch("apps.core.services.cache_operations.estimate_json_payload_size_bytes")
    def test_persists_result_when_payload_is_within_limit(
        self,
        estimate_mock: MagicMock,
        limit_mock: MagicMock,
    ) -> None:
        """Cuando el payload es pequeño, debe almacenarse y dejar trazabilidad."""
        limit_mock.return_value = 2048
        estimate_mock.return_value = 128

        persist_result_in_cache(
            job=self.job,
            result_payload={"final_result": 42},
            cache_repository=self.cache_repository,
            progress_publisher=self.progress_publisher,
            log_publisher=self.log_publisher,
        )

        self.progress_publisher.publish.assert_called_once()
        self.log_publisher.publish.assert_called()
        self.cache_repository.store_cached_result.assert_called_once()

    @patch("apps.core.services.cache_operations.get_result_cache_payload_limit_bytes")
    @patch("apps.core.services.cache_operations.estimate_json_payload_size_bytes")
    def test_skips_persistence_when_payload_exceeds_limit(
        self,
        estimate_mock: MagicMock,
        limit_mock: MagicMock,
    ) -> None:
        """Un payload excesivo debe omitir la escritura y dejar warning en logs."""
        limit_mock.return_value = 64
        estimate_mock.return_value = 256

        persist_result_in_cache(
            job=self.job,
            result_payload={"final_result": "x" * 512},
            cache_repository=self.cache_repository,
            progress_publisher=self.progress_publisher,
            log_publisher=self.log_publisher,
        )

        self.cache_repository.store_cached_result.assert_not_called()
        self.log_publisher.publish.assert_called()

    @patch("apps.core.services.cache_operations.get_result_cache_payload_limit_bytes")
    @patch("apps.core.services.cache_operations.estimate_json_payload_size_bytes")
    def test_logs_storage_failure_without_raising(
        self,
        estimate_mock: MagicMock,
        limit_mock: MagicMock,
    ) -> None:
        """Errores del repositorio de caché no deben romper la ejecución del job."""
        limit_mock.return_value = 2048
        estimate_mock.return_value = 128
        self.cache_repository.store_cached_result.side_effect = TypeError("bad payload")

        persist_result_in_cache(
            job=self.job,
            result_payload={"final_result": 42},
            cache_repository=self.cache_repository,
            progress_publisher=self.progress_publisher,
            log_publisher=self.log_publisher,
        )

        self.cache_repository.store_cached_result.assert_called_once()
        self.log_publisher.publish.assert_called()
