"""plugin.py: Lógica de dominio para cálculo de fracciones molares.

Objetivo del archivo:
- Implementar la lógica científica desacoplada de HTTP/ORM.

Cómo se usa:
- `PluginRegistry` ejecuta `molar_fractions_plugin` desde `JobService.run_job`.
- El plugin publica progreso/logs para trazabilidad paso a paso del cálculo.
"""

from __future__ import annotations

import logging
from typing import cast

from apps.core.processing import PluginRegistry
from apps.core.types import JSONMap, PluginLogCallback, PluginProgressCallback

from .definitions import (
    DEFAULT_SINGLE_PH_STEP,
    MAX_PH_POINTS,
    MAX_PKA_VALUES,
    MIN_PKA_VALUES,
    PLUGIN_NAME,
)
from .types import (
    MolarFractionRow,
    MolarFractionsInput,
    MolarFractionsMetadata,
    MolarFractionsMode,
    MolarFractionsResult,
)

logger = logging.getLogger(__name__)


def _build_molar_fractions_input(parameters: JSONMap) -> MolarFractionsInput:
    """Valida y normaliza los parámetros de entrada de fracciones molares."""
    raw_pka_values = parameters.get("pka_values")
    if not isinstance(raw_pka_values, list):
        raise ValueError("pka_values debe ser una lista de números.")

    pka_values: list[float] = [float(value) for value in raw_pka_values]
    if len(pka_values) < MIN_PKA_VALUES or len(pka_values) > MAX_PKA_VALUES:
        raise ValueError(
            f"pka_values debe contener entre {MIN_PKA_VALUES} y {MAX_PKA_VALUES} valores."
        )

    raw_mode: str = str(parameters.get("ph_mode", "range"))
    if raw_mode not in {"single", "range"}:
        raise ValueError("ph_mode debe ser 'single' o 'range'.")
    mode: MolarFractionsMode = cast(MolarFractionsMode, raw_mode)

    if mode == "single":
        raw_ph_value = parameters.get("ph_value")
        if raw_ph_value is None:
            raise ValueError("ph_value es obligatorio cuando ph_mode=single.")
        normalized_ph_value: float = float(raw_ph_value)
        return {
            "pka_values": pka_values,
            "ph_mode": mode,
            "ph_min": normalized_ph_value,
            "ph_max": normalized_ph_value,
            "ph_step": DEFAULT_SINGLE_PH_STEP,
        }

    raw_ph_min = parameters.get("ph_min")
    raw_ph_max = parameters.get("ph_max")
    raw_ph_step = parameters.get("ph_step")

    if raw_ph_min is None or raw_ph_max is None or raw_ph_step is None:
        raise ValueError(
            "ph_min, ph_max y ph_step son obligatorios cuando ph_mode=range."
        )

    ph_min: float = float(raw_ph_min)
    ph_max: float = float(raw_ph_max)
    ph_step: float = float(raw_ph_step)

    if ph_step <= 0:
        raise ValueError("ph_step debe ser mayor que cero.")

    normalized_min: float = min(ph_min, ph_max)
    normalized_max: float = max(ph_min, ph_max)
    estimated_points: int = int(((normalized_max - normalized_min) / ph_step) + 1) + 1
    if estimated_points > MAX_PH_POINTS:
        raise ValueError(
            f"La malla de pH excede el máximo permitido de {MAX_PH_POINTS} puntos."
        )

    return {
        "pka_values": pka_values,
        "ph_mode": mode,
        "ph_min": normalized_min,
        "ph_max": normalized_max,
        "ph_step": ph_step,
    }


def _build_ph_grid(ph_min: float, ph_max: float, ph_step: float) -> list[float]:
    """Construye una malla de pH inclusiva similar al comportamiento legado."""
    ph_values: list[float] = []
    current_value: float = ph_min
    epsilon_value: float = max(ph_step * 1e-6, 1e-9)

    while current_value <= ph_max + epsilon_value:
        ph_values.append(round(current_value, 10))
        current_value += ph_step

    if len(ph_values) == 0:
        raise ValueError("No se pudo construir una malla de pH válida.")

    if len(ph_values) > MAX_PH_POINTS:
        raise ValueError(
            f"La malla de pH excede el máximo permitido de {MAX_PH_POINTS} puntos."
        )

    return ph_values


def _compute_beta_values(pka_values: list[float]) -> list[float]:
    """Calcula betas acumuladas replicando el algoritmo del legado Tkinter."""
    beta_values: list[float] = [1.0]
    pka_count: int = len(pka_values)

    for k_index in range(1, pka_count + 1):
        exponent_value: float = 0.0
        for reverse_index in range(k_index):
            exponent_value += pka_values[pka_count - reverse_index - 1]
        beta_values.append(10**exponent_value)

    return beta_values


def _compute_fraction_row(
    ph_value: float, beta_values: list[float]
) -> MolarFractionRow:
    """Calcula fracciones molares f0..fn para un valor de pH puntual."""
    hydrogen_concentration: float = 10 ** (-ph_value)

    denominator: float = 0.0
    indexed_terms: list[float] = []
    for species_index, beta_value in enumerate(beta_values):
        term_value: float = beta_value * (hydrogen_concentration**species_index)
        indexed_terms.append(term_value)
        denominator += term_value

    if denominator == 0:
        raise ValueError("El denominador del cálculo de fracciones resultó en cero.")

    fractions: list[float] = [term_value / denominator for term_value in indexed_terms]
    sum_fraction: float = float(sum(fractions))
    return {
        "ph": ph_value,
        "fractions": fractions,
        "sum_fraction": sum_fraction,
    }


@PluginRegistry.register(PLUGIN_NAME)
def molar_fractions_plugin(
    parameters: JSONMap,
    progress_callback: PluginProgressCallback,
    log_callback: PluginLogCallback | None = None,
) -> JSONMap:
    """Ejecuta cálculo de fracciones molares y reporta trazabilidad detallada."""
    emit_log: PluginLogCallback = (
        log_callback
        if log_callback is not None
        else lambda _level, _source, _message, _payload: None
    )

    emit_log(
        "info",
        "molar_fractions.plugin",
        "Iniciando validación de parámetros para cálculo de fracciones molares.",
        {
            "received_keys": list(parameters.keys()),
        },
    )

    normalized_input: MolarFractionsInput = _build_molar_fractions_input(parameters)
    pka_values: list[float] = normalized_input["pka_values"]
    ph_mode: MolarFractionsMode = normalized_input["ph_mode"]
    ph_min: float = normalized_input["ph_min"]
    ph_max: float = normalized_input["ph_max"]
    ph_step: float = normalized_input["ph_step"]

    emit_log(
        "info",
        "molar_fractions.plugin",
        "Parámetros validados correctamente; se iniciará el cálculo por malla de pH.",
        {
            "pka_values": pka_values,
            "ph_mode": ph_mode,
            "ph_min": ph_min,
            "ph_max": ph_max,
            "ph_step": ph_step,
        },
    )

    ph_values: list[float] = _build_ph_grid(ph_min, ph_max, ph_step)
    beta_values: list[float] = _compute_beta_values(pka_values)
    species_labels: list[str] = [f"f{index}" for index in range(len(pka_values) + 1)]

    emit_log(
        "info",
        "molar_fractions.plugin",
        "Se construyó la malla de pH y coeficientes beta; iniciando iteración de cálculo.",
        {
            "total_points": len(ph_values),
            "total_species": len(species_labels),
            "species_labels": species_labels,
        },
    )

    logger.info(
        "Calculando fracciones molares con %s puntos y %s especies",
        len(ph_values),
        len(species_labels),
    )

    rows: list[MolarFractionRow] = []
    total_points: int = len(ph_values)

    for point_index, ph_value in enumerate(ph_values, start=1):
        emit_log(
            "debug",
            "molar_fractions.plugin",
            "Se iniciará el cálculo para el punto de pH actual.",
            {
                "index": point_index,
                "total_points": total_points,
                "ph": ph_value,
            },
        )

        row: MolarFractionRow = _compute_fraction_row(ph_value, beta_values)
        rows.append(row)

        emit_log(
            "debug",
            "molar_fractions.plugin",
            "Cálculo de punto completado correctamente.",
            {
                "index": point_index,
                "ph": ph_value,
                "sum_fraction": row["sum_fraction"],
                "fractions": row["fractions"],
            },
        )

        completion_percentage: int = int((point_index / total_points) * 100)
        progress_callback(
            completion_percentage,
            "running",
            (
                f"Calculadas fracciones molares para {point_index}/{total_points} "
                "valores de pH."
            ),
        )

    metadata: MolarFractionsMetadata = {
        "pka_values": pka_values,
        "ph_mode": ph_mode,
        "ph_min": ph_min,
        "ph_max": ph_max,
        "ph_step": ph_step,
        "total_species": len(species_labels),
        "total_points": len(rows),
    }

    emit_log(
        "info",
        "molar_fractions.plugin",
        "Cálculo global de fracciones molares completado.",
        {
            "total_points": len(rows),
            "total_species": len(species_labels),
            "first_row": rows[0] if len(rows) > 0 else None,
            "last_row": rows[-1] if len(rows) > 0 else None,
        },
    )

    result_payload: MolarFractionsResult = {
        "species_labels": species_labels,
        "rows": rows,
        "metadata": metadata,
    }
    return result_payload
