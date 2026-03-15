"""tests.py: Pruebas de contrato y dominio para Smile-it v2.

Objetivo del archivo:
- Validar asignación flexible por bloques, persistencia de catálogos/patrones,
  inspección enriquecida y exportes reproducibles con trazabilidad.

Cómo se usa:
- Ejecutar con `./venv/bin/python manage.py test apps.smileit`.
"""

from __future__ import annotations

from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import ScientificJob
from apps.core.services import JobService

from .catalog import list_active_patterns
from .definitions import APP_API_BASE_PATH, DEFAULT_ALGORITHM_VERSION
from .engine import inspect_smiles_structure_with_patterns


class SmileitInspectionTests(TestCase):
    """Valida inspección molecular enriquecida con propiedades y anotaciones."""

    def test_inspection_includes_quick_properties_and_annotations(self) -> None:
        """La inspección debe devolver propiedades rápidas y anotaciones estructurales."""
        patterns = list_active_patterns()
        inspection = inspect_smiles_structure_with_patterns(
            smiles="c1ccccc1[N+](=O)[O-]",
            patterns=patterns,
        )

        self.assertGreaterEqual(inspection["quick_properties"]["molecular_weight"], 1.0)
        self.assertGreaterEqual(inspection["quick_properties"]["aromatic_rings"], 1)
        self.assertIn("annotations", inspection)
        self.assertIn("active_pattern_refs", inspection)


class SmileitCatalogCrudTests(TestCase):
    """Valida CRUD de catálogo y reglas de validación de categorías."""

    def setUp(self) -> None:
        self.client = APIClient()

    def test_catalog_endpoint_returns_seed_entries(self) -> None:
        """El endpoint de catálogo debe retornar sustituyentes precargados persistidos."""
        response = self.client.get(f"{APP_API_BASE_PATH}catalog/")
        self.assertEqual(response.status_code, 200)
        self.assertGreaterEqual(len(response.json()), 1)

    def test_create_catalog_rejects_wrong_category_assignment(self) -> None:
        """Debe rechazar sustituyente mal clasificado, por ejemplo aromático sin aromaticidad."""
        payload = {
            "name": "EthanolNonAromatic",
            "smiles": "CCO",
            "anchor_atom_indices": [0],
            "category_keys": ["aromatic"],
            "source_reference": "unit-test",
            "provenance_metadata": {"case": "reject-aromatic"},
        }

        response = self.client.post(
            f"{APP_API_BASE_PATH}catalog/",
            data=payload,
            format="json",
        )

        self.assertEqual(response.status_code, 409)
        self.assertIn("detail", response.json())

    def test_create_catalog_accepts_valid_substituent(self) -> None:
        """Debe aceptar alta cuando SMILES/categorías/anclajes son coherentes."""
        payload = {
            "name": "CyclopropylHydrophobic",
            "smiles": "C1CC1",
            "anchor_atom_indices": [0],
            "category_keys": ["hydrophobic"],
            "source_reference": "unit-test",
            "provenance_metadata": {"case": "accept-hydrophobic"},
        }

        response = self.client.post(
            f"{APP_API_BASE_PATH}catalog/",
            data=payload,
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(body["name"], payload["name"])
        self.assertEqual(body["version"], 1)


class SmileitPatternCrudTests(TestCase):
    """Valida alta de patrones estructurales con caption y SMARTS válidos."""

    def setUp(self) -> None:
        self.client = APIClient()

    def test_create_pattern_rejects_invalid_smarts(self) -> None:
        """Debe rechazar patrón con SMARTS inválido."""
        payload = {
            "name": "BrokenPattern",
            "smarts": "[invalid",
            "pattern_type": "toxicophore",
            "caption": "Invalid SMARTS should fail",
            "source_reference": "unit-test",
            "provenance_metadata": {"case": "invalid-smarts"},
        }

        response = self.client.post(
            f"{APP_API_BASE_PATH}patterns/",
            data=payload,
            format="json",
        )

        self.assertEqual(response.status_code, 409)


class SmileitJobBlockTests(TestCase):
    """Valida integridad de cobertura por sitios y ejecución por bloques."""

    def setUp(self) -> None:
        self.client = APIClient()

    def _valid_payload(self) -> dict:
        return {
            "version": DEFAULT_ALGORITHM_VERSION,
            "principal_smiles": "c1ccccc1",
            "selected_atom_indices": [0, 1],
            "assignment_blocks": [
                {
                    "label": "AromaticSites",
                    "site_atom_indices": [0],
                    "category_keys": ["aromatic"],
                    "substituent_refs": [],
                    "manual_substituents": [],
                },
                {
                    "label": "DonorSites",
                    "site_atom_indices": [1],
                    "category_keys": ["hbond_donor"],
                    "substituent_refs": [],
                    "manual_substituents": [],
                },
            ],
            "site_overlap_policy": "last_block_wins",
            "r_substitutes": 1,
            "num_bonds": 1,
            "allow_repeated": False,
            "max_structures": 60,
            "export_name_base": "BENZENE_SERIES",
            "export_padding": 5,
        }

    def test_create_job_rejects_missing_site_coverage(self) -> None:
        """No debe crear job cuando existe al menos un sitio seleccionado sin cobertura."""
        payload = self._valid_payload()
        payload["selected_atom_indices"] = [0, 1, 2]

        response = self.client.post(APP_API_BASE_PATH, data=payload, format="json")
        self.assertEqual(response.status_code, 400)

    def test_create_and_run_job_generates_traceability(self) -> None:
        """Job válido debe ejecutarse y generar trazabilidad por derivado."""
        response = self.client.post(
            APP_API_BASE_PATH, data=self._valid_payload(), format="json"
        )
        self.assertEqual(response.status_code, 201)

        job_id = response.json()["id"]
        JobService.run_job(job_id)

        job = ScientificJob.objects.get(pk=job_id)
        self.assertEqual(job.status, "completed")
        self.assertIsInstance(job.results, dict)

        job_results = job.results or {}
        self.assertGreaterEqual(int(job_results.get("total_generated", 0)), 1)
        self.assertIn("traceability_rows", job_results)


class SmileitExportTests(TestCase):
    """Valida exportes reproducibles de SMILES y trazabilidad."""

    def setUp(self) -> None:
        self.client = APIClient()

    def _create_completed_job(self) -> str:
        payload = {
            "version": DEFAULT_ALGORITHM_VERSION,
            "principal_smiles": "c1ccccc1",
            "selected_atom_indices": [0],
            "assignment_blocks": [
                {
                    "label": "AromaticOnly",
                    "site_atom_indices": [0],
                    "category_keys": ["aromatic"],
                    "substituent_refs": [],
                    "manual_substituents": [],
                }
            ],
            "site_overlap_policy": "last_block_wins",
            "r_substitutes": 1,
            "num_bonds": 1,
            "allow_repeated": False,
            "max_structures": 40,
            "export_name_base": "SMILEIT_SERIES",
            "export_padding": 5,
        }
        create_response = self.client.post(
            APP_API_BASE_PATH, data=payload, format="json"
        )
        self.assertEqual(create_response.status_code, 201)

        job_id = create_response.json()["id"]
        JobService.run_job(job_id)
        return str(job_id)

    def test_report_smiles_returns_enumerated_format(self) -> None:
        """El export principal debe entregar NAME y líneas NAME_XXXXX SMILES."""
        job_id = self._create_completed_job()

        response = self.client.get(f"{APP_API_BASE_PATH}{job_id}/report-smiles/")
        self.assertEqual(response.status_code, 200)
        content = response.content.decode("utf-8")

        self.assertTrue(content.startswith("SMILEIT_SERIES"))
        self.assertIn("SMILEIT_SERIES_00001", content)

    def test_report_traceability_returns_csv(self) -> None:
        """Debe exportar trazabilidad tabular para auditoría de sustituciones."""
        job_id = self._create_completed_job()

        response = self.client.get(f"{APP_API_BASE_PATH}{job_id}/report-traceability/")
        self.assertEqual(response.status_code, 200)
        content = response.content.decode("utf-8")
        self.assertIn("derivative_name,derivative_smiles,round_index", content)
