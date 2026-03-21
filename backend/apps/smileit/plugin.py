"""plugin.py: Plugin científico Smile-it con asignación flexible por bloques.

Objetivo del archivo:
- Ejecutar generación combinatoria de derivados desde un principal SMILES usando
  bloques de asignación sitio -> sustituyentes con prioridad explícita.
- Registrar trazabilidad completa de cada sustitución aplicada por derivado.

Cómo se usa:
- `routers.py` valida y normaliza el payload del job.
- El core invoca `smileit_plugin` por `PluginRegistry` durante la ejecución.
"""

from __future__ import annotations

import logging
import os
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Final, cast

from apps.core.processing import PluginRegistry
from apps.core.types import JSONMap, PluginLogCallback, PluginProgressCallback

from .definitions import (
    DEFAULT_EXPORT_PADDING,
    MAX_NUM_BONDS,
    MAX_R_SUBSTITUTES,
    PLUGIN_NAME,
)
from .engine import (
    canonicalize_smiles,
    clear_smileit_caches,
    fuse_molecules,
    is_fusion_candidate_viable,
    render_derivative_svg_with_substituent_highlighting,
    render_molecule_svg_with_atom_labels,
)
from .types import (
    SmileitGeneratedStructure,
    SmileitInput,
    SmileitPlaceholderAssignment,
    SmileitResolvedAssignmentBlock,
    SmileitResolvedSubstituent,
    SmileitResult,
    SmileitSubstitutionTraceEvent,
    SmileitTraceabilityRow,
)

logger = logging.getLogger(__name__)
LOG_PROGRESS_BATCH_SIZE: Final[int] = 50
ATTEMPT_PROGRESS_BATCH_SIZE: Final[int] = 100
GENERATION_CONCURRENCY_MIN_BATCH: Final[int] = 8
MAX_GENERATION_WORKERS: Final[int] = max(1, min(8, (os.cpu_count() or 2)))


@dataclass
class GeneratedNode:
    """Nodo interno con estructura derivada y trazabilidad incremental."""

    smiles: str
    traceability: list[SmileitSubstitutionTraceEvent]


@dataclass(slots=True)
class GeneratedCandidate:
    """Candidato generado antes de materializar SVG y previews visuales."""

    smiles: str
    name: str
    traceability: list[SmileitSubstitutionTraceEvent]


@dataclass(slots=True)
class ExpansionSummary:
    """Resumen incremental para controlar progreso y poda sin trabajo redundante."""

    derivative_counter: int
    attempts_processed: int
    rejected_fusions: int
    duplicate_structures: int
    reached_limit: bool


@dataclass(frozen=True)
class SiteOption:
    """Opción ejecutable por sitio derivada de la unión de bloques activos."""

    site_atom_index: int
    block_label: str
    block_priority: int
    substituent: SmileitResolvedSubstituent


@dataclass(frozen=True, slots=True)
class FusionAttemptKey:
    """Clave exacta para reutilizar resultados de fusión dentro del job.

    Evita recalcular combinaciones ya vistas entre rondas o entre bloques que
    terminan intentando la misma firma química.
    """

    principal_smiles: str
    site_atom_index: int
    substituent_smiles: str
    substituent_anchor: int
    bond_order: int


@dataclass(frozen=True, slots=True)
class PendingFusionAttempt:
    """Representa un intento ordenado de fusión antes de resolverlo."""

    site_atom_index: int
    site_option: SiteOption
    selected_anchor: int
    bond_order: int
    attempt_key: FusionAttemptKey


def _build_site_option_map(
    selected_atom_indices: list[int],
    assignment_blocks: list[SmileitResolvedAssignmentBlock],
) -> dict[int, list[SiteOption]]:
    """Construye opciones por sitio uniendo sustituyentes de todos los bloques aplicables."""
    site_option_map: dict[int, list[SiteOption]] = {
        site_atom_index: [] for site_atom_index in selected_atom_indices
    }
    selected_set = set(selected_atom_indices)
    seen_keys_by_site: dict[int, set[tuple[str, int, int, int, str]]] = {
        site_atom_index: set() for site_atom_index in selected_atom_indices
    }

    for block in assignment_blocks:
        for site_atom_index in block["site_atom_indices"]:
            if site_atom_index not in selected_set:
                continue

            for substituent in block["resolved_substituents"]:
                dedupe_key = (
                    substituent["stable_id"],
                    substituent["version"],
                    substituent["selected_atom_index"],
                    block["priority"],
                    block["label"],
                )
                if dedupe_key in seen_keys_by_site[site_atom_index]:
                    continue
                seen_keys_by_site[site_atom_index].add(dedupe_key)
                site_option_map[site_atom_index].append(
                    SiteOption(
                        site_atom_index=site_atom_index,
                        block_label=block["label"],
                        block_priority=block["priority"],
                        substituent=substituent,
                    )
                )

    return site_option_map


def _tint_svg(raw_svg: str, color_hex: str) -> str:
    """Aplica un color dominante al SVG para diferenciar roles visuales."""
    if raw_svg.strip() == "":
        return raw_svg

    colored_svg = raw_svg
    replacements: list[tuple[str, str]] = [
        (r"stroke:\s*#000000", f"stroke:{color_hex}"),
        (r"stroke:\s*#000", f"stroke:{color_hex}"),
        (r"fill:\s*#000000", f"fill:{color_hex}"),
        (r"fill:\s*#000", f"fill:{color_hex}"),
        (r"stroke=\"#000000\"", f'stroke="{color_hex}"'),
        (r"stroke=\"#000\"", f'stroke="{color_hex}"'),
        (r"fill=\"#000000\"", f'fill="{color_hex}"'),
        (r"fill=\"#000\"", f'fill="{color_hex}"'),
    ]

    for pattern, replacement in replacements:
        colored_svg = re.sub(pattern, replacement, colored_svg)

    return colored_svg


def _sort_traceability_events(
    traceability: list[SmileitSubstitutionTraceEvent],
) -> list[SmileitSubstitutionTraceEvent]:
    """Ordena la trazabilidad con una regla estable para UI y exportes químicos."""
    return sorted(
        traceability,
        key=lambda event: (
            event["site_atom_index"],
            event["round_index"],
            event["block_priority"],
            event["substituent_name"],
            event["substituent_smiles"],
        ),
    )


def _build_placeholder_assignments(
    traceability: list[SmileitSubstitutionTraceEvent],
) -> list[SmileitPlaceholderAssignment]:
    """Construye placeholders `R1`, `R2`, ... alineados con la traza química."""
    placeholder_assignments: list[SmileitPlaceholderAssignment] = []

    for placeholder_index, event in enumerate(
        _sort_traceability_events(traceability), start=1
    ):
        placeholder_assignments.append(
            SmileitPlaceholderAssignment(
                placeholder_label=f"R{placeholder_index}",
                site_atom_index=event["site_atom_index"],
                substituent_name=event["substituent_name"],
                substituent_smiles=event["substituent_smiles"],
            )
        )

    return placeholder_assignments


def _build_combined_structure_svg(
    principal_smiles: str,
    derivative_smiles: str,
    placeholder_assignments: list[SmileitPlaceholderAssignment],
) -> str:
    """Renderiza la molécula derivada completa con highlighting en átomos de sustituto.

    El SVG muestra:
    - Molécula derivada completa (principal + todos los sustitutos combinados)
    - Highlighting en los átomos que pertenecen a sustitutos (color verde)
    - Principal se muestra NORMAL sin highlighting
    """
    # Extraer SMILES de sustitutos en orden de la trazabilidad
    substituent_smiles_list: list[str] = [
        assignment["substituent_smiles"]
        for assignment in placeholder_assignments
    ]
    
    # Renderizar derivado completo con highlighting SOLO en átomos de sustituto
    svg = render_derivative_svg_with_substituent_highlighting(
        principal_smiles,
        derivative_smiles,
        substituent_smiles_list,
    )
    # Aplicar color verde a los átomos resaltados
    return _tint_svg(svg, "#2f855a")


def _build_structure_name(base_name: str, index_value: int, padding: int) -> str:
    """Construye nombre determinista para exportación reproducible."""
    safe_padding = max(1, padding)
    return f"{base_name}_{index_value:0{safe_padding}d}"


def _build_pending_fusion_attempts(
    node: GeneratedNode,
    selected_atom_indices: list[int],
    site_option_map: dict[int, list[SiteOption]],
    num_bonds: int,
) -> list[PendingFusionAttempt]:
    """Construye intentos ordenados priorizando sitios con menor branching."""
    ordered_site_indices = sorted(
        selected_atom_indices,
        key=lambda site_atom_index: (
            len(site_option_map.get(site_atom_index, [])),
            site_atom_index,
        ),
    )
    pending_attempts: list[PendingFusionAttempt] = []

    for site_atom_index in ordered_site_indices:
        site_options = sorted(
            site_option_map.get(site_atom_index, []),
            key=lambda site_option: (
                site_option.block_priority,
                site_option.substituent["stable_id"],
                site_option.substituent["version"],
                site_option.substituent["selected_atom_index"],
                site_option.block_label,
            ),
        )
        for site_option in site_options:
            selected_anchor = int(site_option.substituent["selected_atom_index"])
            for bond_order in range(1, num_bonds + 1):
                pending_attempts.append(
                    PendingFusionAttempt(
                        site_atom_index=site_atom_index,
                        site_option=site_option,
                        selected_anchor=selected_anchor,
                        bond_order=bond_order,
                        attempt_key=FusionAttemptKey(
                            principal_smiles=node.smiles,
                            site_atom_index=site_atom_index,
                            substituent_smiles=site_option.substituent["smiles"],
                            substituent_anchor=selected_anchor,
                            bond_order=bond_order,
                        ),
                    )
                )

    return pending_attempts


def _resolve_pending_fusion_attempts(
    attempt_cache: dict[FusionAttemptKey, str | None],
    pending_attempts: list[PendingFusionAttempt],
) -> None:
    """Resuelve intentos no cacheados usando concurrencia controlada."""
    unresolved_attempts: list[PendingFusionAttempt] = []
    seen_unresolved_keys: set[FusionAttemptKey] = set()
    for pending_attempt in pending_attempts:
        attempt_key = pending_attempt.attempt_key
        if attempt_key in attempt_cache or attempt_key in seen_unresolved_keys:
            continue
        seen_unresolved_keys.add(attempt_key)
        unresolved_attempts.append(pending_attempt)
    if len(unresolved_attempts) == 0:
        return

    def resolve_attempt_worker(
        pending_attempt: PendingFusionAttempt,
    ) -> tuple[FusionAttemptKey, str | None]:
        return (
            pending_attempt.attempt_key,
            fuse_molecules(
                principal_smiles=pending_attempt.attempt_key.principal_smiles,
                substituent_smiles=pending_attempt.attempt_key.substituent_smiles,
                principal_atom_idx=pending_attempt.attempt_key.site_atom_index,
                substituent_atom_idx=pending_attempt.attempt_key.substituent_anchor,
                bond_order=pending_attempt.attempt_key.bond_order,
            ),
        )

    if len(unresolved_attempts) < GENERATION_CONCURRENCY_MIN_BATCH:
        for unresolved_attempt in unresolved_attempts:
            attempt_key, fused_smiles = resolve_attempt_worker(unresolved_attempt)
            attempt_cache[attempt_key] = fused_smiles
        return

    with ThreadPoolExecutor(max_workers=MAX_GENERATION_WORKERS) as executor:
        resolved_attempts = list(
            executor.map(resolve_attempt_worker, unresolved_attempts)
        )

    for attempt_key, fused_smiles in resolved_attempts:
        attempt_cache[attempt_key] = fused_smiles


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
    log_callback(cast("object", typed_level), source, message, safe_payload)  # type: ignore[arg-type]


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


def _materialize_generated_structures(
    principal_smiles: str,
    generated_candidates: list[GeneratedCandidate],
    progress_callback: PluginProgressCallback,
    log_callback: PluginLogCallback | None,
) -> list[SmileitGeneratedStructure]:
    """Construye un SVG único por derivado usando el scaffold principal etiquetado."""
    generated_structures: list[SmileitGeneratedStructure] = []

    for candidate_index, candidate in enumerate(generated_candidates, start=1):
        sorted_traceability = _sort_traceability_events(candidate.traceability)
        placeholder_assignments = _build_placeholder_assignments(sorted_traceability)
        generated_structures.append(
            SmileitGeneratedStructure(
                smiles=candidate.smiles,
                name=candidate.name,
                svg=_build_combined_structure_svg(
                    principal_smiles,
                    candidate.smiles,  # Pasar molécula derivada completa
                    placeholder_assignments,  # Pasar assignments para calcular átomos
                ),
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
                "Renderizando estructuras finales de Smile-it. "
                f"Procesadas: {candidate_index}/{len(generated_candidates)}."
            ),
        )

    _emit_log(
        log_callback,
        level="info",
        source="smileit.plugin",
        message="Materialización visual Smile-it completada.",
        payload={
            "generated_structures": len(generated_structures),
            "render_mode": "single-scaffold-highlight",
        },
    )

    return generated_structures


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

        for node_index, node in enumerate(round_frontier, start=1):
            expansion_summary = _expand_derivatives_from_node(
                node=node,
                round_index=round_index,
                selected_atom_indices=selected_atom_indices,
                site_option_map=site_option_map,
                num_bonds=num_bonds,
                seen_smiles=seen_smiles,
                attempt_cache=attempt_cache,
                export_name_base=export_name_base,
                export_padding=export_padding,
                derivative_counter=derivative_counter,
                generated_candidates=generated_candidates,
                derivative_rows=derivative_rows,
                next_frontier_nodes=next_frontier_nodes,
                max_structures=max_structures,
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
                progress_percentage = _build_generation_progress_percentage(
                    round_index=round_index,
                    total_rounds=r_substitutes,
                    node_index=node_index,
                    node_total=len(round_frontier),
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
                    source="smileit.plugin",
                    message="Avance de generación Smile-it.",
                    payload={
                        "attempts_processed": attempts_processed,
                        "generated_structures": current_generated,
                        "rejected_fusions": rejected_fusions,
                        "duplicate_structures": duplicate_structures,
                        "round_index": round_index,
                        "processed_nodes": node_index,
                        "round_nodes": len(round_frontier),
                        "fusion_attempt_cache_size": len(attempt_cache),
                    },
                )
                last_reported_generated = current_generated
                last_reported_attempts = attempts_processed

            if expansion_summary.reached_limit:
                _emit_log(
                    log_callback,
                    level="warning",
                    source="smileit.plugin",
                    message="Se alcanzó el límite configurado de estructuras para Smile-it.",
                    payload={
                        "attempts_processed": attempts_processed,
                        "generated_structures": len(generated_candidates),
                        "rejected_fusions": rejected_fusions,
                        "max_structures": max_structures,
                    },
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
            source="smileit.plugin",
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


def _expand_derivatives_from_node(
    node: GeneratedNode,
    round_index: int,
    selected_atom_indices: list[int],
    site_option_map: dict[int, list[SiteOption]],
    num_bonds: int,
    seen_smiles: set[str],
    attempt_cache: dict[FusionAttemptKey, str | None],
    export_name_base: str,
    export_padding: int,
    derivative_counter: int,
    generated_candidates: list[GeneratedCandidate],
    derivative_rows: list[SmileitTraceabilityRow],
    next_frontier_nodes: list[GeneratedNode],
    max_structures: int | None,
) -> ExpansionSummary:
    """Expande derivados desde un nodo base para reducir complejidad ciclomática."""
    attempts_processed = 0
    rejected_fusions = 0
    duplicate_structures = 0

    pending_attempts = _build_pending_fusion_attempts(
        node=node,
        selected_atom_indices=selected_atom_indices,
        site_option_map=site_option_map,
        num_bonds=num_bonds,
    )

    attempts_to_resolve: list[PendingFusionAttempt] = []
    for pending_attempt in pending_attempts:
        attempts_processed += 1
        if pending_attempt.attempt_key in attempt_cache:
            continue

        if not is_fusion_candidate_viable(
            principal_smiles=pending_attempt.attempt_key.principal_smiles,
            substituent_smiles=pending_attempt.attempt_key.substituent_smiles,
            principal_atom_idx=pending_attempt.attempt_key.site_atom_index,
            substituent_atom_idx=pending_attempt.attempt_key.substituent_anchor,
            bond_order=pending_attempt.attempt_key.bond_order,
        ):
            attempt_cache[pending_attempt.attempt_key] = None
            continue

        attempts_to_resolve.append(pending_attempt)

    _resolve_pending_fusion_attempts(
        attempt_cache=attempt_cache,
        pending_attempts=attempts_to_resolve,
    )

    for pending_attempt in pending_attempts:
        fused_smiles = attempt_cache.get(pending_attempt.attempt_key)
        if fused_smiles is None:
            rejected_fusions += 1
            continue

        if fused_smiles in seen_smiles:
            duplicate_structures += 1
            continue

        seen_smiles.add(fused_smiles)

        substituent = pending_attempt.site_option.substituent
        trace_event = SmileitSubstitutionTraceEvent(
            round_index=round_index,
            site_atom_index=pending_attempt.site_atom_index,
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
            base_name=export_name_base,
            index_value=derivative_counter,
            padding=export_padding,
        )
        derivative_counter += 1

        generated_candidates.append(
            GeneratedCandidate(
                smiles=fused_smiles,
                name=generated_name,
                traceability=traceability,
            )
        )
        _append_traceability_rows(
            rows=derivative_rows,
            derivative_name=generated_name,
            derivative_smiles=fused_smiles,
            traceability=traceability,
        )
        next_frontier_nodes.append(
            GeneratedNode(
                smiles=fused_smiles,
                traceability=traceability,
            )
        )

        if max_structures is not None and len(generated_candidates) >= max_structures:
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


def _normalize_resolved_substituent(
    raw_value: dict[str, object],
) -> SmileitResolvedSubstituent:
    """Normaliza sustituyente resuelto proveniente de parámetros JSON."""
    categories_raw = raw_value.get("categories", [])
    categories: list[str] = (
        [str(item) for item in categories_raw]
        if isinstance(categories_raw, list)
        else []
    )
    return SmileitResolvedSubstituent(
        source_kind=str(raw_value.get("source_kind", "catalog")),
        stable_id=str(raw_value.get("stable_id", "")),
        version=int(raw_value.get("version", 1)),
        name=str(raw_value.get("name", "")),
        smiles=str(raw_value.get("smiles", "")),
        selected_atom_index=int(raw_value.get("selected_atom_index", 0)),
        categories=categories,
    )


def _normalize_assignment_block(
    raw_block: dict[str, object],
) -> SmileitResolvedAssignmentBlock:
    """Normaliza bloque de asignación resuelto proveniente del router."""
    sites_raw = raw_block.get("site_atom_indices", [])
    sites: list[int] = (
        [int(item) for item in sites_raw] if isinstance(sites_raw, list) else []
    )

    resolved_raw = raw_block.get("resolved_substituents", [])
    resolved_substituents: list[SmileitResolvedSubstituent] = []
    if isinstance(resolved_raw, list):
        for item in resolved_raw:
            if isinstance(item, dict):
                resolved_substituents.append(_normalize_resolved_substituent(item))

    return SmileitResolvedAssignmentBlock(
        label=str(raw_block.get("label", "block")),
        priority=int(raw_block.get("priority", 1)),
        site_atom_indices=sites,
        resolved_substituents=resolved_substituents,
    )


def _build_smileit_input(parameters: JSONMap) -> SmileitInput:
    """Construye entrada tipada para el plugin desde parámetros serializados."""
    raw_blocks = parameters.get("assignment_blocks", [])
    assignment_blocks: list[SmileitResolvedAssignmentBlock] = []
    if isinstance(raw_blocks, list):
        for raw_item in raw_blocks:
            if isinstance(raw_item, dict):
                assignment_blocks.append(_normalize_assignment_block(raw_item))

    selected_raw = parameters.get("selected_atom_indices", [])
    selected_atom_indices = (
        [int(item) for item in selected_raw] if isinstance(selected_raw, list) else []
    )

    references_raw = parameters.get("references", {})
    references: dict[str, list[dict[str, str | int]]] = {}
    if isinstance(references_raw, dict):
        for ref_key, ref_value in references_raw.items():
            if isinstance(ref_value, list):
                typed_rows: list[dict[str, str | int]] = []
                for row in ref_value:
                    if isinstance(row, dict):
                        typed_rows.append(
                            {
                                str(key): (
                                    int(value) if isinstance(value, int) else str(value)
                                )
                                for key, value in row.items()
                            }
                        )
                references[str(ref_key)] = typed_rows

    return SmileitInput(
        principal_smiles=str(parameters.get("principal_smiles", "")),
        selected_atom_indices=selected_atom_indices,
        assignment_blocks=assignment_blocks,
        options={
            "r_substitutes": int(parameters.get("r_substitutes", 1)),
            "num_bonds": int(parameters.get("num_bonds", 1)),
            "allow_repeated": bool(parameters.get("allow_repeated", False)),
            "max_structures": int(parameters.get("max_structures", 0)),
            "site_overlap_policy": str(
                parameters.get("site_overlap_policy", "last_block_wins")
            ),
            "export_name_base": str(parameters.get("export_name_base", "SMILEIT")),
            "export_padding": int(
                parameters.get("export_padding", DEFAULT_EXPORT_PADDING)
            ),
        },
        version=str(parameters.get("version", "2.0.0")),
        references=references,
    )


@PluginRegistry.register(PLUGIN_NAME)
def smileit_plugin(
    parameters: JSONMap,
    progress_callback: PluginProgressCallback,
    log_callback: PluginLogCallback | None = None,
) -> JSONMap:
    """Ejecuta generación combinatoria de Smile-it con trazabilidad completa."""
    try:
        parsed_input = _build_smileit_input(parameters)

        canonical_principal = canonicalize_smiles(parsed_input["principal_smiles"])
        if canonical_principal is None:
            raise ValueError("SMILES principal inválido para Smile-it.")

        options = parsed_input["options"]
        r_substitutes = max(1, min(int(options["r_substitutes"]), MAX_R_SUBSTITUTES))
        num_bonds = max(1, min(int(options["num_bonds"]), MAX_NUM_BONDS))
        max_structures_raw = int(options["max_structures"])
        max_structures = max_structures_raw if max_structures_raw > 0 else None
        export_name_base = options["export_name_base"].strip() or "SMILEIT"
        export_padding = int(options["export_padding"])

        progress_callback(5, "running", "Validando cobertura de bloques para Smile-it.")

        site_option_map = _build_site_option_map(
            selected_atom_indices=parsed_input["selected_atom_indices"],
            assignment_blocks=parsed_input["assignment_blocks"],
        )
        missing_sites = [
            site
            for site in parsed_input["selected_atom_indices"]
            if len(site_option_map.get(site, [])) == 0
        ]
        if len(missing_sites) > 0:
            raise ValueError(
                f"No se puede ejecutar Smile-it con sitios sin cobertura: {missing_sites}."
            )

        _emit_log(
            log_callback,
            level="info",
            source="smileit.plugin",
            message="Cobertura de bloques validada. Iniciando generación combinatoria.",
            payload={
                "selected_sites": parsed_input["selected_atom_indices"],
                "blocks": len(parsed_input["assignment_blocks"]),
                "site_options": sum(
                    len(options) for options in site_option_map.values()
                ),
                "r_substitutes": r_substitutes,
                "num_bonds": num_bonds,
                "max_structures": max_structures,
            },
        )

        progress_callback(
            20, "running", "Generando derivados por bloques de asignación."
        )

        generated_candidates, traceability_rows, truncated = _generate_derivatives(
            principal_smiles=canonical_principal,
            selected_atom_indices=parsed_input["selected_atom_indices"],
            site_option_map=site_option_map,
            r_substitutes=r_substitutes,
            num_bonds=num_bonds,
            max_structures=max_structures,
            export_name_base=export_name_base,
            export_padding=export_padding,
            progress_callback=progress_callback,
            log_callback=log_callback,
        )

        progress_callback(
            85, "running", "Consolidando y renderizando resultado final de Smile-it."
        )

        generated_structures = _materialize_generated_structures(
            principal_smiles=canonical_principal,
            generated_candidates=generated_candidates,
            progress_callback=progress_callback,
            log_callback=log_callback,
        )

        result = SmileitResult(
            total_generated=len(generated_structures),
            generated_structures=generated_structures,
            traceability_rows=traceability_rows,
            truncated=truncated,
            principal_smiles=canonical_principal,
            selected_atom_indices=parsed_input["selected_atom_indices"],
            export_name_base=export_name_base,
            export_padding=export_padding,
            references=parsed_input["references"],
        )

        _emit_log(
            log_callback,
            level="info",
            source="smileit.plugin",
            message="Ejecución Smile-it finalizada.",
            payload={
                "total_generated": result["total_generated"],
                "truncated": result["truncated"],
            },
        )

        progress_callback(
            100,
            "completed",
            f"Smile-it completado con {result['total_generated']} derivados.",
        )

        return cast(JSONMap, dict(result))
    finally:
        # Liberar memoria aun cuando la ejecución termine con error o pause.
        clear_smileit_caches()
