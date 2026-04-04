"""test_utils.py: Mixin reutilizable para tests de APIs de jobs científicos.

Objetivo del archivo:
- Proveer ScientificJobTestMixin con helpers que eliminan duplicación
  en los tests de todas las apps científicas del proyecto.

Cómo se usa:
- Heredar ScientificJobTestMixin en TestCase de cualquier app científica.
- Llamar create_job_via_api, run_job, retrieve_job desde los casos de prueba.
"""

from __future__ import annotations

from unittest.mock import patch

from django.test import TestCase
from rest_framework import status
from rest_framework.response import Response
from rest_framework.test import APIClient

from apps.core.models import ScientificJob
from apps.core.services import JobService
from apps.core.types import JSONMap


class ScientificJobTestMixin(TestCase):
    """Mixin base con helpers para tests de ciclo de vida HTTP de jobs científicos.

    Elimina patrones repetidos entre las apps: crear job, despachar,
    ejecutar y verificar resultados.
    """

    client: APIClient  # typed hint for subclasses

    def setUp(self) -> None:
        """Inicializa el cliente API para cada test."""
        self.client = APIClient()

    def create_job_via_api(
        self,
        api_base_path: str,
        payload: JSONMap,
        router_module_path: str,
    ) -> Response:
        """Crea un job via HTTP POST con dispatch simulado.

        Parchea dispatch_scientific_job en el módulo de routers indicado
        para evitar dependencia del broker Celery en tests.
        """
        with patch(f"{router_module_path}.dispatch_scientific_job") as mock_dispatch:
            mock_dispatch.return_value = True
            response: Response = self.client.post(api_base_path, payload, format="json")
        return response

    def run_job(self, job_id: str) -> None:
        """Ejecuta el job de forma síncrona usando el servicio runtime."""
        JobService.run_job(job_id)

    def retrieve_job(self, api_base_path: str, job_id: str) -> Response:
        """Recupera el estado actual del job vía GET."""
        return self.client.get(f"{api_base_path}{job_id}/")  # type: ignore[return-value]

    def create_and_run_job(
        self,
        api_base_path: str,
        payload: JSONMap,
        router_module_path: str,
    ) -> tuple[str, Response]:
        """Crea, despacha y ejecuta un job; devuelve (job_id, retrieve_response)."""
        create_response: Response = self.create_job_via_api(
            api_base_path, payload, router_module_path
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        job_id: str = str(create_response.data["id"])
        self.run_job(job_id)
        retrieve_response: Response = self.retrieve_job(api_base_path, job_id)
        return job_id, retrieve_response

    def assert_job_created(self, response: Response, expected_plugin_name: str) -> str:
        """Verifica que la respuesta de creación es correcta y retorna el job_id."""
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["plugin_name"], expected_plugin_name)
        self.assertEqual(response.data["status"], "pending")
        return str(response.data["id"])

    def assert_job_completed(self, response: Response) -> None:
        """Verifica que el job terminó correctamente con resultados."""
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], "completed")
        self.assertIsNotNone(response.data.get("results"))

    def assert_job_failed(self, response: Response) -> None:
        """Verifica que el job terminó en estado fallido."""
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], "failed")

    def get_job_from_db(self, job_id: str) -> ScientificJob:
        """Recupera el objeto ScientificJob directo de base de datos."""
        return ScientificJob.objects.get(id=job_id)


class CoreRoutingTests(TestCase):
    """Valida que los patrones WebSocket del dominio core están configurados."""

    def test_websocket_urlpatterns_are_configured(self) -> None:
        """El módulo routing debe exportar al menos una ruta WebSocket para el stream."""
        from apps.core.routing import websocket_urlpatterns

        self.assertGreaterEqual(len(websocket_urlpatterns), 1)


class ModelStrRepresentationTests(TestCase):
    """Valida representaciones legibles de los modelos del dominio core."""

    def test_scientific_job_str_includes_plugin_and_status(self) -> None:
        """ScientificJob.__str__ debe incluir plugin_name y status."""
        job = ScientificJob(
            plugin_name="test-plugin",
            algorithm_version="1.0.0",
            job_hash="a" * 64,
            parameters={},
            status="pending",
        )
        representation = str(job)
        self.assertIn("test-plugin", representation)
        self.assertIn("pending", representation)

    def test_scientific_cache_entry_str_includes_plugin_and_version(self) -> None:
        """ScientificCacheEntry.__str__ debe incluir plugin_name y algorithm_version."""
        from apps.core.models import ScientificCacheEntry

        entry = ScientificCacheEntry(
            job_hash="b" * 64,
            plugin_name="test-plugin",
            algorithm_version="1.0.0",
        )
        representation = str(entry)
        self.assertIn("test-plugin", representation)
        self.assertIn("1.0.0", representation)

    def test_scientific_job_log_event_str_includes_level(self) -> None:
        """ScientificJobLogEvent.__str__ debe incluir el nivel del log."""
        from apps.core.models import ScientificJobLogEvent

        log = ScientificJobLogEvent(
            event_index=0,
            level="info",
            source="test",
            message="Test log",
        )
        representation = str(log)
        self.assertIn("info", representation)

    def test_input_artifact_str_includes_field_name(self) -> None:
        """ScientificJobInputArtifact.__str__ debe incluir field_name."""
        from apps.core.models import ScientificJobInputArtifact

        artifact = ScientificJobInputArtifact(
            field_name="input_file",
            original_filename="test.log",
            content_type="text/plain",
            role="input",
        )
        representation = str(artifact)
        self.assertIn("input_file", representation)

    def test_input_artifact_chunk_str_includes_chunk_index(self) -> None:
        """ScientificJobInputArtifactChunk.__str__ debe incluir chunk_index."""
        from apps.core.models import ScientificJobInputArtifactChunk

        chunk = ScientificJobInputArtifactChunk(chunk_index=3, chunk_data=b"data")
        representation = str(chunk)
        self.assertIn("3", representation)
