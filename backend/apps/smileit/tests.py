"""tests.py: Pruebas de contrato y dominio para Smile-it v2.

Objetivo del archivo:
- Validar asignación flexible por bloques, persistencia de catálogos/patrones,
  inspección enriquecida y exportes reproducibles con trazabilidad.

Cómo se usa:
- Ejecutar con `./venv/bin/python manage.py test apps.smileit`.
"""

from __future__ import annotations

from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import ScientificJob, ScientificJobLogEvent
from apps.core.services import JobService

from . import engine as smileit_engine
from .catalog import list_active_patterns
from .definitions import APP_API_BASE_PATH, DEFAULT_ALGORITHM_VERSION
from .engine import inspect_smiles_structure_with_patterns
from .models import SmileitSubstituent


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

    def test_inspection_reports_only_matched_patterns(self) -> None:
        """Las referencias activas deben reflejar solo patrones realmente coincidentes."""
        patterns = list_active_patterns()

        benzene_inspection = inspect_smiles_structure_with_patterns(
            smiles="c1ccccc1",
            patterns=patterns,
        )
        self.assertEqual(benzene_inspection["active_pattern_refs"], [])

        nitro_inspection = inspect_smiles_structure_with_patterns(
            smiles="c1ccccc1[N+](=O)[O-]",
            patterns=patterns,
        )
        self.assertEqual(len(nitro_inspection["active_pattern_refs"]), 1)
        self.assertEqual(
            nitro_inspection["active_pattern_refs"][0]["name"],
            "Nitro Aromatic Alert",
        )


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

    def test_update_user_catalog_creates_new_latest_version(self) -> None:
        """Editar una entrada de usuario debe crear una versión nueva con mismo stable_id."""
        create_payload = {
            "name": "CyclobutylHydrophobic",
            "smiles": "C1CCC1",
            "anchor_atom_indices": [0],
            "category_keys": ["hydrophobic"],
            "source_reference": "local-lab",
            "provenance_metadata": {"owner": "ui-user"},
        }
        create_response = self.client.post(
            f"{APP_API_BASE_PATH}catalog/",
            data=create_payload,
            format="json",
        )
        self.assertEqual(create_response.status_code, 201)
        created_entry = create_response.json()

        update_payload = {
            "name": "CyclobutylHydrophobicV2",
            "smiles": "CC1CC1",
            "anchor_atom_indices": [0],
            "category_keys": ["hydrophobic"],
            "source_reference": "local-lab",
            "provenance_metadata": {"owner": "ui-user", "revision": "2"},
        }
        update_response = self.client.patch(
            f"{APP_API_BASE_PATH}catalog/{created_entry['stable_id']}/",
            data=update_payload,
            format="json",
        )

        self.assertEqual(update_response.status_code, 200)
        catalog_rows = update_response.json()
        updated_rows = [
            row
            for row in catalog_rows
            if row["stable_id"] == created_entry["stable_id"]
        ]
        self.assertEqual(len(updated_rows), 1)
        self.assertEqual(updated_rows[0]["name"], "CyclobutylHydrophobicV2")
        self.assertEqual(updated_rows[0]["version"], 2)

        self.assertFalse(
            SmileitSubstituent.objects.get(id=created_entry["id"]).is_latest
        )

    def test_update_seed_catalog_is_rejected(self) -> None:
        """Las entradas semilla deben mantenerse inmutables para trazabilidad base."""
        seed_entry = SmileitSubstituent.objects.filter(is_latest=True).first()
        self.assertIsNotNone(seed_entry)
        if seed_entry is None:
            return

        payload = {
            "name": "ShouldNotUpdateSeed",
            "smiles": "C",
            "anchor_atom_indices": [0],
            "category_keys": ["hydrophobic"],
            "source_reference": "local-lab",
            "provenance_metadata": {"owner": "ui-user"},
        }
        response = self.client.patch(
            f"{APP_API_BASE_PATH}catalog/{seed_entry.stable_id}/",
            data=payload,
            format="json",
        )

        self.assertEqual(response.status_code, 409)
        self.assertIn("detail", response.json())


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

    def test_create_pattern_accepts_valid_captioned_pattern(self) -> None:
        """Debe persistir patrón nuevo cuando SMARTS, tipo y caption son válidos."""
        payload = {
            "name": "Morpholine Privileged",
            "smarts": "O1CCNCC1",
            "pattern_type": "privileged",
            "caption": "Morpholine ring commonly improves polarity and solubility.",
            "source_reference": "unit-test",
            "provenance_metadata": {"case": "valid-pattern"},
        }

        response = self.client.post(
            f"{APP_API_BASE_PATH}patterns/",
            data=payload,
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(body["name"], payload["name"])
        self.assertEqual(body["caption"], payload["caption"])
        self.assertEqual(body["version"], 1)


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

    def test_create_job_rejects_r_substitutes_exceeding_site_count(self) -> None:
        """r_substitutes mayor que el número de sitios seleccionados debe rechazar el job."""
        payload = self._valid_payload()
        # _valid_payload tiene 2 sitios; r_substitutes=3 supera ese límite
        payload["r_substitutes"] = 3

        response = self.client.post(APP_API_BASE_PATH, data=payload, format="json")
        self.assertEqual(response.status_code, 400)
        error_detail = response.json()
        self.assertIn("r_substitutes", error_detail)

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
        generated_structures = job_results.get("generated_structures", [])
        self.assertGreaterEqual(len(generated_structures), 1)
        self.assertIn("scaffold_svg", generated_structures[0])
        self.assertIn("substituent_svgs", generated_structures[0])

    def test_overlapped_blocks_generate_union_permutations_per_site(self) -> None:
        """Sitio cubierto por múltiples bloques debe combinar todas las opciones efectivas."""
        payload = {
            "version": DEFAULT_ALGORITHM_VERSION,
            "principal_smiles": "c1ccccc1",
            "selected_atom_indices": [0],
            "assignment_blocks": [
                {
                    "label": "BlockFluoro",
                    "site_atom_indices": [0],
                    "category_keys": ["aromatic"],
                    "substituent_refs": [],
                    "manual_substituents": [],
                },
                {
                    "label": "BlockChloro",
                    "site_atom_indices": [0],
                    "category_keys": ["hbond_donor"],
                    "substituent_refs": [],
                    "manual_substituents": [],
                },
            ],
            "site_overlap_policy": "last_block_wins",
            "r_substitutes": 1,
            "num_bonds": 1,
            "max_structures": 20,
            "export_name_base": "UNION_OVERLAP",
            "export_padding": 5,
        }

        response = self.client.post(APP_API_BASE_PATH, data=payload, format="json")
        self.assertEqual(response.status_code, 201)

        job_id = response.json()["id"]
        JobService.run_job(job_id)

        job = ScientificJob.objects.get(pk=job_id)
        self.assertEqual(job.status, "completed")

        result_payload = job.results or {}
        generated_structures = result_payload.get("generated_structures", [])
        self.assertGreaterEqual(len(generated_structures), 2)

        traceability_rows = result_payload.get("traceability_rows", [])
        trace_block_labels = {
            str(row.get("block_label", "")) for row in traceability_rows
        }
        self.assertIn("BlockFluoro", trace_block_labels)
        self.assertIn("BlockChloro", trace_block_labels)

    def test_r_substitutes_generates_multi_round_combinatorics(self) -> None:
        """Con múltiples rondas debe existir trazabilidad con round_index mayor a 1."""
        payload = {
            "version": DEFAULT_ALGORITHM_VERSION,
            "principal_smiles": "c1ccccc1",
            "selected_atom_indices": [0, 1],
            "assignment_blocks": [
                {
                    "label": "BlockSite0",
                    "site_atom_indices": [0],
                    "category_keys": ["aromatic"],
                    "substituent_refs": [],
                    "manual_substituents": [],
                },
                {
                    "label": "BlockSite1",
                    "site_atom_indices": [1],
                    "category_keys": ["hbond_donor"],
                    "substituent_refs": [],
                    "manual_substituents": [],
                },
            ],
            "site_overlap_policy": "last_block_wins",
            "r_substitutes": 2,
            "num_bonds": 1,
            "max_structures": 60,
            "export_name_base": "MULTIROUND",
            "export_padding": 5,
        }

        response = self.client.post(APP_API_BASE_PATH, data=payload, format="json")
        self.assertEqual(response.status_code, 201)

        job_id = response.json()["id"]
        JobService.run_job(job_id)

        job = ScientificJob.objects.get(pk=job_id)
        self.assertEqual(job.status, "completed")
        result_payload = job.results or {}
        traceability_rows = result_payload.get("traceability_rows", [])
        self.assertGreaterEqual(len(traceability_rows), 2)
        self.assertGreaterEqual(
            max(int(row.get("round_index", 0)) for row in traceability_rows),
            2,
        )
        self.assertTrue(all("substituent_smiles" in row for row in traceability_rows))

    def test_create_and_run_job_without_limit_emits_generation_logs(self) -> None:
        """Con max_structures=0 debe ejecutar sin tope y registrar conteos de avance."""
        payload = self._valid_payload()
        payload["max_structures"] = 0
        payload["r_substitutes"] = 2

        response = self.client.post(APP_API_BASE_PATH, data=payload, format="json")
        self.assertEqual(response.status_code, 201)

        job_id = response.json()["id"]
        JobService.run_job(job_id)

        job = ScientificJob.objects.get(pk=job_id)
        self.assertEqual(job.status, "completed")

        plugin_logs = ScientificJobLogEvent.objects.filter(
            job=job,
            source="smileit.plugin",
        )
        self.assertGreaterEqual(plugin_logs.count(), 2)

        round_log = plugin_logs.filter(
            message="Ronda de generación completada."
        ).first()
        self.assertIsNotNone(round_log)
        assert round_log is not None
        self.assertIn("generated_structures", round_log.payload)
        self.assertIn("attempts_processed", round_log.payload)


class SmileitEngineOptimizationTests(TestCase):
    """Valida caches internas para reducir trabajo redundante en RDKit."""

    def tearDown(self) -> None:
        smileit_engine._parse_smiles_cached.cache_clear()
        smileit_engine.render_molecule_svg.cache_clear()
        smileit_engine.fuse_molecules.cache_clear()

    def test_render_molecule_svg_reuses_cache_for_same_smiles(self) -> None:
        """El render repetido del mismo SMILES no debe recalcular coordenadas 2D."""
        smileit_engine.render_molecule_svg.cache_clear()

        with patch(
            "apps.smileit.engine.AllChem.Compute2DCoords",
            wraps=smileit_engine.AllChem.Compute2DCoords,
        ) as mocked_compute_coords:
            first_svg = smileit_engine.render_molecule_svg("CCO")
            second_svg = smileit_engine.render_molecule_svg("CCO")

        self.assertEqual(first_svg, second_svg)
        self.assertEqual(mocked_compute_coords.call_count, 1)

    def test_fuse_molecules_reuses_cache_for_same_signature(self) -> None:
        """La misma fusión repetida debe resolverse desde caché en memoria."""
        smileit_engine.fuse_molecules.cache_clear()

        first_result = smileit_engine.fuse_molecules("c1ccccc1", "F", 0, 0, 1)
        second_result = smileit_engine.fuse_molecules("c1ccccc1", "F", 0, 0, 1)
        cache_info = smileit_engine.fuse_molecules.cache_info()

        self.assertEqual(first_result, second_result)
        self.assertGreaterEqual(cache_info.hits, 1)

    def test_parse_smiles_cache_reuses_rdkit_parser(self) -> None:
        """El parseo repetido del mismo SMILES debe reutilizar la caché interna."""
        smileit_engine._parse_smiles_cached.cache_clear()

        with patch(
            "apps.smileit.engine.Chem.MolFromSmiles",
            wraps=smileit_engine.Chem.MolFromSmiles,
        ) as mocked_parser:
            first_molecule = smileit_engine._parse_smiles_cached("CCO")
            second_molecule = smileit_engine._parse_smiles_cached("CCO")

        self.assertIsNotNone(first_molecule)
        self.assertIs(first_molecule, second_molecule)
        self.assertEqual(mocked_parser.call_count, 1)


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


class SmileitLegacyJobCompatibilityTests(TestCase):
    """Valida compatibilidad de lectura para jobs históricos de Smile-it."""

    def setUp(self) -> None:
        self.client = APIClient()

    def test_retrieve_legacy_job_without_assignment_blocks(self) -> None:
        """El retrieve debe responder 200 aun si parámetros legacy no traen campos v2."""
        legacy_job = ScientificJob.objects.create(
            job_hash="a" * 64,
            plugin_name="smileit",
            algorithm_version="1.0.0",
            status="completed",
            parameters={
                "principal_smiles": "c1ccccc1",
                "selected_atom_indices": [0, 1],
                "substituents": [
                    {"name": "Amine", "smiles": "[NH2]", "selected_atom_index": 0}
                ],
                "r_substitutes": 1,
                "num_bonds": 1,
                "allow_repeated": True,
                "max_structures": 100,
            },
            results={
                "total_generated": 1,
                "generated_structures": [],
                "truncated": False,
                "principal_smiles": "c1ccccc1",
                "selected_atom_indices": [0, 1],
            },
            progress_percentage=100,
            progress_stage="completed",
            progress_message="legacy completed",
            progress_event_index=12,
        )

        response = self.client.get(f"{APP_API_BASE_PATH}{legacy_job.id}/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["parameters"]["assignment_blocks"], [])
        self.assertEqual(payload["results"]["traceability_rows"], [])

    def test_retrieve_legacy_job_without_structure_traceability(self) -> None:
        """El retrieve debe completar trazabilidad vacía si faltan campos por estructura."""
        legacy_job = ScientificJob.objects.create(
            job_hash="b" * 64,
            plugin_name="smileit",
            algorithm_version="1.0.0",
            status="completed",
            parameters={
                "principal_smiles": "c1ccccc1",
                "selected_atom_indices": [0],
                "r_substitutes": 1,
                "num_bonds": 1,
                "allow_repeated": False,
                "max_structures": 50,
            },
            results={
                "total_generated": 1,
                "generated_structures": [
                    {
                        "name": "legacy_00001",
                        "smiles": "c1ccccc1",
                        "svg": "<svg></svg>",
                    }
                ],
                "truncated": False,
                "principal_smiles": "c1ccccc1",
                "selected_atom_indices": [0],
            },
            progress_percentage=100,
            progress_stage="completed",
            progress_message="legacy completed",
            progress_event_index=22,
        )

        response = self.client.get(f"{APP_API_BASE_PATH}{legacy_job.id}/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(
            payload["results"]["generated_structures"][0]["traceability"], []
        )
        self.assertEqual(
            payload["results"]["generated_structures"][0]["scaffold_svg"], ""
        )
        self.assertEqual(
            payload["results"]["generated_structures"][0]["substituent_svgs"],
            [],
        )
