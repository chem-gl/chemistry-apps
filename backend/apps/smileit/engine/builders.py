"""engine/builders.py: Estructuras de datos internas y constructores del motor Smile-it.

Objetivo: definir dataclasses de estado (GeneratedNode, ExpansionContext, SiteOption, etc.)
y las funciones que construyen opciones de sitio, ordenan trazabilidad y resuelven fusiones
en paralelo. No depende de engine/generation ni de plugin para evitar ciclos.
"""

from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Final

from .._naming import build_derivative_identifier
from ..types import (
    SmileitPlaceholderAssignment,
    SmileitResolvedAssignmentBlock,
    SmileitResolvedSubstituent,
    SmileitSubstitutionTraceEvent,
    SmileitTraceabilityRow,
)
from .fusion import fuse_molecules

GENERATION_CONCURRENCY_MIN_BATCH: Final[int] = 8
MAX_GENERATION_WORKERS: Final[int] = max(1, min(8, (os.cpu_count() or 2)))


# =========================
# DATACLASES DE ESTADO INTERNO
# =========================


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


@dataclass
class ExpansionContext:
    """Estado compartido para expansión de nodos sin listas de parámetros largas."""

    principal_smiles: str
    selected_atom_indices: list[int]
    site_option_map: dict[int, list[SiteOption]]
    allowed_signatures_by_site: dict[int, set[SiteOptionSignature]]
    num_bonds: int
    seen_smiles: set[str]
    attempt_cache: dict[FusionAttemptKey, str | None]
    export_name_base: str
    export_padding: int
    generated_candidates: list[GeneratedCandidate]
    derivative_rows: list[SmileitTraceabilityRow]
    next_frontier_nodes: list[GeneratedNode]
    max_structures: int | None


@dataclass(frozen=True)
class SiteOption:
    """Opción ejecutable por sitio derivada de la unión de bloques activos."""

    site_atom_index: int
    block_label: str
    block_priority: int
    substituent: SmileitResolvedSubstituent


type SiteOptionSignature = tuple[str, str, int, str, int]


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

    principal_site_atom_index: int
    resolved_site_atom_index: int
    site_option: SiteOption
    selected_anchor: int
    bond_order: int
    attempt_key: FusionAttemptKey


# =========================
# CONSTRUCTORES DE OPCIONES Y TRAZABILIDAD
# =========================


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


def _build_allowed_signatures_by_site(
    site_option_map: dict[int, list[SiteOption]],
) -> dict[int, set[SiteOptionSignature]]:
    """Construye firma permitida por sitio para validar pertenencia de bloque."""
    allowed_signatures_by_site: dict[int, set[SiteOptionSignature]] = {}

    for site_atom_index, site_options in site_option_map.items():
        signatures_for_site: set[SiteOptionSignature] = set()
        for site_option in site_options:
            signatures_for_site.add(
                (
                    site_option.block_label,
                    site_option.substituent["stable_id"],
                    site_option.substituent["version"],
                    site_option.substituent["smiles"],
                    site_option.substituent["selected_atom_index"],
                )
            )
        allowed_signatures_by_site[site_atom_index] = signatures_for_site

    return allowed_signatures_by_site


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


def _build_structure_name(base_name: str, index_value: int, padding: int) -> str:
    """Construye nombre determinista para exportación reproducible."""
    _ = padding
    return build_derivative_identifier(base_name, index_value)


def _build_pending_fusion_attempts(
    node: GeneratedNode,
    selected_atom_indices: list[int],
    site_option_map: dict[int, list[SiteOption]],
    resolved_site_indices: dict[int, int],
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
        resolved_site_atom_index = resolved_site_indices.get(site_atom_index)
        if resolved_site_atom_index is None:
            continue

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
                        principal_site_atom_index=site_atom_index,
                        resolved_site_atom_index=resolved_site_atom_index,
                        site_option=site_option,
                        selected_anchor=selected_anchor,
                        bond_order=bond_order,
                        attempt_key=FusionAttemptKey(
                            principal_smiles=node.smiles,
                            site_atom_index=resolved_site_atom_index,
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
