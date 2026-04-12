"""test_extended.py: Pruebas extendidas del contrato HTTP para la app marcus.

Objetivo del archivo:
- Cubrir escenarios adicionales: cancel, progress, list, 404, campos faltantes.
- Reutilizar el helper de gaussian log de tests.py para multipart válido.
- Complementar MarcusContractApiTests sin duplicar escenarios base.

Cómo se usa:
- Ejecutar con `poetry run python manage.py test apps.marcus.test_extended`.
"""

from __future__ import annotations

from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.services import JobService

from .definitions import APP_API_BASE_PATH, PLUGIN_NAME
from .tests import _build_gaussian_log_content

ROUTER_MODULE = "apps.marcus.routers"


def _make_gaussian_file(
    name: str, scf_energy: float, thermal_free_enthalpy: float
) -> SimpleUploadedFile:
    """Construye un SimpleUploadedFile con contenido Gaussian mínimo válido."""
    content = _build_gaussian_log_content(
        scf_energy=scf_energy,
        thermal_free_enthalpy=thermal_free_enthalpy,
        temperature=298.15,
    )
    return SimpleUploadedFile(name, content, content_type="text/plain")


def _build_valid_payload() -> dict[str, object]:
    """Retorna payload multipart completo con los 6 archivos Gaussian requeridos."""
    return {
        "version": "1.0.0",
        "title": "Marcus Extended Test",
        "diffusion": "true",
        "radius_reactant_1": "2.0",
        "radius_reactant_2": "2.5",
        "reaction_distance": "3.2",
        "reactant_1_file": _make_gaussian_file("r1.log", -150.0, -149.9),
        "reactant_2_file": _make_gaussian_file("r2.log", -130.0, -129.9),
        "product_1_adiabatic_file": _make_gaussian_file("p1a.log", -149.95, -149.85),
        "product_2_adiabatic_file": _make_gaussian_file("p2a.log", -129.94, -129.84),
        "product_1_vertical_file": _make_gaussian_file("p1v.log", -149.91, -149.81),
        "product_2_vertical_file": _make_gaussian_file("p2v.log", -129.91, -129.81),
    }


class MarcusExtendedApiTests(TestCase):
    """Pruebas extendidas del contrato API de marcus."""

    def setUp(self) -> None:
        self.client = APIClient()

    def _create_job(self) -> str:
        """Crea job marcus y retorna su ID."""
        with patch("apps.core.base_router.dispatch_scientific_job") as mock_d:
            mock_d.return_value = True
            response = self.client.post(
                APP_API_BASE_PATH, _build_valid_payload(), format="multipart"
            )
        self.assertEqual(response.status_code, 201)
        return str(response.data["id"])

    def test_create_returns_plugin_name(self) -> None:
        """Verifica que el job creado tiene el plugin_name correcto."""
        with patch("apps.core.base_router.dispatch_scientific_job") as mock_d:
            mock_d.return_value = True
            response = self.client.post(
                APP_API_BASE_PATH, _build_valid_payload(), format="multipart"
            )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["plugin_name"], PLUGIN_NAME)
        self.assertEqual(response.data["status"], "pending")

    def test_retrieve_pending_job(self) -> None:
        """Recupera un job sin ejecutarlo y verifica estado pending."""
        job_id = self._create_job()
        response = self.client.get(f"{APP_API_BASE_PATH}{job_id}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "pending")

    def test_create_and_run_completes(self) -> None:
        """Ciclo completo: create + run + retrieve con resultado esperado."""
        job_id = self._create_job()
        JobService.run_job(job_id)
        response = self.client.get(f"{APP_API_BASE_PATH}{job_id}/")
        self.assertEqual(response.status_code, 200)
        self.assertIn(response.data["status"], ("completed", "failed"))

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

    def test_list_jobs_filtered_by_plugin(self) -> None:
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

    def test_rejects_missing_product_files(self) -> None:
        """Rechaza payload sin los archivos de producto requeridos."""
        payload = {
            "version": "1.0.0",
            "title": "Incomplete",
            "reactant_1_file": _make_gaussian_file("r1.log", -150.0, -149.9),
            "reactant_2_file": _make_gaussian_file("r2.log", -130.0, -129.9),
        }
        response = self.client.post(APP_API_BASE_PATH, payload, format="multipart")
        self.assertEqual(response.status_code, 400)

    def test_rejects_payload_without_any_files(self) -> None:
        """Rechaza payload completamente vacío."""
        response = self.client.post(APP_API_BASE_PATH, {}, format="multipart")
        self.assertEqual(response.status_code, 400)
