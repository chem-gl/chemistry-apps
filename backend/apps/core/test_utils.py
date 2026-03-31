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
