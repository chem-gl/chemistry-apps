"""test_generation_completeness.py: Tests de completitud de generación combinatoria.

Objetivo: verificar que el motor genera TODAS las permutaciones esperadas
en casos controlados y que el pipeline completo del plugin usa la cobertura
de los bloques (resolved_substituents) y no solo automatching.

Caso controlado: 2 sitios × 2 opciones por sitio, r=2.
- Ronda 1: desde el principal → 2 opciones × 2 sitios = 4 derivados (uno por par sitio-opción).
- Ronda 2: desde cada derivado de R1 → intenta el sitio restante con sus opciones.
  - PA1 (usó site0): puede añadir B1 o B2 en site1 → 2 nuevos.
  - PA2 (usó site0): puede añadir B1 o B2 en site1 → 2 nuevos.
  - PB1 (usó site1): puede añadir A1 o A2 en site0 → 2 nuevos.
  - PB2 (usó site1): puede añadir A1 o A2 en site0 → 2 nuevos.
  - Total R2: 8 derivados.
- Total esperado: 4 + 8 = 12 derivados, todos únicos si la fusión produce SMILES distintos.
"""

from __future__ import annotations

from unittest import TestCase
from unittest.mock import patch

from ..engine.builders import SiteOption, _build_site_option_map
from ..engine.generation import _generate_derivatives
from ..types import SmileitResolvedAssignmentBlock, SmileitResolvedSubstituent


def _make_resolved_substituent(
    *,
    stable_id: str,
    version: int = 1,
    name: str = "",
    smiles: str = "",
    selected_atom_index: int = 0,
    source_kind: str = "catalog",
) -> SmileitResolvedSubstituent:
    """Construye un sustituyente resuelto mínimo para tests."""
    return SmileitResolvedSubstituent(
        source_kind=source_kind,
        stable_id=stable_id,
        version=version,
        name=name or stable_id,
        smiles=smiles or f"X_{stable_id}",
        selected_atom_index=selected_atom_index,
        categories=[],
    )


def _build_controlled_site_option_map() -> dict[int, list[SiteOption]]:
    """2 sitios × 2 opciones por sitio con SMILES de sustituyente únicos."""
    return {
        0: [
            SiteOption(
                site_atom_index=0,
                block_label="BlockA",
                block_priority=1,
                substituent=_make_resolved_substituent(
                    stable_id="sub-a1",
                    name="A1",
                    smiles="SMILES_A1",
                ),
            ),
            SiteOption(
                site_atom_index=0,
                block_label="BlockA",
                block_priority=1,
                substituent=_make_resolved_substituent(
                    stable_id="sub-a2",
                    name="A2",
                    smiles="SMILES_A2",
                ),
            ),
        ],
        1: [
            SiteOption(
                site_atom_index=1,
                block_label="BlockB",
                block_priority=1,
                substituent=_make_resolved_substituent(
                    stable_id="sub-b1",
                    name="B1",
                    smiles="SMILES_B1",
                ),
            ),
            SiteOption(
                site_atom_index=1,
                block_label="BlockB",
                block_priority=1,
                substituent=_make_resolved_substituent(
                    stable_id="sub-b2",
                    name="B2",
                    smiles="SMILES_B2",
                ),
            ),
        ],
    }


class GenerateDerivativesCompletenessTests(TestCase):
    """Verifica que _generate_derivatives produce TODAS las permutaciones esperadas."""

    def _run_generation(
        self,
        site_option_map: dict[int, list[SiteOption]],
        r_substitutes: int = 2,
    ) -> list[str]:
        """Ejecuta generación con mocks controlados y devuelve lista de SMILES generados."""

        def fake_resolve(
            principal_smiles: str,
            derivative_smiles: str,
            selected_atom_indices: list[int],
        ) -> list[dict[int, int]]:
            """Resuelve sitios del principal en el derivado.

            Para el principal original, mapea identidad.
            Para derivados, mapea todos los sitios restantes a índices altos únicos.
            """
            del principal_smiles
            if derivative_smiles == "PRINCIPAL":
                return [{i: i for i in selected_atom_indices}]
            # Para derivados: todos los sitios siguen disponibles (mapeo identidad)
            return [{i: i for i in selected_atom_indices}]

        def fake_is_viable(
            principal_smiles: str,
            substituent_smiles: str,
            principal_atom_idx: int,
            substituent_atom_idx: int,
            bond_order: int,
        ) -> bool:
            """Todas las fusiones son viables en este test controlado."""
            return True

        def fake_fuse(
            principal_smiles: str,
            substituent_smiles: str,
            principal_atom_idx: int,
            substituent_atom_idx: int,
            bond_order: int,
        ) -> str | None:
            """Produce un SMILES único por combinación principal+sustituyente+sitio."""
            return f"{principal_smiles}+{substituent_smiles}@site{principal_atom_idx}"

        with (
            patch(
                "apps.smileit.engine.generation._resolve_principal_site_index_maps_for_node",
                side_effect=fake_resolve,
            ),
            patch(
                "apps.smileit.engine.generation.is_fusion_candidate_viable",
                side_effect=fake_is_viable,
            ),
            patch(
                "apps.smileit.engine.builders.fuse_molecules",
                side_effect=fake_fuse,
            ),
        ):
            selected_atom_indices = sorted(site_option_map.keys())
            candidates, rows, truncated = _generate_derivatives(
                principal_smiles="PRINCIPAL",
                selected_atom_indices=selected_atom_indices,
                site_option_map=site_option_map,
                r_substitutes=r_substitutes,
                num_bonds=1,
                export_name_base="TEST",
                export_padding=3,
                progress_callback=lambda _p, _s, _m: None,
                log_callback=None,
            )

        self.assertFalse(truncated, "No debe truncarse en generación completa")
        return [c.smiles for c in candidates]

    def test_r1_generates_one_derivative_per_site_option_pair(self) -> None:
        """Ronda 1: cada par (sitio, opción) produce un derivado único.

        2 sitios × 2 opciones = 4 derivados en R1.
        """
        smiles_list = self._run_generation(
            _build_controlled_site_option_map(),
            r_substitutes=1,
        )

        self.assertEqual(
            len(smiles_list),
            4,
            (
                f"Esperado: 4 derivados en R1 (2 sitios × 2 opciones). "
                f"Obtenido: {len(smiles_list)}. SMILES: {smiles_list}"
            ),
        )

    def test_r2_generates_all_permutations(self) -> None:
        """Rondas 1+2: todas las permutaciones de 1 y 2 sitios.

        R1: 4 derivados (uno por par sitio-opción).
        R2: desde cada derivado de R1, se intenta el sitio restante con sus 2 opciones.
        Total esperado: 4 + 8 = 12 derivados.
        """
        smiles_list = self._run_generation(
            _build_controlled_site_option_map(),
            r_substitutes=2,
        )

        # 4 (R1) + 8 (R2) = 12
        self.assertEqual(
            len(smiles_list),
            12,
            (
                f"Esperado: 12 derivados (4 en R1 + 8 en R2). "
                f"Obtenido: {len(smiles_list)}. SMILES: {smiles_list}"
            ),
        )

        # Verificar que no hay duplicados
        self.assertEqual(
            len(set(smiles_list)),
            len(smiles_list),
            ("No debe haber SMILES duplicados en el caso controlado"),
        )

    def test_r1_with_single_site_single_option(self) -> None:
        """Caso mínimo: 1 sitio × 1 opción → 1 derivado."""
        site_option_map: dict[int, list[SiteOption]] = {
            0: [
                SiteOption(
                    site_atom_index=0,
                    block_label="Block",
                    block_priority=1,
                    substituent=_make_resolved_substituent(
                        stable_id="sub-x",
                        name="X",
                        smiles="SMILES_X",
                    ),
                ),
            ],
        }
        smiles_list = self._run_generation(site_option_map, r_substitutes=1)

        self.assertEqual(len(smiles_list), 1)

    def test_r2_with_three_sites_two_options_each(self) -> None:
        """3 sitios × 2 opciones, r=2.

        R1: 3 sitios × 2 opciones = 6 derivados.
        R2: desde cada derivado de R1 (que usó 1 sitio), intenta los otros 2 sitios × 2 opciones.
            Cada derivado de R1 genera 2 sitios restantes × 2 opciones = 4 nuevos.
            Total R2: 6 × 4 = 24.
        Total: 6 + 24 = 30.
        """
        site_option_map: dict[int, list[SiteOption]] = {}
        for site_idx in range(3):
            site_option_map[site_idx] = [
                SiteOption(
                    site_atom_index=site_idx,
                    block_label=f"Block{site_idx}",
                    block_priority=1,
                    substituent=_make_resolved_substituent(
                        stable_id=f"sub-{site_idx}-{opt}",
                        name=f"S{site_idx}O{opt}",
                        smiles=f"SMILES_{site_idx}_{opt}",
                    ),
                )
                for opt in range(2)
            ]

        smiles_list = self._run_generation(site_option_map, r_substitutes=2)

        # R1: 6, R2: 6×4 = 24, total: 30
        self.assertEqual(
            len(smiles_list),
            30,
            (
                f"Esperado: 30 derivados (6 en R1 + 24 en R2). "
                f"Obtenido: {len(smiles_list)}."
            ),
        )


class BuildSiteOptionMapFromResolvedTests(TestCase):
    """Verifica que _build_site_option_map usa resolved_substituents correctamente."""

    def test_builds_options_from_resolved_substituents(self) -> None:
        """Cada resolved_substituent del bloque genera una SiteOption por sitio del bloque."""
        blocks: list[SmileitResolvedAssignmentBlock] = [
            SmileitResolvedAssignmentBlock(
                label="TestBlock",
                priority=1,
                site_atom_indices=[0, 1],
                resolved_substituents=[
                    _make_resolved_substituent(stable_id="ref-1", smiles="[OH]"),
                    _make_resolved_substituent(stable_id="ref-2", smiles="[NH2]"),
                ],
            ),
        ]

        site_option_map = _build_site_option_map(
            selected_atom_indices=[0, 1],
            assignment_blocks=blocks,
        )

        # 2 sitios × 2 sustituyentes = 4 opciones totales
        self.assertEqual(len(site_option_map[0]), 2)
        self.assertEqual(len(site_option_map[1]), 2)

    def test_empty_resolved_substituents_produces_empty_options(self) -> None:
        """Un bloque sin resolved_substituents no genera opciones."""
        blocks: list[SmileitResolvedAssignmentBlock] = [
            SmileitResolvedAssignmentBlock(
                label="EmptyBlock",
                priority=1,
                site_atom_indices=[0, 1],
                resolved_substituents=[],
            ),
        ]

        site_option_map = _build_site_option_map(
            selected_atom_indices=[0, 1],
            assignment_blocks=blocks,
        )

        self.assertEqual(len(site_option_map[0]), 0)
        self.assertEqual(len(site_option_map[1]), 0)

    def test_multiple_blocks_merge_options_per_site(self) -> None:
        """Dos bloques con sitios solapados acumulan opciones por sitio."""
        blocks: list[SmileitResolvedAssignmentBlock] = [
            SmileitResolvedAssignmentBlock(
                label="Block1",
                priority=1,
                site_atom_indices=[0],
                resolved_substituents=[
                    _make_resolved_substituent(stable_id="ref-a", smiles="A"),
                ],
            ),
            SmileitResolvedAssignmentBlock(
                label="Block2",
                priority=2,
                site_atom_indices=[0],
                resolved_substituents=[
                    _make_resolved_substituent(stable_id="ref-b", smiles="B"),
                ],
            ),
        ]

        site_option_map = _build_site_option_map(
            selected_atom_indices=[0],
            assignment_blocks=blocks,
        )

        self.assertEqual(len(site_option_map[0]), 2)

    def test_deduplicates_identical_substituents_across_blocks(self) -> None:
        """Sustituyentes idénticos (mismo stable_id, version, anchor, priority, label) se deduplican."""
        sub = _make_resolved_substituent(stable_id="ref-x", version=1, smiles="X")
        blocks: list[SmileitResolvedAssignmentBlock] = [
            SmileitResolvedAssignmentBlock(
                label="Block1",
                priority=1,
                site_atom_indices=[0],
                resolved_substituents=[sub],
            ),
            SmileitResolvedAssignmentBlock(
                label="Block1",
                priority=1,
                site_atom_indices=[0],
                resolved_substituents=[sub],
            ),
        ]

        site_option_map = _build_site_option_map(
            selected_atom_indices=[0],
            assignment_blocks=blocks,
        )

        # Mismo label, priority, stable_id, version, anchor → deduplicado
        self.assertEqual(len(site_option_map[0]), 1)


class PluginGenerationWithRealBlocksTests(TestCase):
    """Test de integración: plugin con resolved_substituents reales."""

    def test_plugin_generates_derivatives_from_resolved_substituents(self) -> None:
        """El plugin genera derivados usando resolved_substituents del bloque.

        Caso: benzene (c1ccccc1) con 2 sitios y 2 sustituyentes reales por sitio, r=2.
        """
        from ..plugin import smileit_plugin

        parameters: dict[str, object] = {
            "principal_smiles": "c1ccccc1",
            "selected_atom_indices": [0, 1],
            "assignment_blocks": [
                {
                    "label": "TestBlock",
                    "priority": 1,
                    "site_atom_indices": [0, 1],
                    "resolved_substituents": [
                        {
                            "source_kind": "manual",
                            "stable_id": "manual-oh",
                            "version": 1,
                            "name": "Hydroxyl",
                            "smiles": "[OH]",
                            "selected_atom_index": 0,
                            "categories": [],
                        },
                        {
                            "source_kind": "manual",
                            "stable_id": "manual-nh2",
                            "version": 1,
                            "name": "Amino",
                            "smiles": "[NH2]",
                            "selected_atom_index": 0,
                            "categories": [],
                        },
                    ],
                },
            ],
            "r_substitutes": 2,
            "num_bonds": 1,
            "site_overlap_policy": "last_block_wins",
            "export_name_base": "TEST",
            "export_padding": 3,
            "version": "2.0.1",
            "references": {},
        }

        progress_calls: list[tuple[int, str, str]] = []

        def capture_progress(percentage: int, stage: str, message: str) -> None:
            progress_calls.append((percentage, stage, message))

        result = smileit_plugin(parameters, capture_progress, None)

        total_generated = result["total_generated"]
        truncated = result["truncated"]

        self.assertFalse(truncated, "No debe truncarse en generación completa")
        self.assertGreater(
            total_generated,
            0,
            (
                f"Debe generar al menos 1 derivado. "
                f"Generados: {total_generated}. "
                f"Progress calls: {len(progress_calls)}"
            ),
        )

        # Con 2 sitios × 2 opciones, r=2, esperamos:
        # R1: 4 derivados (2 sitios × 2 opciones)
        # R2: desde cada derivado de R1, intenta el otro sitio con 2 opciones
        #     = 4 derivados de R1 × 2 opciones del sitio restante = 8
        # Pero algunos pueden ser duplicados por simetría del benzene
        # (OH en sitio 0 + NH2 en sitio 1 puede ser igual a NH2 en sitio 0 + OH en sitio 1)
        # Así que el mínimo esperado es 4 (R1) y el máximo es 12 (sin duplicados)
        self.assertGreaterEqual(
            total_generated,
            4,
            (f"Mínimo esperado: 4 derivados en R1. Obtenido: {total_generated}"),
        )
        self.assertLessEqual(
            total_generated,
            12,
            (
                f"Máximo esperado: 12 derivados (4 R1 + 8 R2). Obtenido: {total_generated}"
            ),
        )

    def test_plugin_with_zero_resolved_substituents_raises_coverage_error(self) -> None:
        """El plugin aborta si un sitio no tiene cobertura de resolved_substituents."""
        from ..plugin import smileit_plugin

        parameters: dict[str, object] = {
            "principal_smiles": "c1ccccc1",
            "selected_atom_indices": [0, 1],
            "assignment_blocks": [
                {
                    "label": "EmptyBlock",
                    "priority": 1,
                    "site_atom_indices": [0],
                    "resolved_substituents": [
                        {
                            "source_kind": "manual",
                            "stable_id": "manual-oh",
                            "version": 1,
                            "name": "Hydroxyl",
                            "smiles": "[OH]",
                            "selected_atom_index": 0,
                            "categories": [],
                        },
                    ],
                },
            ],
            "r_substitutes": 1,
            "num_bonds": 1,
            "site_overlap_policy": "last_block_wins",
            "export_name_base": "TEST",
            "export_padding": 3,
            "version": "2.0.1",
            "references": {},
        }

        def dummy_progress(percentage: int, stage: str, message: str) -> None:
            pass

        with self.assertRaises(ValueError) as ctx:
            smileit_plugin(parameters, dummy_progress, None)

        self.assertIn("cobertura", str(ctx.exception).lower())
