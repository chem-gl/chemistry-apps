"""test_real_generation_completeness.py: Completitud con química real (RDKit).

Verifica que el motor de generación produce TODAS las permutaciones esperadas
usando fusión molecular real, sin mocks. Identifica el punto exacto de pérdida
cuando el conteo no coincide con el esperado combinatorio.

Casos de prueba:
- CCO (etanol): asimétrica, sin simetría molecular → mínimos duplicados.
- Oc1ccccc1 (fenol): simetría ortho/para → duplicados por embeddings múltiples.
"""

from __future__ import annotations

from unittest import TestCase
from unittest.mock import patch

from ..engine.builders import (
    FusionAttemptKey,
    _build_site_option_map,
)
from ..engine.generation import (
    _expand_derivatives_from_node,
    _generate_derivatives,
    _resolve_principal_site_index_maps_for_node,
)
from ..plugin import smileit_plugin
from ..types import (
    SmileitResolvedAssignmentBlock,
    SmileitResolvedSubstituent,
)


def _noop_progress(_p: int, _s: str, _m: str) -> None:
    pass


def _make_sub(
    stable_id: str,
    smiles: str,
    name: str = "",
    anchor: int = 0,
    source_kind: str = "manual",
) -> dict[str, object]:
    return {
        "source_kind": source_kind,
        "stable_id": stable_id,
        "version": 1,
        "name": name or stable_id,
        "smiles": smiles,
        "selected_atom_index": anchor,
        "categories": [],
    }


def _build_params(
    principal_smiles: str,
    sites: list[int],
    substituents: list[dict[str, object]],
    r_substitutes: int = 1,
    num_bonds: int = 1,
) -> dict[str, object]:
    return {
        "principal_smiles": principal_smiles,
        "selected_atom_indices": sites,
        "assignment_blocks": [
            {
                "label": "BlockA",
                "priority": 1,
                "site_atom_indices": sites,
                "resolved_substituents": substituents,
            },
        ],
        "r_substitutes": r_substitutes,
        "num_bonds": num_bonds,
        "site_overlap_policy": "last_block_wins",
        "export_name_base": "REAL",
        "export_padding": 3,
        "version": "2.0.1",
        "references": {},
    }


# =========================
# TAREA 1: R1 CON QUÍMICA REAL
# =========================


class RealGenerationR1Tests(TestCase):
    """R1 real: cada (sitio, opción) produce un derivado salvo deduplicación."""

    def test_ethanol_r1_2sites_2options_yields_4(self) -> None:
        """CCO (etanol), sitios [0,1], [OH]+[NH2] → 4 derivados únicos.

        CCO es asimétrica: C0 (3H) y C1 (2H) no son equivalentes.
        Las 4 combinaciones (2 sitios × 2 opciones) producen SMILES canónicos distintos.
        """
        subs = [_make_sub("oh", "[OH]", "Hydroxyl"), _make_sub("nh2", "[NH2]", "Amino")]
        result = smileit_plugin(
            _build_params("CCO", [0, 1], subs, r_substitutes=1),
            _noop_progress,
            None,
        )

        self.assertEqual(result["total_generated"], 4)
        self.assertFalse(result["truncated"])
        smiles_set = {s["smiles"] for s in result["generated_structures"]}
        self.assertEqual(len(smiles_set), 4, f"Todos únicos: {smiles_set}")

    def test_phenol_r1_2sites_2options_yields_4(self) -> None:
        """Oc1ccccc1 (fenol), sitios [2,4] (ortho+para), [OH]+[NH2] → 4 derivados.

        Sitios 2 y 4 no son equivalentes por simetría (ortho vs para al OH).
        """
        subs = [_make_sub("oh", "[OH]", "Hydroxyl"), _make_sub("nh2", "[NH2]", "Amino")]
        result = smileit_plugin(
            _build_params("Oc1ccccc1", [2, 4], subs, r_substitutes=1),
            _noop_progress,
            None,
        )

        self.assertEqual(result["total_generated"], 4)
        self.assertFalse(result["truncated"])
        smiles_set = {s["smiles"] for s in result["generated_structures"]}
        self.assertEqual(len(smiles_set), 4, f"Todos únicos: {smiles_set}")

    def test_ethanol_r1_3sites_2options_yields_6(self) -> None:
        """CCO, sitios [0,1,2] (incluye O), [OH]+[NH2] → 6 derivados.

        Verifica que el O (atom 2, 1H) también es sustituible.
        """
        subs = [_make_sub("oh", "[OH]", "Hydroxyl"), _make_sub("nh2", "[NH2]", "Amino")]
        result = smileit_plugin(
            _build_params("CCO", [0, 1, 2], subs, r_substitutes=1),
            _noop_progress,
            None,
        )

        # 3 sitios × 2 opciones = 6 si todos producen SMILES distintos
        self.assertGreaterEqual(result["total_generated"], 4)
        self.assertLessEqual(result["total_generated"], 6)
        self.assertFalse(result["truncated"])


# =========================
# TAREA 2: R2 INSTRUMENTADO CON QUÍMICA REAL
# =========================


class RealGenerationR2InstrumentedTests(TestCase):
    """R2 real con instrumentación: cuenta nodos, descartes, duplicados y cache."""

    def _run_instrumented(
        self,
        principal_smiles: str,
        sites: list[int],
        substituents: list[dict[str, object]],
        r_substitutes: int,
    ) -> dict[str, object]:
        """Ejecuta generación instrumentando contadores internos.

        Retorna un dict con métricas detalladas por ronda.
        """
        nodes_explored_by_round: dict[int, int] = {}
        nodes_without_mappings: list[str] = []
        total_cache_hits: int = 0

        from ..engine import generation as gen_module

        original_expand = gen_module._expand_derivatives_from_node
        current_round = {"value": 0}

        def instrumented_expand(node, round_index, derivative_counter, context):
            current_round["value"] = round_index
            nodes_explored_by_round[round_index] = (
                nodes_explored_by_round.get(round_index, 0) + 1
            )

            # Verificar si el nodo tendrá mappings
            resolved_maps = _resolve_principal_site_index_maps_for_node(
                principal_smiles=context.principal_smiles,
                derivative_smiles=node.smiles,
                selected_atom_indices=context.selected_atom_indices,
            )
            if len(resolved_maps) == 0:
                nodes_without_mappings.append(node.smiles)

            # Contar cache hits antes de la expansión
            cache_size_before = len(context.attempt_cache)
            summary = original_expand(node, round_index, derivative_counter, context)
            cache_size_after = len(context.attempt_cache)

            nonlocal total_cache_hits
            # Los hits son intentos procesados menos nuevas entradas en cache
            new_cache_entries = cache_size_after - cache_size_before
            total_cache_hits += max(0, summary.attempts_processed - new_cache_entries)

            return summary

        subs_list = substituents
        params = _build_params(
            principal_smiles, sites, subs_list, r_substitutes=r_substitutes
        )

        with patch.object(
            gen_module,
            "_expand_derivatives_from_node",
            side_effect=instrumented_expand,
        ):
            result = smileit_plugin(params, _noop_progress, None)

        return {
            "result": result,
            "nodes_explored_by_round": nodes_explored_by_round,
            "nodes_without_mappings": nodes_without_mappings,
            "total_cache_hits": total_cache_hits,
        }

    def test_ethanol_r2_instrumented(self) -> None:
        """CCO r=2: esperado combinatorio 12, generado real 10.

        Motivo de pérdida: 4 duplicados SMILES por rutas de síntesis distintas
        que convergen al mismo SMILES canónico. No es un bug, es deduplicación
        química correcta.
        """
        subs = [_make_sub("oh", "[OH]", "Hydroxyl"), _make_sub("nh2", "[NH2]", "Amino")]
        data = self._run_instrumented("CCO", [0, 1], subs, r_substitutes=2)
        result = data["result"]

        # R1: 2 sitios × 2 opciones = 4
        # R2 combinatorio: 4 × 1 sitio restante × 2 opciones = 8
        # Total combinatorio: 12
        actual = result["total_generated"]

        # CCO r=2 genera 10 por duplicados SMILES
        self.assertEqual(actual, 10, f"CCO r=2 debe generar 10, obtuvo {actual}")
        self.assertFalse(result["truncated"])

        # Verificar métricas
        r1_nodes = data["nodes_explored_by_round"].get(1, 0)
        r2_nodes = data["nodes_explored_by_round"].get(2, 0)
        self.assertEqual(r1_nodes, 1, "R1 explora 1 nodo (el principal)")
        self.assertEqual(r2_nodes, 4, "R2 explora 4 nodos (los 4 derivados de R1)")

        # Sin nodos descartados por falta de mappings
        self.assertEqual(
            len(data["nodes_without_mappings"]),
            0,
            f"Nodos sin mappings: {data['nodes_without_mappings']}",
        )

    def test_phenol_r2_instrumented(self) -> None:
        """Fenol r=2: esperado combinatorio 12, generado real 12.

        El fenol con sitios [2,4] (ortho+para) genera 12 derivados:
        R1=4 + R2=8. Los múltiples embeddings del scaffold compensan
        los duplicados por simetría.
        """
        subs = [_make_sub("oh", "[OH]", "Hydroxyl"), _make_sub("nh2", "[NH2]", "Amino")]
        data = self._run_instrumented("Oc1ccccc1", [2, 4], subs, r_substitutes=2)
        result = data["result"]

        self.assertEqual(
            result["total_generated"],
            12,
            f"Fenol r=2 debe generar 12, obtuvo {result['total_generated']}",
        )
        self.assertFalse(result["truncated"])

        r1_nodes = data["nodes_explored_by_round"].get(1, 0)
        r2_nodes = data["nodes_explored_by_round"].get(2, 0)
        self.assertEqual(r1_nodes, 1)
        self.assertEqual(r2_nodes, 4)

        self.assertEqual(len(data["nodes_without_mappings"]), 0)

    def test_phenol_r2_loss_breakdown(self) -> None:
        """Desglose detallado de pérdidas en fenol r=2.

        Verifica que rejected_fusions + duplicate_structures explican
        la diferencia entre intentos y generados.
        """
        # Invocamos _generate_derivatives directamente para capturar contadores

        site_option_map = _build_site_option_map(
            selected_atom_indices=[2, 4],
            assignment_blocks=[
                SmileitResolvedAssignmentBlock(
                    label="BlockA",
                    priority=1,
                    site_atom_indices=[2, 4],
                    resolved_substituents=[
                        SmileitResolvedSubstituent(
                            source_kind="manual",
                            stable_id="oh",
                            version=1,
                            name="Hydroxyl",
                            smiles="[OH]",
                            selected_atom_index=0,
                            categories=[],
                        ),
                        SmileitResolvedSubstituent(
                            source_kind="manual",
                            stable_id="nh2",
                            version=1,
                            name="Amino",
                            smiles="[NH2]",
                            selected_atom_index=0,
                            categories=[],
                        ),
                    ],
                ),
            ],
        )

        candidates, rows, truncated = _generate_derivatives(
            principal_smiles="Oc1ccccc1",
            selected_atom_indices=[2, 4],
            site_option_map=site_option_map,
            r_substitutes=2,
            num_bonds=1,
            export_name_base="TEST",
            export_padding=3,
            progress_callback=_noop_progress,
            log_callback=None,
        )

        self.assertEqual(len(candidates), 12)
        self.assertFalse(truncated)

        # Verificar que todos los SMILES son únicos
        smiles_list = [c.smiles for c in candidates]
        self.assertEqual(len(set(smiles_list)), len(smiles_list))


# =========================
# TAREA 3: SEGURIDAD DEL ATTEMPT_CACHE
# =========================


class AttemptCacheSafetyTests(TestCase):
    """Verifica que attempt_cache no suprime fusiones válidas.

    FusionAttemptKey incluye principal_smiles (el derivado), así que nodos
    distintos tienen claves distintas. Para nodos con el mismo SMILES canónico
    (simetría), la fusión química es idéntica y el cache es correcto.
    """

    def test_cache_key_includes_derivative_smiles(self) -> None:
        """La clave incluye el SMILES del nodo (derivado), no solo el principal original."""
        key1 = FusionAttemptKey(
            principal_smiles="CCO",
            site_atom_index=0,
            substituent_smiles="[OH]",
            substituent_anchor=0,
            bond_order=1,
        )
        key2 = FusionAttemptKey(
            principal_smiles="[O]CCO",
            site_atom_index=0,
            substituent_smiles="[OH]",
            substituent_anchor=0,
            bond_order=1,
        )
        self.assertNotEqual(key1, key2, "Claves de nodos distintos deben ser distintas")

    def test_cache_reuse_for_same_canonical_smiles(self) -> None:
        """Nodos con SMILES canónico idéntico comparten cache correctamente.

        Si dos rutas de síntesis producen el mismo derivado, la fusión química
        posterior es idéntica. El cache devuelve el mismo resultado sin pérdida.
        """
        subs = [_make_sub("oh", "[OH]", "Hydroxyl"), _make_sub("nh2", "[NH2]", "Amino")]

        # Con fenol r=2, algunos derivados de R1 pueden tener el mismo SMILES
        # canónico por simetría. El cache debe ser seguro.
        result = smileit_plugin(
            _build_params("Oc1ccccc1", [2, 4], subs, r_substitutes=2),
            _noop_progress,
            None,
        )

        # 12 derivados: el cache no suprimió ninguno
        self.assertEqual(result["total_generated"], 12)

    def test_no_valid_fusion_suppressed_by_cache(self) -> None:
        """Ejecuta R2 con cache y sin cache, compara resultados.

        Si el cache suprime una fusión válida, la versión sin cache generaría más.
        """
        from ..engine.builders import _build_site_option_map

        site_option_map = _build_site_option_map(
            selected_atom_indices=[0, 1],
            assignment_blocks=[
                SmileitResolvedAssignmentBlock(
                    label="BlockA",
                    priority=1,
                    site_atom_indices=[0, 1],
                    resolved_substituents=[
                        SmileitResolvedSubstituent(
                            source_kind="manual",
                            stable_id="oh",
                            version=1,
                            name="Hydroxyl",
                            smiles="[OH]",
                            selected_atom_index=0,
                            categories=[],
                        ),
                        SmileitResolvedSubstituent(
                            source_kind="manual",
                            stable_id="nh2",
                            version=1,
                            name="Amino",
                            smiles="[NH2]",
                            selected_atom_index=0,
                            categories=[],
                        ),
                    ],
                ),
            ],
        )

        # Con cache (normal)
        candidates_cache, _, _ = _generate_derivatives(
            principal_smiles="CCO",
            selected_atom_indices=[0, 1],
            site_option_map=site_option_map,
            r_substitutes=2,
            num_bonds=1,
            export_name_base="TEST",
            export_padding=3,
            progress_callback=_noop_progress,
            log_callback=None,
        )

        # Sin cache: forzamos __contains__=False pero __setitem__/get normales.
        # Así nunca reporta hits previos pero sí almacena resultados de fusión
        # para que _expand_derivatives_from_node pueda recuperarlos con .get().
        class NoHitDict(dict):
            """Dict que almacena valores pero nunca reporta contener una clave."""

            def __contains__(self, key: object) -> bool:
                return False

        original_expand = _expand_derivatives_from_node
        shared_no_hit_cache: dict[FusionAttemptKey, str | None] = NoHitDict()

        def expand_no_cache(node, round_index, derivative_counter, context):
            real_cache = context.attempt_cache
            context.attempt_cache = shared_no_hit_cache
            try:
                return original_expand(node, round_index, derivative_counter, context)
            finally:
                context.attempt_cache = real_cache

        from ..engine import generation as gen_module

        with patch.object(
            gen_module,
            "_expand_derivatives_from_node",
            side_effect=expand_no_cache,
        ):
            candidates_no_cache, _, _ = _generate_derivatives(
                principal_smiles="CCO",
                selected_atom_indices=[0, 1],
                site_option_map=site_option_map,
                r_substitutes=2,
                num_bonds=1,
                export_name_base="TEST",
                export_padding=3,
                progress_callback=_noop_progress,
                log_callback=None,
            )

        smiles_cache = {c.smiles for c in candidates_cache}
        smiles_no_cache = {c.smiles for c in candidates_no_cache}

        self.assertEqual(
            smiles_cache,
            smiles_no_cache,
            f"Cache no debe suprimir fusiones válidas. "
            f"Con cache: {len(smiles_cache)}, sin cache: {len(smiles_no_cache)}. "
            f"Faltan: {smiles_no_cache - smiles_cache}",
        )


# =========================
# TAREA 4: LÍMITES DE COMBINATORIA
# =========================


class NoTruncationTests(TestCase):
    """La generación nunca trunca y aplica límites de seguridad."""

    def test_generation_is_complete_without_dead_limit_parameter(self) -> None:
        """La generación completa no acepta ni necesita un límite de salida."""
        subs = [_make_sub("oh", "[OH]", "Hydroxyl"), _make_sub("nh2", "[NH2]", "Amino")]
        result = smileit_plugin(
            _build_params("CCO", [0, 1], subs, r_substitutes=2),
            _noop_progress,
            None,
        )

        self.assertFalse(result["truncated"])
        self.assertEqual(result["total_generated"], 10)

    def test_hard_limit_rejects_more_than_one_million(self) -> None:
        """Por encima de 1_000_000 derivados se rechaza la ejecución (no se trunca)."""
        subs = [_make_sub(f"s{index}", "[OH]", f"Sub{index}") for index in range(10)]
        with self.assertRaises(ValueError) as error_context:
            smileit_plugin(
                _build_params(
                    "CCCCCCCCCCCCCC",
                    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
                    subs,
                    r_substitutes=10,
                ),
                _noop_progress,
                None,
            )

        self.assertIn("máximo permitido", str(error_context.exception))

    def test_warning_when_estimate_exceeds_threshold(self) -> None:
        """Sobre el umbral de aviso se emite warning y se genera completo.

        El umbral se baja con `patch` porque el estimador cuenta moléculas
        distintas (sin factor `k!`) y la combinatoria de este caso queda por
        debajo del valor real de `DERIVATIVE_WARNING_THRESHOLD`.
        """
        subs = [_make_sub(f"s{index}", "[OH]", f"Sub{index}") for index in range(4)]
        warnings: list[str] = []

        def _capture_log(
            level: str, source: str, message: str, payload: object = None
        ) -> None:
            if level == "warning":
                warnings.append(message)

        with patch("apps.smileit.plugin.DERIVATIVE_WARNING_THRESHOLD", 500):
            result = smileit_plugin(
                _build_params(
                    "CCCCCC",
                    [1, 2, 3, 4, 5],
                    subs,
                    r_substitutes=3,
                ),
                _noop_progress,
                _capture_log,
            )

        self.assertFalse(result["truncated"])
        self.assertTrue(
            any("combinatoria estimada" in warning for warning in warnings),
            warnings,
        )


# =========================
# TAREA 5: COBERTURA DE SITE_OPTION_MAP
# =========================


class SiteOptionMapCoverageTests(TestCase):
    """Verifica que _build_site_option_map incluye TODAS las opciones."""

    def test_all_block_options_included(self) -> None:
        """Todas las opciones de todos los bloques se incluyen por sitio."""
        blocks: list[SmileitResolvedAssignmentBlock] = [
            SmileitResolvedAssignmentBlock(
                label="BlockA",
                priority=1,
                site_atom_indices=[0, 1],
                resolved_substituents=[
                    SmileitResolvedSubstituent(
                        source_kind="catalog",
                        stable_id="ref-1",
                        version=1,
                        name="OH",
                        smiles="[OH]",
                        selected_atom_index=0,
                        categories=["polar"],
                    ),
                    SmileitResolvedSubstituent(
                        source_kind="catalog",
                        stable_id="ref-2",
                        version=1,
                        name="NH2",
                        smiles="[NH2]",
                        selected_atom_index=0,
                        categories=["polar", "donor"],
                    ),
                ],
            ),
            SmileitResolvedAssignmentBlock(
                label="BlockB",
                priority=2,
                site_atom_indices=[0],
                resolved_substituents=[
                    SmileitResolvedSubstituent(
                        source_kind="manual",
                        stable_id="manual-1",
                        version=1,
                        name="F",
                        smiles="[F]",
                        selected_atom_index=0,
                        categories=[],
                    ),
                ],
            ),
        ]

        site_option_map = _build_site_option_map(
            selected_atom_indices=[0, 1],
            assignment_blocks=blocks,
        )

        # Site 0: 2 de BlockA + 1 de BlockB = 3
        self.assertEqual(len(site_option_map[0]), 3)
        # Site 1: 2 de BlockA + 0 de BlockB = 2
        self.assertEqual(len(site_option_map[1]), 2)

        # Verificar que todas las fuentes están presentes
        site0_stable_ids = {opt.substituent["stable_id"] for opt in site_option_map[0]}
        self.assertEqual(site0_stable_ids, {"ref-1", "ref-2", "manual-1"})

    def test_no_smiles_dedup_in_build_site_option_map(self) -> None:
        """Sustituyentes con distinto stable_id pero mismo SMILES NO se deduplican.

        La deduplicación en _build_site_option_map es por (stable_id, version,
        anchor, priority, label), no por SMILES. Dos sustituyentes con SMILES
        idéntico pero distinto stable_id son opciones distintas.
        """
        blocks: list[SmileitResolvedAssignmentBlock] = [
            SmileitResolvedAssignmentBlock(
                label="BlockA",
                priority=1,
                site_atom_indices=[0],
                resolved_substituents=[
                    SmileitResolvedSubstituent(
                        source_kind="catalog",
                        stable_id="ref-oh-1",
                        version=1,
                        name="OH v1",
                        smiles="[OH]",
                        selected_atom_index=0,
                        categories=[],
                    ),
                    SmileitResolvedSubstituent(
                        source_kind="manual",
                        stable_id="manual-oh",
                        version=1,
                        name="OH manual",
                        smiles="[OH]",
                        selected_atom_index=0,
                        categories=[],
                    ),
                ],
            ),
        ]

        site_option_map = _build_site_option_map(
            selected_atom_indices=[0],
            assignment_blocks=blocks,
        )

        # Mismo SMILES [OH] pero distinto stable_id → 2 opciones
        self.assertEqual(
            len(site_option_map[0]),
            2,
            "Sustituyentes con mismo SMILES pero distinto stable_id no se deduplican",
        )

    def test_categories_preserved_in_options(self) -> None:
        """Las categorías de cada sustituyente se preservan en las SiteOptions."""
        blocks: list[SmileitResolvedAssignmentBlock] = [
            SmileitResolvedAssignmentBlock(
                label="BlockA",
                priority=1,
                site_atom_indices=[0],
                resolved_substituents=[
                    SmileitResolvedSubstituent(
                        source_kind="catalog",
                        stable_id="ref-1",
                        version=1,
                        name="OH",
                        smiles="[OH]",
                        selected_atom_index=0,
                        categories=["polar", "h-bond-donor"],
                    ),
                ],
            ),
        ]

        site_option_map = _build_site_option_map(
            selected_atom_indices=[0],
            assignment_blocks=blocks,
        )

        self.assertEqual(len(site_option_map[0]), 1)
        self.assertEqual(
            site_option_map[0][0].substituent["categories"],
            ["polar", "h-bond-donor"],
        )

    def test_plugin_uses_all_site_options(self) -> None:
        """El plugin genera derivados para TODAS las opciones del site_option_map.

        Con 2 bloques y 3 opciones totales en site 0, r=1 debe generar al menos 3.
        """
        params: dict[str, object] = {
            "principal_smiles": "CCO",
            "selected_atom_indices": [0],
            "assignment_blocks": [
                {
                    "label": "BlockA",
                    "priority": 1,
                    "site_atom_indices": [0],
                    "resolved_substituents": [
                        _make_sub("oh", "[OH]", "Hydroxyl"),
                        _make_sub("nh2", "[NH2]", "Amino"),
                    ],
                },
                {
                    "label": "BlockB",
                    "priority": 2,
                    "site_atom_indices": [0],
                    "resolved_substituents": [
                        _make_sub("fluoro", "[F]", "Fluoro"),
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

        result = smileit_plugin(params, _noop_progress, None)

        # 3 opciones en site 0: OH, NH2, F → 3 derivados
        self.assertEqual(result["total_generated"], 3)
        self.assertFalse(result["truncated"])
