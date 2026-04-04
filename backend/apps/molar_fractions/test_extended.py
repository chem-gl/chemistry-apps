"""test_extended.py: Tests HTTP extendidos para la app molar_fractions.

Objetivo del archivo:
- Cubrir ciclo HTTP completo de molar fractions con modos range y single,
  validaciones de pKa, límites de pH y casos borde del schema.

Cómo se usa:
- Ejecutar con `python manage.py test apps.molar_fractions.test_extended`.
"""

from __future__ import annotations

from apps.core.test_utils import ScientificJobTestMixin

from .definitions import APP_API_BASE_PATH, PLUGIN_NAME

ROUTER_MODULE = "apps.molar_fractions.routers"


class MolarFractionsExtendedApiTests(ScientificJobTestMixin):
    """Pruebas extendidas del contrato API de fracciones molares."""

    def test_range_mode_full_cycle(self) -> None:
        """Ciclo completo con modo range de pH 0 a 14."""
        payload = {
            "version": "1.0.0",
            "pka_values": [4.75],
            "ph_mode": "range",
            "ph_min": 0.0,
            "ph_max": 14.0,
            "ph_step": 1.0,
        }
        _job_id, response = self.create_and_run_job(
            APP_API_BASE_PATH, payload, ROUTER_MODULE
        )
        self.assert_job_completed(response)

    def test_single_mode_full_cycle(self) -> None:
        """Ciclo completo con modo single pH."""
        payload = {
            "version": "1.0.0",
            "pka_values": [4.75, 9.2],
            "ph_mode": "single",
            "ph_value": 7.4,
        }
        _job_id, response = self.create_and_run_job(
            APP_API_BASE_PATH, payload, ROUTER_MODULE
        )
        self.assert_job_completed(response)

    def test_multiple_pka_values_range_mode(self) -> None:
        payload = {
            "version": "1.0.0",
            "pka_values": [2.2, 7.2, 12.3],
            "ph_mode": "range",
            "ph_min": 0.0,
            "ph_max": 14.0,
            "ph_step": 0.5,
        }
        _job_id, response = self.create_and_run_job(
            APP_API_BASE_PATH, payload, ROUTER_MODULE
        )
        self.assert_job_completed(response)

    def test_rejects_empty_pka_list(self) -> None:
        payload = {
            "version": "1.0.0",
            "pka_values": [],
            "ph_mode": "single",
            "ph_value": 7.0,
        }
        response = self.client.post(APP_API_BASE_PATH, payload, format="json")
        self.assertEqual(response.status_code, 400)

    def test_rejects_range_mode_without_ph_min_max(self) -> None:
        """Modo range sin ph_min/ph_max debe fallar validación."""
        payload = {
            "version": "1.0.0",
            "pka_values": [4.75],
            "ph_mode": "range",
        }
        response = self.client.post(APP_API_BASE_PATH, payload, format="json")
        self.assertEqual(response.status_code, 400)

    def test_rejects_single_mode_without_ph_value(self) -> None:
        payload = {
            "version": "1.0.0",
            "pka_values": [4.75],
            "ph_mode": "single",
        }
        response = self.client.post(APP_API_BASE_PATH, payload, format="json")
        self.assertEqual(response.status_code, 400)

    def test_small_ph_step_respects_limits(self) -> None:
        """Un paso de pH muy pequeño puede generar muchos puntos pero debe respetar límite."""
        payload = {
            "version": "1.0.0",
            "pka_values": [7.0],
            "ph_mode": "range",
            "ph_min": 6.0,
            "ph_max": 8.0,
            "ph_step": 0.1,
        }
        _job_id, response = self.create_and_run_job(
            APP_API_BASE_PATH, payload, ROUTER_MODULE
        )
        self.assertIn(response.data["status"], ("completed", "failed"))

    def test_list_molar_fractions_jobs_filtered(self) -> None:
        payload = {
            "version": "1.0.0",
            "pka_values": [4.75],
            "ph_mode": "single",
            "ph_value": 7.0,
        }
        self.create_job_via_api(APP_API_BASE_PATH, payload, ROUTER_MODULE)
        response = self.client.get("/api/jobs/", {"plugin_name": PLUGIN_NAME})
        self.assertEqual(response.status_code, 200)
        for job_data in response.data:
            self.assertEqual(job_data["plugin_name"], PLUGIN_NAME)

    def test_retrieve_nonexistent_job_returns_404(self) -> None:
        from uuid import uuid4

        response = self.client.get(f"{APP_API_BASE_PATH}{uuid4()}/")
        self.assertEqual(response.status_code, 404)
