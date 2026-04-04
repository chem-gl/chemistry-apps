"""_gaussian_inspector.py: Inspección y parseo de archivos Gaussian para Easy-rate.

Objetivo: parsear archivos log de Gaussian, construir snapshots de estructura
termodinámica y validar cada archivo según el rol esperado (reactivo, producto, TS).
Usado por plugin.py y por el endpoint de inspección en routers.py.
"""

from __future__ import annotations

import math

from libs.gaussian_log_parser.models import GaussianExecution
from libs.gaussian_log_parser.parsers import GaussianLogParser

from .types import (
    EasyRateInspectionExecutionSummary,
    EasyRateInspectionResult,
    EasyRateStructureSnapshot,
)

# =========================
# UTILIDADES NUMÉRICAS
# =========================


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


# =========================
# PARSEO DE EJECUCIONES GAUSSIAN
# =========================


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
            f"El archivo '{original_filename}' tiene {parser_result.execution_count} ejecuciones "
            f"y se solicitó execution_index={resolved_execution_index}."
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


# =========================
# PUNTO DE ENTRADA DE INSPECCIÓN
# =========================


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
