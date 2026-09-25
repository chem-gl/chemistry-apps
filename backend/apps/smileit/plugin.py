"""plugin.py: Plugin Smile-it — normalización de parámetros y registro del plugin.

Objetivo: parsear y normalizar el payload del job Smile-it, delegar la generacion
combinatoria al paquete engine y registrar el plugin en PluginRegistry.
La logica pesada de generacion y las estructuras de datos internas viven en
engine/builders.py y engine/generation.py respectivamente.
"""

from __future__ import annotations

from typing import cast

from apps.core.processing import PluginRegistry
from apps.core.types import JSONMap, PluginLogCallback, PluginProgressCallback

from .definitions import (
    DEFAULT_EXPORT_PADDING,
    MAX_NUM_BONDS,
    MAX_R_SUBSTITUTES,
    PLUGIN_NAME,
)
from .engine import (
    clear_smileit_caches,
    parse_smiles_cached,
    remap_anchor_indices_to_canonical,
    validate_smiles,
)
from .engine.builders import _build_site_option_map
from .engine.generation import (
    SMILEIT_LOG_SOURCE,
    _emit_log,
    _generate_derivatives,
    _materialize_generated_structures,
)
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


# =========================
# REMAPEO AL ESPACIO CANÓNICO
# =========================


def _describe_principal_atoms(principal_smiles: str) -> int:
    """Cuenta los átomos del principal para mensajes de error accionables."""
    parsed = parse_smiles_cached(principal_smiles)
    return 0 if parsed is None else int(parsed.GetNumAtoms())


def _remap_failure_message(
    principal_smiles: str,
    raw_sites: list[int],
    sites_label: str,
) -> str:
    """Construye el error cuando los sitios no se pueden llevar al espacio canónico."""
    if not validate_smiles(principal_smiles):
        return "SMILES principal inválido para Smile-it."
    return (
        f"Los sitios de sustitución ({sites_label}) {raw_sites} no se pudieron "
        f"mapear al SMILES canónico de {principal_smiles!r} "
        f"({_describe_principal_atoms(principal_smiles)} átomos). "
        "Verifica que los índices correspondan al SMILES principal de entrada."
    )


def _ensure_complete_remap(
    principal_smiles: str,
    raw_sites: list[int],
    remapped_sites: list[int],
    sites_label: str,
) -> None:
    """Exige que cada sitio crudo tenga su contraparte canónica.

    `remap_anchor_indices_to_canonical` descarta en silencio los índices que no
    encuentran match (fuera de rango, p. ej.). Si no se aborta aquí, el motor
    genera 0 derivados y el job queda `completed` sin ningún aviso.
    """
    if len(remapped_sites) == len(raw_sites):
        return
    raise ValueError(_remap_failure_message(principal_smiles, raw_sites, sites_label))


def _canonical_site_list(remapped_sites: list[int]) -> list[int]:
    """Restablece orden y unicidad que el `validate` del serializer garantiza.

    El mapeo crudo→canónico no es monótono, por lo que los índices remapeados
    pueden llegar desordenados respecto del SMILES canónico.
    """
    return sorted(set(remapped_sites))


def _remap_principal_and_sites(
    principal_smiles: str,
    raw_sites: list[int],
    sites_label: str,
) -> tuple[str, list[int]]:
    """Canoniza el principal y traduce sus sitios crudos a ese espacio.

    Al canonicalizar, RDKit puede reordenar los átomos: los sitios elegidos sobre
    el SMILES de entrada caerían en átomos no sustituibles del canónico y la
    generación terminaría en 0 derivados sin aviso. Con un principal ya canónico
    el mapeo es identidad, así que el remapeo es idempotente.
    """
    remapped = remap_anchor_indices_to_canonical(principal_smiles, raw_sites)
    if remapped is None:
        raise ValueError(
            _remap_failure_message(principal_smiles, raw_sites, sites_label)
        )

    canonical_principal, remapped_sites = remapped
    _ensure_complete_remap(principal_smiles, raw_sites, remapped_sites, sites_label)
    return canonical_principal, _canonical_site_list(remapped_sites)


def _remap_sites_to_canonical_space(
    principal_smiles: str,
    raw_sites: list[int],
    sites_label: str,
) -> list[int]:
    """Devuelve solo los sitios ya en espacio canónico (usado por los bloques)."""
    return _remap_principal_and_sites(principal_smiles, raw_sites, sites_label)[1]


def _canonicalize_principal_with_sites(
    principal_smiles: str,
    selected_atom_indices: list[int],
) -> tuple[str, list[int]]:
    """Canoniza el principal y devuelve sus sitios ya expresados en ese espacio."""
    if len(selected_atom_indices) == 0:
        raise ValueError("Smile-it requiere al menos un sitio de sustitución.")

    return _remap_principal_and_sites(
        principal_smiles, selected_atom_indices, "selected_atom_indices"
    )


def _remap_assignment_blocks(
    principal_smiles: str,
    assignment_blocks: list[SmileitResolvedAssignmentBlock],
) -> list[SmileitResolvedAssignmentBlock]:
    """Remapea los sitios de cada bloque al mismo espacio canónico que el principal."""
    remapped_blocks: list[SmileitResolvedAssignmentBlock] = []
    for block in assignment_blocks:
        remapped_block = block.copy()
        if len(block["site_atom_indices"]) > 0:
            remapped_block["site_atom_indices"] = _remap_sites_to_canonical_space(
                principal_smiles=principal_smiles,
                raw_sites=block["site_atom_indices"],
                sites_label=f"sites del bloque {block['label']!r}",
            )
        remapped_blocks.append(remapped_block)
    return remapped_blocks


def _canonicalize_generation_input(
    parsed_input: SmileitInput,
    log_callback: PluginLogCallback | None,
) -> tuple[str, list[int], list[SmileitResolvedAssignmentBlock]]:
    """Lleva principal, sitios y bloques al espacio canónico antes de generar.

    Retorna `(canonical_principal, canonical_sites, canonical_blocks)`. Si el
    remapeo movió sitios se registra un aviso: así el cambio de espacio queda
    trazable en los logs del job en lugar de ser un fallo silencioso.
    """
    raw_principal = parsed_input["principal_smiles"]
    raw_sites = parsed_input["selected_atom_indices"]
    canonical_principal, canonical_sites = _canonicalize_principal_with_sites(
        principal_smiles=raw_principal,
        selected_atom_indices=raw_sites,
    )
    canonical_blocks = _remap_assignment_blocks(
        principal_smiles=raw_principal,
        assignment_blocks=parsed_input["assignment_blocks"],
    )

    if canonical_sites != raw_sites:
        _emit_log(
            log_callback,
            level="warning",
            source=SMILEIT_LOG_SOURCE,
            message=(
                "Los sitios de sustitución se remapearon al espacio canónico "
                "del SMILES principal."
            ),
            payload={
                "raw_principal_smiles": raw_principal,
                "raw_sites": raw_sites,
                "canonical_principal_smiles": canonical_principal,
                "canonical_sites": canonical_sites,
            },
        )

    return canonical_principal, canonical_sites, canonical_blocks


@PluginRegistry.register(PLUGIN_NAME)
def smileit_plugin(
    parameters: JSONMap,
    progress_callback: PluginProgressCallback,
    log_callback: PluginLogCallback | None = None,
) -> JSONMap:
    """Ejecuta generación combinatoria de Smile-it con trazabilidad completa."""
    try:
        parsed_input = _build_smileit_input(parameters)

        # Los sitios llegan en el espacio del SMILES crudo y RDKit puede reordenar
        # átomos al canonicalizar: sin este remapeo los sitios válidos caen en
        # átomos no sustituibles y el job termina `completed` con 0 derivados.
        canonical_principal, canonical_sites, canonical_blocks = (
            _canonicalize_generation_input(parsed_input, log_callback)
        )

        options = parsed_input["options"]
        r_substitutes = max(1, min(int(options["r_substitutes"]), MAX_R_SUBSTITUTES))
        num_bonds = max(1, min(int(options["num_bonds"]), MAX_NUM_BONDS))
        max_structures_raw = int(options["max_structures"])
        max_structures = max_structures_raw if max_structures_raw > 0 else None
        export_name_base = options["export_name_base"].strip() or "SMILEIT"
        export_padding = int(options["export_padding"])

        progress_callback(5, "running", "Validando cobertura de bloques para Smile-it.")

        site_option_map = _build_site_option_map(
            selected_atom_indices=canonical_sites,
            assignment_blocks=canonical_blocks,
        )
        missing_sites = [
            site for site in canonical_sites if len(site_option_map.get(site, [])) == 0
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
                "selected_sites": canonical_sites,
                "blocks": len(canonical_blocks),
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
            selected_atom_indices=canonical_sites,
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
            selected_atom_indices=canonical_sites,
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
