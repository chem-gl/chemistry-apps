"""plugin.py: Lógica de dominio Easy-rate desacoplada de HTTP.

Objetivo del archivo:
- Parsear entradas Gaussian persistidas en DB y calcular constantes de velocidad
  con TST, corrección de túnel y corrección difusiva opcional.

Cómo se usa:
- `JobService.run_job` ejecuta `easy_rate_plugin` vía `PluginRegistry`.
- El plugin solo depende de parámetros serializables y del `job_id` inyectado
  por runtime para reconstruir artefactos desde DB.
"""

from __future__ import annotations

import logging
import math
from typing import cast

from libs.ck_test.calculators import TST
from libs.ck_test.models import TSTPrecalculatedConstants
from libs.gaussian_log_parser.models import GaussianExecution
from libs.gaussian_log_parser.parsers import GaussianLogParser

from apps.core.artifacts import ScientificInputArtifactStorageService
from apps.core.models import ScientificJobInputArtifact
from apps.core.processing import PluginRegistry
from apps.core.types import JSONMap, PluginLogCallback, PluginProgressCallback

from .definitions import PLUGIN_NAME
from .types import (
    EasyRateCalculationResult,
    EasyRateInspectionExecutionSummary,
    EasyRateInspectionResult,
    EasyRateJobParameters,
    EasyRateResultMetadata,
    EasyRateStructureSnapshot,
)

logger = logging.getLogger(__name__)

HARTREE_TO_KCAL: float = 627.5095
R_GAS_KCAL: float = 1.987 / 1000.0
KB: float = 1.380649e-23
NA: float = 6.02214076e23
PI: float = math.pi
ANGSTROM_TO_M: float = 1e-10


def _is_finite(value: float) -> bool:
    """Valida que un float sea numérico finito."""
    return math.isfinite(value)


def _to_optional_finite(value: float | None) -> float | None:
    """Normaliza números no finitos a None para serialización JSON segura."""
    if value is None:
        return None
    return value if _is_finite(value) else None


def _build_zero_structure_snapshot(source_field: str) -> EasyRateStructureSnapshot:
    """Crea snapshot neutro para estructuras opcionales no provistas."""
    return {
        "source_field": source_field,
        "original_filename": None,
        "is_provided": False,
        "execution_index": None,
        "available_execution_count": 0,
        "job_title": None,
        "checkpoint_file": None,
        "charge": 0,
        "multiplicity": 1,
        "free_energy": 0.0,
        "thermal_enthalpy": 0.0,
        "zero_point_energy": 0.0,
        "scf_energy": 0.0,
        "temperature": 0.0,
        "negative_frequencies": 0,
        "imaginary_frequency": 0.0,
        "normal_termination": False,
        "is_opt_freq": False,
    }


def _parse_gaussian_execution(
    *,
    parser: GaussianLogParser,
    artifact_bytes: bytes,
    original_filename: str,
    selected_execution_index: int | None,
) -> tuple[GaussianExecution, int, int, list[str]]:
    """Parsea bytes Gaussian y resuelve la ejecución seleccionada por índice."""
    parser_result = parser.parse_blob(artifact_bytes)

    if parser_result.execution_count == 0:
        joined_errors: str = " | ".join(parser_result.errors)
        if joined_errors.strip() == "":
            joined_errors = "No se detectaron ejecuciones Gaussian válidas."
        raise ValueError(
            f"El archivo '{original_filename}' no contiene ejecuciones válidas: {joined_errors}"
        )

    resolved_execution_index: int = (
        parser_result.execution_count - 1
        if selected_execution_index is None
        else selected_execution_index
    )
    if (
        resolved_execution_index < 0
        or resolved_execution_index >= parser_result.execution_count
    ):
        raise ValueError(
            (
                f"El archivo '{original_filename}' tiene {parser_result.execution_count} ejecuciones "
                f"y se solicitó execution_index={resolved_execution_index}."
            )
        )

    execution: GaussianExecution | None = parser_result.executions[
        resolved_execution_index
    ]
    if execution is None:
        raise ValueError(
            f"No fue posible recuperar una ejecución válida del archivo '{original_filename}'."
        )

    return (
        execution,
        parser_result.execution_count,
        resolved_execution_index,
        list(parser_result.errors),
    )


def _build_structure_snapshot(
    *,
    source_field: str,
    execution: GaussianExecution,
    original_filename: str | None,
    execution_index: int,
    available_execution_count: int,
) -> EasyRateStructureSnapshot:
    """Mapea la ejecución Gaussian a estructura tipada del dominio Easy-rate."""
    raw_imaginary_frequency: float = float(execution.imaginary_frequency)
    normalized_imaginary_frequency: float = (
        abs(raw_imaginary_frequency) if _is_finite(raw_imaginary_frequency) else 0.0
    )
    normalized_negative_frequencies: int = int(execution.negative_frequencies)
    if normalized_negative_frequencies == 0 and normalized_imaginary_frequency > 0.0:
        normalized_negative_frequencies = 1

    return {
        "source_field": source_field,
        "original_filename": original_filename,
        "is_provided": True,
        "execution_index": execution_index,
        "available_execution_count": available_execution_count,
        "job_title": execution.job_title.strip() or None,
        "checkpoint_file": execution.checkpoint_file.strip() or None,
        "charge": int(execution.charge),
        "multiplicity": int(execution.multiplicity),
        "free_energy": float(execution.free_energies),
        "thermal_enthalpy": float(execution.thermal_enthalpies),
        "zero_point_energy": float(execution.zero_point_energy),
        "scf_energy": float(execution.scf_energy),
        "temperature": float(execution.temperature),
        "negative_frequencies": normalized_negative_frequencies,
        "imaginary_frequency": normalized_imaginary_frequency,
        "normal_termination": bool(execution.normal_termination),
        "is_opt_freq": bool(execution.is_opt_freq),
    }


def _collect_structure_validation_errors(
    *,
    snapshot: EasyRateStructureSnapshot,
    expected_role: str,
) -> list[str]:
    """Construye errores de validación sin lanzar excepción para reutilizar en preview."""
    if not snapshot["is_provided"]:
        return []

    validation_errors: list[str] = []
    required_values: list[float] = [
        snapshot["free_energy"],
        snapshot["thermal_enthalpy"],
        snapshot["zero_point_energy"],
        snapshot["temperature"],
    ]

    if not all(_is_finite(value) for value in required_values):
        validation_errors.append(
            "La ejecución no tiene termodinámica completa (G, H, ZPE, T)."
        )

    if expected_role == "transition_state_file":
        if snapshot["negative_frequencies"] != 1:
            validation_errors.append(
                "Transition state debe tener exactamente 1 frecuencia imaginaria."
            )
        if snapshot["imaginary_frequency"] <= 0.0 or not _is_finite(
            snapshot["imaginary_frequency"]
        ):
            validation_errors.append(
                "Transition state requiere frecuencia imaginaria válida mayor a cero."
            )
        return validation_errors

    if snapshot["negative_frequencies"] != 0:
        validation_errors.append(
            "Reactivos y productos deben tener 0 frecuencias imaginarias."
        )

    return validation_errors


def _validate_structure_snapshot(
    *,
    snapshot: EasyRateStructureSnapshot,
    expected_role: str,
) -> None:
    """Aplica reglas de integridad termodinámica y frecuencias por rol."""
    validation_errors = _collect_structure_validation_errors(
        snapshot=snapshot,
        expected_role=expected_role,
    )
    if len(validation_errors) == 0:
        return

    filename: str = snapshot["original_filename"] or expected_role
    raise ValueError(
        f"El archivo '{filename}' no es válido para {expected_role}: {' '.join(validation_errors)}"
    )


def inspect_easy_rate_gaussian_blob(
    *,
    source_field: str,
    original_filename: str | None,
    artifact_bytes: bytes,
) -> EasyRateInspectionResult:
    """Inspecciona un archivo Gaussian y devuelve ejecuciones candidatas para UI."""
    parser = GaussianLogParser()
    parser_result = parser.parse_blob(artifact_bytes)
    default_execution_index: int | None = (
        parser_result.execution_count - 1 if parser_result.execution_count > 0 else None
    )

    execution_summaries: list[EasyRateInspectionExecutionSummary] = []
    for execution_index, execution in enumerate(parser_result.executions):
        snapshot = _build_structure_snapshot(
            source_field=source_field,
            execution=execution,
            original_filename=original_filename,
            execution_index=execution_index,
            available_execution_count=parser_result.execution_count,
        )
        validation_errors = _collect_structure_validation_errors(
            snapshot=snapshot,
            expected_role=source_field,
        )
        execution_summaries.append(
            {
                "source_field": source_field,
                "original_filename": original_filename,
                "execution_index": execution_index,
                "job_title": snapshot["job_title"],
                "checkpoint_file": snapshot["checkpoint_file"],
                "charge": snapshot["charge"],
                "multiplicity": snapshot["multiplicity"],
                "free_energy": _to_optional_finite(snapshot["free_energy"]),
                "thermal_enthalpy": _to_optional_finite(snapshot["thermal_enthalpy"]),
                "zero_point_energy": _to_optional_finite(snapshot["zero_point_energy"]),
                "scf_energy": _to_optional_finite(snapshot["scf_energy"]),
                "temperature": _to_optional_finite(snapshot["temperature"]),
                "negative_frequencies": snapshot["negative_frequencies"],
                "imaginary_frequency": _to_optional_finite(
                    snapshot["imaginary_frequency"]
                ),
                "normal_termination": snapshot["normal_termination"],
                "is_opt_freq": snapshot["is_opt_freq"],
                "is_valid_for_role": len(validation_errors) == 0,
                "validation_errors": validation_errors,
            }
        )

    return {
        "source_field": source_field,
        "original_filename": original_filename,
        "parse_errors": list(parser_result.errors),
        "execution_count": parser_result.execution_count,
        "default_execution_index": default_execution_index,
        "executions": execution_summaries,
    }


def _resolve_viscosity(
    *,
    solvent: str,
    custom_viscosity: float | None,
) -> float | None:
    """Resuelve viscosidad final en Pa*s según solvente o valor custom."""
    normalized_solvent: str = solvent.strip()

    if normalized_solvent == "Other":
        if custom_viscosity is None or custom_viscosity <= 0:
            raise ValueError(
                "Cuando solvent es 'Other' se requiere custom_viscosity > 0."
            )
        return custom_viscosity

    viscosity_map: dict[str, float] = {
        "Benzene": 0.000604,
        "Gas phase (Air)": 0.000018,
        "Pentyl ethanoate": 0.000862,
        "Water": 0.000891,
    }

    if normalized_solvent == "":
        return None

    return viscosity_map.get(normalized_solvent)


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


def _compute_easy_rate(
    *,
    parameters: EasyRateJobParameters,
    structures: dict[str, EasyRateStructureSnapshot],
    artifact_count: int,
    emit_log: PluginLogCallback,
) -> EasyRateCalculationResult:
    """Ejecuta ecuaciones Easy-rate con lógica legacy en etapas pequeñas."""
    thermo = _compute_thermodynamic_terms(
        structures=structures,
        cage_effects=parameters["cage_effects"],
        emit_log=emit_log,
    )

    tunnel = _compute_tunnel_terms(
        gibbs_activation=thermo["gibbs_activation"],
        zpe_activation=thermo["zpe_activation"],
        zpe_reaction=thermo["zpe_reaction"],
        imaginary_frequency=thermo["imaginary_frequency"],
        temperature_k=thermo["temperature_k"],
    )

    rate_constant_tst: float | None = None
    if not tunnel["warn_negative_activation"]:
        rate_constant_tst = (
            parameters["reaction_path_degeneracy"]
            * tunnel["kappa_tst"]
            * (
                2.08e10
                * thermo["temperature_k"]
                * math.exp(
                    -thermo["gibbs_activation"] / (R_GAS_KCAL * thermo["temperature_k"])
                )
            )
        )

    diffusion = _compute_diffusion_terms(
        diffusion_enabled=parameters["diffusion"],
        solvent=parameters["solvent"],
        custom_viscosity=parameters["custom_viscosity"],
        radius_reactant_1=parameters["radius_reactant_1"],
        radius_reactant_2=parameters["radius_reactant_2"],
        reaction_distance=parameters["reaction_distance"],
        temperature_k=thermo["temperature_k"],
        rate_constant_tst=rate_constant_tst,
    )

    metadata: EasyRateResultMetadata = {
        "model_name": "Easy Rate (TST + Tunnel + Diffusion)",
        "source_library": "libs.ck_test + libs.gaussian_log_parser",
        "units": {
            "gibbs": "kcal/mol",
            "enthalpy": "kcal/mol",
            "zpe": "kcal/mol",
            "temperature": "K",
            "imaginary_frequency": "cm^-1",
            "rate_constant": "M^-1 s^-1 or s^-1",
            "viscosity": "Pa*s",
        },
        "input_artifact_count": artifact_count,
    }

    emit_log(
        "info",
        "easy_rate.math",
        "Cálculo principal Easy-rate completado.",
        {
            "gibbs_reaction_kcal_mol": thermo["gibbs_reaction"],
            "gibbs_activation_kcal_mol": thermo["gibbs_activation"],
            "rate_constant": diffusion["final_rate_constant"],
            "kappa_tst": tunnel["kappa_tst"],
        },
    )

    return {
        "title": parameters["title"],
        "rate_constant": _to_optional_finite(diffusion["final_rate_constant"]),
        "rate_constant_tst": _to_optional_finite(rate_constant_tst),
        "rate_constant_diffusion_corrected": _to_optional_finite(
            diffusion["rate_constant_diffusion_corrected"]
        ),
        "k_diff": _to_optional_finite(diffusion["k_diff"]),
        "gibbs_reaction_kcal_mol": thermo["gibbs_reaction"],
        "gibbs_activation_kcal_mol": thermo["gibbs_activation"],
        "enthalpy_reaction_kcal_mol": thermo["enthalpy_reaction"],
        "enthalpy_activation_kcal_mol": thermo["enthalpy_activation"],
        "zpe_reaction_kcal_mol": thermo["zpe_reaction"],
        "zpe_activation_kcal_mol": thermo["zpe_activation"],
        "tunnel_u": _to_optional_finite(tunnel["tunnel_u"]),
        "tunnel_alpha_1": _to_optional_finite(tunnel["tunnel_alpha_1"]),
        "tunnel_alpha_2": _to_optional_finite(tunnel["tunnel_alpha_2"]),
        "tunnel_g": _to_optional_finite(tunnel["tunnel_g"]),
        "kappa_tst": tunnel["kappa_tst"],
        "temperature_k": thermo["temperature_k"],
        "imaginary_frequency_cm1": thermo["imaginary_frequency"],
        "delta_n_reaction": thermo["delta_n_reaction"],
        "delta_n_transition": thermo["delta_n_transition"],
        "warn_negative_activation": tunnel["warn_negative_activation"],
        "cage_effects_applied": bool(parameters["cage_effects"]),
        "diffusion_applied": bool(parameters["diffusion"]),
        "solvent_used": parameters["solvent"],
        "viscosity_pa_s": _to_optional_finite(diffusion["viscosity_pa_s"]),
        "reaction_path_degeneracy": parameters["reaction_path_degeneracy"],
        "structures": structures,
        "metadata": metadata,
    }


def _compute_thermodynamic_terms(
    *,
    structures: dict[str, EasyRateStructureSnapshot],
    cage_effects: bool,
    emit_log: PluginLogCallback,
) -> dict[str, float | int]:
    """Calcula términos termodinámicos base de Easy-rate."""
    react_1 = structures["reactant_1_file"]
    react_2 = structures["reactant_2_file"]
    transition_state = structures["transition_state_file"]
    product_1 = structures["product_1_file"]
    product_2 = structures["product_2_file"]

    temperature_k: float = transition_state["temperature"]
    if temperature_k <= 0.0:
        raise ValueError(
            "Temperature del transition_state_file debe ser mayor que cero."
        )

    enthalpy_reaction: float = HARTREE_TO_KCAL * (
        product_1["thermal_enthalpy"]
        + product_2["thermal_enthalpy"]
        - react_1["thermal_enthalpy"]
        - react_2["thermal_enthalpy"]
    )
    enthalpy_activation: float = HARTREE_TO_KCAL * (
        transition_state["thermal_enthalpy"]
        - react_1["thermal_enthalpy"]
        - react_2["thermal_enthalpy"]
    )

    zpe_reaction: float = HARTREE_TO_KCAL * (
        product_1["zero_point_energy"]
        + product_2["zero_point_energy"]
        - react_1["zero_point_energy"]
        - react_2["zero_point_energy"]
    )
    zpe_activation: float = HARTREE_TO_KCAL * (
        transition_state["zero_point_energy"]
        - react_1["zero_point_energy"]
        - react_2["zero_point_energy"]
    )

    gibbs_r1: float = react_1["free_energy"]
    gibbs_r2: float = react_2["free_energy"]
    gibbs_ts: float = transition_state["free_energy"]
    gibbs_p1: float = product_1["free_energy"]
    gibbs_p2: float = product_2["free_energy"]

    molar_volume: float = 0.08206 * temperature_k
    count_reactants: int = sum(
        1 for snapshot in [react_1, react_2] if snapshot["is_provided"]
    )
    count_products: int = sum(
        1 for snapshot in [product_1, product_2] if snapshot["is_provided"]
    )
    delta_n_reaction: int = count_products - count_reactants
    delta_n_transition: int = 1 - count_reactants

    correction_reaction: float = (
        R_GAS_KCAL * temperature_k * math.log(math.pow(molar_volume, delta_n_reaction))
    )
    correction_transition: float = (
        R_GAS_KCAL
        * temperature_k
        * math.log(math.pow(molar_volume, delta_n_transition))
    )

    gibbs_reaction: float = correction_reaction + HARTREE_TO_KCAL * (
        gibbs_p1 + gibbs_p2 - gibbs_r1 - gibbs_r2
    )
    gibbs_activation: float = correction_transition + HARTREE_TO_KCAL * (
        gibbs_ts - gibbs_r1 - gibbs_r2
    )

    if cage_effects and delta_n_transition != 0:
        cage_correction = (
            R_GAS_KCAL
            * temperature_k
            * (
                math.log(count_reactants * math.pow(10.0, 2 * count_reactants - 2))
                - (count_reactants - 1)
            )
        )
        gibbs_activation = gibbs_activation - cage_correction
        emit_log(
            "debug",
            "easy_rate.math",
            "Corrección cage aplicada sobre energía de activación.",
            {
                "cage_correction": cage_correction,
                "count_reactants": count_reactants,
            },
        )

    return {
        "temperature_k": temperature_k,
        "imaginary_frequency": transition_state["imaginary_frequency"],
        "enthalpy_reaction": enthalpy_reaction,
        "enthalpy_activation": enthalpy_activation,
        "zpe_reaction": zpe_reaction,
        "zpe_activation": zpe_activation,
        "gibbs_reaction": gibbs_reaction,
        "gibbs_activation": gibbs_activation,
        "delta_n_reaction": delta_n_reaction,
        "delta_n_transition": delta_n_transition,
    }


def _compute_tunnel_terms(
    *,
    gibbs_activation: float,
    zpe_activation: float,
    zpe_reaction: float,
    imaginary_frequency: float,
    temperature_k: float,
) -> dict[str, float | bool | None]:
    """Calcula métricas de túnel y determina si TST aplica."""
    if not _is_finite(imaginary_frequency) or imaginary_frequency <= 0.0:
        raise ValueError(
            "No se puede evaluar la corrección Eckart sin una frecuencia imaginaria positiva y finita."
        )

    if gibbs_activation <= 0.0:
        return {
            "tunnel_u": None,
            "tunnel_alpha_1": None,
            "tunnel_alpha_2": None,
            "tunnel_g": None,
            "kappa_tst": 1.0,
            "warn_negative_activation": True,
        }

    if zpe_activation <= 0.0:
        constants = TSTPrecalculatedConstants()
        tunnel_u = (
            constants.planck * constants.speed_of_light * imaginary_frequency
        ) / (constants.boltzmann * temperature_k)
        return {
            "tunnel_u": tunnel_u,
            "tunnel_alpha_1": None,
            "tunnel_alpha_2": None,
            "tunnel_g": math.exp(-tunnel_u),
            "kappa_tst": 1.0,
            "warn_negative_activation": False,
        }

    if zpe_activation <= zpe_reaction:
        raise ValueError(
            (
                "No se puede evaluar la corrección Eckart porque la barrera ZPE de activación "
                "debe ser mayor que la energía ZPE de reacción. Revise los productos seleccionados "
                "o complete las estructuras faltantes antes de ejecutar Easy-rate."
            )
        )

    tunnel_calculator = TST()
    tunnel_result = tunnel_calculator.set_parameters(
        delta_zpe=zpe_reaction,
        barrier_zpe=zpe_activation,
        frequency=imaginary_frequency,
        temperature=temperature_k,
    )
    if not tunnel_result.success:
        error_text: str = (
            tunnel_result.error_message
            if tunnel_result.error_message is not None
            else "Error desconocido durante cálculo de túnel."
        )
        raise ValueError(error_text)

    tunnel_u: float = float(tunnel_result.u)
    tunnel_g: float = float(tunnel_result.g)
    baseline_exp_u: float = math.exp(-tunnel_u)
    if baseline_exp_u <= 0.0:
        raise ValueError("No fue posible calcular baseline exp(-U) para kappa.")

    return {
        "tunnel_u": tunnel_u,
        "tunnel_alpha_1": float(tunnel_result.alpha_1),
        "tunnel_alpha_2": float(tunnel_result.alpha_2),
        "tunnel_g": tunnel_g,
        "kappa_tst": tunnel_g / baseline_exp_u,
        "warn_negative_activation": False,
    }


def _compute_diffusion_terms(
    *,
    diffusion_enabled: bool,
    solvent: str,
    custom_viscosity: float | None,
    radius_reactant_1: float | None,
    radius_reactant_2: float | None,
    reaction_distance: float | None,
    temperature_k: float,
    rate_constant_tst: float | None,
) -> dict[str, float | None]:
    """Calcula corrección difusiva cuando fue solicitada por el usuario."""
    if not diffusion_enabled:
        return {
            "viscosity_pa_s": None,
            "k_diff": None,
            "rate_constant_diffusion_corrected": None,
            "final_rate_constant": rate_constant_tst,
        }

    viscosity_pa_s = _resolve_viscosity(
        solvent=solvent,
        custom_viscosity=custom_viscosity,
    )
    if viscosity_pa_s is None or viscosity_pa_s <= 0.0:
        raise ValueError("No fue posible resolver una viscosidad válida para difusión.")
    if radius_reactant_1 is None or radius_reactant_1 <= 0.0:
        raise ValueError("radius_reactant_1 es obligatorio cuando diffusion=true.")
    if radius_reactant_2 is None or radius_reactant_2 <= 0.0:
        raise ValueError("radius_reactant_2 es obligatorio cuando diffusion=true.")
    if reaction_distance is None or reaction_distance <= 0.0:
        raise ValueError("reaction_distance es obligatorio cuando diffusion=true.")

    radius_a_m: float = radius_reactant_1 * ANGSTROM_TO_M
    radius_b_m: float = radius_reactant_2 * ANGSTROM_TO_M
    reaction_distance_m: float = reaction_distance * ANGSTROM_TO_M

    diff_coef_a: float = (KB * temperature_k) / (6.0 * PI * viscosity_pa_s * radius_a_m)
    diff_coef_b: float = (KB * temperature_k) / (6.0 * PI * viscosity_pa_s * radius_b_m)
    diff_coef_ab: float = diff_coef_a + diff_coef_b
    k_diff: float = 1000.0 * 4.0 * PI * diff_coef_ab * reaction_distance_m * NA

    rate_constant_diffusion_corrected: float | None = None
    final_rate_constant: float | None = rate_constant_tst
    if rate_constant_tst is not None:
        rate_constant_diffusion_corrected = (k_diff * rate_constant_tst) / (
            k_diff + rate_constant_tst
        )
        final_rate_constant = rate_constant_diffusion_corrected

    return {
        "viscosity_pa_s": viscosity_pa_s,
        "k_diff": k_diff,
        "rate_constant_diffusion_corrected": rate_constant_diffusion_corrected,
        "final_rate_constant": final_rate_constant,
    }


def _build_easy_rate_parameters(parameters: JSONMap) -> EasyRateJobParameters:
    """Normaliza parámetros serializados persistidos del job Easy-rate."""
    file_descriptors_raw = parameters.get("file_descriptors", [])
    if not isinstance(file_descriptors_raw, list):
        raise ValueError("file_descriptors debe ser una lista.")

    normalized_file_descriptors: list[dict[str, str | int]] = []
    for descriptor in file_descriptors_raw:
        if not isinstance(descriptor, dict):
            raise ValueError("Cada descriptor de archivo debe ser un objeto.")

        normalized_file_descriptors.append(
            {
                "field_name": str(descriptor.get("field_name", "")),
                "original_filename": str(descriptor.get("original_filename", "")),
                "content_type": str(descriptor.get("content_type", "")),
                "sha256": str(descriptor.get("sha256", "")),
                "size_bytes": int(descriptor.get("size_bytes", 0)),
            }
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
