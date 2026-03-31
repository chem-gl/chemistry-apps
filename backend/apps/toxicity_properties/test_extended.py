"""test_extended.py: Pruebas extendidas del contrato HTTP para toxicity_properties.

Objetivo del archivo:
- Cubrir ciclo HTTP completo: create, run, retrieve, cancel.
- Verificar validaciones del schema para listas de SMILES.
- Complementar tests base sin duplicar escenarios existentes.

Cómo se usa:
- Ejecutar con `./venv/bin/python manage.py test apps.toxicity_properties.test_extended`.
"""

from __future__ import annotations

from apps.core.test_utils import ScientificJobTestMixin

from .definitions import APP_API_BASE_PATH, PLUGIN_NAME

ROUTER_MODULE = "apps.toxicity_properties.routers"

CAFFEINE_SMILES = "CN1C=NC2=C1C(=O)N(C(=O)N2C)C"
ASPIRIN_SMILES = "CC(=O)Oc1ccccc1C(=O)O"
INVALID_SMILES = "INVALID_SMILES_XYZ"

_SINGLE_MOLECULE_PAYLOAD = {
    "version": "1.0.0",
    "smiles": [CAFFEINE_SMILES],
}

_BATCH_PAYLOAD = {
    "version": "1.0.0",
    "smiles": [CAFFEINE_SMILES, ASPIRIN_SMILES],
}


class ToxicityPropertiesExtendedApiTests(ScientificJobTestMixin):
    """Pruebas extendidas del contrato API de toxicity_properties."""

    def test_create_single_molecule_job(self) -> None:
        """Crea job con una sola molecules y verifica el contrato inicial."""
        response = self.create_job_via_api(
            APP_API_BASE_PATH, _SINGLE_MOLECULE_PAYLOAD, ROUTER_MODULE
        )
        self.assertEqual(response.status_code, 201)
        self.assertIn("id", response.data)
        self.assertEqual(response.data["status"], "pending")

    def test_full_cycle_single_molecule(self) -> None:
        """Ciclo completo: create + run + retrieve con 1 molécula."""
        _job_id, response = self.create_and_run_job(
            APP_API_BASE_PATH, _SINGLE_MOLECULE_PAYLOAD, ROUTER_MODULE
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "completed")
        self.assertIn("molecules", response.data["results"])

    def test_full_cycle_batch_molecules(self) -> None:
        """Ciclo completo: create + run + retrieve con múltiples moléculas."""
        _job_id, response = self.create_and_run_job(
            APP_API_BASE_PATH, _BATCH_PAYLOAD, ROUTER_MODULE
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "completed")
        results = response.data["results"]
        self.assertEqual(results["total"], 2)

    def test_rejects_empty_smiles_list(self) -> None:
        """Rechaza payload con lista vacía de SMILES."""
        response = self.client.post(APP_API_BASE_PATH, {"smiles": []}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_rejects_invalid_smiles(self) -> None:
        """Rechaza payload con SMILES no parseable por RDKit."""
        response = self.client.post(
            APP_API_BASE_PATH, {"smiles": [INVALID_SMILES]}, format="json"
        )
        self.assertEqual(response.status_code, 400)

    def test_deduplicates_repeated_smiles(self) -> None:
        """Verifica que SMILES duplicados se deduplican antes de ejecutar."""
        payload = {"smiles": [CAFFEINE_SMILES, CAFFEINE_SMILES]}
        _job_id, response = self.create_and_run_job(
            APP_API_BASE_PATH, payload, ROUTER_MODULE
        )
        self.assertEqual(response.data["status"], "completed")
        # El job debe procesarse como 1 molécula única
        self.assertEqual(response.data["results"]["total"], 1)

    def test_cancel_pending_job(self) -> None:
        """Cancela un job en estado pending."""
        create_response = self.create_job_via_api(
            APP_API_BASE_PATH, _SINGLE_MOLECULE_PAYLOAD, ROUTER_MODULE
        )
        _job_id = str(create_response.data["id"])
        response = self.client.post(f"/api/jobs/{_job_id}/cancel/")
        self.assertEqual(response.status_code, 200)
        job = self.get_job_from_db(_job_id)
        self.assertEqual(job.status, "cancelled")

    def test_list_jobs_filtered_by_plugin(self) -> None:
        """Verifica que el listado filtra por plugin_name correctamente."""
        self.create_job_via_api(
            APP_API_BASE_PATH, _SINGLE_MOLECULE_PAYLOAD, ROUTER_MODULE
        )
        response = self.client.get("/api/jobs/", {"plugin_name": PLUGIN_NAME})
        self.assertEqual(response.status_code, 200)
        for item in response.data:
            self.assertEqual(item["plugin_name"], PLUGIN_NAME)

    def test_retrieve_nonexistent_job_returns_404(self) -> None:
        """Retorna 404 cuando el UUID no existe."""
        from uuid import uuid4

        response = self.client.get(f"{APP_API_BASE_PATH}{uuid4()}/")
        self.assertEqual(response.status_code, 404)

    def test_progress_endpoint_returns_snapshot(self) -> None:
        """Verifica que el endpoint de progreso retorna porcentaje."""
        create_response = self.create_job_via_api(
            APP_API_BASE_PATH, _SINGLE_MOLECULE_PAYLOAD, ROUTER_MODULE
        )
        _job_id = str(create_response.data["id"])
        response = self.client.get(f"/api/jobs/{_job_id}/progress/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("progress_percentage", response.data)
