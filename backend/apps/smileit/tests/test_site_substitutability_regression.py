"""test_site_substitutability_regression.py: regresión del falso positivo de caché.

Objetivo:
- Demostrar que `job_hash` sí distingue `r_substitutes` y que la caché nunca
  reutiliza resultados entre valores de `r`.
- Fijar la causa raíz del bug reportado ("3 runs de Smile-it con distinto
  `r_substitutes` devolvieron los mismos 24 derivados"): el cliente envía el
  SMILES principal sin canonicalizar junto con índices de sitio del espacio
  canónico (los que devuelve /inspect-structure). Al remapearlos el plugin por
  segunda vez, los sitios caían en átomos sin valencia libre y la generación se
  saturaba. El router normaliza ahora el principal al espacio canónico y rechaza
  sitios sin valencia libre.

Cómo se usa:
- `python manage.py test apps.smileit.tests.test_site_substitutability_regression`
"""

from __future__ import annotations

from typing import cast
from unittest import TestCase
from unittest.mock import patch

from apps.core.models import ScientificJob
from apps.core.services import JobService
from apps.core.test_utils import build_authenticated_api_client
from apps.core.types import JSONMap

from ..definitions import APP_API_BASE_PATH, DEFAULT_ALGORITHM_VERSION
from ..engine import (
    canonicalize_smiles,
    find_sites_without_free_valence,
    inspect_smiles_structure,
)
from ..plugin import smileit_plugin
from .test_seed import SmileitSeedTestCase

ROUTER_MODULE = "apps.smileit.routers.viewset_write"

# SMILES exacto del job reportado (no canónico).
RAW_PRINCIPAL = "c1(O)c(NCCC=C)c2c([nH]cc2)c([N+](=O)[O-])c1O"
# Índices tal y como los devuelve /inspect-structure: espacio canónico.
SELECTED_SITES = [2, 3, 7, 9]
# Sitios crudos del mismo SMILES que no admiten sustituyentes (C de fusión).
RAW_DEAD_SITES = [2, 9]
ROUTER_RAW_SITES = [1, 3, 4, 5]


def _manual_substituents() -> list[dict[str, object]]:
    """Sustituyentes manuales con anclaje en el primer átomo de cada SMILES."""
    return [
        {
            "name": "Phenyl",
            "smiles": "c1ccccc1",
            "anchor_atom_indices": [0],
            "categories": [],
        },
        {
            "name": "Hydroxy",
            "smiles": "[OH]",
            "anchor_atom_indices": [0],
            "categories": [],
        },
        {
            "name": "Amino",
            "smiles": "[NH2]",
            "anchor_atom_indices": [0],
            "categories": [],
        },
    ]


def _job_payload(r_substitutes: int, principal_smiles: str = RAW_PRINCIPAL) -> dict:
    """Payload HTTP equivalente al enviado por la UI para el job reportado."""
    return {
        "version": DEFAULT_ALGORITHM_VERSION,
        "principal_smiles": principal_smiles,
        "selected_atom_indices": list(ROUTER_RAW_SITES),
        "assignment_blocks": [
            {
                "label": "Block 1",
                "site_atom_indices": list(ROUTER_RAW_SITES),
                "category_keys": [],
                "substituent_refs": [],
                "manual_substituents": _manual_substituents(),
            }
        ],
        "site_overlap_policy": "last_block_wins",
        "r_substitutes": r_substitutes,
        "num_bonds": 1,
        "export_name_base": "REGRESSION",
        "export_padding": 5,
    }


def _plugin_parameters(
    principal_smiles: str,
    selected_atom_indices: list[int],
    r_substitutes: int,
) -> JSONMap:
    """Parámetros resueltos que recibe el plugin (sin pasar por el router)."""
    resolved_substituents: list[JSONMap] = [
        {
            "source_kind": "manual",
            "stable_id": str(substituent["name"]),
            "version": 1,
            "name": str(substituent["name"]),
            "smiles": str(substituent["smiles"]),
            "selected_atom_index": 0,
            "categories": ["regression"],
        }
        for substituent in _manual_substituents()
    ]
    return cast(
        JSONMap,
        {
            "version": DEFAULT_ALGORITHM_VERSION,
            "principal_smiles": principal_smiles,
            "selected_atom_indices": list(selected_atom_indices),
            "assignment_blocks": [
                {
                    "label": "Block 1",
                    "priority": 1,
                    "site_atom_indices": list(selected_atom_indices),
                    "resolved_substituents": resolved_substituents,
                }
            ],
            "r_substitutes": r_substitutes,
            "num_bonds": 1,
            "site_overlap_policy": "last_block_wins",
            "export_name_base": "REGRESSION",
            "export_padding": 5,
            "references": {},
        },
    )


def _run_plugin(parameters: JSONMap) -> JSONMap:
    """Ejecuta el plugin con callbacks no-op y devuelve el resultado."""
    return smileit_plugin(parameters, lambda *_args, **_kwargs: None, None)


class FindSitesWithoutFreeValenceTests(TestCase):
    """El helper de valencia marca sólo los átomos que no admiten sustituyentes."""

    def test_reported_principal_marks_aromatic_fusion_carbons(self) -> None:
        self.assertEqual(
            find_sites_without_free_valence(RAW_PRINCIPAL, RAW_DEAD_SITES),
            RAW_DEAD_SITES,
        )

    def test_reported_canonical_sites_are_all_substitutable(self) -> None:
        canonical_principal = canonicalize_smiles(RAW_PRINCIPAL)
        self.assertIsNotNone(canonical_principal)

        self.assertEqual(
            find_sites_without_free_valence(
                canonical_principal or "", list(SELECTED_SITES)
            ),
            [],
        )

    def test_heteroatom_with_explicit_hydrogen_is_substitutable(self) -> None:
        """El N del pirrol no tiene H implícito pero sí explícito: admite sustitución."""
        inspection = inspect_smiles_structure("c1cc[nH]c1")
        pyrrole_nitrogen = next(
            atom for atom in inspection["atoms"] if atom["symbol"] == "N"
        )

        self.assertEqual(pyrrole_nitrogen["implicit_hydrogens"], 0)
        self.assertTrue(pyrrole_nitrogen["is_substitutable"])

    def test_out_of_range_index_is_reported(self) -> None:
        self.assertEqual(find_sites_without_free_valence("CCO", [0, 999]), [999])

    def test_invalid_smiles_reports_every_site(self) -> None:
        self.assertEqual(
            find_sites_without_free_valence("NOT_A_SMILES", [0, 1]), [0, 1]
        )


class InspectionSubstitutabilityTests(TestCase):
    """El contrato de inspección expone `is_substitutable` para la UI."""

    def test_reported_principal_marks_fusion_carbons_as_non_substitutable(self) -> None:
        inspection = inspect_smiles_structure(RAW_PRINCIPAL)
        substitutable_by_index = {
            int(atom["index"]): bool(atom["is_substitutable"])
            for atom in inspection["atoms"]
        }

        self.assertFalse(substitutable_by_index[5])
        self.assertFalse(substitutable_by_index[14])
        self.assertTrue(substitutable_by_index[2])
        self.assertTrue(substitutable_by_index[3])
        self.assertTrue(substitutable_by_index[7])
        self.assertTrue(substitutable_by_index[9])


class PluginSiteValidationTests(TestCase):
    """El plugin rechaza sitios sin valencia libre en lugar de saturar en silencio."""

    def test_plugin_rejects_sites_without_free_valence(self) -> None:
        parameters = _plugin_parameters(RAW_PRINCIPAL, RAW_DEAD_SITES, r_substitutes=2)

        with self.assertRaises(ValueError) as context:
            _run_plugin(parameters)

        message = str(context.exception)
        self.assertIn("valencia libre", message)
        self.assertIn("[5, 14]", message)

    def test_plugin_runs_when_every_site_is_substitutable(self) -> None:
        canonical_principal = canonicalize_smiles(RAW_PRINCIPAL) or ""
        parameters = _plugin_parameters(
            canonical_principal, list(SELECTED_SITES), r_substitutes=2
        )

        result = _run_plugin(parameters)

        self.assertGreater(int(str(result["total_generated"])), 0)

    def test_plugin_clamps_rounds_to_available_sites_with_warning(self) -> None:
        """Pedir más rondas que sitios no añade trabajo: se avisa y se ajusta."""
        canonical_principal = canonicalize_smiles(RAW_PRINCIPAL) or ""
        two_sites = [2, 3]
        requested = _plugin_parameters(canonical_principal, two_sites, r_substitutes=5)
        expected = _plugin_parameters(canonical_principal, two_sites, r_substitutes=2)
        warnings: list[JSONMap] = []

        result = smileit_plugin(
            requested,
            lambda *_args, **_kwargs: None,
            lambda level, _source, _message, payload=None: (
                warnings.append(payload if payload is not None else {})
                if level == "warning"
                else None
            ),
        )

        self.assertEqual(
            int(str(result["total_generated"])),
            int(str(_run_plugin(expected)["total_generated"])),
        )
        clamp_warnings = [
            payload
            for payload in warnings
            if payload.get("effective_r_substitutes") == 2
        ]
        self.assertEqual(len(clamp_warnings), 1)
        self.assertEqual(clamp_warnings[0]["requested_r_substitutes"], 5)


class RouterCanonicalPrincipalTests(SmileitSeedTestCase):
    """El router normaliza el principal y con ello los sitios caen donde deben."""

    def setUp(self) -> None:
        self.client = build_authenticated_api_client()

    def _create_job(self, payload: dict) -> ScientificJob:
        with patch(f"{ROUTER_MODULE}.dispatch_scientific_job") as dispatch_mock:
            dispatch_mock.return_value = True
            response = self.client.post(APP_API_BASE_PATH, data=payload, format="json")

        self.assertEqual(response.status_code, 201, response.data)
        return ScientificJob.objects.get(pk=str(response.data["id"]))

    def test_router_stores_canonical_principal_for_raw_input(self) -> None:
        job = self._create_job(_job_payload(r_substitutes=2))

        self.assertEqual(
            job.parameters["principal_smiles"], canonicalize_smiles(RAW_PRINCIPAL)
        )
        self.assertEqual(job.parameters["selected_atom_indices"], [2, 3, 4, 7])

    def test_router_remaps_raw_sites_before_persisting_job(self) -> None:
        payload = _job_payload(r_substitutes=2)
        payload["selected_atom_indices"] = [1, 3, 4]
        payload["assignment_blocks"][0]["site_atom_indices"] = [1, 3, 4]

        job = self._create_job(payload)

        self.assertEqual(
            job.parameters["principal_smiles"], canonicalize_smiles(RAW_PRINCIPAL)
        )
        self.assertEqual(job.parameters["selected_atom_indices"], [3, 4, 7])
        self.assertEqual(
            job.parameters["assignment_blocks"][0]["site_atom_indices"], [3, 4, 7]
        )

    def test_different_r_substitutes_produce_different_hashes_and_results(self) -> None:
        """Regresión exacta: r=2,3,4 deben dar hashes y totales distintos."""
        jobs_by_r: dict[int, ScientificJob] = {}
        for r_substitutes in (2, 3, 4):
            jobs_by_r[r_substitutes] = self._create_job(
                _job_payload(r_substitutes=r_substitutes)
            )

        hashes = {job.job_hash for job in jobs_by_r.values()}
        self.assertEqual(len(hashes), 3)

        totals: list[int] = []
        for r_substitutes, job in jobs_by_r.items():
            JobService.run_job(str(job.id))
            refreshed_job = ScientificJob.objects.get(pk=job.id)
            self.assertEqual(refreshed_job.status, "completed")
            self.assertFalse(refreshed_job.cache_hit)
            self.assertEqual(
                int(refreshed_job.parameters["r_substitutes"]), r_substitutes
            )
            totals.append(int((refreshed_job.results or {})["total_generated"]))

        self.assertLess(totals[0], totals[1])
        self.assertLess(totals[1], totals[2])

    def test_cache_is_not_reused_across_r_substitutes(self) -> None:
        first_job = self._create_job(_job_payload(r_substitutes=2))
        JobService.run_job(str(first_job.id))

        same_parameters_job = self._create_job(_job_payload(r_substitutes=2))
        different_r_job = self._create_job(_job_payload(r_substitutes=3))

        self.assertTrue(same_parameters_job.cache_hit)
        self.assertFalse(different_r_job.cache_hit)

    def test_router_rejects_sites_without_free_valence(self) -> None:
        canonical_principal = canonicalize_smiles(RAW_PRINCIPAL) or ""
        payload = _job_payload(r_substitutes=1, principal_smiles=canonical_principal)
        payload["selected_atom_indices"] = [5]
        payload["assignment_blocks"][0]["site_atom_indices"] = [5]

        response = self.client.post(APP_API_BASE_PATH, data=payload, format="json")

        self.assertEqual(response.status_code, 409)
        self.assertIn("valencia libre", str(response.data["detail"]))

    def test_router_rejects_invalid_principal_smiles(self) -> None:
        payload = _job_payload(r_substitutes=1, principal_smiles="NOT_A_SMILES")

        response = self.client.post(APP_API_BASE_PATH, data=payload, format="json")

        self.assertEqual(response.status_code, 400)
