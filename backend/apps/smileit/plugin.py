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
import re
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
from .engine import canonicalize_smiles, fuse_molecules, render_molecule_svg
from .types import (
    SmileitGeneratedStructure,
    SmileitInput,
    SmileitResolvedAssignmentBlock,
    SmileitResolvedSubstituent,
    SmileitResult,
    SmileitSubstituentPreview,
    SmileitSubstitutionTraceEvent,
    SmileitTraceabilityRow,
)

logger = logging.getLogger(__name__)
LOG_PROGRESS_BATCH_SIZE: Final[int] = 50


@dataclass
class GeneratedNode:
    """Nodo interno con estructura derivada y trazabilidad incremental."""

    smiles: str
    traceability: list[SmileitSubstitutionTraceEvent]


@dataclass(frozen=True)
class SiteOption:
    """Opción ejecutable por sitio derivada de la unión de bloques activos."""

    site_atom_index: int
    block_label: str
    block_priority: int
    substituent: SmileitResolvedSubstituent


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


def _build_substituent_previews(
    traceability: list[SmileitSubstitutionTraceEvent],
) -> list[SmileitSubstituentPreview]:
    """Construye previsualizaciones únicas de sustituyentes aplicados en el derivado."""
    previews: list[SmileitSubstituentPreview] = []
    seen_preview_keys: set[tuple[str, str]] = set()

    for event in traceability:
        substituent_smiles = event["substituent_smiles"].strip()
        if substituent_smiles == "":
            continue

        preview_key = (event["substituent_name"], substituent_smiles)
        if preview_key in seen_preview_keys:
            continue

        seen_preview_keys.add(preview_key)
        previews.append(
            SmileitSubstituentPreview(
                name=event["substituent_name"],
                smiles=substituent_smiles,
                svg=_tint_svg(render_molecule_svg(substituent_smiles), "#2563eb"),
            )
        )

    return previews


def _build_structure_name(base_name: str, index_value: int, padding: int) -> str:
    """Construye nombre determinista para exportación reproducible."""
    safe_padding = max(1, padding)
    return f"{base_name}_{index_value:0{safe_padding}d}"


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


def _generate_derivatives(
    principal_smiles: str,
    selected_atom_indices: list[int],
    site_option_map: dict[int, list[SiteOption]],
    r_substitutes: int,
    num_bonds: int,
    allow_repeated: bool,
    max_structures: int | None,
    export_name_base: str,
    export_padding: int,
    progress_callback: PluginProgressCallback,
    log_callback: PluginLogCallback | None,
) -> tuple[list[SmileitGeneratedStructure], list[SmileitTraceabilityRow], bool]:
    """Genera derivados con trazabilidad por ronda y por sitio."""
    principal_svg = _tint_svg(render_molecule_svg(principal_smiles), "#2f855a")
    nodes: list[GeneratedNode] = [
        GeneratedNode(smiles=principal_smiles, traceability=[])
    ]
    seen_smiles: set[str] = {principal_smiles}

    derivative_rows: list[SmileitTraceabilityRow] = []
    generated_structures: list[SmileitGeneratedStructure] = []
    truncated = False
    derivative_counter = 1
    last_reported_generated = 0

    for round_index in range(1, r_substitutes + 1):
        snapshot = list(nodes)
        new_nodes: list[GeneratedNode] = []

        for node_index, node in enumerate(snapshot, start=1):
            derivative_counter, reached_limit = _expand_derivatives_from_node(
                node=node,
                round_index=round_index,
                selected_atom_indices=selected_atom_indices,
                site_option_map=site_option_map,
                num_bonds=num_bonds,
                allow_repeated=allow_repeated,
                seen_smiles=seen_smiles,
                export_name_base=export_name_base,
                export_padding=export_padding,
                principal_svg=principal_svg,
                derivative_counter=derivative_counter,
                generated_structures=generated_structures,
                derivative_rows=derivative_rows,
                new_nodes=new_nodes,
                max_structures=max_structures,
            )

            current_generated = len(generated_structures)
            if current_generated - last_reported_generated >= LOG_PROGRESS_BATCH_SIZE:
                progress_percentage = _build_generation_progress_percentage(
                    round_index=round_index,
                    total_rounds=r_substitutes,
                    node_index=node_index,
                    node_total=len(snapshot),
                )
                progress_callback(
                    progress_percentage,
                    "running",
                    (
                        "Generando derivados por bloques de asignación. "
                        f"Estructuras acumuladas: {current_generated}."
                    ),
                )
                _emit_log(
                    log_callback,
                    level="info",
                    source="smileit.plugin",
                    message="Avance de generación Smile-it.",
                    payload={
                        "generated_structures": current_generated,
                        "round_index": round_index,
                        "processed_nodes": node_index,
                        "round_nodes": len(snapshot),
                    },
                )
                last_reported_generated = current_generated

            if reached_limit:
                _emit_log(
                    log_callback,
                    level="warning",
                    source="smileit.plugin",
                    message="Se alcanzó el límite configurado de estructuras para Smile-it.",
                    payload={
                        "generated_structures": len(generated_structures),
                        "max_structures": max_structures,
                    },
                )
                truncated = True
                return generated_structures, derivative_rows, truncated

        if len(new_nodes) == 0:
            break

        nodes.extend(new_nodes)
        progress_percentage = 20 + int((round_index / max(1, r_substitutes)) * 60)
        progress_callback(
            min(80, max(20, progress_percentage)),
            "running",
            (
                f"Ronda {round_index}/{r_substitutes} completada. "
                f"Estructuras acumuladas: {len(generated_structures)}."
            ),
        )
        _emit_log(
            log_callback,
            level="info",
            source="smileit.plugin",
            message="Ronda de generación completada.",
            payload={
                "round_index": round_index,
                "total_rounds": r_substitutes,
                "generated_structures": len(generated_structures),
            },
        )

    return generated_structures, derivative_rows, truncated


def _expand_derivatives_from_node(
    node: GeneratedNode,
    round_index: int,
    selected_atom_indices: list[int],
    site_option_map: dict[int, list[SiteOption]],
    num_bonds: int,
    allow_repeated: bool,
    seen_smiles: set[str],
    export_name_base: str,
    export_padding: int,
    principal_svg: str,
    derivative_counter: int,
    generated_structures: list[SmileitGeneratedStructure],
    derivative_rows: list[SmileitTraceabilityRow],
    new_nodes: list[GeneratedNode],
    max_structures: int | None,
) -> tuple[int, bool]:
    """Expande derivados desde un nodo base para reducir complejidad ciclomática."""
    for site_atom_index in selected_atom_indices:
        site_options = site_option_map.get(site_atom_index, [])
        if len(site_options) == 0:
            continue

        for site_option in site_options:
            substituent = site_option.substituent
            selected_anchor = int(substituent["selected_atom_index"])
            for bond_order in range(1, num_bonds + 1):
                fused_smiles = fuse_molecules(
                    principal_smiles=node.smiles,
                    substituent_smiles=substituent["smiles"],
                    principal_atom_idx=site_atom_index,
                    substituent_atom_idx=selected_anchor,
                    bond_order=bond_order,
                )
                if fused_smiles is None:
                    continue

                if not allow_repeated and fused_smiles in seen_smiles:
                    continue

                if not allow_repeated:
                    seen_smiles.add(fused_smiles)

                trace_event = SmileitSubstitutionTraceEvent(
                    round_index=round_index,
                    site_atom_index=site_atom_index,
                    block_label=site_option.block_label,
                    block_priority=site_option.block_priority,
                    substituent_name=substituent["name"],
                    substituent_smiles=substituent["smiles"],
                    substituent_stable_id=substituent["stable_id"],
                    substituent_version=substituent["version"],
                    source_kind=substituent["source_kind"],
                    bond_order=bond_order,
                )
                traceability = [*node.traceability, trace_event]
                generated_name = _build_structure_name(
                    base_name=export_name_base,
                    index_value=derivative_counter,
                    padding=export_padding,
                )
                derivative_counter += 1

                generated_structures.append(
                    SmileitGeneratedStructure(
                        smiles=fused_smiles,
                        name=generated_name,
                        svg=_tint_svg(render_molecule_svg(fused_smiles), "#1d4ed8"),
                        scaffold_svg=principal_svg,
                        substituent_svgs=_build_substituent_previews(traceability),
                        traceability=traceability,
                    )
                )
                _append_traceability_rows(
                    rows=derivative_rows,
                    derivative_name=generated_name,
                    derivative_smiles=fused_smiles,
                    traceability=traceability,
                )
                new_nodes.append(
                    GeneratedNode(
                        smiles=fused_smiles,
                        traceability=traceability,
                    )
                )

                if (
                    max_structures is not None
                    and len(generated_structures) >= max_structures
                ):
                    return derivative_counter, True

    return derivative_counter, False


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
    parsed_input = _build_smileit_input(parameters)

    canonical_principal = canonicalize_smiles(parsed_input["principal_smiles"])
    if canonical_principal is None:
        raise ValueError("SMILES principal inválido para Smile-it.")

    options = parsed_input["options"]
    r_substitutes = max(1, min(int(options["r_substitutes"]), MAX_R_SUBSTITUTES))
    num_bonds = max(1, min(int(options["num_bonds"]), MAX_NUM_BONDS))
    max_structures_raw = int(options["max_structures"])
    max_structures = max_structures_raw if max_structures_raw > 0 else None
    allow_repeated = bool(options["allow_repeated"])
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
            "site_options": sum(len(options) for options in site_option_map.values()),
            "r_substitutes": r_substitutes,
            "num_bonds": num_bonds,
            "max_structures": max_structures,
        },
    )

    progress_callback(20, "running", "Generando derivados por bloques de asignación.")

    generated_structures, traceability_rows, truncated = _generate_derivatives(
        principal_smiles=canonical_principal,
        selected_atom_indices=parsed_input["selected_atom_indices"],
        site_option_map=site_option_map,
        r_substitutes=r_substitutes,
        num_bonds=num_bonds,
        allow_repeated=allow_repeated,
        max_structures=max_structures,
        export_name_base=export_name_base,
        export_padding=export_padding,
        progress_callback=progress_callback,
        log_callback=log_callback,
    )

    progress_callback(
        85, "running", "Consolidando resultado y trazabilidad de Smile-it."
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
