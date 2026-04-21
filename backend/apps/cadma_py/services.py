"""services.py: Servicios de parsing, trazabilidad y permisos para CADMA Py.

Este módulo prepara datasets reutilizables para el protocolo CADMA inspirado en
el legado del proyecto. Combina CSVs provenientes de Smile-it, Toxicity
Properties y SA Score, calcula descriptores fisicoquímicos faltantes con RDKit
y persiste familias de referencia con alcance por rol/grupo.
"""

from __future__ import annotations

import csv
import hashlib
import json
from io import BytesIO, StringIO
from pathlib import Path
from typing import cast
from zipfile import ZIP_DEFLATED, ZipFile

from django.contrib.auth.models import AbstractUser
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import UploadedFile
from rdkit import Chem
from rdkit.Chem import Crippen, Descriptors, Lipinski, rdMolDescriptors

from apps.core.identity.services import AuthorizationService
from apps.core.models import GroupMembership, ScientificJob
from apps.core.permissions import (
    can_user_delete_entry,
    can_user_edit_entry,
    can_user_view_entry,
    get_source_reference_for_role,
)

from .definitions import ADME_METRIC_NAMES, ALL_METRIC_NAMES
from .literature_catalog import enrich_bundled_sample_rows, get_sample_literature
from .models import CadmaReferenceLibrary, CadmaReferenceSourceFile
from .types import (
    CadmaCompoundRow,
    CadmaMappedSourceConfig,
    CadmaRankingRow,
    CadmaReferenceLibraryView,
    CadmaReferenceSample,
    CadmaReferenceSourceFileView,
)

HEADER_ALIASES: dict[str, tuple[str, ...]] = {
    "name": ("name", "nombre", "label", "compound", "compoundname"),
    "smiles": ("smiles", "smile", "smi"),
    "paper_reference": (
        "paperreference",
        "paper",
        "papertitle",
        "reference",
        "citation",
        "source",
    ),
    "paper_url": ("paperurl", "url", "doi", "paperdoi", "referenceurl"),
    "evidence_note": ("evidencenote", "note", "notes", "comment", "comments"),
    "MW": ("mw", "molecularweight", "molwt"),
    "logP": ("logp",),
    "MR": ("mr", "molarrefractivity"),
    "AtX": ("atx", "heavyatoms", "numheavyatoms"),
    "HBLA": ("hbla", "hbondacceptors", "numhacceptors"),
    "HBLD": ("hbld", "hbonddonors", "numhdonors"),
    "RB": ("rb", "rotatablebonds", "numrotatablebonds"),
    "PSA": ("psa", "tpsa"),
    "DT": ("dt", "devtox", "devtoxscore", "developmentaltoxicity"),
    "M": ("m", "amesscore", "amesprobability", "mutagenicity"),
    "LD50": ("ld50", "ld50mgkg", "ld50oral", "acuteld50"),
    "SA": ("sa", "sascore", "syntheticaccessibility", "ambit", "brsa", "rdkit"),
}

SAMPLE_DEFINITIONS: tuple[CadmaReferenceSample, ...] = (
    {
        "key": "neuro",
        "name": "Legacy Neuro Reference",
        "disease_name": "Neurodegenerative Disorders",
        "description": (
            "Bundled deprecated CADMA reference set kept only as a reproducible "
            "internal comparison baseline."
        ),
        "row_count": 0,
        "source_note": "Deprecated CADMA sample stored in the repository.",
    },
    {
        "key": "rett",
        "name": "Legacy RETT Reference",
        "disease_name": "RETT Syndrome",
        "description": (
            "Bundled deprecated CADMA reference set kept only as a reproducible "
            "internal comparison baseline."
        ),
        "row_count": 0,
        "source_note": "Deprecated CADMA sample stored in the repository.",
    },
)

POSITIVE_LABELS: set[str] = {"positive", "toxic", "high", "yes", "true", "1"}
NEGATIVE_LABELS: set[str] = {"negative", "non-toxic", "safe", "low", "no", "false", "0"}
CSV_CONTENT_TYPE = "text/csv"
CONFIG_FIELD_TO_ALIAS_KEY: dict[str, str] = {
    "smiles_column": "smiles",
    "name_column": "name",
    "paper_reference_column": "paper_reference",
    "paper_url_column": "paper_url",
    "evidence_note_column": "evidence_note",
    "mw_column": "MW",
    "logp_column": "logP",
    "mr_column": "MR",
    "atx_column": "AtX",
    "hbla_column": "HBLA",
    "hbld_column": "HBLD",
    "rb_column": "RB",
    "psa_column": "PSA",
    "dt_column": "DT",
    "m_column": "M",
    "ld50_column": "LD50",
    "sa_column": "SA",
}


def _normalize_header(raw_value: str) -> str:
    return (
        raw_value.replace("\ufeff", "")
        .strip()
        .lower()
        .replace('"', "")
        .replace("_", "")
        .replace("-", "")
        .replace(" ", "")
    )


def _detect_dialect(raw_text: str) -> csv.Dialect:
    sample_text = raw_text[:2048]
    try:
        return csv.Sniffer().sniff(sample_text, delimiters=",;\t")
    except csv.Error:
        return csv.excel


def _normalize_csv_row(row: dict[str, str | None] | None) -> dict[str, str]:
    if row is None:
        return {}

    normalized_row: dict[str, str] = {}
    for raw_key, raw_value in row.items():
        if raw_key is None:
            continue
        normalized_key = _normalize_header(raw_key)
        if normalized_key == "":
            continue
        normalized_row[normalized_key] = (
            "" if raw_value is None else str(raw_value).strip()
        )
    return normalized_row


def _collect_normalized_rows(reader: csv.DictReader[str]) -> list[dict[str, str]]:
    parsed_rows: list[dict[str, str]] = []
    for row in reader:
        normalized_row = _normalize_csv_row(row)
        if len(normalized_row) > 0:
            parsed_rows.append(normalized_row)
    return parsed_rows


def _parse_table_text(raw_text: str) -> list[dict[str, str]]:
    normalized_text = raw_text.strip()
    if normalized_text == "":
        return []

    reader = csv.DictReader(
        StringIO(normalized_text),
        dialect=_detect_dialect(normalized_text),
    )
    return _collect_normalized_rows(reader)


def _get_alias_value(row: dict[str, str], alias_key: str) -> str:
    for candidate_key in HEADER_ALIASES.get(alias_key, (alias_key.lower(),)):
        if candidate_key in row and row[candidate_key].strip() != "":
            return row[candidate_key].strip()
    return ""


def _canonicalize_smiles(smiles_value: str) -> str:
    molecule = Chem.MolFromSmiles(smiles_value)
    if molecule is None:
        raise ValueError(f"SMILES inválido detectado en CADMA Py: {smiles_value}")
    return Chem.MolToSmiles(molecule, isomericSmiles=True)


def _compute_adme_descriptors(smiles_value: str) -> dict[str, float]:
    molecule = Chem.MolFromSmiles(smiles_value)
    if molecule is None:
        raise ValueError(f"No fue posible calcular descriptores para: {smiles_value}")

    return {
        "MW": float(Descriptors.MolWt(molecule)),
        "logP": float(Crippen.MolLogP(molecule)),
        "MR": float(Crippen.MolMR(molecule)),
        "AtX": float(molecule.GetNumHeavyAtoms()),
        "HBLA": float(Lipinski.NumHAcceptors(molecule)),
        "HBLD": float(Lipinski.NumHDonors(molecule)),
        "RB": float(Lipinski.NumRotatableBonds(molecule)),
        "PSA": float(rdMolDescriptors.CalcTPSA(molecule)),
    }


def _normalize_numeric_value(metric_name: str, raw_value: str) -> float | None:
    normalized_text = raw_value.strip()
    if normalized_text == "":
        return None

    lowered_text = normalized_text.lower()
    if metric_name in {"M", "DT"}:
        if lowered_text in POSITIVE_LABELS:
            return 1.0
        if lowered_text in NEGATIVE_LABELS:
            return 0.0

    try:
        numeric_value = float(normalized_text)
    except ValueError:
        return None

    if metric_name in {"M", "DT"} and 1 < numeric_value <= 100:
        return numeric_value / 100.0

    if metric_name == "SA" and numeric_value <= 10:
        return max(0.0, min(100.0, ((10.0 - numeric_value) / 9.0) * 100.0))

    return numeric_value


def _resolve_metric_value(
    row: dict[str, str], metric_name: str, descriptor_values: dict[str, float]
) -> float:
    alias_value = _get_alias_value(row, metric_name)
    parsed_value = _normalize_numeric_value(metric_name, alias_value)
    if parsed_value is not None:
        return parsed_value

    if metric_name in descriptor_values:
        return descriptor_values[metric_name]

    raise ValueError(
        f"La métrica {metric_name} es obligatoria para CADMA Py; revisa los CSV cargados."
    )


def _row_identity_key(row: dict[str, str], fallback_index: int) -> str:
    smiles_value = _get_alias_value(row, "smiles")
    if smiles_value != "":
        try:
            return f"smiles::{_canonicalize_smiles(smiles_value)}"
        except ValueError:
            pass

    name_value = _get_alias_value(row, "name")
    if name_value != "":
        return f"name::{name_value.strip().lower()}"

    return f"row::{fallback_index}"


def _merge_non_empty_values(
    target_row: dict[str, str], incoming_row: dict[str, str]
) -> None:
    for key, value in incoming_row.items():
        normalized_value = value.strip()
        if normalized_value != "":
            target_row[key] = normalized_value


def _merge_rows_by_identity(*tables: list[dict[str, str]]) -> list[dict[str, str]]:
    merged_rows: dict[str, dict[str, str]] = {}
    row_index = 0
    for table in tables:
        for row in table:
            key = _row_identity_key(row, row_index)
            current_row = merged_rows.setdefault(key, {})
            _merge_non_empty_values(current_row, row)
            row_index += 1
    return list(merged_rows.values())


def _coerce_non_negative_int(raw_value: object, default: int = 0) -> int:
    try:
        return max(int(raw_value), 0)
    except (TypeError, ValueError):
        return default


def _coerce_bool(raw_value: object, default: bool) -> bool:
    if isinstance(raw_value, bool):
        return raw_value
    normalized_text = str(raw_value).strip().lower()
    if normalized_text in {"1", "true", "yes", "y", "si", "sí"}:
        return True
    if normalized_text in {"0", "false", "no", "n"}:
        return False
    return default


def _coerce_delimiter(raw_value: object) -> str:
    normalized_text = str(raw_value).strip().lower()
    if normalized_text == "tab":
        return "\t"
    if normalized_text in {",", ";", "\t"}:
        return normalized_text
    return ""


def _infer_file_format(*, filename: str, raw_format: object) -> str:
    normalized_format = str(raw_format).strip().lower()
    if normalized_format in {"csv", "smi"}:
        return normalized_format
    return "smi" if filename.lower().endswith(".smi") else "csv"


def _prepare_source_lines(raw_text: str, skip_lines: int) -> list[str]:
    raw_lines = raw_text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    content_lines = raw_lines[skip_lines:]
    return [
        line.strip()
        for line in content_lines
        if line.strip() != "" and not line.lstrip().startswith("#")
    ]


def _parse_delimited_rows(
    *,
    lines: list[str],
    has_header: bool,
    delimiter: str,
) -> list[dict[str, str]]:
    if len(lines) == 0:
        return []

    normalized_text = "\n".join(lines)
    resolved_delimiter = delimiter or _detect_dialect(normalized_text).delimiter
    reader = csv.reader(StringIO(normalized_text), delimiter=resolved_delimiter)
    parsed_cells = [row for row in reader if any(cell.strip() != "" for cell in row)]
    if len(parsed_cells) == 0:
        return []

    if has_header:
        header_row = parsed_cells[0]
        headers = [
            _normalize_header(cell) or f"column{index + 1}"
            for index, cell in enumerate(header_row)
        ]
        data_rows = parsed_cells[1:]
    else:
        max_width = max(len(row) for row in parsed_cells)
        headers = [f"column{index + 1}" for index in range(max_width)]
        data_rows = parsed_cells

    normalized_rows: list[dict[str, str]] = []
    for data_row in data_rows:
        normalized_row = {
            header: (data_row[index].strip() if index < len(data_row) else "")
            for index, header in enumerate(headers)
        }
        if any(value != "" for value in normalized_row.values()):
            normalized_rows.append(normalized_row)
    return normalized_rows


def _parse_smi_rows(*, lines: list[str], has_header: bool) -> list[dict[str, str]]:
    if len(lines) == 0:
        return []

    content_lines = lines[1:] if has_header else lines
    parsed_rows: list[dict[str, str]] = []
    for line in content_lines:
        if "\t" in line:
            segments = [segment.strip() for segment in line.split("\t")]
            smiles_value = segments[0] if len(segments) > 0 else ""
            name_value = segments[1] if len(segments) > 1 else ""
        else:
            smiles_value, _, remainder = line.partition(" ")
            name_value = remainder.strip()

        normalized_row = {
            "column1": smiles_value.strip(),
            "column2": name_value,
        }
        if normalized_row["column1"] != "":
            parsed_rows.append(normalized_row)
    return parsed_rows


def _parse_source_rows(source_config: CadmaMappedSourceConfig) -> list[dict[str, str]]:
    content_text = str(source_config.get("content_text", ""))
    if content_text.strip() == "":
        return []

    filename = str(source_config.get("filename", "source.csv"))
    skip_lines = _coerce_non_negative_int(source_config.get("skip_lines", 0))
    has_header = _coerce_bool(source_config.get("has_header", True), True)
    delimiter = _coerce_delimiter(source_config.get("delimiter", ""))
    file_format = _infer_file_format(
        filename=filename,
        raw_format=source_config.get("file_format", ""),
    )
    prepared_lines = _prepare_source_lines(content_text, skip_lines)

    if file_format == "smi":
        return _parse_smi_rows(lines=prepared_lines, has_header=has_header)

    return _parse_delimited_rows(
        lines=prepared_lines,
        has_header=has_header,
        delimiter=delimiter,
    )


def _normalize_column_reference(raw_value: object) -> str:
    return _normalize_header(str(raw_value))


def _project_row_with_source_config(
    row: dict[str, str],
    source_config: CadmaMappedSourceConfig,
) -> dict[str, str]:
    projected_row = dict(row)
    for config_field, alias_key in CONFIG_FIELD_TO_ALIAS_KEY.items():
        if config_field not in source_config:
            continue
        normalized_column = _normalize_column_reference(source_config[config_field])
        if normalized_column == "":
            continue
        selected_value = row.get(normalized_column, "").strip()
        if selected_value != "":
            projected_row[_normalize_header(alias_key)] = selected_value
    return projected_row


def _source_has_explicit_smiles(source_config: CadmaMappedSourceConfig) -> bool:
    file_format = _infer_file_format(
        filename=str(source_config.get("filename", "source.csv")),
        raw_format=source_config.get("file_format", ""),
    )
    return (
        file_format == "smi"
        or str(source_config.get("smiles_column", "")).strip() != ""
    )


def _parse_source_configs_json(raw_json: str) -> list[CadmaMappedSourceConfig]:
    normalized_json = raw_json.strip()
    if normalized_json == "":
        return []

    try:
        parsed_payload = json.loads(normalized_json)
    except json.JSONDecodeError as exc:
        raise ValueError(
            "La configuración de importación no es un JSON válido."
        ) from exc

    if not isinstance(parsed_payload, list):
        raise ValueError(
            "La configuración de importación debe ser una lista de archivos."
        )

    parsed_configs: list[CadmaMappedSourceConfig] = []
    for raw_item in parsed_payload:
        if not isinstance(raw_item, dict):
            raise ValueError(
                "Cada archivo importado debe incluir un objeto de configuración."
            )
        normalized_item = {str(key): value for key, value in raw_item.items()}
        content_text = str(normalized_item.get("content_text", ""))
        if content_text.strip() == "":
            continue
        parsed_configs.append(cast(CadmaMappedSourceConfig, normalized_item))

    return parsed_configs


def _build_compound_rows_from_normalized_rows(
    *,
    merged_rows: list[dict[str, str]],
    default_paper_reference: str,
    default_paper_url: str,
    default_evidence_note: str,
    default_name_prefix: str,
    require_evidence: bool,
) -> list[CadmaCompoundRow]:
    if len(merged_rows) == 0:
        raise ValueError("Debes cargar al menos un CSV con compuestos para CADMA Py.")

    normalized_rows: list[CadmaCompoundRow] = []
    safe_name_prefix = default_name_prefix.strip() or "Compound"
    for index, merged_row in enumerate(merged_rows, start=1):
        smiles_value = _get_alias_value(merged_row, "smiles")
        if smiles_value == "":
            raise ValueError("Cada fila debe incluir una columna smiles/smile/smi.")

        canonical_smiles = _canonicalize_smiles(smiles_value)
        descriptor_values = _compute_adme_descriptors(canonical_smiles)

        name_value = (
            _get_alias_value(merged_row, "name") or f"{safe_name_prefix} {index}"
        )
        paper_reference = (
            _get_alias_value(merged_row, "paper_reference") or default_paper_reference
        )
        paper_url = _get_alias_value(merged_row, "paper_url") or default_paper_url
        evidence_note = (
            _get_alias_value(merged_row, "evidence_note") or default_evidence_note
        )

        if (
            require_evidence
            and paper_reference.strip() == ""
            and paper_url.strip() == ""
        ):
            raise ValueError(
                "Cada referencia debe tener trazabilidad bibliográfica; agrega paper_reference o paper_url."
            )

        compound_row: CadmaCompoundRow = {
            "name": name_value,
            "smiles": canonical_smiles,
            "MW": _resolve_metric_value(merged_row, "MW", descriptor_values),
            "logP": _resolve_metric_value(merged_row, "logP", descriptor_values),
            "MR": _resolve_metric_value(merged_row, "MR", descriptor_values),
            "AtX": _resolve_metric_value(merged_row, "AtX", descriptor_values),
            "HBLA": _resolve_metric_value(merged_row, "HBLA", descriptor_values),
            "HBLD": _resolve_metric_value(merged_row, "HBLD", descriptor_values),
            "RB": _resolve_metric_value(merged_row, "RB", descriptor_values),
            "PSA": _resolve_metric_value(merged_row, "PSA", descriptor_values),
            "DT": _resolve_metric_value(merged_row, "DT", descriptor_values),
            "M": _resolve_metric_value(merged_row, "M", descriptor_values),
            "LD50": _resolve_metric_value(merged_row, "LD50", descriptor_values),
            "SA": _resolve_metric_value(merged_row, "SA", descriptor_values),
            "paper_reference": paper_reference.strip(),
            "paper_url": paper_url.strip(),
            "evidence_note": evidence_note.strip(),
        }
        normalized_rows.append(compound_row)

    return normalized_rows


def build_compound_rows_from_mapped_sources(
    *,
    source_configs: list[CadmaMappedSourceConfig],
    default_paper_reference: str = "",
    default_paper_url: str = "",
    default_evidence_note: str = "",
    default_name_prefix: str = "Compound",
    require_evidence: bool,
) -> list[CadmaCompoundRow]:
    """Construye filas CADMA a partir de archivos guiados con mapeo de columnas."""
    if len(source_configs) == 0:
        raise ValueError(
            "Debes cargar al menos un archivo con configuración de importación."
        )
    if not _source_has_explicit_smiles(source_configs[0]):
        raise ValueError(
            "El primer archivo debe definir la columna principal de SMILES o ser un archivo .smi."
        )

    merged_by_smiles: dict[str, dict[str, str]] = {}
    guide_order: list[str] = []

    for source_index, source_config in enumerate(source_configs):
        parsed_rows = _parse_source_rows(source_config)
        if len(parsed_rows) == 0:
            continue

        projected_rows = [
            _project_row_with_source_config(row, source_config) for row in parsed_rows
        ]
        filename = str(source_config.get("filename", f"source_{source_index + 1}.csv"))

        if source_index == 0:
            for projected_row in projected_rows:
                smiles_value = _get_alias_value(projected_row, "smiles")
                if smiles_value == "":
                    raise ValueError(
                        "El archivo guía debe incluir una columna principal de SMILES en todas las filas utilizables."
                    )
                canonical_smiles = _canonicalize_smiles(smiles_value)
                if canonical_smiles in merged_by_smiles:
                    raise ValueError(
                        "El archivo guía contiene SMILES duplicados; corrígelo antes de continuar."
                    )
                guide_order.append(canonical_smiles)
                merged_by_smiles[canonical_smiles] = dict(projected_row)
            continue

        if _source_has_explicit_smiles(source_config):
            source_matches: dict[str, dict[str, str]] = {}
            for projected_row in projected_rows:
                smiles_value = _get_alias_value(projected_row, "smiles")
                if smiles_value == "":
                    raise ValueError(
                        f"El archivo {filename} no incluye SMILES en una de sus filas utilizables."
                    )
                canonical_smiles = _canonicalize_smiles(smiles_value)
                if canonical_smiles in source_matches:
                    raise ValueError(
                        f"El archivo {filename} contiene SMILES duplicados tras la normalización."
                    )
                source_matches[canonical_smiles] = projected_row

            missing_smiles = [
                smiles for smiles in guide_order if smiles not in source_matches
            ]
            extra_smiles = [
                smiles for smiles in source_matches if smiles not in merged_by_smiles
            ]
            if missing_smiles or extra_smiles:
                raise ValueError(
                    f"El archivo {filename} no coincide con la guía de SMILES seleccionada."
                )

            for canonical_smiles in guide_order:
                _merge_non_empty_values(
                    merged_by_smiles[canonical_smiles],
                    source_matches[canonical_smiles],
                )
            continue

        if len(projected_rows) != len(guide_order):
            raise ValueError(
                f"El archivo {filename} no tiene columna de SMILES y su número de filas utilizables no coincide con la guía."
            )

        for canonical_smiles, projected_row in zip(
            guide_order, projected_rows, strict=True
        ):
            _merge_non_empty_values(merged_by_smiles[canonical_smiles], projected_row)

    return _build_compound_rows_from_normalized_rows(
        merged_rows=[
            merged_by_smiles[canonical_smiles] for canonical_smiles in guide_order
        ],
        default_paper_reference=default_paper_reference,
        default_paper_url=default_paper_url,
        default_evidence_note=default_evidence_note,
        default_name_prefix=default_name_prefix,
        require_evidence=require_evidence,
    )


def build_compound_rows_from_sources(
    *,
    combined_csv_text: str = "",
    smiles_csv_text: str = "",
    toxicity_csv_text: str = "",
    sa_csv_text: str = "",
    default_paper_reference: str = "",
    default_paper_url: str = "",
    default_evidence_note: str = "",
    default_name_prefix: str = "Compound",
    require_evidence: bool,
) -> list[CadmaCompoundRow]:
    """Construye filas CADMA combinando CSVs heterogéneos del proyecto."""
    combined_rows = _parse_table_text(combined_csv_text)
    smiles_rows = _parse_table_text(smiles_csv_text)
    toxicity_rows = _parse_table_text(toxicity_csv_text)
    sa_rows = _parse_table_text(sa_csv_text)

    merged_rows = _merge_rows_by_identity(
        combined_rows, smiles_rows, toxicity_rows, sa_rows
    )
    return _build_compound_rows_from_normalized_rows(
        merged_rows=merged_rows,
        default_paper_reference=default_paper_reference,
        default_paper_url=default_paper_url,
        default_evidence_note=default_evidence_note,
        default_name_prefix=default_name_prefix,
        require_evidence=require_evidence,
    )


def build_compound_rows_from_payload(
    *,
    payload: dict[str, str],
    default_name_prefix: str,
    require_evidence: bool,
) -> list[CadmaCompoundRow]:
    """Resuelve filas CADMA desde el payload clásico o desde el importador guiado."""
    source_configs = _parse_source_configs_json(
        str(payload.get("source_configs_json", ""))
    )
    if len(source_configs) > 0:
        return build_compound_rows_from_mapped_sources(
            source_configs=source_configs,
            default_paper_reference=str(payload.get("paper_reference", "")),
            default_paper_url=str(payload.get("paper_url", "")),
            default_evidence_note=str(payload.get("description", "")),
            default_name_prefix=default_name_prefix,
            require_evidence=require_evidence,
        )

    return build_compound_rows_from_sources(
        combined_csv_text=str(payload.get("combined_csv_text", "")),
        smiles_csv_text=str(payload.get("smiles_csv_text", "")),
        toxicity_csv_text=str(payload.get("toxicity_csv_text", "")),
        sa_csv_text=str(payload.get("sa_csv_text", "")),
        default_paper_reference=str(payload.get("paper_reference", "")),
        default_paper_url=str(payload.get("paper_url", "")),
        default_evidence_note=str(payload.get("description", "")),
        default_name_prefix=default_name_prefix,
        require_evidence=require_evidence,
    )


def _serialize_source_file(
    source_file: CadmaReferenceSourceFile,
) -> CadmaReferenceSourceFileView:
    return {
        "id": str(source_file.id),
        "field_name": source_file.field_name,
        "original_filename": source_file.original_filename,
        "content_type": source_file.content_type,
        "size_bytes": int(source_file.size_bytes),
        "sha256": source_file.sha256,
        "created_at": source_file.created_at.isoformat(),
    }


def _store_reference_content_bytes(
    *,
    library: CadmaReferenceLibrary,
    field_name: str,
    original_filename: str,
    content_bytes: bytes,
    content_type: str,
) -> CadmaReferenceSourceFile:
    sha256_value = hashlib.sha256(content_bytes).hexdigest()
    source_file = CadmaReferenceSourceFile.objects.create(
        library=library,
        field_name=field_name,
        original_filename=original_filename,
        content_type=content_type,
        size_bytes=len(content_bytes),
        sha256=sha256_value,
    )
    source_file.file.save(original_filename, ContentFile(content_bytes), save=True)
    return source_file


def store_reference_uploaded_files(
    *,
    library: CadmaReferenceLibrary,
    uploaded_files: list[tuple[str, UploadedFile]],
) -> list[CadmaReferenceSourceFile]:
    stored_files: list[CadmaReferenceSourceFile] = []
    for field_name, uploaded_file in uploaded_files:
        file_bytes = uploaded_file.read()
        uploaded_file.seek(0)
        stored_files.append(
            _store_reference_content_bytes(
                library=library,
                field_name=field_name,
                original_filename=uploaded_file.name,
                content_bytes=file_bytes,
                content_type=uploaded_file.content_type or CSV_CONTENT_TYPE,
            )
        )
    return stored_files


def build_reference_artifacts_zip_bytes(*, library: CadmaReferenceLibrary) -> bytes:
    buffer = BytesIO()
    with ZipFile(buffer, mode="w", compression=ZIP_DEFLATED) as zip_file:
        for source_file in library.source_files.order_by("created_at"):
            with source_file.file.open("rb") as file_handle:
                zip_file.writestr(source_file.original_filename, file_handle.read())
    return buffer.getvalue()


def _actor_group_ids(actor: AbstractUser | None) -> list[int]:
    if actor is None or not bool(getattr(actor, "is_authenticated", False)):
        return []
    return list(
        GroupMembership.objects.filter(user_id=actor.id).values_list(
            "group_id", flat=True
        )
    )


def _actor_role(actor: AbstractUser | None) -> str | None:
    if actor is None or not bool(getattr(actor, "is_authenticated", False)):
        return None
    return str(getattr(actor, "role", "user"))


def serialize_reference_library(
    library: CadmaReferenceLibrary,
    actor: AbstractUser | None = None,
) -> CadmaReferenceLibraryView:
    """Convierte una familia persistida a contrato serializable para la UI."""
    actor_user_id = None if actor is None else getattr(actor, "id", None)
    actor_groups = _actor_group_ids(actor)
    actor_role = _actor_role(actor)

    editable = can_user_edit_entry(
        entry=library,
        actor_user_id=actor_user_id,
        actor_role=actor_role,
        actor_user_groups=actor_groups,
    )
    deletable = can_user_delete_entry(
        entry=library,
        actor_user_id=actor_user_id,
        actor_role=actor_role,
        actor_user_groups=actor_groups,
    )

    created_by_name = ""
    if library.created_by is not None:
        created_by_name = library.created_by.get_username()

    source_files = [_serialize_source_file(item) for item in library.source_files.all()]
    return {
        "id": str(library.id),
        "name": library.name,
        "disease_name": library.disease_name,
        "description": library.description,
        "source_reference": library.source_reference,
        "group_id": library.group_id,
        "created_by_id": library.created_by_id,
        "created_by_name": created_by_name,
        "editable": editable,
        "deletable": deletable,
        "forkable": bool(_can_fork_visible_library(library, actor)),
        "row_count": len(library.reference_rows),
        "rows": list(library.reference_rows),
        "source_file_count": len(source_files),
        "source_files": source_files,
        "paper_reference": library.paper_reference,
        "paper_url": library.paper_url,
        "created_at": library.created_at.isoformat(),
        "updated_at": library.updated_at.isoformat(),
    }


def list_visible_reference_libraries(
    actor: AbstractUser | None,
) -> list[CadmaReferenceLibraryView]:
    """Lista las familias visibles para el actor actual."""
    actor_user_id = None if actor is None else getattr(actor, "id", None)
    actor_role = _actor_role(actor)
    actor_groups = _actor_group_ids(actor)

    visible_libraries: list[CadmaReferenceLibraryView] = []
    libraries = CadmaReferenceLibrary.objects.filter(is_active=True).select_related(
        "created_by", "group"
    )
    for library in libraries:
        if can_user_view_entry(
            entry=library,
            actor_user_id=actor_user_id,
            actor_user_groups=actor_groups,
            actor_role=actor_role,
        ):
            visible_libraries.append(serialize_reference_library(library, actor))
    return visible_libraries


def get_reference_library_for_actor(
    library_id: str,
    actor: AbstractUser | None,
) -> CadmaReferenceLibrary:
    """Recupera una familia visible o falla con un mensaje claro."""
    try:
        library = CadmaReferenceLibrary.objects.select_related(
            "created_by", "group"
        ).get(
            pk=library_id,
            is_active=True,
        )
    except CadmaReferenceLibrary.DoesNotExist as exc:
        raise ValueError("No existe la familia de referencia indicada.") from exc

    actor_user_id = None if actor is None else getattr(actor, "id", None)
    actor_role = _actor_role(actor)
    actor_groups = _actor_group_ids(actor)
    if not can_user_view_entry(
        entry=library,
        actor_user_id=actor_user_id,
        actor_user_groups=actor_groups,
        actor_role=actor_role,
    ):
        raise PermissionError("No tienes permisos para ver esta familia de referencia.")
    return library


def _resolve_library_scope(actor: AbstractUser) -> tuple[str, int | None]:
    actor_role = _actor_role(actor)
    primary_group_id = AuthorizationService.get_primary_group_id(actor)
    source_reference = get_source_reference_for_role(actor_role, primary_group_id)
    group_id = int(primary_group_id) if primary_group_id is not None else None
    return source_reference, group_id


def _can_fork_visible_library(
    _library: CadmaReferenceLibrary,
    actor: AbstractUser | None,
) -> bool:
    """Determina si el actor autenticado puede copiar una familia visible.

    La copia es una acción explícita disponible para cualquier familia visible;
    el resultado siempre queda bajo el scope del actor que la duplicó.
    """

    return bool(actor is not None and getattr(actor, "is_authenticated", False))


def _clone_source_files(
    source_library: CadmaReferenceLibrary,
    target_library: CadmaReferenceLibrary,
) -> None:
    """Copia los archivos fuente para preservar trazabilidad de la familia derivada."""

    for source_file in source_library.source_files.all():
        with source_file.file.open("rb") as file_handle:
            _store_reference_content_bytes(
                library=target_library,
                field_name=source_file.field_name,
                original_filename=source_file.original_filename,
                content_bytes=file_handle.read(),
                content_type=source_file.content_type or CSV_CONTENT_TYPE,
            )


def fork_reference_library(
    *,
    library_id: str,
    actor: AbstractUser,
    new_name: str = "",
) -> CadmaReferenceLibrary:
    """Deriva una copia editable para el actor manteniendo intacta la fuente compartida."""

    source_library = get_reference_library_for_actor(library_id, actor)
    if not _can_fork_visible_library(source_library, actor):
        raise PermissionError(
            "Debes iniciar sesión para copiar una familia de referencia."
        )

    resolved_name = new_name.strip() or source_library.name
    source_reference, group_id = _resolve_library_scope(actor)
    forked_library = CadmaReferenceLibrary.objects.create(
        name=resolved_name,
        disease_name=source_library.disease_name,
        description=source_library.description,
        paper_reference=source_library.paper_reference,
        paper_url=source_library.paper_url,
        source_reference=source_reference,
        provenance_metadata={
            "owner_user_id": actor.id,
            "owner_username": actor.get_username(),
            "forked_from_library_id": str(source_library.id),
            "forked_from_source_reference": source_library.source_reference,
        },
        reference_rows=list(source_library.reference_rows),
        created_by=actor,
        group_id=group_id if source_reference.startswith("admin-") else None,
    )
    _clone_source_files(source_library, forked_library)
    return forked_library


def _library_has_linked_jobs(library: CadmaReferenceLibrary) -> bool:
    """Indica si la familia ya quedó asociada a trabajos CADMA todavía activos."""

    return ScientificJob.objects.filter(
        plugin_name="cadma-py",
        parameters__reference_library_id=str(library.id),
        deleted_at__isnull=True,
    ).exists()


def _get_linked_jobs(library: CadmaReferenceLibrary) -> list[ScientificJob]:
    """Retorna los jobs de CADMA vinculados a la familia, ordenados por fecha."""

    return list(
        ScientificJob.objects.filter(
            plugin_name="cadma-py",
            parameters__reference_library_id=str(library.id),
            deleted_at__isnull=True,
        )
        .order_by("-created_at")
        .only("id", "status", "parameters", "created_at")[:50]
    )


def _soft_delete_linked_jobs(
    library: CadmaReferenceLibrary,
    actor: AbstractUser,
) -> int:
    """Envía a la papelera lógica todos los jobs vinculados a la familia."""
    from django.utils import timezone

    now = timezone.now()
    linked_qs = ScientificJob.objects.filter(
        plugin_name="cadma-py",
        parameters__reference_library_id=str(library.id),
        deleted_at__isnull=True,
    )
    count = linked_qs.update(
        deleted_at=now,
        deleted_by=actor,
        deletion_mode=ScientificJob.DELETION_MODE_SOFT,
    )
    return count


def create_reference_library(
    *,
    payload: dict[str, str],
    actor: AbstractUser,
    uploaded_files: list[tuple[str, UploadedFile]] | None = None,
) -> CadmaReferenceLibrary:
    """Crea una familia de referencia con trazabilidad y alcance RBAC."""
    if not bool(getattr(actor, "is_authenticated", False)):
        raise PermissionError(
            "Debes iniciar sesión para crear una familia de referencia."
        )

    source_reference, group_id = _resolve_library_scope(actor)
    reference_rows = build_compound_rows_from_payload(
        payload=payload,
        default_name_prefix=str(payload.get("name", "Reference family")),
        require_evidence=True,
    )

    library = CadmaReferenceLibrary.objects.create(
        name=str(payload.get("name", "")).strip(),
        disease_name=str(payload.get("disease_name", "")).strip(),
        description=str(payload.get("description", "")).strip(),
        paper_reference=str(payload.get("paper_reference", "")).strip(),
        paper_url=str(payload.get("paper_url", "")).strip(),
        source_reference=source_reference,
        provenance_metadata={
            "owner_user_id": actor.id,
            "owner_username": actor.get_username(),
        },
        reference_rows=reference_rows,
        created_by=actor,
        group_id=group_id if source_reference.startswith("admin-") else None,
    )
    if uploaded_files:
        store_reference_uploaded_files(library=library, uploaded_files=uploaded_files)
    return library


def update_reference_library(
    *,
    library_id: str,
    payload: dict[str, str],
    actor: AbstractUser,
    uploaded_files: list[tuple[str, UploadedFile]] | None = None,
) -> CadmaReferenceLibrary:
    """Actualiza una familia si el actor tiene permisos de edición.

    Si la familia visible es compartida pero de solo lectura para el actor,
    primero se deriva una copia propia antes de persistir los cambios para
    mantener intacta la familia original.
    """
    library = get_reference_library_for_actor(library_id, actor)

    actor_user_id = getattr(actor, "id", None)
    actor_role = _actor_role(actor)
    actor_groups = _actor_group_ids(actor)
    if not can_user_edit_entry(
        entry=library,
        actor_user_id=actor_user_id,
        actor_role=actor_role,
        actor_user_groups=actor_groups,
    ):
        if _can_fork_visible_library(library, actor):
            library = fork_reference_library(library_id=library_id, actor=actor)
        else:
            raise PermissionError(
                "No tienes permisos para editar esta familia de referencia."
            )

    if any(
        str(payload.get(field_name, "")).strip() != ""
        for field_name in (
            "combined_csv_text",
            "smiles_csv_text",
            "toxicity_csv_text",
            "sa_csv_text",
            "source_configs_json",
        )
    ):
        library.reference_rows = build_compound_rows_from_payload(
            payload={
                **payload,
                "paper_reference": str(
                    payload.get("paper_reference", library.paper_reference)
                ),
                "paper_url": str(payload.get("paper_url", library.paper_url)),
                "description": str(payload.get("description", library.description)),
            },
            default_name_prefix=str(
                payload.get("name", library.name or "Reference family")
            ),
            require_evidence=True,
        )

    for field_name in (
        "name",
        "disease_name",
        "description",
        "paper_reference",
        "paper_url",
    ):
        if field_name in payload and payload[field_name] is not None:
            setattr(library, field_name, str(payload[field_name]).strip())

    library.save(
        update_fields=[
            "name",
            "disease_name",
            "description",
            "paper_reference",
            "paper_url",
            "reference_rows",
            "updated_at",
        ]
    )
    if uploaded_files:
        store_reference_uploaded_files(library=library, uploaded_files=uploaded_files)
    return library


def _assert_library_editable(
    library: CadmaReferenceLibrary, actor: AbstractUser
) -> None:
    """Valida que el actor tenga permisos de edición sobre la familia."""
    actor_user_id = getattr(actor, "id", None)
    actor_role = _actor_role(actor)
    actor_groups = _actor_group_ids(actor)
    if not can_user_edit_entry(
        entry=library,
        actor_user_id=actor_user_id,
        actor_role=actor_role,
        actor_user_groups=actor_groups,
    ):
        if _can_fork_visible_library(library, actor):
            raise PermissionError(
                "Esta familia es de solo lectura en tu scope; clónala primero para crear una copia editable."
            )
        raise PermissionError(
            "No tienes permisos para editar esta familia de referencia."
        )


def update_reference_row(
    *,
    library_id: str,
    row_index: int,
    patch: dict[str, str],
    actor: AbstractUser,
) -> CadmaCompoundRow:
    """Actualiza campos editables de una fila concreta del set de referencia.

    Campos editables: name, paper_reference, paper_url, evidence_note.
    Los promedios de ADME/toxicity/SA no cambian porque no se alteran métricas.
    """
    library = get_reference_library_for_actor(library_id, actor)
    _assert_library_editable(library, actor)

    rows: list[CadmaCompoundRow] = library.reference_rows
    if row_index < 0 or row_index >= len(rows):
        raise ValueError(
            f"Índice de fila {row_index} fuera de rango (0-{len(rows) - 1})."
        )

    editable_fields = ("name", "paper_reference", "paper_url", "evidence_note")
    target_row = rows[row_index]
    for field in editable_fields:
        if field in patch:
            target_row[field] = str(patch[field]).strip()  # type: ignore[literal-required]

    library.reference_rows = rows
    library.save(update_fields=["reference_rows", "updated_at"])
    return target_row


def remove_reference_row(
    *,
    library_id: str,
    row_index: int,
    actor: AbstractUser,
) -> CadmaCompoundRow:
    """Elimina una fila de compuesto de una familia editable.

    Mantiene al menos un compuesto en la familia para no dejar datasets vacíos.
    """
    library = get_reference_library_for_actor(library_id, actor)
    _assert_library_editable(library, actor)

    rows: list[CadmaCompoundRow] = list(library.reference_rows)
    if row_index < 0 or row_index >= len(rows):
        raise ValueError(
            f"Índice de fila {row_index} fuera de rango (0-{len(rows) - 1})."
        )
    if len(rows) <= 1:
        raise ValueError(
            "La familia debe conservar al menos un compuesto de referencia."
        )

    removed_row = rows.pop(row_index)
    library.reference_rows = rows
    library.save(update_fields=["reference_rows", "updated_at"])
    return removed_row


def add_compound_to_library(
    *,
    library_id: str,
    smiles: str,
    name: str,
    paper_reference: str = "",
    paper_url: str = "",
    evidence_note: str = "",
    toxicity_dt: float | None = None,
    toxicity_m: float | None = None,
    toxicity_ld50: float | None = None,
    sa_score: float | None = None,
    actor: AbstractUser,
) -> CadmaCompoundRow:
    """Agrega un compuesto nuevo a una familia existente calculando ADME con RDKit.

    Recibe SMILES obligatorio y opcionalmente métricas de toxicidad/SA.
    Las métricas ADME se computan automáticamente.
    El snapshot de jobs previos no cambia — trazabilidad intacta.
    """
    library = get_reference_library_for_actor(library_id, actor)
    _assert_library_editable(library, actor)

    canonical_smiles = _canonicalize_smiles(smiles)
    descriptor_values = _compute_adme_descriptors(canonical_smiles)

    compound_name = (
        name.strip() if name.strip() else f"Compound {len(library.reference_rows) + 1}"
    )

    new_row: CadmaCompoundRow = {
        "name": compound_name,
        "smiles": canonical_smiles,
        "MW": descriptor_values["MW"],
        "logP": descriptor_values["logP"],
        "MR": descriptor_values["MR"],
        "AtX": descriptor_values["AtX"],
        "HBLA": descriptor_values["HBLA"],
        "HBLD": descriptor_values["HBLD"],
        "RB": descriptor_values["RB"],
        "PSA": descriptor_values["PSA"],
        "DT": toxicity_dt if toxicity_dt is not None else 0.0,
        "M": toxicity_m if toxicity_m is not None else 0.0,
        "LD50": toxicity_ld50 if toxicity_ld50 is not None else 0.0,
        "SA": sa_score if sa_score is not None else 0.0,
        "paper_reference": paper_reference.strip(),
        "paper_url": paper_url.strip(),
        "evidence_note": evidence_note.strip(),
    }

    rows: list[CadmaCompoundRow] = library.reference_rows
    rows.append(new_row)
    library.reference_rows = rows
    library.save(update_fields=["reference_rows", "updated_at"])
    return new_row


def preview_library_deletion(
    *,
    library_id: str,
    actor: AbstractUser,
) -> dict[str, object]:
    """Devuelve información sobre los jobs vinculados a la familia para mostrar antes de eliminar."""
    library = get_reference_library_for_actor(library_id, actor)
    linked_jobs = _get_linked_jobs(library)
    return {
        "library_id": str(library.id),
        "library_name": library.name,
        "linked_job_count": len(linked_jobs),
        "linked_jobs": [
            {
                "id": str(job.id),
                "status": job.status,
                "created_at": job.created_at.isoformat() if job.created_at else "",
                "project_label": job.parameters.get("project_label", ""),
            }
            for job in linked_jobs
        ],
    }


def deactivate_reference_library(
    *,
    library_id: str,
    actor: AbstractUser,
    cascade: bool = False,
) -> None:
    """Elimina lógicamente una familia de referencia y, si cascade=True, también sus jobs."""
    library = get_reference_library_for_actor(library_id, actor)
    actor_user_id = getattr(actor, "id", None)
    actor_role = _actor_role(actor)
    actor_groups = _actor_group_ids(actor)
    if not can_user_delete_entry(
        entry=library,
        actor_user_id=actor_user_id,
        actor_role=actor_role,
        actor_user_groups=actor_groups,
    ):
        raise PermissionError(
            "No tienes permisos para eliminar esta familia de referencia."
        )

    has_linked = _library_has_linked_jobs(library)
    if has_linked and not cascade:
        raise ValueError(
            "Esta familia tiene jobs asociados. Usa cascade=true para eliminarla junto con sus jobs."
        )

    if has_linked:
        _soft_delete_linked_jobs(library, actor)

    library.is_active = False
    library.save(update_fields=["is_active", "updated_at"])


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def list_reference_samples() -> list[CadmaReferenceSample]:
    """Expone los datasets legacy disponibles como punto de partida."""
    sample_rows: list[CadmaReferenceSample] = []
    for sample_item in SAMPLE_DEFINITIONS:
        sample_copy: CadmaReferenceSample = dict(sample_item)
        csv_path = _resolve_sample_path(sample_item["key"])
        sample_copy["row_count"] = len(
            _parse_table_text(csv_path.read_text(encoding="utf-8"))
        )
        sample_rows.append(sample_copy)
    return sample_rows


def preview_reference_sample(sample_key: str) -> list[dict[str, str]]:
    """Devuelve las filas name + SMILES de una muestra legacy para vista previa."""
    csv_path = _resolve_sample_path(sample_key)
    rows = _parse_table_text(csv_path.read_text(encoding="utf-8"))
    preview_rows: list[dict[str, str]] = []
    for index, row in enumerate(rows):
        name = _get_alias_value(row, "name") or f"Compound {index + 1}"
        smiles = _get_alias_value(row, "smiles")
        preview_rows.append({"name": name, "smiles": smiles})
    return preview_rows


def preview_reference_sample_detail(sample_key: str) -> CadmaReferenceLibraryView:
    """Construye una vista completa de una muestra bundled sin importarla.

    Esto permite inspeccionar métricas, referencias y notas de cada compuesto
    antes de seleccionar la familia como baseline.
    """
    sample_path = _resolve_sample_path(sample_key)
    sample_meta = next(item for item in SAMPLE_DEFINITIONS if item["key"] == sample_key)
    sample_literature = get_sample_literature(sample_key)
    sample_bytes = sample_path.read_bytes()
    rows = build_compound_rows_from_sources(
        combined_csv_text=sample_path.read_text(encoding="utf-8"),
        default_paper_reference=sample_literature["paper_reference"],
        default_paper_url=sample_literature["paper_url"],
        default_evidence_note=sample_literature["default_evidence_note"],
        require_evidence=True,
    )
    enriched_rows = enrich_bundled_sample_rows(sample_key, rows)
    return {
        "id": f"sample-{sample_key}",
        "name": sample_meta["name"],
        "disease_name": sample_meta["disease_name"],
        "description": sample_literature["description"],
        "source_reference": "root",
        "group_id": None,
        "created_by_id": None,
        "created_by_name": "Bundled seed",
        "editable": False,
        "deletable": False,
        "forkable": True,
        "row_count": len(enriched_rows),
        "rows": enriched_rows,
        "source_file_count": 1,
        "source_files": [
            {
                "id": f"sample-file-{sample_key}",
                "field_name": "combined_file",
                "original_filename": sample_path.name,
                "content_type": CSV_CONTENT_TYPE,
                "size_bytes": len(sample_bytes),
                "sha256": hashlib.sha256(sample_bytes).hexdigest(),
                "created_at": "",
            }
        ],
        "paper_reference": sample_literature["paper_reference"],
        "paper_url": sample_literature["paper_url"],
        "created_at": "",
        "updated_at": "",
    }


def _resolve_sample_path(sample_key: str) -> Path:
    sample_map = {
        "neuro": _repo_root() / "deprecated" / "CADMA" / "Neuro_RefSet.csv",
        "rett": _repo_root() / "deprecated" / "CADMA" / "RETT_RefSet.csv",
    }
    try:
        return sample_map[sample_key]
    except KeyError as exc:
        raise ValueError("No existe la muestra CADMA solicitada.") from exc


def create_library_from_sample(
    *, sample_key: str, actor: AbstractUser, new_name: str = ""
) -> CadmaReferenceLibrary:
    """Crea una familia a partir de los CSVs de ejemplo del repositorio."""
    sample_path = _resolve_sample_path(sample_key)
    sample_meta = next(item for item in SAMPLE_DEFINITIONS if item["key"] == sample_key)
    sample_literature = get_sample_literature(sample_key)
    payload: dict[str, str] = {
        "name": new_name.strip() or sample_meta["name"],
        "disease_name": sample_meta["disease_name"],
        "description": sample_literature["description"],
        "paper_reference": sample_literature["paper_reference"],
        "paper_url": sample_literature["paper_url"],
        "combined_csv_text": sample_path.read_text(encoding="utf-8"),
    }
    library = create_reference_library(payload=payload, actor=actor)
    library.description = sample_literature["description"]
    library.paper_reference = sample_literature["paper_reference"]
    library.paper_url = sample_literature["paper_url"]
    library.reference_rows = enrich_bundled_sample_rows(
        sample_key,
        list(library.reference_rows),
    )
    library.save(
        update_fields=[
            "description",
            "paper_reference",
            "paper_url",
            "reference_rows",
            "updated_at",
        ]
    )
    _store_reference_content_bytes(
        library=library,
        field_name="combined_file",
        original_filename=sample_path.name,
        content_bytes=sample_path.read_bytes(),
        content_type=CSV_CONTENT_TYPE,
    )
    return library


def _escape_csv_cell(cell: str) -> str:
    escaped_cell = cell.replace('"', '""')
    return (
        f'"{escaped_cell}"'
        if any(token in cell for token in [",", '"', "\n"])
        else cell
    )


def ranking_to_csv_rows(ranking_rows: list[CadmaRankingRow]) -> list[str]:
    """Convierte el ranking final a líneas CSV descargables."""
    header = [
        "name",
        "smiles",
        "selection_score",
        "adme_alignment",
        "toxicity_alignment",
        "sa_alignment",
        "adme_hits_in_band",
        "metrics_in_band",
        "best_fit_summary",
    ]
    lines = [",".join(header)]
    for row in ranking_rows:
        cells = [
            str(row.get("name", "")),
            str(row.get("smiles", "")),
            f"{float(row.get('selection_score', 0.0)):.4f}",
            f"{float(row.get('adme_alignment', 0.0)):.4f}",
            f"{float(row.get('toxicity_alignment', 0.0)):.4f}",
            f"{float(row.get('sa_alignment', 0.0)):.4f}",
            str(int(row.get("adme_hits_in_band", 0))),
            "|".join(str(item) for item in row.get("metrics_in_band", [])),
            str(row.get("best_fit_summary", "")),
        ]
        escaped = [_escape_csv_cell(cell) for cell in cells]
        lines.append(",".join(escaped))
    return lines


__all__ = [
    "ALL_METRIC_NAMES",
    "ADME_METRIC_NAMES",
    "add_compound_to_library",
    "build_compound_rows_from_sources",
    "build_reference_artifacts_zip_bytes",
    "create_library_from_sample",
    "create_reference_library",
    "fork_reference_library",
    "deactivate_reference_library",
    "get_reference_library_for_actor",
    "list_reference_samples",
    "list_visible_reference_libraries",
    "preview_reference_sample",
    "preview_reference_sample_detail",
    "ranking_to_csv_rows",
    "serialize_reference_library",
    "update_reference_library",
    "update_reference_row",
]
