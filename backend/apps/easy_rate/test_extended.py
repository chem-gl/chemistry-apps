"""test_extended.py: Pruebas extendidas del contrato HTTP para la app easy_rate.

Objetivo del archivo:
- Cubrir escenarios adicionales: cancel, pause, progress, list, 404.
- Reutilizar helpers de tests.py para construir payloads multipart válidos.
- Complementar EasyRateContractApiTests sin duplicar sus escenarios base.

Cómo se usa:
- Ejecutar con `poetry run python manage.py test apps.easy_rate.test_extended`.
"""

from __future__ import annotations

from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.services import JobService

from .definitions import APP_API_BASE_PATH, PLUGIN_NAME
from .tests import _build_gaussian_log_content

ROUTER_MODULE = "apps.easy_rate.routers"


def _build_reactant_file(name: str = "r.log") -> SimpleUploadedFile:
    """Construye un archivo de reactivo válido para cargas multipart."""
    content = _build_gaussian_log_content(
        free_energy=-50.0,
        thermal_enthalpy=-49.9,
        zero_point_energy=-49.85,
        scf_energy=-50.2,
        temperature=298.15,
        imaginary_frequency=0.0,
        include_ts_marker=False,
    )
    return SimpleUploadedFile(name, content, content_type="text/plain")


def _build_ts_file() -> SimpleUploadedFile:
    """Construye un archivo de estado de transición válido para cargas multipart."""
    content = _build_gaussian_log_content(
        free_energy=-99.93,
        thermal_enthalpy=-99.83,
        zero_point_energy=-99.78,
        scf_energy=-100.0,
        temperature=298.15,
        imaginary_frequency=625.0,
        include_ts_marker=True,
    )
    return SimpleUploadedFile("ts.log", content, content_type="text/plain")


def _build_valid_multipart_payload() -> dict[str, object]:
    """Retorna payload multipart completo con todos los campos requeridos."""
    return {
        "version": "2.0.0",
        "title": "Test Reaction Extended",
        "reaction_path_degeneracy": "1.0",
        "cage_effects": "true",
        "diffusion": "true",
        "solvent": "Water",
        "radius_reactant_1": "2.10",
        "radius_reactant_2": "2.30",
        "reaction_distance": "2.80",
        "print_data_input": "true",
        "reactant_1_file": _build_reactant_file("r1.log"),
        "reactant_2_file": _build_reactant_file("r2.log"),
        "transition_state_file": _build_ts_file(),
        "product_1_file": _build_reactant_file("p1.log"),
    }


class EasyRateExtendedApiTests(TestCase):
    """Pruebas extendidas del contrato API de easy_rate."""

    def setUp(self) -> None:
        self.client = APIClient()

    def _create_job(self) -> str:
        """Crea job easy_rate y retorna su ID."""
        payload = _build_valid_multipart_payload()
        with patch("apps.core.base_router.dispatch_scientific_job") as mock_d:
            mock_d.return_value = True
            response = self.client.post(APP_API_BASE_PATH, payload, format="multipart")
        self.assertEqual(response.status_code, 201)
        return str(response.data["id"])

    def test_create_returns_plugin_name(self) -> None:
        """Verifica que el job creado tiene el plugin_name correcto."""
        payload = _build_valid_multipart_payload()
        with patch("apps.core.base_router.dispatch_scientific_job") as mock_d:
            mock_d.return_value = True
            response = self.client.post(APP_API_BASE_PATH, payload, format="multipart")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["plugin_name"], PLUGIN_NAME)
        self.assertEqual(response.data["status"], "pending")

    def test_retrieve_pending_job(self) -> None:
        """Recupera un job creado sin ejecutarlo y verifica estado pending."""
        job_id = self._create_job()
        response = self.client.get(f"{APP_API_BASE_PATH}{job_id}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "pending")

    def test_create_and_run_completes_successfully(self) -> None:
        """Ciclo completo: create + run + retrieve con resultado esperado."""
        job_id = self._create_job()
        JobService.run_job(job_id)
        response = self.client.get(f"{APP_API_BASE_PATH}{job_id}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "completed")
        self.assertIn("rate_constant", response.data["results"])

    def test_cancel_pending_job(self) -> None:
        """Cancela un job en estado pending."""
        job_id = self._create_job()
        response = self.client.post(f"/api/jobs/{job_id}/cancel/")
        self.assertEqual(response.status_code, 200)
        retrieve = self.client.get(f"{APP_API_BASE_PATH}{job_id}/")
        self.assertEqual(retrieve.data["status"], "cancelled")

    def test_progress_endpoint_returns_data(self) -> None:
        """Verifica que el endpoint de progreso retorna porcentaje."""
        job_id = self._create_job()
        response = self.client.get(f"/api/jobs/{job_id}/progress/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("progress_percentage", response.data)

    def test_list_jobs_endpoint(self) -> None:
        """Verifica que el listado filtra por plugin_name correctamente."""
        self._create_job()
        response = self.client.get("/api/jobs/", {"plugin_name": PLUGIN_NAME})
        self.assertEqual(response.status_code, 200)
        for item in response.data:
            self.assertEqual(item["plugin_name"], PLUGIN_NAME)

    def test_retrieve_nonexistent_job_returns_404(self) -> None:
        """Retorna 404 cuando el UUID no existe."""
        from uuid import uuid4

        response = self.client.get(f"{APP_API_BASE_PATH}{uuid4()}/")
        self.assertEqual(response.status_code, 404)

    def test_rejects_payload_without_transition_state(self) -> None:
        """Rechaza payload multipart sin el archivo de estado de transición."""
        payload = _build_valid_multipart_payload()
        del payload["transition_state_file"]
        response = self.client.post(APP_API_BASE_PATH, payload, format="multipart")
        self.assertEqual(response.status_code, 400)

    def test_rejects_payload_without_reactant_files(self) -> None:
        """Rechaza payload multipart sin los archivos de reactivos."""
        payload = {
            "version": "2.0.0",
            "title": "Missing Files",
            "reaction_path_degeneracy": "1.0",
        }
        response = self.client.post(APP_API_BASE_PATH, payload, format="multipart")
        self.assertEqual(response.status_code, 400)
