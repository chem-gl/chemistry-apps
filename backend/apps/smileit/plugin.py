"""plugin.py: Plugin Smile-it — normalización de parámetros y registro del plugin.

Objetivo: parsear y normalizar el payload del job Smile-it, delegar la generación
combinatoria a _smileit_engine y registrar el plugin en PluginRegistry.
La lógica pesada de generación y las estructuras de datos internas viven en
_smileit_builders.py y _smileit_engine.py respectivamente.
"""

from __future__ import annotations

from typing import cast

from apps.core.processing import PluginRegistry
from apps.core.types import JSONMap, PluginLogCallback, PluginProgressCallback

from ._smileit_builders import _build_site_option_map
from ._smileit_engine import (
    SMILEIT_LOG_SOURCE,
    _emit_log,
    _generate_derivatives,
    _materialize_generated_structures,
)
from .definitions import (
    DEFAULT_EXPORT_PADDING,
    MAX_NUM_BONDS,
    MAX_R_SUBSTITUTES,
    PLUGIN_NAME,
)
from .engine import canonicalize_smiles, clear_smileit_caches
from .types import (
    SmileitInput,
    SmileitResolvedAssignmentBlock,
    SmileitResolvedSubstituent,
    SmileitResult,
)

# =========================
# NORMALIZACIÓN DE ENTRADA
# =========================


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


def _parse_assignment_blocks(
    raw_blocks: object,
) -> list[SmileitResolvedAssignmentBlock]:
    """Convierte bloques crudos en bloques tipados válidos."""
    if not isinstance(raw_blocks, list):
        return []

    assignment_blocks: list[SmileitResolvedAssignmentBlock] = []
    for raw_item in raw_blocks:
        if isinstance(raw_item, dict):
            assignment_blocks.append(_normalize_assignment_block(raw_item))
    return assignment_blocks


def _parse_selected_atom_indices(raw_selected: object) -> list[int]:
    """Normaliza índices de átomos seleccionados desde parámetros serializados."""
    if not isinstance(raw_selected, list):
        return []
    return [int(item) for item in raw_selected]


def _parse_references(
    raw_references: object,
) -> dict[str, list[dict[str, str | int]]]:
    """Convierte referencias libres a un mapa tipado y estable."""
    if not isinstance(raw_references, dict):
        return {}

    references: dict[str, list[dict[str, str | int]]] = {}
    for ref_key, ref_value in raw_references.items():
        if not isinstance(ref_value, list):
            continue

        typed_rows: list[dict[str, str | int]] = []
        for row in ref_value:
            if not isinstance(row, dict):
                continue
            typed_rows.append(
                {
                    str(key): int(value) if isinstance(value, int) else str(value)
                    for key, value in row.items()
                }
            )
        references[str(ref_key)] = typed_rows

    return references


def _build_smileit_input(parameters: JSONMap) -> SmileitInput:
    """Construye entrada tipada para el plugin desde parámetros serializados."""
    assignment_blocks = _parse_assignment_blocks(
        parameters.get("assignment_blocks", [])
    )
    selected_atom_indices = _parse_selected_atom_indices(
        parameters.get("selected_atom_indices", [])
    )
    references = _parse_references(parameters.get("references", {}))

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
            source=SMILEIT_LOG_SOURCE,
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
            source=SMILEIT_LOG_SOURCE,
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
