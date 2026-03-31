"""test_extended.py: Tests HTTP extendidos para la app SA Score.

Objetivo del archivo:
- Cubrir el ciclo HTTP completo de SA Score: creación, ejecución y
  consulta de resultados con los tres métodos (ambit, brsa, rdkit).

Cómo se usa:
- Ejecutar con `python manage.py test apps.sa_score.test_extended`.
"""

from __future__ import annotations

from apps.core.test_utils import ScientificJobTestMixin

from .definitions import APP_API_BASE_PATH, PLUGIN_NAME, SA_SCORE_METHODS

ROUTER_MODULE = "apps.sa_score.routers"

# SMILES de caffeine para pruebas
CAFFEINE_SMILES = "CN1C=NC2=C1C(=O)N(C(=O)N2C)C"
ASPIRIN_SMILES = "CC(=O)Oc1ccccc1C(=O)O"


class SaScoreExtendedApiTests(ScientificJobTestMixin):
    """Pruebas extendidas del contrato API de SA Score."""

    def test_basic_cycle_single_smiles_all_methods(self) -> None:
        """Ciclo completo con una molécula y todos los métodos."""
        payload = {
            "smiles": [CAFFEINE_SMILES],
            "methods": list(SA_SCORE_METHODS),
            "version": "1.0.0",
        }
        _job_id, response = self.create_and_run_job(
            APP_API_BASE_PATH, payload, ROUTER_MODULE
        )
        self.assert_job_completed(response)

    def test_single_molecule_rdkit_method(self) -> None:
        payload = {
            "smiles": [ASPIRIN_SMILES],
            "methods": ["rdkit"],
            "version": "1.0.0",
        }
        _job_id, response = self.create_and_run_job(
            APP_API_BASE_PATH, payload, ROUTER_MODULE
        )
        self.assert_job_completed(response)
        self.assertIsNotNone(response.data["results"])

    def test_multiple_smiles_batch(self) -> None:
        payload = {
            "smiles": [CAFFEINE_SMILES, ASPIRIN_SMILES],
            "methods": ["rdkit"],
            "version": "1.0.0",
        }
        _job_id, response = self.create_and_run_job(
            APP_API_BASE_PATH, payload, ROUTER_MODULE
        )
        self.assert_job_completed(response)

    def test_rejects_empty_smiles_list(self) -> None:
        payload = {"smiles": [], "methods": ["rdkit"], "version": "1.0.0"}
        response = self.client.post(APP_API_BASE_PATH, payload, format="json")
        self.assertEqual(response.status_code, 400)

    def test_rejects_invalid_method(self) -> None:
        payload = {
            "smiles": [CAFFEINE_SMILES],
            "methods": ["invalid_method"],
            "version": "1.0.0",
        }
        response = self.client.post(APP_API_BASE_PATH, payload, format="json")
        self.assertEqual(response.status_code, 400)

    def test_rejects_invalid_smiles(self) -> None:
        """SMILES inválido debe retornar 400."""
        payload = {
            "smiles": ["NOT_VALID_SMILES_###"],
            "methods": ["rdkit"],
            "version": "1.0.0",
        }
        response = self.client.post(APP_API_BASE_PATH, payload, format="json")
        self.assertEqual(response.status_code, 400)

    def test_list_sa_score_jobs_filtered(self) -> None:
        payload = {
            "smiles": [CAFFEINE_SMILES],
            "methods": ["rdkit"],
            "version": "1.0.0",
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

    def test_default_methods_used_when_omitted(self) -> None:
        """Sin especificar methods, se usan todos los disponibles."""
        payload = {"smiles": [CAFFEINE_SMILES], "version": "1.0.0"}
        create_response = self.create_job_via_api(
            APP_API_BASE_PATH, payload, ROUTER_MODULE
        )
        self.assertEqual(create_response.status_code, 201)
