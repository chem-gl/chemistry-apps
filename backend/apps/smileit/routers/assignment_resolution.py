"""routers_pkg/assignment_resolution.py: Resolución de bloques para create de Smile-it.

Concentra la lógica declarativa de bloques/categorías/sustituyentes para
mantener la capa HTTP desacoplada de reglas de composición.
"""

from __future__ import annotations

from typing import cast

from ..catalog import (
    list_active_categories,
    list_active_patterns,
    normalize_manual_substituent,
    resolve_catalog_substituent_reference,
    resolve_catalog_substituents_by_categories,
)
from ..types import (
    SmileitAssignmentBlockInput,
    SmileitCatalogEntry,
    SmileitJobCreatePayload,
    SmileitResolvedAssignmentBlock,
    SmileitResolvedSubstituent,
)


def _expand_catalog_entry_to_resolved(
    entry: SmileitCatalogEntry,
    source_kind: str,
) -> list[SmileitResolvedSubstituent]:
    """Expande un catálogo con múltiples anclajes a sustituyentes ejecutables."""
    output: list[SmileitResolvedSubstituent] = []
    for anchor_index in entry["anchor_atom_indices"]:
        output.append(
            SmileitResolvedSubstituent(
                source_kind=cast("str", source_kind),
                stable_id=entry["stable_id"],
                version=entry["version"],
                name=entry["name"],
                smiles=entry["smiles"],
                selected_atom_index=int(anchor_index),
                categories=[str(value) for value in entry["categories"]],
            )
        )
    return output


def _dedupe_resolved_substituents(
    entries: list[SmileitResolvedSubstituent],
) -> list[SmileitResolvedSubstituent]:
    """Deduplica sustituyentes resueltos preservando orden estable."""
    output: list[SmileitResolvedSubstituent] = []
    seen: set[tuple[str, int, int, str]] = set()

    for entry in entries:
        dedupe_key = (
            entry["stable_id"],
            entry["version"],
            entry["selected_atom_index"],
            entry["source_kind"],
        )
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        output.append(entry)

    return output


def _dedupe_reference_rows(
    rows: list[dict[str, str | int]],
    left_key: str,
    right_key: str,
) -> list[dict[str, str | int]]:
    """Deduplica referencias por dos llaves preservando orden de inserción."""
    output: list[dict[str, str | int]] = []
    seen_rows: set[tuple[str, int]] = set()

    for row in rows:
        left_value = str(row[left_key])
        right_value = int(row[right_key])
        dedupe_key = (left_value, right_value)
        if dedupe_key in seen_rows:
            continue
        seen_rows.add(dedupe_key)
        output.append({left_key: left_value, right_key: right_value})

    return output


def _resolve_block_substituents(
    block: SmileitAssignmentBlockInput,
    category_map: dict[str, dict[str, str | int]],
    category_references: list[dict[str, str | int]],
    catalog_references: list[dict[str, str | int]],
) -> list[SmileitResolvedSubstituent]:
    """Resuelve sustituyentes efectivos de un bloque individual."""
    block_entries: list[SmileitResolvedSubstituent] = []

    for category_key in block["category_keys"]:
        category_entry = category_map.get(category_key)
        if category_entry is None:
            raise ValueError(
                f"La categoría '{category_key}' no existe o no está activa."
            )
        category_references.append(
            {
                "key": str(category_entry["key"]),
                "version": int(category_entry["version"]),
            }
        )

    for entry in resolve_catalog_substituents_by_categories(block["category_keys"]):
        block_entries.extend(_expand_catalog_entry_to_resolved(entry, "catalog"))
        catalog_references.append(
            {
                "stable_id": entry["stable_id"],
                "version": entry["version"],
            }
        )

    for reference in block["substituent_refs"]:
        catalog_entry = resolve_catalog_substituent_reference(reference)
        block_entries.extend(
            _expand_catalog_entry_to_resolved(catalog_entry, "catalog")
        )
        catalog_references.append(
            {
                "stable_id": catalog_entry["stable_id"],
                "version": catalog_entry["version"],
            }
        )

    for manual_entry in block["manual_substituents"]:
        normalized_entry = normalize_manual_substituent(manual_entry)
        block_entries.extend(
            _expand_catalog_entry_to_resolved(normalized_entry, "manual")
        )

    return _dedupe_resolved_substituents(block_entries)


def resolve_assignment_blocks(
    payload: SmileitJobCreatePayload,
) -> tuple[list[SmileitResolvedAssignmentBlock], dict[str, list[dict[str, str | int]]]]:
    """Resuelve bloques con sustituyentes efectivos y referencias versionadas."""
    categories_catalog = list_active_categories()
    category_map: dict[str, dict[str, str | int]] = {
        entry["key"]: {
            "key": entry["key"],
            "version": entry["version"],
        }
        for entry in categories_catalog
    }

    resolved_blocks: list[SmileitResolvedAssignmentBlock] = []
    category_references: list[dict[str, str | int]] = []
    catalog_references: list[dict[str, str | int]] = []

    for priority, block in enumerate(payload["assignment_blocks"], start=1):
        resolved_entries = _resolve_block_substituents(
            block=block,
            category_map=category_map,
            category_references=category_references,
            catalog_references=catalog_references,
        )
        if len(resolved_entries) == 0:
            raise ValueError(
                f"El bloque '{block['label']}' no resolvió sustituyentes efectivos."
            )

        resolved_blocks.append(
            SmileitResolvedAssignmentBlock(
                label=block["label"],
                priority=priority,
                site_atom_indices=block["site_atom_indices"],
                resolved_substituents=resolved_entries,
            )
        )

    pattern_references: list[dict[str, str | int]] = [
        {
            "stable_id": entry["stable_id"],
            "version": entry["version"],
            "pattern_type": entry["pattern_type"],
        }
        for entry in list_active_patterns()
    ]

    references = {
        "substituents": _dedupe_reference_rows(
            catalog_references, "stable_id", "version"
        ),
        "categories": _dedupe_reference_rows(category_references, "key", "version"),
        "patterns": pattern_references,
    }

    return resolved_blocks, references


def validate_effective_coverage(
    selected_sites: list[int],
    resolved_blocks: list[SmileitResolvedAssignmentBlock],
) -> list[int]:
    """Verifica cobertura final de sitios usando unión de bloques por cada átomo."""
    selected_set = set(selected_sites)
    covered_sites: set[int] = set()

    for block in resolved_blocks:
        if len(block["resolved_substituents"]) == 0:
            continue
        for site_atom_index in block["site_atom_indices"]:
            if site_atom_index in selected_set:
                covered_sites.add(site_atom_index)

    return [
        site_atom_index
        for site_atom_index in selected_sites
        if site_atom_index not in covered_sites
    ]
