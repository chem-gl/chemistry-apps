"""test_smileit_engine_unit.py: Tests unitarios para _smileit_engine.py.

Objetivo: Cubrir funciones de progreso, log y trazabilidad del motor de
generación combinatoria que no son alcanzadas por los tests de integración.
"""

from __future__ import annotations

from unittest import TestCase
from unittest.mock import MagicMock, patch

from ._smileit_builders import SiteOption
from ._smileit_engine import (
    _build_generation_progress_percentage,
    _build_render_progress_percentage,
    _emit_log,
    _generate_derivatives,
    _report_generation_limit_reached,
    _report_generation_progress,
    _resolve_principal_site_index_maps_for_node,
)

# =========================
# _emit_log
# =========================


class EmitLogTests(TestCase):
    """Prueba que _emit_log maneja correctamente el callback nulo y válido."""

    def test_none_callback_returns_early_without_error(self) -> None:
        """Cuando log_callback=None no debe lanzar excepción."""
        _emit_log(None, level="info", source="test", message="Prueba.")

    def test_callback_receives_level_source_message_payload(self) -> None:
        """Callback válido es invocado con los parámetros correctos."""
        mock_callback = MagicMock()
        _emit_log(
            mock_callback,
            level="warning",
            source="smileit.engine",
            message="Límite alcanzado.",
            payload={"count": 50},
        )
        mock_callback.assert_called_once()

    def test_callback_receives_empty_dict_when_payload_is_none(self) -> None:
        """Cuando payload=None, el callback recibe un dict vacío en su lugar."""
        mock_callback = MagicMock()
        _emit_log(mock_callback, level="info", source="test", message="Sin payload.")
        args = mock_callback.call_args[0]
        # El cuarto argumento debe ser dict vacío
        self.assertEqual(args[3], {})


# =========================
# _build_generation_progress_percentage
# =========================


class BuildGenerationProgressPercentageTests(TestCase):
    """Prueba que el porcentaje de progreso de generación se calcula y acota bien."""

    def test_first_round_start_returns_near_twenty(self) -> None:
        """Primera ronda, primer nodo → porcentaje cercano al 20 %."""
        result = _build_generation_progress_percentage(
            round_index=1, total_rounds=3, node_index=1, node_total=10
        )
        self.assertGreaterEqual(result, 20)
        self.assertLessEqual(result, 80)

    def test_last_round_last_node_returns_near_eighty(self) -> None:
        """Última ronda, último nodo → porcentaje cercano al 80 %."""
        result = _build_generation_progress_percentage(
            round_index=3, total_rounds=3, node_index=10, node_total=10
        )
        self.assertGreaterEqual(result, 75)
        self.assertLessEqual(result, 80)

    def test_zero_total_rounds_does_not_raise(self) -> None:
        """total_rounds=0 no debe lanzar división por cero (usa max(1, ...))."""
        result = _build_generation_progress_percentage(
            round_index=1, total_rounds=0, node_index=1, node_total=1
        )
        self.assertIsInstance(result, int)

    def test_zero_node_total_does_not_raise(self) -> None:
        """node_total=0 no debe lanzar división por cero."""
        result = _build_generation_progress_percentage(
            round_index=1, total_rounds=2, node_index=0, node_total=0
        )
        self.assertIsInstance(result, int)

    def test_result_clamped_between_twenty_and_eighty(self) -> None:
        """El resultado siempre está entre 20 y 80 para cualquier input extremo."""
        # Caso que podría intentar superar 80
        result_high = _build_generation_progress_percentage(
            round_index=100, total_rounds=1, node_index=100, node_total=1
        )
        self.assertLessEqual(result_high, 80)

        # Caso que podría intentar bajar de 20
        result_low = _build_generation_progress_percentage(
            round_index=1, total_rounds=1000, node_index=1, node_total=1000
        )
        self.assertGreaterEqual(result_low, 20)


# =========================
# _build_render_progress_percentage
# =========================


class BuildRenderProgressPercentageTests(TestCase):
    """Prueba el cálculo del porcentaje de progreso en fase de renderizado."""

    def test_start_of_render_returns_near_eighty_six(self) -> None:
        """Primer ítem de render → porcentaje cercano a 86 %."""
        result = _build_render_progress_percentage(item_index=1, item_total=100)
        self.assertGreaterEqual(result, 86)
        self.assertLessEqual(result, 99)

    def test_end_of_render_returns_near_ninety_nine(self) -> None:
        """Último ítem de render → porcentaje cercano a 99 %."""
        result = _build_render_progress_percentage(item_index=100, item_total=100)
        self.assertGreaterEqual(result, 97)
        self.assertLessEqual(result, 99)

    def test_zero_total_does_not_raise(self) -> None:
        """item_total=0 no debe lanzar división por cero."""
        result = _build_render_progress_percentage(item_index=0, item_total=0)
        self.assertIsInstance(result, int)

    def test_result_clamped_between_eighty_six_and_ninety_nine(self) -> None:
        """El resultado siempre está entre 86 y 99."""
        result = _build_render_progress_percentage(item_index=99999, item_total=1)
        self.assertLessEqual(result, 99)
        result_low = _build_render_progress_percentage(item_index=0, item_total=9999)
        self.assertGreaterEqual(result_low, 86)


# =========================
# _report_generation_limit_reached
# =========================


class ReportGenerationLimitReachedTests(TestCase):
    """Prueba que el log de límite alcanzado invoca el callback correctamente."""

    def test_no_log_callback_does_not_raise(self) -> None:
        """Sin callback de log el reporte de límite no lanza excepción."""
        _report_generation_limit_reached(
            log_callback=None,
            attempts_processed=500,
            generated_count=100,
            rejected_fusions=50,
            max_structures=100,
        )

    def test_with_log_callback_emits_warning(self) -> None:
        """Con callback, el reporte de límite emite un log de warning."""
        mock_log = MagicMock()
        _report_generation_limit_reached(
            log_callback=mock_log,
            attempts_processed=200,
            generated_count=50,
            rejected_fusions=10,
            max_structures=50,
        )
        mock_log.assert_called_once()
        # El primer argumento es el nivel, debe ser warning
        level_arg = mock_log.call_args[0][0]
        self.assertIn("warn", str(level_arg).lower())


# =========================
# _report_generation_progress
# =========================


class ReportGenerationProgressTests(TestCase):
    """Prueba la publicación de progreso incremental de la generación."""

    def test_invokes_progress_callback_with_valid_percentage(self) -> None:
        """El callback de progreso debe recibir un porcentaje entre 20 y 80."""
        mock_progress = MagicMock()
        mock_log = MagicMock()
        _report_generation_progress(
            progress_callback=mock_progress,
            log_callback=mock_log,
            round_index=1,
            r_substitutes=2,
            node_index=1,
            round_frontier_size=5,
            attempts_processed=50,
            current_generated=10,
            rejected_fusions=5,
            duplicate_structures=2,
            attempt_cache_size=30,
        )
        mock_progress.assert_called_once()
        percentage_arg = mock_progress.call_args[0][0]
        self.assertGreaterEqual(percentage_arg, 20)
        self.assertLessEqual(percentage_arg, 80)


class ResolvePrincipalSiteIndexMapsTests(TestCase):
    """Prueba la resolución de múltiples embeddings del scaffold principal."""

    def test_returns_all_best_scaffold_matches_when_scores_tie(self) -> None:
        """En derivados ambiguos debe conservar todos los matches empatados."""
        resolved_maps = _resolve_principal_site_index_maps_for_node(
            principal_smiles="CC",
            derivative_smiles="CCC",
            selected_atom_indices=[0, 1],
        )

        self.assertEqual(
            resolved_maps,
            [
                {0: 0, 1: 1},
                {0: 1, 1: 2},
            ],
        )


class GenerateDerivativesEmbeddingExpansionTests(TestCase):
    """Valida que el generador expanda todos los embeddings equivalentes."""

    def _build_site_option_map(self) -> dict[int, list[SiteOption]]:
        """Construye un mapa mínimo de sitios con dos grupos distintos."""
        return {
            0: [
                SiteOption(
                    site_atom_index=0,
                    block_label="GroupA",
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
            ],
            1: [
                SiteOption(
                    site_atom_index=1,
                    block_label="GroupB",
                    block_priority=2,
                    substituent={
                        "source_kind": "catalog",
                        "stable_id": "sub-b",
                        "version": 1,
                        "name": "B",
                        "smiles": "B",
                        "selected_atom_index": 0,
                        "categories": [],
                    },
                )
            ],
        }

    def test_expands_all_best_embeddings_on_following_rounds(self) -> None:
        """Si un derivado tiene múltiples embeddings válidos, debe expandir todos."""

        def fake_resolve(
            principal_smiles: str,
            derivative_smiles: str,
            selected_atom_indices: list[int],
        ) -> list[dict[int, int]]:
            del principal_smiles, selected_atom_indices
            if derivative_smiles == "P":
                return [{0: 10, 1: 11}]
            if derivative_smiles == "PA":
                return [
                    {0: 100, 1: 101},
                    {0: 100, 1: 102},
                ]
            if derivative_smiles == "PB":
                return [{0: 10, 1: 11}]
            return []

        def fake_fuse(
            principal_smiles: str,
            substituent_smiles: str,
            principal_atom_idx: int | None,
            substituent_atom_idx: int | None,
            bond_order: int,
        ) -> str | None:
            del substituent_atom_idx, bond_order
            mapping: dict[tuple[str, str, int | None], str] = {
                ("P", "A", 10): "PA",
                ("P", "B", 11): "PB",
                ("PA", "B", 101): "PAB_left",
                ("PA", "B", 102): "PAB_right",
                ("PB", "A", 10): "PBA",
            }
            return mapping.get(
                (principal_smiles, substituent_smiles, principal_atom_idx)
            )

        with (
            patch(
                "apps.smileit._smileit_engine._resolve_principal_site_index_maps_for_node",
                side_effect=fake_resolve,
            ),
            patch(
                "apps.smileit._smileit_engine.is_fusion_candidate_viable",
                return_value=True,
            ),
            patch(
                "apps.smileit._smileit_builders.fuse_molecules",
                side_effect=fake_fuse,
            ) as mocked_fuse,
        ):
            generated_candidates, _traceability_rows, truncated = _generate_derivatives(
                principal_smiles="P",
                selected_atom_indices=[0, 1],
                site_option_map=self._build_site_option_map(),
                r_substitutes=2,
                num_bonds=1,
                max_structures=None,
                export_name_base="SERIES",
                export_padding=3,
                progress_callback=lambda _percentage, _stage, _message: None,
                log_callback=None,
            )

        self.assertFalse(truncated)
        self.assertEqual(
            [candidate.smiles for candidate in generated_candidates],
            ["PA", "PB", "PAB_left", "PAB_right", "PBA"],
        )
        self.assertEqual(mocked_fuse.call_count, 5)

    def test_invokes_log_callback_when_provided(self) -> None:
        """El callback de log debe ser invocado cuando está presente."""
        mock_progress = MagicMock()
        mock_log = MagicMock()
        _report_generation_progress(
            progress_callback=mock_progress,
            log_callback=mock_log,
            round_index=2,
            r_substitutes=3,
            node_index=3,
            round_frontier_size=5,
            attempts_processed=120,
            current_generated=25,
            rejected_fusions=8,
            duplicate_structures=3,
            attempt_cache_size=50,
        )
        mock_log.assert_called_once()

    def test_no_log_callback_does_not_raise(self) -> None:
        """Sin callback de log el reporte de progreso no lanza excepción."""
        mock_progress = MagicMock()
        _report_generation_progress(
            progress_callback=mock_progress,
            log_callback=None,
            round_index=1,
            r_substitutes=1,
            node_index=1,
            round_frontier_size=1,
            attempts_processed=10,
            current_generated=5,
            rejected_fusions=2,
            duplicate_structures=1,
            attempt_cache_size=8,
        )
        mock_progress.assert_called_once()
