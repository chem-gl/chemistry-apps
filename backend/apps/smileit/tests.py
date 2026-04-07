"""tests.py: Pruebas de contrato y dominio para Smile-it v2.

Objetivo del archivo:
- Validar asignación flexible por bloques, persistencia de catálogos/patrones,
  inspección enriquecida y exportes reproducibles con trazabilidad.

Cómo se usa:
- Ejecutar con `./venv/bin/python manage.py test apps.smileit`.
"""

from __future__ import annotations

import csv
from io import BytesIO, StringIO
from unittest.mock import patch
from zipfile import ZipFile

from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import ScientificJob, ScientificJobLogEvent
from apps.core.services import JobService

from . import _smileit_builders as smileit_builders_module
from . import engine as smileit_engine
from . import plugin as smileit_plugin_module
from .catalog import list_active_patterns
from .definitions import APP_API_BASE_PATH, DEFAULT_ALGORITHM_VERSION
from .engine import inspect_smiles_structure_with_patterns
from .models import SmileitSubstituent
from .test_seed import SmileitSeedTestCase


class SmileitInspectionTests(SmileitSeedTestCase):
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


class SmileitCatalogCrudTests(SmileitSeedTestCase):
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

    def test_create_catalog_accepts_uncategorized_substituent(self) -> None:
        """Debe permitir alta de sustituyente sin categorías explícitas."""
        payload = {
            "name": "CyclopropylUncategorized",
            "smiles": "C1CC1",
            "anchor_atom_indices": [0],
            "category_keys": [],
            "source_reference": "unit-test",
            "provenance_metadata": {"case": "accept-uncategorized"},
        }

        response = self.client.post(
            f"{APP_API_BASE_PATH}catalog/",
            data=payload,
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(body["name"], payload["name"])
        self.assertEqual(body["categories"], [])

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


class SmileitJobBlockTests(SmileitSeedTestCase):
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
        self.assertIn("placeholder_assignments", generated_structures[0])
        self.assertIn("svg", generated_structures[0])
        self.assertEqual(generated_structures[0]["svg"], "")

    def test_create_job_accepts_manual_substituent_without_categories(self) -> None:
        """Debe aceptar sustituyente manual sin categorías dentro del bloque."""
        payload = {
            "version": DEFAULT_ALGORITHM_VERSION,
            "principal_smiles": "c1ccccc1",
            "selected_atom_indices": [0],
            "assignment_blocks": [
                {
                    "label": "ManualWithoutCategories",
                    "site_atom_indices": [0],
                    "category_keys": [],
                    "substituent_refs": [],
                    "manual_substituents": [
                        {
                            "name": "NoCategorySubstituent",
                            "smiles": "C",
                            "anchor_atom_indices": [0],
                            "categories": [],
                        }
                    ],
                }
            ],
            "site_overlap_policy": "last_block_wins",
            "r_substitutes": 1,
            "num_bonds": 1,
            "max_structures": 20,
            "export_name_base": "UNCAT",
            "export_padding": 4,
        }

        response = self.client.post(APP_API_BASE_PATH, data=payload, format="json")
        self.assertEqual(response.status_code, 201)

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

    def test_derivations_page_and_svg_on_demand(self) -> None:
        """Derivaciones paginadas y SVG on-demand deben responder en job completado."""
        response = self.client.post(
            APP_API_BASE_PATH, data=self._valid_payload(), format="json"
        )
        self.assertEqual(response.status_code, 201)

        job_id = response.json()["id"]
        JobService.run_job(job_id)

        derivations_response = self.client.get(
            f"{APP_API_BASE_PATH}{job_id}/derivations/?offset=0&limit=100"
        )
        self.assertEqual(derivations_response.status_code, 200)
        derivations_payload = derivations_response.json()
        self.assertIn("total_generated", derivations_payload)
        self.assertIn("items", derivations_payload)
        self.assertGreaterEqual(len(derivations_payload["items"]), 1)
        self.assertIn("structure_index", derivations_payload["items"][0])

        structure_index = int(derivations_payload["items"][0]["structure_index"])
        svg_response = self.client.get(
            f"{APP_API_BASE_PATH}{job_id}/derivations/{structure_index}/svg/"
        )
        self.assertEqual(svg_response.status_code, 200)
        self.assertIn("image/svg+xml", svg_response["Content-Type"])
        svg_text = svg_response.content.decode("utf-8")
        self.assertTrue(svg_text.startswith("<?xml") or svg_text.startswith("<svg"))

        thumb_response = self.client.get(
            f"{APP_API_BASE_PATH}{job_id}/derivations/{structure_index}/svg/?variant=thumb"
        )
        self.assertEqual(thumb_response.status_code, 200)
        self.assertIn("image/svg+xml", thumb_response["Content-Type"])

    def test_retrieve_returns_summary_without_embedded_generated_structures(
        self,
    ) -> None:
        """Retrieve debe omitir lista pesada de derivados para minimizar payload."""
        response = self.client.post(
            APP_API_BASE_PATH, data=self._valid_payload(), format="json"
        )
        self.assertEqual(response.status_code, 201)

        job_id = response.json()["id"]
        JobService.run_job(job_id)

        retrieve_response = self.client.get(f"{APP_API_BASE_PATH}{job_id}/")
        self.assertEqual(retrieve_response.status_code, 200)
        payload = retrieve_response.json()
        self.assertIn("results", payload)
        self.assertIn("generated_structures", payload["results"])
        self.assertEqual(payload["results"]["generated_structures"], [])

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

        generated_structures = result_payload.get("generated_structures", [])
        for generated_structure in generated_structures:
            traceability_events = generated_structure.get("traceability", [])
            used_sites = {
                int(event.get("site_atom_index", -1)) for event in traceability_events
            }
            # Cada derivado debe usar sitios distintos de la principal sin reusar el mismo.
            self.assertEqual(len(used_sites), len(traceability_events))

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

    def test_prevents_known_chained_substitution_derivatives(self) -> None:
        """No debe generar derivados conocidos por encadenar sobre sustituyentes."""
        payload = {
            "version": DEFAULT_ALGORITHM_VERSION,
            "principal_smiles": "c1ccc2[nH]ccc2c1NCCC=C",
            "selected_atom_indices": [0, 1, 2],
            "assignment_blocks": [
                {
                    "label": "Block 1",
                    "site_atom_indices": [0, 1, 2],
                    "category_keys": [],
                    "substituent_refs": [],
                    "manual_substituents": [
                        {
                            "name": "segundo",
                            "smiles": "CCCCCCC",
                            "anchor_atom_indices": [0],
                            "categories": ["hydrophobic"],
                        }
                    ],
                }
            ],
            "site_overlap_policy": "last_block_wins",
            "r_substitutes": 3,
            "num_bonds": 1,
            "max_structures": 0,
            "export_name_base": "smileit_run",
            "export_padding": 5,
        }

        response = self.client.post(APP_API_BASE_PATH, data=payload, format="json")
        self.assertEqual(response.status_code, 201)

        job_id = response.json()["id"]
        JobService.run_job(job_id)

        job = ScientificJob.objects.get(pk=job_id)
        self.assertEqual(job.status, "completed")

        generated_smiles = {
            str(item.get("smiles", ""))
            for item in (job.results or {}).get("generated_structures", [])
        }

        # Derivados reportados por el usuario como inválidos (sustituyente-sobre-sustituyente).
        forbidden_derivatives = {
            "CCCCCC(C)C(CC)CCC(C)CCCCCC(C)C=CCCNc1cccc2[nH]ccc12",
            "CCCCCC(C)C(=CC(C)CCC(CC)C(C)CCCCC)CCNc1cccc2[nH]ccc12",
            "CCCCCC(C)C(C)CCCC(C)C=CC(CNc1cccc2[nH]ccc12)C(C)CCCCC",
            "CCCCCC(C)C(C=CC(C)CCC(CC)C(C)CCCCC)CNc1cccc2[nH]ccc12",
        }
        for forbidden_smiles in forbidden_derivatives:
            self.assertNotIn(forbidden_smiles, generated_smiles)

    def test_allows_site_reuse_across_derivatives_without_simultaneous_conflicts(
        self,
    ) -> None:
        """Permite reutilizar un sitio entre derivados, pero no duplicarlo en el mismo."""
        payload = {
            "version": DEFAULT_ALGORITHM_VERSION,
            "principal_smiles": "c1ccccc1",
            "selected_atom_indices": [0, 1, 2],
            "assignment_blocks": [
                {
                    "label": "ReusableSites",
                    "site_atom_indices": [0, 1, 2],
                    "category_keys": [],
                    "substituent_refs": [],
                    "manual_substituents": [
                        {
                            "name": "a",
                            "smiles": "C",
                            "anchor_atom_indices": [0],
                            "categories": ["hydrophobic"],
                        },
                        {
                            "name": "b",
                            "smiles": "CC",
                            "anchor_atom_indices": [0],
                            "categories": ["hydrophobic"],
                        },
                    ],
                }
            ],
            "site_overlap_policy": "last_block_wins",
            "r_substitutes": 2,
            "num_bonds": 1,
            "max_structures": 0,
            "export_name_base": "reuse_sites",
            "export_padding": 4,
        }

        response = self.client.post(APP_API_BASE_PATH, data=payload, format="json")
        self.assertEqual(response.status_code, 201)

        job_id = response.json()["id"]
        JobService.run_job(job_id)

        job = ScientificJob.objects.get(pk=job_id)
        self.assertEqual(job.status, "completed")
        results = job.results or {}
        traceability_rows = results.get("traceability_rows", [])
        self.assertGreaterEqual(len(traceability_rows), 1)

        # Reuso permitido: el sitio 0 debe aparecer con sustituyentes distintos en derivados diferentes.
        site_zero_rows = [
            row for row in traceability_rows if int(row.get("site_atom_index", -1)) == 0
        ]
        self.assertGreaterEqual(len(site_zero_rows), 2)
        site_zero_substituents = {
            str(row.get("substituent_name", "")) for row in site_zero_rows
        }
        self.assertIn("a", site_zero_substituents)
        self.assertIn("b", site_zero_substituents)

        # No simultaneidad: dentro de un mismo derivado no puede repetirse el mismo sitio.
        rows_by_derivative: dict[str, list[dict]] = {}
        for row in traceability_rows:
            derivative_name = str(row.get("derivative_name", ""))
            rows_by_derivative.setdefault(derivative_name, []).append(row)

        for derivative_rows in rows_by_derivative.values():
            used_sites = {
                int(row.get("site_atom_index", -1)) for row in derivative_rows
            }
            self.assertEqual(len(used_sites), len(derivative_rows))


class SmileitEngineOptimizationTests(TestCase):
    """Valida caches internas para reducir trabajo redundante en RDKit."""

    def tearDown(self) -> None:
        smileit_engine._parse_smiles_cached.cache_clear()
        smileit_engine.render_molecule_svg.cache_clear()
        smileit_engine.is_fusion_candidate_viable.cache_clear()
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


class SmileitPluginOptimizationTests(TestCase):
    """Valida optimizaciones de búsqueda exacta dentro del plugin Smile-it."""

    def _build_site_option_map_with_single_option(
        self,
    ) -> dict[int, list[smileit_builders_module.SiteOption]]:
        return {
            0: [
                smileit_builders_module.SiteOption(
                    site_atom_index=0,
                    block_label="BlockA",
                    block_priority=1,
                    substituent={
                        "source_kind": "catalog",
                        "stable_id": "sub-a",
                        "version": 1,
                        "name": "A",
                        "smiles": "A",
                        "selected_atom_index": 0,
                        "categories": [],
                    },
                )
            ]
        }

    def test_generate_derivatives_expands_only_current_frontier(self) -> None:
        """Cada ronda expande solo frontier actual respetando no-reuso de sitio."""
        progress_updates: list[tuple[int, str, str]] = []

        def progress_callback(percentage: int, stage: str, message: str) -> None:
            progress_updates.append((percentage, stage, message))

        def fake_fuse(
            principal_smiles: str,
            substituent_smiles: str,
            principal_atom_idx: int | None,
            substituent_atom_idx: int | None,
            bond_order: int,
        ) -> str | None:
            del substituent_smiles, substituent_atom_idx, bond_order
            if principal_smiles == "CC":
                return "CCC" if principal_atom_idx == 0 else "CCN"
            mapping: dict[str, str] = {
                "CCC": "CCCC",
                "CCN": "CCNC",
            }
            return mapping.get(principal_smiles)

        with (
            patch(
                "apps.smileit._smileit_engine.is_fusion_candidate_viable",
                return_value=True,
            ),
            patch(
                "apps.smileit._smileit_builders.fuse_molecules",
                side_effect=fake_fuse,
            ) as mocked_fuse,
        ):
            generated_candidates, traceability_rows, truncated = (
                smileit_plugin_module._generate_derivatives(
                    principal_smiles="CC",
                    selected_atom_indices=[0, 1],
                    site_option_map={
                        0: self._build_site_option_map_with_single_option()[0],
                        1: self._build_site_option_map_with_single_option()[0],
                    },
                    r_substitutes=2,
                    num_bonds=1,
                    max_structures=None,
                    export_name_base="SERIES",
                    export_padding=3,
                    progress_callback=progress_callback,
                    log_callback=None,
                )
            )

        self.assertFalse(truncated)
        self.assertEqual(
            [candidate.smiles for candidate in generated_candidates],
            ["CCC", "CCN", "CCCC", "CCNC"],
        )
        self.assertEqual(mocked_fuse.call_count, 4)
        self.assertEqual(len(traceability_rows), 6)
        self.assertGreaterEqual(len(progress_updates), 1)

    def test_generate_derivatives_reuses_intra_job_fusion_attempt_cache(self) -> None:
        """Dos bloques que intentan la misma fusión exacta no deben recalcular RDKit."""

        duplicated_site_option_map: dict[
            int, list[smileit_builders_module.SiteOption]
        ] = {
            0: [
                smileit_builders_module.SiteOption(
                    site_atom_index=0,
                    block_label="BlockA",
                    block_priority=1,
                    substituent={
                        "source_kind": "catalog",
                        "stable_id": "sub-a",
                        "version": 1,
                        "name": "A",
                        "smiles": "A",
                        "selected_atom_index": 0,
                        "categories": [],
                    },
                ),
                smileit_builders_module.SiteOption(
                    site_atom_index=0,
                    block_label="BlockB",
                    block_priority=2,
                    substituent={
                        "source_kind": "catalog",
                        "stable_id": "sub-a",
                        "version": 1,
                        "name": "A",
                        "smiles": "A",
                        "selected_atom_index": 0,
                        "categories": [],
                    },
                ),
            ]
        }

        with (
            patch(
                "apps.smileit._smileit_engine.is_fusion_candidate_viable",
                return_value=True,
            ),
            patch(
                "apps.smileit._smileit_builders.fuse_molecules",
                return_value="PA",
            ) as mocked_fuse,
        ):
            generated_candidates, _traceability_rows, truncated = (
                smileit_plugin_module._generate_derivatives(
                    principal_smiles="P",
                    selected_atom_indices=[0],
                    site_option_map=duplicated_site_option_map,
                    r_substitutes=1,
                    num_bonds=1,
                    max_structures=None,
                    export_name_base="SERIES",
                    export_padding=3,
                    progress_callback=lambda _percentage, _stage, _message: None,
                    log_callback=None,
                )
            )

        self.assertFalse(truncated)
        self.assertEqual(len(generated_candidates), 1)
        self.assertEqual(generated_candidates[0].smiles, "PA")
        self.assertEqual(mocked_fuse.call_count, 1)

    def test_generate_derivatives_skips_non_viable_fusions_before_rdkit(self) -> None:
        """La poda previa debe evitar entrar a RDKit cuando la firma ya es inviable."""
        with (
            patch(
                "apps.smileit._smileit_engine.is_fusion_candidate_viable",
                return_value=False,
            ) as mocked_viability,
            patch(
                "apps.smileit._smileit_builders.fuse_molecules",
            ) as mocked_fuse,
        ):
            generated_candidates, traceability_rows, truncated = (
                smileit_plugin_module._generate_derivatives(
                    principal_smiles="P",
                    selected_atom_indices=[0],
                    site_option_map=self._build_site_option_map_with_single_option(),
                    r_substitutes=1,
                    num_bonds=1,
                    max_structures=None,
                    export_name_base="SERIES",
                    export_padding=3,
                    progress_callback=lambda _percentage, _stage, _message: None,
                    log_callback=None,
                )
            )

        self.assertFalse(truncated)
        self.assertEqual(generated_candidates, [])
        self.assertEqual(traceability_rows, [])
        self.assertEqual(mocked_viability.call_count, 1)
        self.assertEqual(mocked_fuse.call_count, 0)

    def test_render_molecule_svg_with_atom_labels_includes_placeholder_text(
        self,
    ) -> None:
        """El SVG combinado debe incluir etiquetas de placeholder visibles en el markup."""
        rendered_svg = smileit_engine.render_molecule_svg_with_atom_labels(
            "c1ccccc1",
            {0: "R1", 2: "R2"},
        )

        self.assertIn("R1", rendered_svg)
        self.assertIn("R2", rendered_svg)

    def test_substituent_highlighting_uses_non_scaffold_atoms(self) -> None:
        """El highlighting debe marcar átomos del sustituyente, no del scaffold principal."""
        fused_smiles = smileit_engine.fuse_molecules(
            principal_smiles="CCCCC",
            substituent_smiles="c1ccccc1",
            principal_atom_idx=0,
            substituent_atom_idx=0,
            bond_order=1,
        )
        self.assertIsNotNone(fused_smiles)
        if fused_smiles is None:
            return

        principal_molecule = smileit_engine._parse_smiles_cached("CCCCC")
        derivative_molecule = smileit_engine._parse_smiles_cached(fused_smiles)
        self.assertIsNotNone(principal_molecule)
        self.assertIsNotNone(derivative_molecule)
        if principal_molecule is None or derivative_molecule is None:
            return

        highlighted_atoms = smileit_engine._compute_substituent_atom_indices(
            principal_molecule=principal_molecule,
            derivative_molecule=derivative_molecule,
            principal_site_atom_indices=[0],
        )

        expected_substituent_atoms = (
            derivative_molecule.GetNumAtoms() - principal_molecule.GetNumAtoms()
        )
        self.assertEqual(len(highlighted_atoms), expected_substituent_atoms)
        self.assertGreater(len(highlighted_atoms), 0)
        self.assertLess(max(highlighted_atoms), derivative_molecule.GetNumAtoms())

    def test_tint_svg_does_not_corrupt_longer_hex_colors(self) -> None:
        """Tintado no debe alterar colores válidos como #0000FF por reemplazo parcial."""
        raw_svg = (
            '<svg><path style="fill:#0000FF;stroke:#000" />'
            '<path style="fill:#000;stroke:#000000" /></svg>'
        )
        tinted_svg = smileit_engine.tint_svg(raw_svg, "#2f855a")

        self.assertIn("fill:#0000FF", tinted_svg)
        self.assertNotIn("#2f855a0FF", tinted_svg)
        self.assertIn("stroke:#2f855a", tinted_svg)


class SmileitExportTests(SmileitSeedTestCase):
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

    def test_report_smiles_returns_enumerated_smiles_lines(self) -> None:
        """El export SMI/TXT debe listar principal primero y luego solo SMILES derivados."""
        job_id = self._create_completed_job()

        response = self.client.get(f"{APP_API_BASE_PATH}{job_id}/report-smiles/")
        self.assertEqual(response.status_code, 200)
        content = response.content.decode("utf-8")
        content_lines = [line for line in content.splitlines() if line.strip() != ""]

        self.assertGreaterEqual(len(content_lines), 2)
        self.assertEqual(content_lines[0], "c1ccccc1")

    def test_report_csv_returns_compact_chemical_columns(self) -> None:
        """El CSV principal debe compactar principal, sustituyentes, posiciones y derivado."""
        job_id = self._create_completed_job()

        response = self.client.get(f"{APP_API_BASE_PATH}{job_id}/report-csv/")
        self.assertEqual(response.status_code, 200)

        parsed_rows = list(csv.DictReader(StringIO(response.content.decode("utf-8"))))
        self.assertGreaterEqual(len(parsed_rows), 1)

        first_row = parsed_rows[0]
        self.assertEqual(
            list(first_row.keys()),
            [
                "compound_name",
                "principal_smiles",
                "substituent_smiles",
                "applied_positions",
                "generated_smiles",
            ],
        )
        self.assertEqual(first_row["principal_smiles"], "c1ccccc1")
        self.assertNotEqual(first_row["substituent_smiles"], "")
        self.assertNotEqual(first_row["applied_positions"], "")
        self.assertNotEqual(first_row["generated_smiles"], "")
        self.assertIn(first_row["principal_smiles"], first_row["compound_name"])

    def test_report_traceability_returns_csv(self) -> None:
        """Debe exportar trazabilidad tabular para auditoría de sustituciones."""
        job_id = self._create_completed_job()

        response = self.client.get(f"{APP_API_BASE_PATH}{job_id}/report-traceability/")
        self.assertEqual(response.status_code, 200)
        content = response.content.decode("utf-8")
        self.assertIn("derivative_name,derivative_smiles,round_index", content)

    def test_report_images_zip_returns_svg_bundle(self) -> None:
        """El endpoint ZIP debe incluir SVGs y archivo de SMILES para export masivo."""
        job_id = self._create_completed_job()

        response = self.client.get(f"{APP_API_BASE_PATH}{job_id}/report-images-zip/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("application/zip", response["Content-Type"])

        with ZipFile(BytesIO(response.content), mode="r") as zip_file:
            member_names = zip_file.namelist()
            smiles_content = zip_file.read("generated_smiles.txt").decode("utf-8")
            smiles_lines = [
                line.strip()
                for line in smiles_content.splitlines()
                if line.strip() != ""
            ]

        self.assertIn("generated_smiles.txt", member_names)
        self.assertTrue(any(name.endswith(".svg") for name in member_names))
        self.assertGreaterEqual(len(smiles_lines), 1)
        self.assertEqual(smiles_lines[0], "c1ccccc1")
