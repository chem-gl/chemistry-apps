"""test_extended.py: Pruebas extendidas del contrato HTTP para la app tunnel.

Objetivo del archivo:
- Cubrir ciclo HTTP completo: create, run, retrieve, cancel.
- Verificar validaciones del schema: frecuencia imaginaria, temperatura.
- Complementar tests base sin duplicar escenarios existentes.

Cómo se usa:
- Ejecutar con `./venv/bin/python manage.py test apps.tunnel.test_extended`.
"""

from __future__ import annotations

from apps.core.test_utils import ScientificJobTestMixin

from .definitions import APP_API_BASE_PATH, PLUGIN_NAME

ROUTER_MODULE = "apps.tunnel.routers"

_VALID_PAYLOAD = {
    "version": "2.0.0",
    "reaction_barrier_zpe": 3.5,
    "imaginary_frequency": 625.0,
    "reaction_energy_zpe": -8.2,
    "temperature": 298.15,
    "input_change_events": [],
}


class TunnelExtendedApiTests(ScientificJobTestMixin):
    """Pruebas extendidas del contrato API de tunnel."""

    def test_create_returns_plugin_name(self) -> None:
        """Crea job de efecto túnel y verifica el contrato inicial."""
        response = self.create_job_via_api(
            APP_API_BASE_PATH, _VALID_PAYLOAD, ROUTER_MODULE
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["plugin_name"], PLUGIN_NAME)
        self.assertEqual(response.data["status"], "pending")

    def test_full_cycle_completes(self) -> None:
        """Ciclo completo: create + run + retrieve."""
        _job_id, response = self.create_and_run_job(
            APP_API_BASE_PATH, _VALID_PAYLOAD, ROUTER_MODULE
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "completed")

    def test_result_has_kappa_value(self) -> None:
        """Verifica que el resultado incluye el coeficiente kappa de túnel (kappa_tst)."""
        _job_id, response = self.create_and_run_job(
            APP_API_BASE_PATH, _VALID_PAYLOAD, ROUTER_MODULE
        )
        self.assertIn("kappa_tst", response.data["results"])

    def test_cancel_pending_job(self) -> None:
        """Cancela un job en estado pending."""
        create_response = self.create_job_via_api(
            APP_API_BASE_PATH, _VALID_PAYLOAD, ROUTER_MODULE
        )
        _job_id = str(create_response.data["id"])
        response = self.client.post(f"/api/jobs/{_job_id}/cancel/")
        self.assertEqual(response.status_code, 200)
        job = self.get_job_from_db(_job_id)
        self.assertEqual(job.status, "cancelled")

    def test_rejects_negative_imaginary_frequency(self) -> None:
        """Rechaza payload con frecuencia imaginaria negativa."""
        payload = {**_VALID_PAYLOAD, "imaginary_frequency": -625.0}
        response = self.client.post(APP_API_BASE_PATH, payload, format="json")
        self.assertEqual(response.status_code, 400)

    def test_rejects_zero_imaginary_frequency(self) -> None:
        """Rechaza payload con frecuencia imaginaria de cero."""
        payload = {**_VALID_PAYLOAD, "imaginary_frequency": 0.0}
        response = self.client.post(APP_API_BASE_PATH, payload, format="json")
        self.assertEqual(response.status_code, 400)

    def test_rejects_missing_required_fields(self) -> None:
        """Rechaza payload sin campos requeridos."""
        response = self.client.post(APP_API_BASE_PATH, {}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_progress_endpoint_returns_snapshot(self) -> None:
        """Verifica que el endpoint de progreso retorna porcentaje."""
        create_response = self.create_job_via_api(
            APP_API_BASE_PATH, _VALID_PAYLOAD, ROUTER_MODULE
        )
        _job_id = str(create_response.data["id"])
        response = self.client.get(f"/api/jobs/{_job_id}/progress/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("progress_percentage", response.data)

    def test_list_jobs_filtered_by_plugin(self) -> None:
        """Verifica que el listado filtra por plugin_name correctamente."""
        self.create_job_via_api(APP_API_BASE_PATH, _VALID_PAYLOAD, ROUTER_MODULE)
        response = self.client.get("/api/jobs/", {"plugin_name": PLUGIN_NAME})
        self.assertEqual(response.status_code, 200)
        for item in response.data:
            self.assertEqual(item["plugin_name"], PLUGIN_NAME)

    def test_retrieve_nonexistent_job_returns_404(self) -> None:
        """Retorna 404 cuando el UUID no existe."""
        from uuid import uuid4

        response = self.client.get(f"{APP_API_BASE_PATH}{uuid4()}/")
        self.assertEqual(response.status_code, 404)

    def test_with_input_change_events(self) -> None:
        """Job con eventos de cambio de entrada auditados se crea correctamente."""
        payload = {
            **_VALID_PAYLOAD,
            "input_change_events": [
                {
                    "field_name": "reaction_barrier_zpe",
                    "previous_value": 0.0,
                    "new_value": 3.5,
                    "changed_at": "2026-03-12T10:01:10.000Z",
                }
            ],
        }
        response = self.create_job_via_api(APP_API_BASE_PATH, payload, ROUTER_MODULE)
        self.assertEqual(response.status_code, 201)
