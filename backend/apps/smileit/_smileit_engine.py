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
    SiteOptionSignature,
    _build_allowed_signatures_by_site,
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


def _resolve_principal_site_index_maps_for_node(
    principal_smiles: str,
    derivative_smiles: str,
    selected_atom_indices: list[int],
) -> list[dict[int, int]]:
    """Resuelve todos los mapeos válidos del scaffold principal sobre el derivado.

    RDKit puede encontrar múltiples embeddings del scaffold principal dentro del
    derivado actual. Si solo se conserva el primero, las rondas siguientes pueden
    perder combinaciones válidas cuando otro embedding expone sitios restantes
    distintos. Por eso este helper devuelve todos los matches con la mejor
    puntuación química disponible.
    """
    principal_molecule = parse_smiles_cached(principal_smiles)
    derivative_molecule = parse_smiles_cached(derivative_smiles)
    if principal_molecule is None or derivative_molecule is None:
        return []

    all_principal_matches = derivative_molecule.GetSubstructMatches(principal_molecule)
    if len(all_principal_matches) == 0:
        return []

    candidate_matches = list(all_principal_matches)
    if len(selected_atom_indices) > 0:
        scored_matches = [
            (
                _score_principal_match_for_sites(
                    derivative_molecule=derivative_molecule,
                    principal_match=principal_match,
                    principal_site_atom_indices=selected_atom_indices,
                ),
                principal_match,
            )
            for principal_match in all_principal_matches
        ]
        best_score = max(score for score, _principal_match in scored_matches)
        candidate_matches = [
            principal_match
            for score, principal_match in scored_matches
            if score == best_score
        ]

    resolved_site_index_maps: list[dict[int, int]] = []
    seen_map_signatures: set[tuple[tuple[int, int], ...]] = set()
    for principal_match in candidate_matches:
        resolved_site_indices: dict[int, int] = {}
        for site_atom_index in selected_atom_indices:
            if site_atom_index < len(principal_match):
                resolved_site_indices[site_atom_index] = int(
                    principal_match[site_atom_index]
                )

        map_signature = tuple(sorted(resolved_site_indices.items()))
        if map_signature in seen_map_signatures:
            continue
        seen_map_signatures.add(map_signature)
        resolved_site_index_maps.append(resolved_site_indices)

    return sorted(
        resolved_site_index_maps,
        key=lambda resolved_site_indices: tuple(sorted(resolved_site_indices.items())),
    )


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


def _is_traceability_sequence_valid(
    traceability: list[SmileitSubstitutionTraceEvent],
    allowed_signatures_by_site: dict[int, set[SiteOptionSignature]],
) -> bool:
    """Valida reglas duras: un sitio por derivado y pertenencia por bloque/sitio."""
    used_sites: set[int] = set()

    for event in traceability:
        site_atom_index = int(event["site_atom_index"])
        if site_atom_index in used_sites:
            return False
        used_sites.add(site_atom_index)

        expected_signature = (
            event["block_label"],
            event["substituent_stable_id"],
            event["substituent_version"],
            event["substituent_smiles"],
            0,
        )
        valid_signatures_for_site = allowed_signatures_by_site.get(
            site_atom_index, set()
        )

        # El ancla se ignora en esta validación para no acoplarla a cómo se serializa el evento.
        is_signature_allowed = any(
            (
                signature[0] == expected_signature[0]
                and signature[1] == expected_signature[1]
                and signature[2] == expected_signature[2]
                and signature[3] == expected_signature[3]
            )
            for signature in valid_signatures_for_site
        )
        if not is_signature_allowed:
            return False

    return True


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


def _build_pending_attempts_for_node_embeddings(
    *,
    node: GeneratedNode,
    context: ExpansionContext,
    resolved_site_index_maps: list[dict[int, int]],
    used_principal_sites: set[int],
) -> list[PendingFusionAttempt]:
    """Construye intentos únicos considerando todos los embeddings válidos.

    Separamos este paso para mantener la expansión principal legible y para poder
    deduplicar intentos equivalentes antes de pasar por validación/pesado de RDKit.
    """
    pending_attempts: list[PendingFusionAttempt] = []
    seen_attempt_signatures: set[tuple[int, int, str, int, str, int, str, int, int]] = (
        set()
    )

    for resolved_site_indices in resolved_site_index_maps:
        for pending_attempt in _build_pending_fusion_attempts(
            node=node,
            selected_atom_indices=context.selected_atom_indices,
            site_option_map=context.site_option_map,
            resolved_site_indices=resolved_site_indices,
            num_bonds=context.num_bonds,
        ):
            if pending_attempt.principal_site_atom_index in used_principal_sites:
                continue

            attempt_signature = (
                pending_attempt.principal_site_atom_index,
                pending_attempt.resolved_site_atom_index,
                pending_attempt.site_option.block_label,
                pending_attempt.site_option.block_priority,
                pending_attempt.site_option.substituent["stable_id"],
                pending_attempt.site_option.substituent["version"],
                pending_attempt.site_option.substituent["smiles"],
                pending_attempt.selected_anchor,
                pending_attempt.bond_order,
            )
            if attempt_signature in seen_attempt_signatures:
                continue

            seen_attempt_signatures.add(attempt_signature)
            pending_attempts.append(pending_attempt)

    pending_attempts.sort(
        key=lambda pending_attempt: (
            pending_attempt.principal_site_atom_index,
            pending_attempt.resolved_site_atom_index,
            pending_attempt.site_option.block_priority,
            pending_attempt.site_option.substituent["stable_id"],
            pending_attempt.site_option.substituent["version"],
            pending_attempt.selected_anchor,
            pending_attempt.bond_order,
            pending_attempt.site_option.block_label,
        )
    )
    return pending_attempts


def _prepare_attempts_for_resolution(
    *,
    pending_attempts: list[PendingFusionAttempt],
    context: ExpansionContext,
) -> tuple[int, list[PendingFusionAttempt]]:
    """Filtra intentos inviables antes de invocar la resolución pesada de RDKit."""
    attempts_processed = 0
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

    return attempts_processed, attempts_to_resolve


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
    resolved_site_index_maps = _resolve_principal_site_index_maps_for_node(
        principal_smiles=context.principal_smiles,
        derivative_smiles=node.smiles,
        selected_atom_indices=context.selected_atom_indices,
    )
    if len(resolved_site_index_maps) == 0:
        return ExpansionSummary(
            derivative_counter=derivative_counter,
            attempts_processed=attempts_processed,
            rejected_fusions=rejected_fusions,
            duplicate_structures=duplicate_structures,
            reached_limit=False,
        )

    used_principal_sites = {
        int(trace_event["site_atom_index"]) for trace_event in node.traceability
    }

    pending_attempts = _build_pending_attempts_for_node_embeddings(
        node=node,
        context=context,
        resolved_site_index_maps=resolved_site_index_maps,
        used_principal_sites=used_principal_sites,
    )
    attempts_processed, attempts_to_resolve = _prepare_attempts_for_resolution(
        pending_attempts=pending_attempts,
        context=context,
    )

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
        if not _is_traceability_sequence_valid(
            traceability=traceability,
            allowed_signatures_by_site=context.allowed_signatures_by_site,
        ):
            rejected_fusions += 1
            continue

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
            allowed_signatures_by_site=_build_allowed_signatures_by_site(
                site_option_map
            ),
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
