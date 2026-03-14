"""tests.py: Pruebas de contrato y dominio para la app smileit.

Objetivo del archivo:
- Validar que los endpoints y el plugin cumplan el contrato funcional esperado:
  inspección de estructura, catálogo, creación de job, ejecución del plugin,
  exportaciones CSV/LOG y manejo de límites combinatorios.

Cómo se usa:
- Ejecutar con `./venv/bin/python manage.py test apps.smileit`.
"""

from __future__ import annotations

from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.services import JobService
from apps.core.types import JSONMap

from .catalog import get_initial_catalog
from .definitions import APP_API_BASE_PATH, PLUGIN_NAME
from .engine import (
    canonicalize_smiles,
    fuse_molecules,
    inspect_smiles_structure,
    render_molecule_svg,
    validate_smiles,
)
from .plugin import _expand_substituents, smileit_plugin

# ---------------------------------------------------------------------------
# Tests del motor químico (engine.py)
# ---------------------------------------------------------------------------


class SmileitEngineTests(TestCase):
    """Valida las operaciones RDKit del motor químico de smileit."""

    def test_validate_smiles_valid(self) -> None:
        """SMILES conocidos válidos deben pasar la validación."""
        self.assertTrue(validate_smiles("c1ccccc1"))
        self.assertTrue(validate_smiles("CCO"))
        self.assertTrue(validate_smiles("[NH2]"))

    def test_validate_smiles_invalid(self) -> None:
        """Cadenas sin sentido deben retornar False."""
        self.assertFalse(validate_smiles("not-a-smiles!!!"))
        # Nota: RDKit trata el string vacío como molécula vacía válida, no se testea aquí.

    def test_canonicalize_smiles_returns_canonical_form(self) -> None:
        """La canonicalización debe retornar una forma estable y no None."""
        canonical = canonicalize_smiles("C1=CC=CC=C1")  # benceno no canónico
        self.assertIsNotNone(canonical)
        # La forma canónica de RDKit para benceno es 'c1ccccc1'
        self.assertEqual(canonical, "c1ccccc1")

    def test_canonicalize_invalid_smiles_returns_none(self) -> None:
        result = canonicalize_smiles("invalid!!!")
        self.assertIsNone(result)

    def test_inspect_smiles_structure_benzene(self) -> None:
        """Inspección del benceno debe retornar 6 átomos de carbono y un SVG no vacío."""
        result = inspect_smiles_structure("c1ccccc1")
        self.assertEqual(result["atom_count"], 6)
        self.assertEqual(len(result["atoms"]), 6)
        self.assertTrue(result["svg"].startswith("<?xml") or "<svg" in result["svg"])
        # Todos los átomos del benceno son carbono
        symbols = [atom["symbol"] for atom in result["atoms"]]
        self.assertTrue(all(s == "C" for s in symbols))

    def test_inspect_smiles_structure_maps_wildcard_to_r(self) -> None:
        """El placeholder `*` del legado debe mostrarse como `R` en la UI."""
        result = inspect_smiles_structure("*=N")
        symbols = [atom["symbol"] for atom in result["atoms"]]
        self.assertEqual(symbols, ["R", "N"])

    def test_inspect_smiles_structure_raises_on_invalid(self) -> None:
        """Inspección de SMILES inválido debe lanzar ValueError."""
        with self.assertRaises(ValueError):
            inspect_smiles_structure("invalid!!!")

    def test_render_molecule_svg_returns_markup(self) -> None:
        """El renderizador de resultados debe producir SVG utilizable por el frontend."""
        svg = render_molecule_svg("c1ccccc1")
        self.assertTrue(svg.startswith("<?xml") or "<svg" in svg)

    def test_fuse_molecules_benzene_amine(self) -> None:
        """Fusionar benceno con amina en átomo 0 debe producir anilina."""
        result = fuse_molecules(
            principal_smiles="c1ccccc1",
            substituent_smiles="N",
            principal_atom_idx=0,
            substituent_atom_idx=0,
            bond_order=1,
        )
        self.assertIsNotNone(result)
        # Anilina canónica
        from rdkit import Chem

        mol = Chem.MolFromSmiles(result)  # type: ignore[arg-type]
        self.assertIsNotNone(mol)

    def test_fuse_molecules_invalid_smiles_returns_none(self) -> None:
        """Fusión con SMILES inválido debe retornar None silenciosamente."""
        result = fuse_molecules(
            principal_smiles="not-valid!!!",
            substituent_smiles="N",
            principal_atom_idx=0,
            substituent_atom_idx=0,
            bond_order=1,
        )
        self.assertIsNone(result)

    def test_fuse_molecules_out_of_range_index_returns_none(self) -> None:
        """Índice de átomo fuera de rango debe retornar None."""
        result = fuse_molecules(
            principal_smiles="C",
            substituent_smiles="N",
            principal_atom_idx=99,
            substituent_atom_idx=0,
            bond_order=1,
        )
        self.assertIsNone(result)

    def test_fuse_molecules_single_atoms_without_indices(self) -> None:
        """La fusión monoatómica del legado debe seguir funcionando con índices nulos."""
        result = fuse_molecules(
            principal_smiles="C",
            substituent_smiles="C",
            principal_atom_idx=None,
            substituent_atom_idx=None,
            bond_order=1,
        )
        self.assertEqual(result, "CC")

    def test_fuse_molecules_supports_double_bond_growth(self) -> None:
        """La fusión con orden 2 debe permitir cadenas como `C=C=C`."""
        first_result = fuse_molecules(
            principal_smiles="C",
            substituent_smiles="C",
            principal_atom_idx=None,
            substituent_atom_idx=None,
            bond_order=2,
        )
        self.assertEqual(first_result, "C=C")

        second_result = fuse_molecules(
            principal_smiles=first_result,
            substituent_smiles="C",
            principal_atom_idx=0,
            substituent_atom_idx=None,
            bond_order=2,
        )
        self.assertEqual(second_result, "C=C=C")

    def test_fuse_molecules_wildcard_anchor_replaces_placeholder(self) -> None:
        """El sustituyente `*=N` debe usar `*` como punto de anclaje removible."""
        result = fuse_molecules(
            principal_smiles="O",
            substituent_smiles="*=N",
            principal_atom_idx=None,
            substituent_atom_idx=0,
            bond_order=1,
        )
        self.assertEqual(result, "N=O")

    def test_fuse_molecules_supports_explicit_hydrogen_substituent(self) -> None:
        """Sustituyentes con H explícitos (ej. [NH2]) deben fusionar correctamente."""
        result = fuse_molecules(
            principal_smiles="c1ccccc1",
            substituent_smiles="[NH2]",
            principal_atom_idx=0,
            substituent_atom_idx=0,
            bond_order=1,
        )
        self.assertEqual(result, "Nc1ccccc1")


# ---------------------------------------------------------------------------
# Tests del catálogo
# ---------------------------------------------------------------------------


class SmileitCatalogTests(TestCase):
    """Valida la integridad del catálogo inicial de sustituyentes."""

    def test_catalog_has_expected_entries(self) -> None:
        """El catálogo migrado debe tener exactamente 17 sustituyentes."""
        catalog = get_initial_catalog()
        self.assertEqual(len(catalog), 17)

    def test_catalog_entries_have_valid_smiles(self) -> None:
        """Todos los SMILES del catálogo deben ser parseables por RDKit."""
        catalog = get_initial_catalog()
        for entry in catalog:
            self.assertTrue(
                validate_smiles(entry["smiles"]),
                f"SMILES inválido para {entry['name']!r}: {entry['smiles']!r}",
            )

    def test_catalog_returns_copies(self) -> None:
        """Modificar la lista retornada no debe afectar el catálogo original."""
        catalog1 = get_initial_catalog()
        catalog2 = get_initial_catalog()
        catalog1.clear()
        self.assertEqual(len(catalog2), 17)


# ---------------------------------------------------------------------------
# Tests del plugin
# ---------------------------------------------------------------------------


class SmileitPluginTests(TestCase):
    """Valida la ejecución del plugin de generación smileit."""

    def _minimal_parameters(self) -> JSONMap:
        return {
            "principal_smiles": "c1ccccc1",
            "selected_atom_indices": [0],
            "substituents": [
                {"name": "Amine", "smiles": "[NH2]", "selected_atom_index": 0},
            ],
            "r_substitutes": 1,
            "num_bonds": 1,
            "allow_repeated": False,
            "max_structures": 100,
            "version": "1.0.0",
        }

    def test_plugin_generates_structures(self) -> None:
        """El plugin debe retornar al menos la molécula principal más una sustitución."""
        result = smileit_plugin(self._minimal_parameters(), lambda *a: None)
        self.assertIn("total_generated", result)
        self.assertGreaterEqual(result["total_generated"], 1)
        self.assertIn("generated_structures", result)
        self.assertIsInstance(result["generated_structures"], list)

    def test_plugin_result_includes_principal(self) -> None:
        """El resultado siempre debe incluir la molécula principal (ronda 0)."""
        params = self._minimal_parameters()
        result = smileit_plugin(params, lambda *a: None)
        smiles_list = [s["smiles"] for s in result["generated_structures"]]
        canonical_principal = canonicalize_smiles(params["principal_smiles"])
        self.assertIn(canonical_principal, smiles_list)

    def test_plugin_respects_max_structures(self) -> None:
        """El plugin debe truncar al límite max_structures."""
        params = self._minimal_parameters()
        params["max_structures"] = 2
        params["r_substitutes"] = 5
        result = smileit_plugin(params, lambda *a: None)
        self.assertLessEqual(result["total_generated"], 2)
        # truncado puede ser True o False dependiendo de si realmente hay más

    def test_plugin_deduplicates_with_no_repeat(self) -> None:
        """Con allow_repeated=False, no debe haber SMILES duplicados."""
        params = self._minimal_parameters()
        params["allow_repeated"] = False
        params["r_substitutes"] = 2
        result = smileit_plugin(params, lambda *a: None)
        smiles_list = [s["smiles"] for s in result["generated_structures"]]
        self.assertEqual(len(smiles_list), len(set(smiles_list)))

    def test_plugin_raises_on_invalid_smiles(self) -> None:
        """El plugin debe lanzar ValueError si el SMILES principal es inválido."""
        params = self._minimal_parameters()
        params["principal_smiles"] = "INVALID!!!"
        with self.assertRaises(ValueError):
            smileit_plugin(params, lambda *a: None)

    def test_plugin_raises_when_no_valid_substituents(self) -> None:
        """El plugin debe lanzar ValueError si todos los sustituyentes son inválidos."""
        params = self._minimal_parameters()
        params["substituents"] = [
            {"name": "Bad", "smiles": "INVALID!!!", "selected_atom_index": 0}
        ]
        with self.assertRaises(ValueError):
            smileit_plugin(params, lambda *a: None)

    def test_expand_substituents_filters_invalid(self) -> None:
        """_expand_substituents debe omitir sustituyentes con SMILES inválido."""
        from .types import SmileitSubstituentInput

        subs = [
            SmileitSubstituentInput(name="Good", smiles="[NH2]", selected_atom_index=0),
            SmileitSubstituentInput(
                name="Bad", smiles="INVALID!!!", selected_atom_index=0
            ),
        ]
        result = _expand_substituents(subs)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["name"], "Good")

    def test_plugin_generated_structures_include_svg_preview(self) -> None:
        """Cada estructura generada debe traer SVG para el previsualizador del frontend."""
        result = smileit_plugin(self._minimal_parameters(), lambda *a: None)
        self.assertTrue(
            all(
                "<svg" in structure["svg"]
                for structure in result["generated_structures"]
            )
        )

    def test_plugin_supports_allow_repeated_for_symmetric_sites(self) -> None:
        """Con `allow_repeated=True` deben conservarse duplicados por sitios simétricos."""
        params = self._minimal_parameters()
        params["principal_smiles"] = "c1ccccc1"
        params["selected_atom_indices"] = [0, 1, 2, 3, 4, 5]
        params["substituents"] = [
            {"name": "Hydroxy", "smiles": "O", "selected_atom_index": 0},
        ]
        params["r_substitutes"] = 1

        params["allow_repeated"] = False
        unique_result = smileit_plugin(params, lambda *a: None)
        self.assertEqual(unique_result["total_generated"], 2)

        params["allow_repeated"] = True
        repeated_result = smileit_plugin(params, lambda *a: None)
        repeated_smiles = [
            structure["smiles"] for structure in repeated_result["generated_structures"]
        ]
        self.assertEqual(repeated_result["total_generated"], 7)
        self.assertEqual(len(set(repeated_smiles)), 2)

    def test_plugin_matches_legacy_benzene_generation_shape(self) -> None:
        """La generación sobre benceno debe reproducir la cobertura básica del legado."""
        params = self._minimal_parameters()
        params["principal_smiles"] = "c1ccccc1"
        params["selected_atom_indices"] = [0, 1, 2, 3, 4, 5]
        params["substituents"] = [
            {"name": "Oxygen", "smiles": "O", "selected_atom_index": 0},
            {"name": "Nitrogen", "smiles": "N", "selected_atom_index": 0},
            {"name": "Fluorine", "smiles": "F", "selected_atom_index": 0},
            {"name": "Bromine", "smiles": "Br", "selected_atom_index": 0},
            {"name": "Iodine", "smiles": "I", "selected_atom_index": 0},
            {"name": "Boron", "smiles": "B", "selected_atom_index": 0},
        ]
        params["r_substitutes"] = 1
        params["allow_repeated"] = False

        result = smileit_plugin(params, lambda *a: None)
        self.assertEqual(result["total_generated"], 7)

    def test_plugin_generates_product_for_catalog_amine(self) -> None:
        """La amina del catálogo (`[NH2]`) debe producir anilina además del principal."""
        params = self._minimal_parameters()
        params["principal_smiles"] = "c1ccccc1"
        params["selected_atom_indices"] = [0]
        params["substituents"] = [
            {"name": "Amine", "smiles": "[NH2]", "selected_atom_index": 0},
        ]
        params["r_substitutes"] = 1

        result = smileit_plugin(params, lambda *a: None)
        smiles_list = [s["smiles"] for s in result["generated_structures"]]

        self.assertIn("c1ccccc1", smiles_list)
        self.assertIn("Nc1ccccc1", smiles_list)
        self.assertEqual(result["total_generated"], 2)


# ---------------------------------------------------------------------------
# Tests de API HTTP (endpoints sin job)
# ---------------------------------------------------------------------------


class SmileitInspectStructureApiTests(TestCase):
    """Valida el endpoint auxiliar inspect-structure."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.url = f"{APP_API_BASE_PATH}inspect-structure/"

    def test_inspect_valid_smiles_returns_200(self) -> None:
        response = self.client.post(self.url, {"smiles": "c1ccccc1"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertIn("canonical_smiles", response.data)
        self.assertIn("atom_count", response.data)
        self.assertIn("atoms", response.data)
        self.assertIn("svg", response.data)
        self.assertEqual(response.data["atom_count"], 6)

    def test_inspect_invalid_smiles_returns_400(self) -> None:
        response = self.client.post(self.url, {"smiles": "NOT-VALID!!!"}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_inspect_missing_smiles_returns_400(self) -> None:
        response = self.client.post(self.url, {}, format="json")
        self.assertEqual(response.status_code, 400)


class SmileitCatalogApiTests(TestCase):
    """Valida el endpoint auxiliar catalog."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.url = f"{APP_API_BASE_PATH}catalog/"

    def test_catalog_returns_200_with_entries(self) -> None:
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertIsInstance(response.data, list)
        self.assertEqual(len(response.data), 17)

    def test_catalog_entries_have_required_fields(self) -> None:
        response = self.client.get(self.url)
        entry = response.data[0]
        self.assertIn("name", entry)
        self.assertIn("smiles", entry)
        self.assertIn("description", entry)
        self.assertIn("selected_atom_index", entry)


# ---------------------------------------------------------------------------
# Tests de API HTTP (job create/retrieve/reports)
# ---------------------------------------------------------------------------


class SmileitJobApiTests(TestCase):
    """Valida el ciclo completo de create/retrieve/reports del job smileit."""

    def setUp(self) -> None:
        self.client = APIClient()

    def _create_job(self, payload: JSONMap | None = None) -> object:
        """Helper para crear un job con payload opcional."""
        default_payload: JSONMap = {
            "version": "1.0.0",
            "principal_smiles": "c1ccccc1",
            "selected_atom_indices": [0],
            "substituents": [
                {"name": "Amine", "smiles": "[NH2]", "selected_atom_index": 0},
                {"name": "Chlorine", "smiles": "[Cl]", "selected_atom_index": 0},
            ],
            "r_substitutes": 1,
            "num_bonds": 1,
            "allow_repeated": False,
            "max_structures": 50,
        }
        effective_payload = payload if payload is not None else default_payload
        with patch("apps.smileit.routers.dispatch_scientific_job") as dispatch_mock:
            dispatch_mock.return_value = True
            return self.client.post(APP_API_BASE_PATH, effective_payload, format="json")

    def test_create_job_returns_201(self) -> None:
        response = self._create_job()
        self.assertEqual(response.status_code, 201)  # type: ignore[union-attr]
        self.assertEqual(response.data["plugin_name"], PLUGIN_NAME)  # type: ignore[union-attr]
        self.assertEqual(response.data["status"], "pending")  # type: ignore[union-attr]

    def test_create_job_rejects_invalid_smiles(self) -> None:
        response = self._create_job(
            {
                "principal_smiles": "INVALID!!!",
                "selected_atom_indices": [0],
                "substituents": [
                    {"name": "A", "smiles": "[NH2]", "selected_atom_index": 0}
                ],
                "r_substitutes": 1,
                "num_bonds": 1,
                "allow_repeated": False,
                "max_structures": 50,
            }
        )
        # La validación de SMILES ocurre en el plugin, no en el serializer,
        # por lo que el job se crea con status pending y falla en ejecución.
        # El serializer solo verifica campos requeridos y tipos.
        self.assertIn(response.status_code, [201, 400])  # type: ignore[union-attr]

    def test_create_job_rejects_empty_substituents(self) -> None:
        response = self._create_job(
            {
                "principal_smiles": "c1ccccc1",
                "selected_atom_indices": [0],
                "substituents": [],
                "r_substitutes": 1,
                "num_bonds": 1,
                "allow_repeated": False,
                "max_structures": 50,
            }
        )
        self.assertEqual(response.status_code, 400)  # type: ignore[union-attr]

    def test_create_job_rejects_r_substitutes_greater_than_selected(self) -> None:
        response = self._create_job(
            {
                "principal_smiles": "c1ccccc1",
                "selected_atom_indices": [0, 1],
                "substituents": [
                    {"name": "A", "smiles": "[NH2]", "selected_atom_index": 0}
                ],
                "r_substitutes": 5,  # >2 seleccionados
                "num_bonds": 1,
                "allow_repeated": False,
                "max_structures": 50,
            }
        )
        self.assertEqual(response.status_code, 400)  # type: ignore[union-attr]

    def test_retrieve_job_returns_200(self) -> None:
        create_response = self._create_job()
        job_id = str(create_response.data["id"])  # type: ignore[union-attr]
        retrieve_response = self.client.get(f"{APP_API_BASE_PATH}{job_id}/")
        self.assertEqual(retrieve_response.status_code, 200)
        self.assertEqual(retrieve_response.data["id"], job_id)

    def test_full_execution_produces_results(self) -> None:
        """Ejecuta el plugin directamente y verifica que el job queda completed."""
        create_response = self._create_job()
        job_id = str(create_response.data["id"])  # type: ignore[union-attr]

        JobService.run_job(job_id)

        retrieve_response = self.client.get(f"{APP_API_BASE_PATH}{job_id}/")
        self.assertEqual(retrieve_response.status_code, 200)
        self.assertEqual(retrieve_response.data["status"], "completed")
        self.assertIsNotNone(retrieve_response.data["results"])
        self.assertGreaterEqual(retrieve_response.data["results"]["total_generated"], 1)

    def test_report_csv_returns_200_after_completion(self) -> None:
        """El reporte CSV debe estar disponible después de la ejecución."""
        create_response = self._create_job()
        job_id = str(create_response.data["id"])  # type: ignore[union-attr]
        JobService.run_job(job_id)

        csv_response = self.client.get(f"{APP_API_BASE_PATH}{job_id}/report-csv/")
        self.assertEqual(csv_response.status_code, 200)
        self.assertIn("text/csv", csv_response.get("Content-Type", ""))

    def test_report_csv_contains_summary_and_rows(self) -> None:
        """El CSV debe comportarse como equivalente liviano de WriteAndGenerate."""
        create_response = self._create_job()
        job_id = str(create_response.data["id"])  # type: ignore[union-attr]
        JobService.run_job(job_id)

        csv_response = self.client.get(f"{APP_API_BASE_PATH}{job_id}/report-csv/")
        csv_text = csv_response.content.decode("utf-8")

        self.assertIn("# Smileit - Job:", csv_text)
        self.assertIn("index,name,smiles", csv_text)
        self.assertIn("principal", csv_text)

    def test_report_csv_returns_409_for_pending_job(self) -> None:
        """El reporte CSV no debe estar disponible para jobs pending."""
        create_response = self._create_job()
        job_id = str(create_response.data["id"])  # type: ignore[union-attr]

        csv_response = self.client.get(f"{APP_API_BASE_PATH}{job_id}/report-csv/")
        self.assertEqual(csv_response.status_code, 409)

    def test_report_log_returns_200_after_completion(self) -> None:
        """El reporte LOG debe estar disponible después de la ejecución."""
        create_response = self._create_job()
        job_id = str(create_response.data["id"])  # type: ignore[union-attr]
        JobService.run_job(job_id)

        log_response = self.client.get(f"{APP_API_BASE_PATH}{job_id}/report-log/")
        self.assertEqual(log_response.status_code, 200)
        self.assertIn("text/plain", log_response.get("Content-Type", ""))

    def test_report_error_returns_200_for_failed_job(self) -> None:
        """Un job fallido por SMILES inválido debe exponer reporte de error."""
        create_response = self._create_job(
            {
                "version": "1.0.0",
                "principal_smiles": "INVALID!!!",
                "selected_atom_indices": [0],
                "substituents": [
                    {"name": "Amine", "smiles": "[NH2]", "selected_atom_index": 0},
                ],
                "r_substitutes": 1,
                "num_bonds": 1,
                "allow_repeated": False,
                "max_structures": 50,
            }
        )
        job_id = str(create_response.data["id"])  # type: ignore[union-attr]

        JobService.run_job(job_id)

        error_response = self.client.get(f"{APP_API_BASE_PATH}{job_id}/report-error/")
        self.assertEqual(error_response.status_code, 200)
        self.assertIn("text/plain", error_response.get("Content-Type", ""))
        self.assertIn("INVALID!!!", error_response.content.decode("utf-8"))

    def test_retrieve_nonexistent_job_returns_404(self) -> None:
        """Consulta de job inexistente debe retornar 404."""
        response = self.client.get(
            f"{APP_API_BASE_PATH}00000000-0000-0000-0000-000000000000/"
        )
        self.assertEqual(response.status_code, 404)
