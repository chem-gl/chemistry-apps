"""test_extended.py: Pruebas extendidas del contrato HTTP para la app smileit.

Objetivo del archivo:
- Cubrir endpoints de ciclo de vida no testeados en tests.py base:
  cancel, progress, logs, list con filtrado, 404.
- Complementar los tests exhaustivos de tests.py sin duplicar lógica de negocio.

Cómo se usa:
- Ejecutar con `./venv/bin/python manage.py test apps.smileit.test_extended`.
"""

from __future__ import annotations

from unittest.mock import patch

from rest_framework.test import APIClient

from apps.core.models import ScientificJob
from apps.core.services import JobService

from .definitions import APP_API_BASE_PATH, DEFAULT_ALGORITHM_VERSION, PLUGIN_NAME
from .test_seed import SmileitSeedTestCase

ROUTER_MODULE = "apps.smileit.routers.viewset_write"


def _valid_job_payload() -> dict[str, object]:
    """Retorna payload mínimo válido para crear un job smileit."""
    return {
        "version": DEFAULT_ALGORITHM_VERSION,
        "principal_smiles": "c1ccccc1",
        "selected_atom_indices": [0],
        "assignment_blocks": [
            {
                "label": "AromaticSites",
                "site_atom_indices": [0],
                "category_keys": ["aromatic"],
                "substituent_refs": [],
                "manual_substituents": [],
            },
        ],
        "site_overlap_policy": "last_block_wins",
        "r_substitutes": 1,
        "num_bonds": 1,
        "max_structures": 10,
        "export_name_base": "EXTENDED_TEST",
        "export_padding": 5,
    }


class SmileitJobLifecycleTests(SmileitSeedTestCase):
    """Pruebas extendidas de ciclo de vida: cancel, progress, logs, list, 404."""

    def setUp(self) -> None:
        self.client = APIClient()

    def _create_pending_job(self) -> str:
        """Crea un job smileit en estado pending y retorna su ID."""
        with patch(f"{ROUTER_MODULE}.dispatch_scientific_job") as mock_d:
            mock_d.return_value = True
            response = self.client.post(
                APP_API_BASE_PATH, data=_valid_job_payload(), format="json"
            )
        self.assertEqual(response.status_code, 201)
        return str(response.data["id"])

    def test_cancel_pending_job(self) -> None:
        """Cancela un job en estado pending mediante POST /cancel/."""
        job_id = self._create_pending_job()
        response = self.client.post(f"/api/jobs/{job_id}/cancel/")
        self.assertEqual(response.status_code, 200)
        retrieve = self.client.get(f"{APP_API_BASE_PATH}{job_id}/")
        self.assertEqual(retrieve.data["status"], "cancelled")

    def test_progress_endpoint_returns_snapshot(self) -> None:
        """Verifica que el endpoint /progress/ retorna porcentaje del job."""
        job_id = self._create_pending_job()
        response = self.client.get(f"/api/jobs/{job_id}/progress/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("progress_percentage", response.data)

    def test_logs_endpoint_returns_list(self) -> None:
        """Verifica que el endpoint /logs/ retorna paginación con results de logs."""
        job_id = self._create_pending_job()
        response = self.client.get(f"/api/jobs/{job_id}/logs/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("results", response.data)
        self.assertIsInstance(response.data["results"], list)

    def test_list_jobs_filtered_by_plugin(self) -> None:
        """El listado filtra correctamente por plugin_name."""
        self._create_pending_job()
        response = self.client.get("/api/jobs/", {"plugin_name": PLUGIN_NAME})
        self.assertEqual(response.status_code, 200)
        for item in response.data:
            self.assertEqual(item["plugin_name"], PLUGIN_NAME)

    def test_retrieve_nonexistent_job_returns_404(self) -> None:
        """Retorna 404 cuando el UUID no existe."""
        from uuid import uuid4

        response = self.client.get(f"{APP_API_BASE_PATH}{uuid4()}/")
        self.assertEqual(response.status_code, 404)

    def test_full_create_and_run_cycle(self) -> None:
        """Ciclo completo con ejecución real para verificar estado completed."""
        response = self.client.post(
            APP_API_BASE_PATH, data=_valid_job_payload(), format="json"
        )
        self.assertEqual(response.status_code, 201)
        job_id = str(response.data["id"])
        JobService.run_job(job_id)
        retrieve = self.client.get(f"{APP_API_BASE_PATH}{job_id}/")
        self.assertEqual(retrieve.data["status"], "completed")

    def test_rejects_empty_payload(self) -> None:
        """Rechaza payload vacío sin los campos requeridos."""
        response = self.client.post(APP_API_BASE_PATH, data={}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_rejects_uncovered_selected_atoms(self) -> None:
        """Rechaza job con átomos seleccionados sin cobertura en bloques."""
        payload = _valid_job_payload()
        payload["selected_atom_indices"] = [0, 1, 2]  # Más sitios que bloques cubren
        response = self.client.post(APP_API_BASE_PATH, data=payload, format="json")
        self.assertEqual(response.status_code, 400)

    def test_create_job_with_manual_substituent(self) -> None:
        """Job con sustituyente manual debe crearse y ejecutarse generando derivados."""
        payload = {
            "version": DEFAULT_ALGORITHM_VERSION,
            "principal_smiles": "c1ccccc1",
            "selected_atom_indices": [0],
            "assignment_blocks": [
                {
                    "label": "ManualBlock",
                    "site_atom_indices": [0],
                    "category_keys": [],
                    "substituent_refs": [],
                    "manual_substituents": [
                        {
                            "name": "Ethyl",
                            "smiles": "CC",
                            "anchor_atom_indices": [0],
                            "categories": ["hydrophobic"],
                            "source_reference": "unit-test",
                            "provenance_metadata": {"case": "manual"},
                        }
                    ],
                }
            ],
            "site_overlap_policy": "last_block_wins",
            "r_substitutes": 1,
            "num_bonds": 1,
            "max_structures": 20,
            "export_name_base": "MANUAL_SERIES",
            "export_padding": 3,
        }
        response = self.client.post(APP_API_BASE_PATH, data=payload, format="json")
        self.assertEqual(response.status_code, 201)

        job_id = str(response.data["id"])
        JobService.run_job(job_id)

        job = ScientificJob.objects.get(pk=job_id)
        self.assertEqual(job.status, "completed")
        self.assertGreaterEqual(int((job.results or {}).get("total_generated", 0)), 1)

    def test_create_job_with_invalid_manual_substituent_smiles(self) -> None:
        """Sustituyente manual con SMILES inválido debe rechazarse con 409."""
        payload = {
            "version": DEFAULT_ALGORITHM_VERSION,
            "principal_smiles": "c1ccccc1",
            "selected_atom_indices": [0],
            "assignment_blocks": [
                {
                    "label": "ManualBlock",
                    "site_atom_indices": [0],
                    "category_keys": [],
                    "substituent_refs": [],
                    "manual_substituents": [
                        {
                            "name": "InvalidSub",
                            "smiles": "[INVALID_SMILES!!!",
                            "anchor_atom_indices": [0],
                            "categories": ["hydrophobic"],
                        }
                    ],
                }
            ],
            "site_overlap_policy": "last_block_wins",
            "r_substitutes": 1,
            "num_bonds": 1,
            "max_structures": 5,
            "export_name_base": "BAD_MANUAL",
            "export_padding": 3,
        }
        response = self.client.post(APP_API_BASE_PATH, data=payload, format="json")
        self.assertEqual(response.status_code, 409)


class SmileitContractTests(SmileitSeedTestCase):
    """Valida que el contrato declarativo de smileit expone la interfaz esperada."""

    def test_contract_exposes_required_interface(self) -> None:
        """El contrato debe tener plugin_name, execute y supports_pause_resume."""
        from .contract import get_smileit_contract

        contract = get_smileit_contract()
        for key in ("plugin_name", "version", "execute", "supports_pause_resume"):
            self.assertIn(key, contract)
        self.assertIsNotNone(contract["execute"])
