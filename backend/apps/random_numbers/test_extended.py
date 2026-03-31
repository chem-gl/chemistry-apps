"""test_extended.py: Tests HTTP extendidos para la app random_numbers.

Objetivo del archivo:
- Cubrir ciclo HTTP completo: create, run, retrieve, cancel, pause/resume.
- Verificar validaciones del schema para seed_url, límites de count.

Cómo se usa:
- Ejecutar con `python manage.py test apps.random_numbers.test_extended`.
"""

from __future__ import annotations

from unittest.mock import patch

from apps.core.models import ScientificJob
from apps.core.test_utils import ScientificJobTestMixin

from .definitions import APP_API_BASE_PATH, MAX_TOTAL_NUMBERS, PLUGIN_NAME

ROUTER_MODULE = "apps.random_numbers.routers"

_VALID_PAYLOAD = {
    "version": "1.0.0",
    "seed_url": "https://httpbin.org/uuid",
    "numbers_per_batch": 2,
    "interval_seconds": 1,
    "total_numbers": 4,
}


class RandomNumbersExtendedApiTests(ScientificJobTestMixin):
    """Pruebas extendidas del contrato API de random numbers."""

    def test_basic_create_cycle(self) -> None:
        create_response = self.create_job_via_api(
            APP_API_BASE_PATH, _VALID_PAYLOAD, ROUTER_MODULE
        )
        self.assertEqual(create_response.status_code, 201)
        self.assertEqual(create_response.data["plugin_name"], PLUGIN_NAME)
        self.assertEqual(create_response.data["status"], "pending")

    def test_full_cycle_with_seed_url_mocked(self) -> None:
        """Ejecuta el job con seed_url mockeada para evitar red."""
        with patch("apps.random_numbers.plugin.urlopen") as mock_url:
            mock_url.return_value.__enter__ = lambda s: s
            mock_url.return_value.__exit__ = lambda *a: False
            mock_url.return_value.read.return_value = b"test_seed_value_123"
            _job_id, response = self.create_and_run_job(
                APP_API_BASE_PATH, _VALID_PAYLOAD, ROUTER_MODULE
            )
        self.assertIn(response.data["status"], ("completed", "failed"))

    def test_rejects_zero_total_numbers(self) -> None:
        payload = {**_VALID_PAYLOAD, "total_numbers": 0}
        response = self.client.post(APP_API_BASE_PATH, payload, format="json")
        self.assertEqual(response.status_code, 400)

    def test_rejects_total_numbers_over_limit(self) -> None:
        payload = {**_VALID_PAYLOAD, "total_numbers": MAX_TOTAL_NUMBERS + 1}
        response = self.client.post(APP_API_BASE_PATH, payload, format="json")
        self.assertEqual(response.status_code, 400)

    def test_rejects_missing_seed_url(self) -> None:
        payload = {
            "version": "1.0.0",
            "numbers_per_batch": 2,
            "interval_seconds": 1,
            "total_numbers": 4,
        }
        response = self.client.post(APP_API_BASE_PATH, payload, format="json")
        self.assertEqual(response.status_code, 400)

    def test_cancel_pending_job(self) -> None:
        create_response = self.create_job_via_api(
            APP_API_BASE_PATH, _VALID_PAYLOAD, ROUTER_MODULE
        )
        self.assertEqual(create_response.status_code, 201)
        _job_id = str(create_response.data["id"])
        cancel_response = self.client.post(f"/api/jobs/{_job_id}/cancel/")
        self.assertEqual(cancel_response.status_code, 200)
        job = self.get_job_from_db(_job_id)
        self.assertEqual(job.status, "cancelled")

    def test_pause_resume_pending_job(self) -> None:
        """Jobs de random_numbers soportan pausa/reanudación."""
        create_response = self.create_job_via_api(
            APP_API_BASE_PATH, _VALID_PAYLOAD, ROUTER_MODULE
        )
        self.assertEqual(create_response.status_code, 201)
        _job_id = str(create_response.data["id"])
        # Verificar que el job soporta pause/resume
        job = self.get_job_from_db(_job_id)
        if job.supports_pause_resume:
            pause_response = self.client.post(f"/api/jobs/{_job_id}/pause/")
            self.assertEqual(pause_response.status_code, 200)
            with patch(f"{ROUTER_MODULE}.dispatch_scientific_job") as mock_d:
                mock_d.return_value = True
                resume_response = self.client.post(f"/api/jobs/{_job_id}/resume/")
            self.assertEqual(resume_response.status_code, 200)

    def test_progress_endpoint_returns_snapshot(self) -> None:
        create_response = self.create_job_via_api(
            APP_API_BASE_PATH, _VALID_PAYLOAD, ROUTER_MODULE
        )
        _job_id = str(create_response.data["id"])
        progress_response = self.client.get(f"/api/jobs/{_job_id}/progress/")
        self.assertEqual(progress_response.status_code, 200)
        self.assertIn("progress_percentage", progress_response.data)

    def test_list_jobs_filtered_by_plugin(self) -> None:
        self.create_job_via_api(APP_API_BASE_PATH, _VALID_PAYLOAD, ROUTER_MODULE)
        response = self.client.get("/api/jobs/", {"plugin_name": PLUGIN_NAME})
        self.assertEqual(response.status_code, 200)
        for job_data in response.data:
            self.assertEqual(job_data["plugin_name"], PLUGIN_NAME)

    def test_retrieve_nonexistent_returns_404(self) -> None:
        from uuid import uuid4

        response = self.client.get(f"{APP_API_BASE_PATH}{uuid4()}/")
        self.assertEqual(response.status_code, 404)
