"""routers_pkg/exports.py: Helpers de exportación y resumen para endpoints Smile-it.

Centraliza construcción de CSV/SMILES/ZIP y utilidades de resumen para
mantener el ViewSet enfocado en la capa HTTP.
"""

from __future__ import annotations

import re
from io import BytesIO
from typing import cast
from zipfile import ZIP_DEFLATED, ZipFile

from apps.core.models import ScientificJob
from apps.core.reporting import escape_csv_cell
from apps.core.types import JSONMap

from ..engine import render_derivative_svg_with_substituent_highlighting, tint_svg
from ..schemas import SmileitJobResponseSerializer
from ..types import SmileitGeneratedStructure, SmileitResult


def _build_pipe_joined_values(raw_values: list[str]) -> str:
    """Une valores no vacíos con `|` preservando orden y evitando repetición consecutiva."""
    normalized_values: list[str] = []
    for raw_value in raw_values:
        cleaned_value = raw_value.strip()
        if cleaned_value == "":
            continue
        normalized_values.append(cleaned_value)
    return "|".join(normalized_values)


def _build_compound_name(
    principal_smiles: str,
    substituent_smiles: str,
    applied_positions: str,
) -> str:
    """Construye un nombre compuesto legible a partir de los SMILES componentes."""
    if substituent_smiles == "":
        return principal_smiles
    if applied_positions == "":
        return f"{principal_smiles} + {substituent_smiles}"
    return f"{principal_smiles} + {substituent_smiles} @ {applied_positions}"


def build_structures_csv(results: SmileitResult) -> str:
    """Construye CSV químico compacto con una fila por derivado."""
    structures = results.get("generated_structures", [])
    principal_smiles = str(results.get("principal_smiles", ""))

    lines: list[str] = [
        "compound_name,principal_smiles,substituent_smiles,applied_positions,generated_smiles"
    ]

    for structure in structures:
        traceability = sorted(
            structure.get("traceability", []),
            key=lambda event: (
                int(event.get("site_atom_index", 0)),
                int(event.get("round_index", 0)),
                int(event.get("block_priority", 0)),
                str(event.get("substituent_name", "")),
            ),
        )
        substituent_smiles = _build_pipe_joined_values(
            [str(event.get("substituent_smiles", "")) for event in traceability]
        )
        applied_positions = _build_pipe_joined_values(
            [str(event.get("site_atom_index", "")) for event in traceability]
        )
        compound_name = _build_compound_name(
            principal_smiles=principal_smiles,
            substituent_smiles=substituent_smiles,
            applied_positions=applied_positions,
        )
        lines.append(
            ",".join(
                [
                    escape_csv_cell(compound_name),
                    escape_csv_cell(principal_smiles),
                    escape_csv_cell(substituent_smiles),
                    escape_csv_cell(applied_positions),
                    escape_csv_cell(str(structure.get("smiles", ""))),
                ]
            )
        )

    return "\n".join(lines)


def build_traceability_csv(results: SmileitResult) -> str:
    """Construye CSV de trazabilidad sitio -> sustituyente por derivado."""
    rows = results.get("traceability_rows", [])

    lines: list[str] = [
        "derivative_name,derivative_smiles,round_index,site_atom_index,"
        "block_label,block_priority,substituent_name,substituent_smiles,substituent_stable_id,"
        "substituent_version,source_kind,bond_order"
    ]

    for row in rows:
        lines.append(
            ",".join(
                [
                    escape_csv_cell(str(row.get("derivative_name", ""))),
                    escape_csv_cell(str(row.get("derivative_smiles", ""))),
                    escape_csv_cell(str(row.get("round_index", ""))),
                    escape_csv_cell(str(row.get("site_atom_index", ""))),
                    escape_csv_cell(str(row.get("block_label", ""))),
                    escape_csv_cell(str(row.get("block_priority", ""))),
                    escape_csv_cell(str(row.get("substituent_name", ""))),
                    escape_csv_cell(str(row.get("substituent_smiles", ""))),
                    escape_csv_cell(str(row.get("substituent_stable_id", ""))),
                    escape_csv_cell(str(row.get("substituent_version", ""))),
                    escape_csv_cell(str(row.get("source_kind", ""))),
                    escape_csv_cell(str(row.get("bond_order", ""))),
                ]
            )
        )

    return "\n".join(lines)


def build_enumerated_smiles_export(results: SmileitResult) -> str:
    """Construye export SMILES: principal primero y luego solo derivados."""
    structures = results.get("generated_structures", [])
    principal_smiles = str(results.get("principal_smiles", ""))

    lines: list[str] = [principal_smiles]
    for structure in structures:
        lines.append(str(structure.get("smiles", "")))
    return "\n".join(lines)


def _sanitize_zip_entry_base(raw_name: str, fallback_name: str) -> str:
    """Normaliza nombre de archivo para entradas ZIP evitando caracteres inválidos."""
    cleaned_name = re.sub(r"[^A-Za-z0-9]+", "_", raw_name).strip("_")
    if cleaned_name == "":
        cleaned_name = fallback_name
    return cleaned_name[:64]


def build_derivations_images_zip(results: SmileitResult) -> bytes:
    """Construye ZIP server-side con SVG por derivado y un TXT con SMILES generados."""
    principal_smiles = str(results.get("principal_smiles", ""))
    structures = results.get("generated_structures", [])

    output_buffer = BytesIO()
    used_file_bases: set[str] = set()
    smiles_lines: list[str] = (
        [principal_smiles] if principal_smiles.strip() != "" else []
    )

    with ZipFile(output_buffer, mode="w", compression=ZIP_DEFLATED) as zip_file:
        for index, structure in enumerate(structures):
            derivative_smiles = str(structure.get("smiles", "")).strip()
            if derivative_smiles == "":
                continue

            smiles_lines.append(derivative_smiles)
            fallback_name = f"structure_{str(index + 1).zfill(5)}"
            raw_name = str(structure.get("name", ""))
            file_base = _sanitize_zip_entry_base(raw_name, fallback_name)

            if file_base in used_file_bases:
                suffix = 2
                while f"{file_base}_{suffix}" in used_file_bases:
                    suffix += 1
                file_base = f"{file_base}_{suffix}"
            used_file_bases.add(file_base)

            placeholder_assignments = cast(
                list[dict[str, str | int]],
                structure.get("placeholder_assignments", []),
            )
            substituent_smiles_list = [
                str(assignment.get("substituent_smiles", ""))
                for assignment in placeholder_assignments
                if str(assignment.get("substituent_smiles", "")) != ""
            ]
            principal_site_atom_indices = [
                int(assignment.get("site_atom_index", -1))
                for assignment in placeholder_assignments
                if int(assignment.get("site_atom_index", -1)) >= 0
            ]

            rendered_svg = render_derivative_svg_with_substituent_highlighting(
                principal_smiles=principal_smiles,
                derivative_smiles=derivative_smiles,
                substituent_smiles_list=substituent_smiles_list,
                principal_site_atom_indices=principal_site_atom_indices,
                image_width=400,
                image_height=400,
            )
            tinted_svg = tint_svg(rendered_svg, "#2f855a")
            if tinted_svg.strip() == "":
                continue

            zip_file.writestr(f"{file_base}.svg", tinted_svg)

        zip_file.writestr("generated_smiles.txt", "\n".join(smiles_lines))

    output_buffer.seek(0)
    return output_buffer.getvalue()


def build_smileit_summary_payload(job: ScientificJob) -> JSONMap:
    """Genera respuesta de retrieve sin estructuras completas para evitar payload masivo."""
    serialized_payload = SmileitJobResponseSerializer(job).data
    payload = cast(JSONMap, dict(serialized_payload))
    raw_results = payload.get("results")
    if not isinstance(raw_results, dict):
        return payload

    normalized_results = cast(JSONMap, dict(raw_results))
    normalized_results["generated_structures"] = []
    payload["results"] = normalized_results
    return payload


def resolve_job_structure_by_index(
    results: SmileitResult | None,
    structure_index: int,
) -> SmileitGeneratedStructure | None:
    """Resuelve un derivado por índice absoluto dentro de resultados persistidos."""
    if results is None:
        return None

    structures = results.get("generated_structures", [])
    if structure_index < 0 or structure_index >= len(structures):
        return None

    return cast(SmileitGeneratedStructure, structures[structure_index])
