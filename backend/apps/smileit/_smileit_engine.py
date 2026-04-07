"""_smileit_engine.py: Motor de generación combinatoria y progreso para Smile-it.

Objetivo: contener las funciones de progreso/log, materialización de resultados
y el bucle principal de generación de derivados por rondas de sustitución.
Importa estructuras de datos y utilidades desde _smileit_builders.
"""

from __future__ import annotations

from typing import Final, cast

from apps.core.types import JSONMap, PluginLogCallback, PluginProgressCallback

from ._smileit_builders import (
    ExpansionContext,
    ExpansionSummary,
    FusionAttemptKey,
    GeneratedCandidate,
    GeneratedNode,
    PendingFusionAttempt,
    SiteOption,
    _build_pending_fusion_attempts,
    _build_placeholder_assignments,
    _build_structure_name,
    _resolve_pending_fusion_attempts,
    _sort_traceability_events,
)
from .engine import (
    _score_principal_match_for_sites,
    is_fusion_candidate_viable,
    parse_smiles_cached,
)
from .types import (
    SmileitGeneratedStructure,
    SmileitSubstitutionTraceEvent,
    SmileitTraceabilityRow,
)

SMILEIT_LOG_SOURCE: Final[str] = "smileit.plugin"
LOG_PROGRESS_BATCH_SIZE: Final[int] = 50
ATTEMPT_PROGRESS_BATCH_SIZE: Final[int] = 100


def _resolve_principal_site_indices_for_node(
    principal_smiles: str,
    derivative_smiles: str,
    selected_atom_indices: list[int],
) -> dict[int, int]:
    """Resuelve índices de sitio de la principal sobre el nodo derivado actual."""
    principal_molecule = parse_smiles_cached(principal_smiles)
    derivative_molecule = parse_smiles_cached(derivative_smiles)
    if principal_molecule is None or derivative_molecule is None:
        return {}

    all_principal_matches = derivative_molecule.GetSubstructMatches(principal_molecule)
    if len(all_principal_matches) == 0:
        return {}

    best_match = all_principal_matches[0]
    if len(selected_atom_indices) > 0:
        best_score = _score_principal_match_for_sites(
            derivative_molecule=derivative_molecule,
            principal_match=best_match,
            principal_site_atom_indices=selected_atom_indices,
        )
        for candidate_match in all_principal_matches[1:]:
            candidate_score = _score_principal_match_for_sites(
                derivative_molecule=derivative_molecule,
                principal_match=candidate_match,
                principal_site_atom_indices=selected_atom_indices,
            )
            if candidate_score > best_score:
                best_match = candidate_match
                best_score = candidate_score

    resolved_site_indices: dict[int, int] = {}
    for site_atom_index in selected_atom_indices:
        if site_atom_index < len(best_match):
            resolved_site_indices[site_atom_index] = int(best_match[site_atom_index])

    return resolved_site_indices


# =========================
# LOG Y TRAZABILIDAD
# =========================


def _emit_log(
    log_callback: PluginLogCallback | None,
    level: str,
    source: str,
    message: str,
    payload: JSONMap | None = None,
) -> None:
    """Envía evento de log si el callback está disponible."""
    if log_callback is None:
        return

    typed_level = cast("str", level)
    safe_payload: JSONMap | None = payload if payload is not None else {}
    log_callback(cast("object", typed_level), source, message, safe_payload)


def _append_traceability_rows(
    rows: list[SmileitTraceabilityRow],
    derivative_name: str,
    derivative_smiles: str,
    traceability: list[SmileitSubstitutionTraceEvent],
) -> None:
    """Convierte trazabilidad interna en filas tabulares de auditoría."""
    for event in traceability:
        rows.append(
            SmileitTraceabilityRow(
                derivative_name=derivative_name,
                derivative_smiles=derivative_smiles,
                round_index=event["round_index"],
                site_atom_index=event["site_atom_index"],
                block_label=event["block_label"],
                block_priority=event["block_priority"],
                substituent_name=event["substituent_name"],
                substituent_smiles=event["substituent_smiles"],
                substituent_stable_id=event["substituent_stable_id"],
                substituent_version=event["substituent_version"],
                source_kind=event["source_kind"],
                bond_order=event["bond_order"],
            )
        )


# =========================
# PROGRESO Y REPORTE
# =========================


def _build_generation_progress_percentage(
    round_index: int,
    total_rounds: int,
    node_index: int,
    node_total: int,
) -> int:
    """Calcula porcentaje intermedio de progreso para generación combinatoria."""
    safe_total_rounds = max(1, total_rounds)
    safe_node_total = max(1, node_total)
    fraction = ((round_index - 1) + (node_index / safe_node_total)) / safe_total_rounds
    raw_percentage = 20 + int(fraction * 60)
    return max(20, min(80, raw_percentage))


def _build_render_progress_percentage(item_index: int, item_total: int) -> int:
    """Calcula porcentaje para la fase de materialización visual final."""
    safe_total = max(1, item_total)
    raw_percentage = 86 + int((item_index / safe_total) * 13)
    return max(86, min(99, raw_percentage))


def _report_generation_progress(
    *,
    progress_callback: PluginProgressCallback,
    log_callback: PluginLogCallback | None,
    round_index: int,
    r_substitutes: int,
    node_index: int,
    round_frontier_size: int,
    attempts_processed: int,
    current_generated: int,
    rejected_fusions: int,
    duplicate_structures: int,
    attempt_cache_size: int,
) -> None:
    """Publica avance incremental de generación para reducir complejidad local."""
    progress_percentage = _build_generation_progress_percentage(
        round_index=round_index,
        total_rounds=r_substitutes,
        node_index=node_index,
        node_total=round_frontier_size,
    )
    progress_callback(
        progress_percentage,
        "running",
        (
            "Generando derivados por bloques de asignación. "
            f"Intentos procesados: {attempts_processed}. "
            f"Estructuras acumuladas: {current_generated}."
        ),
    )
    _emit_log(
        log_callback,
        level="info",
        source=SMILEIT_LOG_SOURCE,
        message="Avance de generación Smile-it.",
        payload={
            "attempts_processed": attempts_processed,
            "generated_structures": current_generated,
            "rejected_fusions": rejected_fusions,
            "duplicate_structures": duplicate_structures,
            "round_index": round_index,
            "processed_nodes": node_index,
            "round_nodes": round_frontier_size,
            "fusion_attempt_cache_size": attempt_cache_size,
        },
    )


def _report_generation_limit_reached(
    *,
    log_callback: PluginLogCallback | None,
    attempts_processed: int,
    generated_count: int,
    rejected_fusions: int,
    max_structures: int | None,
) -> None:
    """Publica evento único cuando la generación alcanza el límite máximo."""
    _emit_log(
        log_callback,
        level="warning",
        source=SMILEIT_LOG_SOURCE,
        message="Se alcanzó el límite configurado de estructuras para Smile-it.",
        payload={
            "attempts_processed": attempts_processed,
            "generated_structures": generated_count,
            "rejected_fusions": rejected_fusions,
            "max_structures": max_structures,
        },
    )


def _materialize_generated_structures(
    principal_smiles: str,
    generated_candidates: list[GeneratedCandidate],
    progress_callback: PluginProgressCallback,
    log_callback: PluginLogCallback | None,
) -> list[SmileitGeneratedStructure]:
    """Materializa resultados sin SVG para habilitar renderizado on-demand."""
    generated_structures: list[SmileitGeneratedStructure] = []
    _ = principal_smiles

    for candidate_index, candidate in enumerate(generated_candidates, start=1):
        sorted_traceability = _sort_traceability_events(candidate.traceability)
        placeholder_assignments = _build_placeholder_assignments(sorted_traceability)
        generated_structures.append(
            SmileitGeneratedStructure(
                smiles=candidate.smiles,
                name=candidate.name,
                # Se difiere render SVG hasta que frontend lo solicita por endpoint dedicado.
                svg="",
                placeholder_assignments=placeholder_assignments,
                traceability=sorted_traceability,
            )
        )

        progress_callback(
            _build_render_progress_percentage(
                item_index=candidate_index,
                item_total=len(generated_candidates),
            ),
            "running",
            (
                "Consolidando metadatos finales de Smile-it. "
                f"Procesadas: {candidate_index}/{len(generated_candidates)}."
            ),
        )

    _emit_log(
        log_callback,
        level="info",
        source=SMILEIT_LOG_SOURCE,
        message="Materialización visual Smile-it completada.",
        payload={
            "generated_structures": len(generated_structures),
            "render_mode": "on-demand-svg",
        },
    )

    return generated_structures


# =========================
# ALGORITMOS PRINCIPALES DE GENERACIÓN
# =========================


def _expand_derivatives_from_node(
    node: GeneratedNode,
    round_index: int,
    derivative_counter: int,
    context: ExpansionContext,
) -> ExpansionSummary:
    """Expande derivados desde un nodo base para reducir complejidad ciclomática."""
    attempts_processed = 0
    rejected_fusions = 0
    duplicate_structures = 0
    resolved_site_indices = _resolve_principal_site_indices_for_node(
        principal_smiles=context.principal_smiles,
        derivative_smiles=node.smiles,
        selected_atom_indices=context.selected_atom_indices,
    )
    used_principal_sites = {
        int(trace_event["site_atom_index"]) for trace_event in node.traceability
    }

    pending_attempts = _build_pending_fusion_attempts(
        node=node,
        selected_atom_indices=context.selected_atom_indices,
        site_option_map=context.site_option_map,
        resolved_site_indices=resolved_site_indices,
        num_bonds=context.num_bonds,
    )
    pending_attempts = [
        pending_attempt
        for pending_attempt in pending_attempts
        if pending_attempt.principal_site_atom_index not in used_principal_sites
    ]

    attempts_to_resolve: list[PendingFusionAttempt] = []
    for pending_attempt in pending_attempts:
        attempts_processed += 1
        if pending_attempt.attempt_key in context.attempt_cache:
            continue

        if not is_fusion_candidate_viable(
            principal_smiles=pending_attempt.attempt_key.principal_smiles,
            substituent_smiles=pending_attempt.attempt_key.substituent_smiles,
            principal_atom_idx=pending_attempt.attempt_key.site_atom_index,
            substituent_atom_idx=pending_attempt.attempt_key.substituent_anchor,
            bond_order=pending_attempt.attempt_key.bond_order,
        ):
            context.attempt_cache[pending_attempt.attempt_key] = None
            continue

        attempts_to_resolve.append(pending_attempt)

    _resolve_pending_fusion_attempts(
        attempt_cache=context.attempt_cache,
        pending_attempts=attempts_to_resolve,
    )

    for pending_attempt in pending_attempts:
        fused_smiles = context.attempt_cache.get(pending_attempt.attempt_key)
        if fused_smiles is None:
            rejected_fusions += 1
            continue

        if fused_smiles in context.seen_smiles:
            duplicate_structures += 1
            continue

        context.seen_smiles.add(fused_smiles)

        substituent = pending_attempt.site_option.substituent
        trace_event = SmileitSubstitutionTraceEvent(
            round_index=round_index,
            site_atom_index=pending_attempt.principal_site_atom_index,
            block_label=pending_attempt.site_option.block_label,
            block_priority=pending_attempt.site_option.block_priority,
            substituent_name=substituent["name"],
            substituent_smiles=substituent["smiles"],
            substituent_stable_id=substituent["stable_id"],
            substituent_version=substituent["version"],
            source_kind=substituent["source_kind"],
            bond_order=pending_attempt.bond_order,
        )
        traceability = [*node.traceability, trace_event]
        generated_name = _build_structure_name(
            base_name=context.export_name_base,
            index_value=derivative_counter,
            padding=context.export_padding,
        )
        derivative_counter += 1

        context.generated_candidates.append(
            GeneratedCandidate(
                smiles=fused_smiles,
                name=generated_name,
                traceability=traceability,
            )
        )
        _append_traceability_rows(
            rows=context.derivative_rows,
            derivative_name=generated_name,
            derivative_smiles=fused_smiles,
            traceability=traceability,
        )
        context.next_frontier_nodes.append(
            GeneratedNode(
                smiles=fused_smiles,
                traceability=traceability,
            )
        )

        if (
            context.max_structures is not None
            and len(context.generated_candidates) >= context.max_structures
        ):
            return ExpansionSummary(
                derivative_counter=derivative_counter,
                attempts_processed=attempts_processed,
                rejected_fusions=rejected_fusions,
                duplicate_structures=duplicate_structures,
                reached_limit=True,
            )

    return ExpansionSummary(
        derivative_counter=derivative_counter,
        attempts_processed=attempts_processed,
        rejected_fusions=rejected_fusions,
        duplicate_structures=duplicate_structures,
        reached_limit=False,
    )


def _generate_derivatives(
    principal_smiles: str,
    selected_atom_indices: list[int],
    site_option_map: dict[int, list[SiteOption]],
    r_substitutes: int,
    num_bonds: int,
    max_structures: int | None,
    export_name_base: str,
    export_padding: int,
    progress_callback: PluginProgressCallback,
    log_callback: PluginLogCallback | None,
) -> tuple[list[GeneratedCandidate], list[SmileitTraceabilityRow], bool]:
    """Genera derivados con trazabilidad por ronda y por sitio."""
    frontier_nodes: list[GeneratedNode] = [
        GeneratedNode(smiles=principal_smiles, traceability=[])
    ]
    seen_smiles: set[str] = {principal_smiles}
    attempt_cache: dict[FusionAttemptKey, str | None] = {}

    derivative_rows: list[SmileitTraceabilityRow] = []
    generated_candidates: list[GeneratedCandidate] = []
    truncated = False
    derivative_counter = 1
    last_reported_generated = 0
    last_reported_attempts = 0
    attempts_processed = 0
    rejected_fusions = 0
    duplicate_structures = 0

    for round_index in range(1, r_substitutes + 1):
        round_frontier = list(frontier_nodes)
        next_frontier_nodes: list[GeneratedNode] = []
        expansion_context = ExpansionContext(
            principal_smiles=principal_smiles,
            selected_atom_indices=selected_atom_indices,
            site_option_map=site_option_map,
            num_bonds=num_bonds,
            seen_smiles=seen_smiles,
            attempt_cache=attempt_cache,
            export_name_base=export_name_base,
            export_padding=export_padding,
            generated_candidates=generated_candidates,
            derivative_rows=derivative_rows,
            next_frontier_nodes=next_frontier_nodes,
            max_structures=max_structures,
        )

        for node_index, node in enumerate(round_frontier, start=1):
            expansion_summary = _expand_derivatives_from_node(
                node=node,
                round_index=round_index,
                derivative_counter=derivative_counter,
                context=expansion_context,
            )
            derivative_counter = expansion_summary.derivative_counter
            attempts_processed += expansion_summary.attempts_processed
            rejected_fusions += expansion_summary.rejected_fusions
            duplicate_structures += expansion_summary.duplicate_structures

            current_generated = len(generated_candidates)
            should_report_generated = (
                current_generated - last_reported_generated >= LOG_PROGRESS_BATCH_SIZE
            )
            should_report_attempts = (
                attempts_processed - last_reported_attempts
                >= ATTEMPT_PROGRESS_BATCH_SIZE
            )
            if should_report_generated or should_report_attempts:
                _report_generation_progress(
                    progress_callback=progress_callback,
                    log_callback=log_callback,
                    round_index=round_index,
                    r_substitutes=r_substitutes,
                    node_index=node_index,
                    round_frontier_size=len(round_frontier),
                    attempts_processed=attempts_processed,
                    current_generated=current_generated,
                    rejected_fusions=rejected_fusions,
                    duplicate_structures=duplicate_structures,
                    attempt_cache_size=len(attempt_cache),
                )
                last_reported_generated = current_generated
                last_reported_attempts = attempts_processed

            if expansion_summary.reached_limit:
                _report_generation_limit_reached(
                    log_callback=log_callback,
                    attempts_processed=attempts_processed,
                    generated_count=len(generated_candidates),
                    rejected_fusions=rejected_fusions,
                    max_structures=max_structures,
                )
                truncated = True
                return generated_candidates, derivative_rows, truncated

        if len(next_frontier_nodes) == 0:
            break

        frontier_nodes = next_frontier_nodes
        progress_percentage = 20 + int((round_index / max(1, r_substitutes)) * 60)
        progress_callback(
            min(80, max(20, progress_percentage)),
            "running",
            (
                f"Ronda {round_index}/{r_substitutes} completada. "
                f"Intentos procesados: {attempts_processed}. "
                f"Estructuras acumuladas: {len(generated_candidates)}."
            ),
        )
        _emit_log(
            log_callback,
            level="info",
            source=SMILEIT_LOG_SOURCE,
            message="Ronda de generación completada.",
            payload={
                "attempts_processed": attempts_processed,
                "round_index": round_index,
                "total_rounds": r_substitutes,
                "generated_structures": len(generated_candidates),
                "rejected_fusions": rejected_fusions,
                "duplicate_structures": duplicate_structures,
                "frontier_nodes": len(frontier_nodes),
                "fusion_attempt_cache_size": len(attempt_cache),
            },
        )

    return generated_candidates, derivative_rows, truncated
