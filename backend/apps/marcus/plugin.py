"""plugin.py: Lógica científica Marcus desacoplada de HTTP.

Objetivo del archivo:
- Parsear artefactos Gaussian persistidos y calcular cinética por modelo Marcus.

Cómo se usa:
- `JobService.run_job` invoca `marcus_plugin` vía `PluginRegistry`.
"""

from __future__ import annotations

import logging
import math
from typing import cast

from libs.chemistry_constants import AVOGADRO, HARTREE_TO_KCAL, KB
from libs.gaussian_log_parser.models import GaussianExecution
from libs.gaussian_log_parser.parsers import GaussianLogParser

from apps.core.artifacts import (
    ScientificInputArtifactStorageService,
    normalize_file_descriptors,
)
from apps.core.models import ScientificJobInputArtifact
from apps.core.processing import PluginRegistry
from apps.core.types import JSONMap, PluginLogCallback, PluginProgressCallback

from .definitions import PLUGIN_NAME
from .types import (
    MarcusCalculationResult,
    MarcusJobParameters,
    MarcusResultMetadata,
    MarcusStructureSnapshot,
)

logger = logging.getLogger(__name__)
REORGANIZATION_ABS_TOLERANCE = 1e-12


DEFAULT_VISCOSITY_PA_S: float = 8.91e-4
PI: float = math.pi


def _is_finite(value: float) -> bool:
    """Valida que un float sea finito."""
    return math.isfinite(value)


def _build_marcus_parameters(parameters: JSONMap) -> MarcusJobParameters:
    """Normaliza parámetros serializados de Marcus a estructura tipada."""
    normalized_file_descriptors = normalize_file_descriptors(
        parameters.get("file_descriptors", [])
    )

    return {
        "title": str(parameters.get("title", "Title")),
        "diffusion": bool(parameters.get("diffusion", False)),
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
        "file_descriptors": cast(
            list[dict[str, str | int]], normalized_file_descriptors
        ),
    }


def _parse_structure_snapshot(
    *,
    field_name: str,
    artifact: ScientificJobInputArtifact,
    parser: GaussianLogParser,
    storage_service: ScientificInputArtifactStorageService,
) -> MarcusStructureSnapshot:
    """Parsea un artefacto Gaussian y extrae variables necesarias para Marcus."""
    artifact_bytes: bytes = storage_service.read_artifact_bytes(artifact=artifact)
    parser_result = parser.parse_blob(artifact_bytes)

    if parser_result.execution_count == 0:
        joined_errors: str = " | ".join(parser_result.errors)
        raise ValueError(
            f"El archivo '{artifact.original_filename}' no contiene ejecuciones válidas: {joined_errors}"
        )

    execution: GaussianExecution | None = parser_result.last_execution()
    if execution is None:
        raise ValueError(
            f"No fue posible extraer ejecución válida del archivo '{artifact.original_filename}'."
        )

    snapshot: MarcusStructureSnapshot = {
        "source_field": field_name,
        "original_filename": artifact.original_filename,
        "scf_energy": float(execution.scf_energy),
        "thermal_free_enthalpy": float(execution.free_energies),
        "temperature": float(execution.temperature),
    }

    for key_name in ["scf_energy", "thermal_free_enthalpy", "temperature"]:
        if not _is_finite(float(snapshot[key_name])):
            raise ValueError(
                f"El archivo '{artifact.original_filename}' no tiene dato finito para {key_name}."
            )

    return snapshot


def _load_marcus_structures(
    *,
    job_id: str,
    emit_log: PluginLogCallback,
) -> tuple[dict[str, MarcusStructureSnapshot], int]:
    """Recupera y parsea todos los artefactos requeridos para Marcus."""
    required_fields: list[str] = [
        "reactant_1_file",
        "reactant_2_file",
        "product_1_adiabatic_file",
        "product_2_adiabatic_file",
        "product_1_vertical_file",
        "product_2_vertical_file",
    ]

    parser = GaussianLogParser()
    storage_service = ScientificInputArtifactStorageService()

    artifacts = ScientificJobInputArtifact.objects.filter(job_id=job_id).order_by(
        "created_at"
    )
    artifact_by_field: dict[str, ScientificJobInputArtifact] = {}
    for artifact in artifacts:
        artifact_by_field[artifact.field_name] = artifact

    missing_fields: list[str] = [
        field_name
        for field_name in required_fields
        if field_name not in artifact_by_field
    ]
    if len(missing_fields) > 0:
        raise ValueError(
            "Faltan archivos obligatorios para Marcus: " + ", ".join(missing_fields)
        )

    structures: dict[str, MarcusStructureSnapshot] = {}
    for field_name in required_fields:
        snapshot = _parse_structure_snapshot(
            field_name=field_name,
            artifact=artifact_by_field[field_name],
            parser=parser,
            storage_service=storage_service,
        )
        structures[field_name] = snapshot

        emit_log(
            "info",
            "marcus.input",
            "Archivo Gaussian validado para cálculo Marcus.",
            {
                "field_name": field_name,
                "filename": snapshot["original_filename"],
            },
        )

    return structures, len(artifact_by_field)


def _reaction_energy_kcal(
    *,
    product_1: float,
    product_2: float,
    reactant_1: float,
    reactant_2: float,
) -> float:
    """Calcula energía de reacción en kcal/mol con factor legacy."""
    return HARTREE_TO_KCAL * (product_1 + product_2 - reactant_1 - reactant_2)


def _compute_marcus_result(
    *,
    parameters: MarcusJobParameters,
    structures: dict[str, MarcusStructureSnapshot],
    artifact_count: int,
) -> MarcusCalculationResult:
    """Ejecuta ecuaciones Marcus y aplica corrección difusiva opcional."""
    reactant_1 = structures["reactant_1_file"]
    reactant_2 = structures["reactant_2_file"]
    product_1_adiabatic = structures["product_1_adiabatic_file"]
    product_2_adiabatic = structures["product_2_adiabatic_file"]
    product_1_vertical = structures["product_1_vertical_file"]
    product_2_vertical = structures["product_2_vertical_file"]

    temperature_k: float = reactant_1["temperature"]
    if temperature_k <= 0.0:
        raise ValueError("La temperatura del reactant_1_file debe ser mayor que cero.")

    adiabatic_energy = _reaction_energy_kcal(
        product_1=product_1_adiabatic["scf_energy"],
        product_2=product_2_adiabatic["scf_energy"],
        reactant_1=reactant_1["scf_energy"],
        reactant_2=reactant_2["scf_energy"],
    )
    adiabatic_energy_corrected = _reaction_energy_kcal(
        product_1=product_1_adiabatic["thermal_free_enthalpy"],
        product_2=product_2_adiabatic["thermal_free_enthalpy"],
        reactant_1=reactant_1["thermal_free_enthalpy"],
        reactant_2=reactant_2["thermal_free_enthalpy"],
    )
    vertical_energy = _reaction_energy_kcal(
        product_1=product_1_vertical["scf_energy"],
        product_2=product_2_vertical["scf_energy"],
        reactant_1=reactant_1["scf_energy"],
        reactant_2=reactant_2["scf_energy"],
    )

    reorganization_energy: float = vertical_energy - adiabatic_energy_corrected
    if math.isclose(
        reorganization_energy,
        0.0,
        abs_tol=REORGANIZATION_ABS_TOLERANCE,
    ):
        raise ValueError("No se puede calcular Marcus cuando lambda es cero.")

    barrier_kcal_mol: float = (reorganization_energy / 4.0) * (
        math.pow(1.0 + (adiabatic_energy_corrected / reorganization_energy), 2.0)
    )

    try:
        rate_constant_tst = (
            2.08366912663558e10
            * temperature_k
            * math.exp(-1.0 * barrier_kcal_mol * 1000.0 / (1.987 * temperature_k))
        )
    except OverflowError as error_value:
        raise ValueError(
            "Math range error al calcular constante de velocidad."
        ) from error_value

    diffusion_applied: bool = bool(parameters["diffusion"])
    k_diff: float | None = None
    viscosity_pa_s: float | None = None
    rate_constant: float = rate_constant_tst

    if diffusion_applied:
        if (
            parameters["radius_reactant_1"] is None
            or parameters["radius_reactant_1"] <= 0.0
        ):
            raise ValueError(
                "radius_reactant_1 debe ser mayor que cero cuando diffusion=true."
            )
        if (
            parameters["radius_reactant_2"] is None
            or parameters["radius_reactant_2"] <= 0.0
        ):
            raise ValueError(
                "radius_reactant_2 debe ser mayor que cero cuando diffusion=true."
            )
        if (
            parameters["reaction_distance"] is None
            or parameters["reaction_distance"] <= 0.0
        ):
            raise ValueError(
                "reaction_distance debe ser mayor que cero cuando diffusion=true."
            )

        viscosity_pa_s = DEFAULT_VISCOSITY_PA_S
        diff_coef_a: float = (KB * temperature_k) / (
            6.0 * PI * viscosity_pa_s * parameters["radius_reactant_1"]
        )
        diff_coef_b: float = (KB * temperature_k) / (
            6.0 * PI * viscosity_pa_s * parameters["radius_reactant_2"]
        )
        diff_coef_ab: float = diff_coef_a + diff_coef_b

        k_diff = (
            1000.0
            * 4.0
            * PI
            * diff_coef_ab
            * parameters["reaction_distance"]
            * AVOGADRO
        )
        rate_constant = (k_diff * rate_constant_tst) / (k_diff + rate_constant_tst)

    metadata: MarcusResultMetadata = {
        "model_name": "Marcus Electron Transfer",
        "source_library": "libs.gaussian_log_parser",
        "units": {
            "energy": "kcal/mol",
            "rate_constant": "M^-1 s^-1 or s^-1",
            "temperature": "K",
            "viscosity": "Pa*s",
        },
        "input_artifact_count": artifact_count,
    }

    return {
        "title": parameters["title"],
        "adiabatic_energy_kcal_mol": adiabatic_energy,
        "adiabatic_energy_corrected_kcal_mol": adiabatic_energy_corrected,
        "vertical_energy_kcal_mol": vertical_energy,
        "reorganization_energy_kcal_mol": reorganization_energy,
        "barrier_kcal_mol": barrier_kcal_mol,
        "rate_constant_tst": rate_constant_tst,
        "rate_constant": rate_constant,
        "diffusion_applied": diffusion_applied,
        "k_diff": k_diff,
        "temperature_k": temperature_k,
        "viscosity_pa_s": viscosity_pa_s,
        "structures": structures,
        "metadata": metadata,
    }


@PluginRegistry.register(PLUGIN_NAME)
def marcus_plugin(
    parameters: JSONMap,
    progress_callback: PluginProgressCallback,
    log_callback: PluginLogCallback | None = None,
) -> JSONMap:
    """Ejecuta cálculo Marcus usando artefactos Gaussian persistidos."""
    emit_log: PluginLogCallback = (
        log_callback
        if log_callback is not None
        else lambda _level, _source, _message, _payload: None
    )

    progress_callback(5, "running", "Validando parámetros del job Marcus.")
    normalized_parameters = _build_marcus_parameters(parameters)

    job_id_value: str = str(parameters.get("__job_id", "")).strip()
    if job_id_value == "":
        raise ValueError("No se encontró __job_id interno para recuperar artefactos.")

    progress_callback(25, "running", "Reconstruyendo y parseando archivos Gaussian.")
    structures, artifact_count = _load_marcus_structures(
        job_id=job_id_value,
        emit_log=emit_log,
    )

    progress_callback(60, "running", "Ejecutando ecuaciones de cinética Marcus.")
    result_payload = _compute_marcus_result(
        parameters=normalized_parameters,
        structures=structures,
        artifact_count=artifact_count,
    )

    emit_log(
        "info",
        "marcus.math",
        "Cálculo Marcus completado correctamente.",
        {
            "barrier_kcal_mol": result_payload["barrier_kcal_mol"],
            "rate_constant": result_payload["rate_constant"],
        },
    )

    progress_callback(100, "completed", "Cálculo Marcus finalizado.")

    logger.info(
        "Marcus completado para job=%s con rate_constant=%s",
        job_id_value,
        result_payload["rate_constant"],
    )
    return cast(JSONMap, result_payload)
