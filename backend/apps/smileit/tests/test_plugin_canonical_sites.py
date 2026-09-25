"""test_plugin_canonical_sites.py: Regresión del remapeo de sitios al espacio canónico.

Objetivo: cubre el fallo silencioso por el que Smile-it quedaba `completed` con
`total_generated=0` cuando `principal_smiles` no era canónico. Los índices de
sitio se eligen sobre el SMILES crudo y RDKit reordena los átomos al
canonicalizar: ahora se remapean al espacio canónico antes de resolver la
generación, y si algo no es remapeable el plugin falla en vez de generar 0.

Cómo se usa:
- `python manage.py test apps.smileit.tests.test_plugin_canonical_sites`
"""

from __future__ import annotations

from typing import cast
from unittest import TestCase

from apps.core.types import JSONMap

from ..engine import canonicalize_smiles
from ..plugin import (
    _canonicalize_principal_with_sites,
    _remap_assignment_blocks,
    _remap_sites_to_canonical_space,
    smileit_plugin,
)
from ..types import SmileitResolvedAssignmentBlock

# Indol no canónico: al canonicalizar, RDKit reordena los átomos y los sitios
# crudos [5, 18] corresponden a [2, 9] en el SMILES canónico.
RAW_INDOL = "c1(O)c(NCCC=C)c2c([nH]cc2)c([N+](=O)[O-])c1O"
RAW_SITES = [5, 18]
CANONICAL_SITES = [2, 9]
BENZENE = "c1ccccc1"

SUBSTITUENT_ROWS: tuple[tuple[str, str], ...] = (
    ("phenyl", "c1ccccc1"),
    ("hydroxy", "[OH]"),
    ("amino", "[NH2]"),
)


def _resolved_substituents() -> list[JSONMap]:
    """Sustituyentes resueltos tal y como los persiste el router (anclaje en 0)."""
    return [
        {
            "source_kind": "catalog",
            "stable_id": stable_id,
            "version": 1,
            "name": stable_id,
            "smiles": smiles,
            "selected_atom_index": 0,
            "categories": ["group"],
        }
        for stable_id, smiles in SUBSTITUENT_ROWS
    ]


def _build_parameters(
    principal_smiles: str,
    selected_atom_indices: list[int],
    blocks_sites: list[list[int]] | None = None,
    r_substitutes: int = 2,
) -> JSONMap:
    """Construye los parámetros serializados que recibe el plugin."""
    sites_lists = blocks_sites if blocks_sites is not None else [selected_atom_indices]
    blocks: list[JSONMap] = [
        {
            "label": f"block-{index}",
            "priority": index,
            "site_atom_indices": sites,
            "resolved_substituents": _resolved_substituents(),
        }
        for index, sites in enumerate(sites_lists, start=1)
    ]
    return {
        "version": "2.0.0",
        "principal_smiles": principal_smiles,
        "selected_atom_indices": selected_atom_indices,
        "assignment_blocks": blocks,
        "r_substitutes": r_substitutes,
        "num_bonds": 1,
        "allow_repeated": False,
        "max_structures": 0,
        "site_overlap_policy": "last_block_wins",
        "export_name_base": "SMILEIT_TEST",
        "export_padding": 5,
        "references": {},
    }


def _run_plugin(parameters: JSONMap) -> tuple[JSONMap, list[JSONMap]]:
    """Ejecuta el plugin y devuelve (resultado, payloads de logs emitidos)."""
    logged: list[JSONMap] = []

    def collect_log(
        _level: str,
        _source: str,
        _message: str,
        payload: JSONMap | None,
    ) -> None:
        logged.append(payload if payload is not None else {})

    result = smileit_plugin(
        parameters,
        lambda *_args, **_kwargs: None,
        collect_log,
    )
    return result, logged


def _remap_logs(logged: list[JSONMap]) -> list[JSONMap]:
    """Filtra los logs que informan del remapeo crudo→canónico."""
    return [payload for payload in logged if "canonical_sites" in payload]


def _total(result: JSONMap) -> int:
    """Total de derivados del resultado del plugin."""
    return int(str(result["total_generated"]))


def _generated_smiles(result: JSONMap) -> list[str]:
    """SMILES de los derivados, en el orden estable del motor."""
    structures = cast(list[JSONMap], result["generated_structures"])
    return [str(structure["smiles"]) for structure in structures]


class RemapSitesToCanonicalSpaceTests(TestCase):
    """El remapeo crudo→canónico es exacto e idempotente con entrada canónica."""

    def test_raw_indol_sites_are_remapped_to_canonical_positions(self) -> None:
        self.assertEqual(
            _remap_sites_to_canonical_space(RAW_INDOL, RAW_SITES, "test"),
            CANONICAL_SITES,
        )

    def test_canonical_principal_keeps_canonical_sites_unchanged(self) -> None:
        canonical_indol = canonicalize_smiles(RAW_INDOL) or ""

        self.assertEqual(
            _remap_sites_to_canonical_space(canonical_indol, CANONICAL_SITES, "test"),
            CANONICAL_SITES,
        )

    def test_benzene_first_site_is_idempotent(self) -> None:
        self.assertEqual(_remap_sites_to_canonical_space(BENZENE, [0], "test"), [0])

    def test_unordered_raw_sites_come_back_sorted(self) -> None:
        self.assertEqual(
            _remap_sites_to_canonical_space(RAW_INDOL, [18, 5], "test"),
            CANONICAL_SITES,
        )

    def test_out_of_range_site_raises_instead_of_being_dropped(self) -> None:
        with self.assertRaises(ValueError) as ctx:
            _remap_sites_to_canonical_space(RAW_INDOL, [5, 999], "selected_sites")

        message = str(ctx.exception)
        self.assertIn("selected_sites", message)
        self.assertIn("no se pudieron mapear", message)

    def test_blocks_are_remapped_without_touching_empty_blocks(self) -> None:
        blocks: list[SmileitResolvedAssignmentBlock] = [
            SmileitResolvedAssignmentBlock(
                label="empty",
                priority=1,
                site_atom_indices=[],
                resolved_substituents=[],
            ),
            SmileitResolvedAssignmentBlock(
                label="both",
                priority=2,
                site_atom_indices=list(RAW_SITES),
                resolved_substituents=[],
            ),
        ]

        remapped = _remap_assignment_blocks(RAW_INDOL, blocks)

        self.assertEqual(remapped[0]["site_atom_indices"], [])
        self.assertEqual(remapped[1]["site_atom_indices"], CANONICAL_SITES)
        # El bloque original no debe mutarse: se trabaja sobre copias.
        self.assertEqual(blocks[1]["site_atom_indices"], RAW_SITES)


class CanonicalizePrincipalWithSitesTests(TestCase):
    """La canonización devuelve el principal canónico y sus sitios remapeados."""

    def test_returns_canonical_smiles_with_canonical_sites(self) -> None:
        canonical_principal, canonical_sites = _canonicalize_principal_with_sites(
            RAW_INDOL, RAW_SITES
        )

        self.assertEqual(canonical_principal, canonicalize_smiles(RAW_INDOL))
        self.assertEqual(canonical_sites, CANONICAL_SITES)

    def test_empty_selected_sites_fails_explicitly(self) -> None:
        with self.assertRaises(ValueError):
            _canonicalize_principal_with_sites(BENZENE, [])

    def test_invalid_principal_keeps_the_original_message(self) -> None:
        with self.assertRaises(ValueError) as ctx:
            _canonicalize_principal_with_sites("SMILES-INVALIDO", [0])

        self.assertIn("SMILES principal inválido", str(ctx.exception))


class SmileitPluginCanonicalSitesTests(TestCase):
    """Regresión end-to-end del caso demostrado en producción."""

    def test_raw_sites_generate_as_many_derivatives_as_canonical_sites(self) -> None:
        """El caso del indol: sitios crudos [5,18] == sitios canónicos [2,9] > 0."""
        raw_result, _ = _run_plugin(
            _build_parameters(RAW_INDOL, list(RAW_SITES))
        )
        canonical_indol = canonicalize_smiles(RAW_INDOL) or ""
        canonical_result, _ = _run_plugin(
            _build_parameters(canonical_indol, list(CANONICAL_SITES))
        )

        self.assertGreater(_total(raw_result), 0)
        self.assertEqual(
            raw_result["total_generated"], canonical_result["total_generated"]
        )
        self.assertEqual(raw_result["selected_atom_indices"], CANONICAL_SITES)
        self.assertEqual(raw_result["principal_smiles"], canonical_indol)

    def test_remap_is_reported_in_logs_instead_of_failing_silently(self) -> None:
        _, logged = _run_plugin(_build_parameters(RAW_INDOL, list(RAW_SITES)))

        remap_rows = _remap_logs(logged)

        self.assertEqual(len(remap_rows), 1)
        self.assertEqual(remap_rows[0]["raw_sites"], RAW_SITES)
        self.assertEqual(remap_rows[0]["canonical_sites"], CANONICAL_SITES)

    def test_benzene_with_first_site_is_unchanged(self) -> None:
        """Benceno: el canónico es idéntico al crudo, así que nada cambia."""
        result, logged = _run_plugin(
            _build_parameters(BENZENE, [0], r_substitutes=1)
        )

        self.assertGreater(_total(result), 0)
        self.assertEqual(result["selected_atom_indices"], [0])
        self.assertEqual(result["principal_smiles"], BENZENE)
        self.assertEqual(_remap_logs(logged), [])

    def test_canonical_input_keeps_result_identical(self) -> None:
        """Un SMILES canónico con índices canónicos no cambia de resultado."""
        canonical_indol = canonicalize_smiles(RAW_INDOL) or ""
        canonical_result, canonical_logged = _run_plugin(
            _build_parameters(canonical_indol, list(CANONICAL_SITES))
        )
        raw_result, _ = _run_plugin(_build_parameters(RAW_INDOL, list(RAW_SITES)))

        self.assertEqual(canonical_result["principal_smiles"], canonical_indol)
        self.assertEqual(canonical_result["selected_atom_indices"], CANONICAL_SITES)
        self.assertEqual(_remap_logs(canonical_logged), [])
        self.assertEqual(
            _generated_smiles(canonical_result), _generated_smiles(raw_result)
        )

    def test_blocks_covering_raw_sites_remap_independently(self) -> None:
        """Cada bloque aporta sus sitios crudos: se remapean antes de cubrir."""
        result, _ = _run_plugin(
            _build_parameters(
                RAW_INDOL,
                list(RAW_SITES),
                blocks_sites=[[5], [18]],
            )
        )

        self.assertGreater(_total(result), 0)

    def test_unmappable_site_fails_instead_of_generating_zero(self) -> None:
        with self.assertRaises(ValueError) as ctx:
            _run_plugin(_build_parameters(RAW_INDOL, [5, 999]))

        self.assertIn("mapear", str(ctx.exception))

    def test_site_without_block_coverage_still_fails(self) -> None:
        """La cobertura se valida en espacio canónico: un sitio suelto se rechaza."""
        with self.assertRaises(ValueError) as ctx:
            _run_plugin(
                _build_parameters(RAW_INDOL, list(RAW_SITES), blocks_sites=[[5]])
            )

        self.assertIn("sin cobertura", str(ctx.exception))
