"""plugin.py: Plugin Easy-rate — carga artefactos Gaussian y calcula constantes de velocidad TST.

Objetivo: orquestar el ciclo de vida del job Easy-rate:
  1. Normalizar parámetros serializados desde la BD.
  2. Cargar y parsear archivos Gaussian desde artefactos persistidos.
  3. Delegar calculo TST+Tunnel+Difusion al modulo computation/physics.py.
Registrado en PluginRegistry bajo el nombre definido en definitions.py.
"""

from __future__ import annotations

import logging
from typing import cast

from libs.gaussian_log_parser.parsers import GaussianLogParser

from apps.core.artifacts import (
    ScientificInputArtifactStorageService,
    normalize_file_descriptors,
)
from apps.core.models import ScientificJobInputArtifact
from apps.core.processing import PluginRegistry
from apps.core.types import JSONMap, PluginLogCallback, PluginProgressCallback

from .computation.physics import _compute_easy_rate
from .definitions import PLUGIN_NAME
from .inspection.gaussian import (
    _build_structure_snapshot,
    _build_zero_structure_snapshot,
    _parse_gaussian_execution,
    _validate_structure_snapshot,
)
from .types import (
    EasyRateCalculationResult,
    EasyRateJobParameters,
    EasyRateStructureSnapshot,
)

logger = logging.getLogger(__name__)


# =========================
# CARGA DE ESTRUCTURAS
# =========================


def _load_structures_from_artifacts(
    *,
    job_id: str,
    selected_execution_indices: dict[str, int | None],
    emit_log: PluginLogCallback,
) -> tuple[dict[str, EasyRateStructureSnapshot], int]:
    """Carga, parsea y valida snapshots de estructuras desde artefactos DB."""
    parser = GaussianLogParser()
    storage_service = ScientificInputArtifactStorageService()

    artifacts = ScientificJobInputArtifact.objects.filter(job_id=job_id).order_by(
        "created_at"
    )
    artifact_by_field: dict[str, ScientificJobInputArtifact] = {}
    for artifact in artifacts:
        artifact_by_field[artifact.field_name] = artifact

    if "transition_state_file" not in artifact_by_field:
        raise ValueError("Debe cargarse el archivo transition_state_file.")

    has_reactant_1: bool = "reactant_1_file" in artifact_by_field
    has_reactant_2: bool = "reactant_2_file" in artifact_by_field
    has_product: bool = (
        "product_1_file" in artifact_by_field or "product_2_file" in artifact_by_field
    )
    if not has_reactant_1:
        raise ValueError("Debe cargarse reactant_1_file.")
    if not has_reactant_2:
        raise ValueError("Debe cargarse reactant_2_file.")
    if not has_product:
        raise ValueError(
            "Debe cargarse al menos un producto (product_1_file o product_2_file)."
        )

    parsed_snapshots: dict[str, EasyRateStructureSnapshot] = {}
    expected_fields: list[str] = [
        "reactant_1_file",
        "reactant_2_file",
        "transition_state_file",
        "product_1_file",
        "product_2_file",
    ]

    for field_name in expected_fields:
        artifact = artifact_by_field.get(field_name)
        if artifact is None:
            if field_name == "transition_state_file":
                raise ValueError("Transition state es obligatorio.")
            parsed_snapshots[field_name] = _build_zero_structure_snapshot(field_name)
            continue

        artifact_bytes: bytes = storage_service.read_artifact_bytes(artifact=artifact)
        execution, execution_count, execution_index, parse_errors = (
            _parse_gaussian_execution(
                parser=parser,
                artifact_bytes=artifact_bytes,
                original_filename=artifact.original_filename,
                selected_execution_index=selected_execution_indices.get(field_name),
            )
        )
        snapshot = _build_structure_snapshot(
            source_field=field_name,
            execution=execution,
            original_filename=artifact.original_filename,
            execution_index=execution_index,
            available_execution_count=execution_count,
        )
        _validate_structure_snapshot(snapshot=snapshot, expected_role=field_name)
        parsed_snapshots[field_name] = snapshot

        emit_log(
            "info",
            "easy_rate.input",
            "Estructura Gaussian cargada y validada.",
            {
                "field_name": field_name,
                "filename": snapshot["original_filename"],
                "negative_frequencies": snapshot["negative_frequencies"],
                "execution_index": execution_index,
                "available_execution_count": execution_count,
                "parse_errors": parse_errors,
            },
        )

    return parsed_snapshots, len(artifact_by_field)


# =========================
# NORMALIZACIÓN DE PARÁMETROS
# =========================


def _build_easy_rate_parameters(parameters: JSONMap) -> EasyRateJobParameters:
    """Normaliza parámetros serializados persistidos del job Easy-rate."""
    normalized_file_descriptors = normalize_file_descriptors(
        parameters.get("file_descriptors", [])
    )

    return {
        "title": str(parameters.get("title", "Title")),
        "reaction_path_degeneracy": float(
            parameters.get("reaction_path_degeneracy", 1.0)
        ),
        "cage_effects": bool(parameters.get("cage_effects", False)),
        "diffusion": bool(parameters.get("diffusion", False)),
        "solvent": str(parameters.get("solvent", "")),
        "custom_viscosity": (
            float(parameters["custom_viscosity"])
            if parameters.get("custom_viscosity") is not None
            else None
        ),
        "radius_reactant_1": (
            float(parameters["radius_reactant_1"])
            if parameters.get("radius_reactant_1") is not None
            else None
        ),
        "radius_reactant_2": (
            float(parameters["radius_reactant_2"])
            if parameters.get("radius_reactant_2") is not None
            else None
        ),
        "reaction_distance": (
            float(parameters["reaction_distance"])
            if parameters.get("reaction_distance") is not None
            else None
        ),
        "print_data_input": bool(parameters.get("print_data_input", False)),
        "reactant_1_execution_index": (
            int(parameters["reactant_1_execution_index"])
            if parameters.get("reactant_1_execution_index") is not None
            else None
        ),
        "reactant_2_execution_index": (
            int(parameters["reactant_2_execution_index"])
            if parameters.get("reactant_2_execution_index") is not None
            else None
        ),
        "transition_state_execution_index": (
            int(parameters["transition_state_execution_index"])
            if parameters.get("transition_state_execution_index") is not None
            else None
        ),
        "product_1_execution_index": (
            int(parameters["product_1_execution_index"])
            if parameters.get("product_1_execution_index") is not None
            else None
        ),
        "product_2_execution_index": (
            int(parameters["product_2_execution_index"])
            if parameters.get("product_2_execution_index") is not None
            else None
        ),
        "file_descriptors": cast(
            list[dict[str, str | int]], normalized_file_descriptors
        ),
    }


# =========================
# PLUGIN PRINCIPAL
# =========================


@PluginRegistry.register(PLUGIN_NAME)
def easy_rate_plugin(
    parameters: JSONMap,
    progress_callback: PluginProgressCallback,
    log_callback: PluginLogCallback | None = None,
) -> JSONMap:
    """Ejecuta flujo Easy-rate desde artefactos persistidos por job."""
    emit_log: PluginLogCallback = (
        log_callback
        if log_callback is not None
        else lambda _level, _source, _message, _payload: None
    )

    progress_callback(5, "running", "Validando parámetros del job Easy-rate.")
    normalized_parameters: EasyRateJobParameters = _build_easy_rate_parameters(
        parameters
    )

    if normalized_parameters["reaction_path_degeneracy"] <= 0.0:
        raise ValueError("reaction_path_degeneracy debe ser mayor que cero.")

    job_id_value: str = str(parameters.get("__job_id", "")).strip()
    if job_id_value == "":
        raise ValueError("No se encontró __job_id interno para recuperar artefactos.")

    progress_callback(20, "running", "Reconstruyendo y parseando archivos Gaussian.")
    structures, artifact_count = _load_structures_from_artifacts(
        job_id=job_id_value,
        selected_execution_indices={
            "reactant_1_file": normalized_parameters["reactant_1_execution_index"],
            "reactant_2_file": normalized_parameters["reactant_2_execution_index"],
            "transition_state_file": normalized_parameters[
                "transition_state_execution_index"
            ],
            "product_1_file": normalized_parameters["product_1_execution_index"],
            "product_2_file": normalized_parameters["product_2_execution_index"],
        },
        emit_log=emit_log,
    )

    progress_callback(
        55, "running", "Ejecutando ecuaciones termodinámicas y cinéticas."
    )
    result_payload: EasyRateCalculationResult = _compute_easy_rate(
        parameters=normalized_parameters,
        structures=structures,
        artifact_count=artifact_count,
        emit_log=emit_log,
    )

    progress_callback(100, "completed", "Cálculo Easy-rate finalizado.")

    logger.info(
        "Easy-rate completado para job=%s con rate_constant=%s",
        job_id_value,
        result_payload["rate_constant"],
    )

    return cast(JSONMap, result_payload)
