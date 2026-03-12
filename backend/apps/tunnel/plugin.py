"""plugin.py: Lógica de dominio para cálculo de efecto túnel con CK_TEST.

Objetivo del archivo:
- Ejecutar cálculo científico de efecto túnel desacoplado de HTTP/ORM.
- Persistir trazabilidad de cambios de entrada como eventos de log del job.

Cómo se usa:
- `PluginRegistry` ejecuta `tunnel_effect_plugin` desde `JobService.run_job`.
- El plugin emite progreso y logs para observabilidad técnica y auditoría.
"""

from __future__ import annotations

import logging
import math

from libs.ck_test.calculators import TST
from libs.ck_test.models import TSTPrecalculatedConstants

from apps.core.processing import PluginRegistry
from apps.core.types import JSONMap, PluginLogCallback, PluginProgressCallback

from .definitions import PLUGIN_NAME
from .types import (
    TunnelCalculationInput,
    TunnelCalculationMetadata,
    TunnelCalculationResult,
    TunnelInputChangeEvent,
)

logger = logging.getLogger(__name__)


def _emit_math_operation_logs(
    emit_log: PluginLogCallback,
    normalized_input: TunnelCalculationInput,
    calc_u: float,
    calc_alpha_1: float,
    calc_alpha_2: float,
    calc_g: float,
) -> tuple[float, float]:
    """Emite trazas detalladas de operaciones matematicas clave del modelo Tunnel."""
    constants = TSTPrecalculatedConstants()

    reaction_barrier_zpe: float = normalized_input["reaction_barrier_zpe"]
    reaction_energy_zpe: float = normalized_input["reaction_energy_zpe"]
    imaginary_frequency: float = normalized_input["imaginary_frequency"]
    temperature: float = normalized_input["temperature"]

    alpha_1_numerator: float = (
        2.0 * math.pi * reaction_barrier_zpe * constants.cal_to_joule
    )
    alpha_1_denominator: float = (
        constants.avogadro
        * constants.planck
        * constants.speed_of_light
        * imaginary_frequency
    )
    alpha_1_trace: float = alpha_1_numerator / alpha_1_denominator

    emit_log(
        "debug",
        "tunnel.math",
        "Operacion matematica: calculo de alpha_1.",
        {
            "formula": "alpha_1 = (2*pi*BARRZPE*CAL)/(AV*H*C*FREQ)",
            "numerator": alpha_1_numerator,
            "denominator": alpha_1_denominator,
            "result": alpha_1_trace,
        },
    )

    alpha_2_numerator: float = (
        2.0
        * math.pi
        * (reaction_barrier_zpe - reaction_energy_zpe)
        * constants.cal_to_joule
    )
    alpha_2_denominator: float = alpha_1_denominator
    alpha_2_trace: float = alpha_2_numerator / alpha_2_denominator

    emit_log(
        "debug",
        "tunnel.math",
        "Operacion matematica: calculo de alpha_2.",
        {
            "formula": "alpha_2 = (2*pi*(BARRZPE-DELZPE)*CAL)/(AV*H*C*FREQ)",
            "numerator": alpha_2_numerator,
            "denominator": alpha_2_denominator,
            "result": alpha_2_trace,
        },
    )

    u_numerator: float = (
        constants.planck * constants.speed_of_light * imaginary_frequency
    )
    u_denominator: float = constants.boltzmann * temperature
    u_trace: float = u_numerator / u_denominator

    emit_log(
        "debug",
        "tunnel.math",
        "Operacion matematica: calculo de U.",
        {
            "formula": "U = (H*C*FREQ)/(KB*T)",
            "numerator": u_numerator,
            "denominator": u_denominator,
            "result": u_trace,
        },
    )

    baseline_value: float = math.exp(-calc_u)
    emit_log(
        "debug",
        "tunnel.math",
        "Operacion matematica: calculo de baseline clasico exp(-U).",
        {
            "formula": "baseline = exp(-U)",
            "u": calc_u,
            "result": baseline_value,
        },
    )

    kappa_tst: float = calc_g / baseline_value
    emit_log(
        "debug",
        "tunnel.math",
        "Operacion matematica: calculo de kappa_tst.",
        {
            "formula": "kappa_tst = G / exp(-U)",
            "g": calc_g,
            "baseline": baseline_value,
            "result": kappa_tst,
        },
    )

    emit_log(
        "debug",
        "tunnel.math",
        "Verificacion matematica contra resultado CK_TEST.",
        {
            "u_trace": u_trace,
            "u_ck_test": calc_u,
            "alpha_1_trace": alpha_1_trace,
            "alpha_1_ck_test": calc_alpha_1,
            "alpha_2_trace": alpha_2_trace,
            "alpha_2_ck_test": calc_alpha_2,
            "delta_u": abs(u_trace - calc_u),
            "delta_alpha_1": abs(alpha_1_trace - calc_alpha_1),
            "delta_alpha_2": abs(alpha_2_trace - calc_alpha_2),
        },
    )

    return baseline_value, kappa_tst


def _build_input_change_event(raw_event: JSONMap) -> TunnelInputChangeEvent:
    """Normaliza un evento individual de cambio de entrada."""
    field_name_value: str = str(raw_event.get("field_name", "")).strip()
    changed_at_value: str = str(raw_event.get("changed_at", "")).strip()

    if field_name_value == "":
        raise ValueError("Cada evento debe incluir field_name.")

    if changed_at_value == "":
        raise ValueError("Cada evento debe incluir changed_at.")

    return {
        "field_name": field_name_value,
        "previous_value": float(raw_event.get("previous_value", 0.0)),
        "new_value": float(raw_event.get("new_value", 0.0)),
        "changed_at": changed_at_value,
    }


def _build_tunnel_input(parameters: JSONMap) -> TunnelCalculationInput:
    """Valida y normaliza parámetros de entrada para cálculo Tunnel."""
    reaction_barrier_zpe: float = float(parameters.get("reaction_barrier_zpe", 0.0))
    imaginary_frequency: float = float(parameters.get("imaginary_frequency", 0.0))
    reaction_energy_zpe: float = float(parameters.get("reaction_energy_zpe", 0.0))
    temperature: float = float(parameters.get("temperature", 0.0))

    if reaction_barrier_zpe <= 0:
        raise ValueError("reaction_barrier_zpe debe ser mayor que cero.")

    if imaginary_frequency <= 0:
        raise ValueError("imaginary_frequency debe ser mayor que cero.")

    if temperature <= 0:
        raise ValueError("temperature debe ser mayor que cero.")

    raw_events: object = parameters.get("input_change_events", [])
    if not isinstance(raw_events, list):
        raise ValueError("input_change_events debe ser una lista de eventos.")

    input_change_events: list[TunnelInputChangeEvent] = []
    for raw_event in raw_events:
        if not isinstance(raw_event, dict):
            raise ValueError("Cada evento de input_change_events debe ser un objeto.")
        input_change_events.append(_build_input_change_event(raw_event))

    return {
        "reaction_barrier_zpe": reaction_barrier_zpe,
        "imaginary_frequency": imaginary_frequency,
        "reaction_energy_zpe": reaction_energy_zpe,
        "temperature": temperature,
        "input_change_events": input_change_events,
    }


def _build_metadata(input_event_count: int) -> TunnelCalculationMetadata:
    """Construye metadatos de salida con unidades y referencia de modelo."""
    return {
        "model_name": "Asymmetric Eckart Tunneling (Gauss-Legendre 40-point)",
        "source_library": "libs.ck_test.TST",
        "units": {
            "reaction_barrier_zpe": "kcal/mol",
            "reaction_energy_zpe": "kcal/mol",
            "imaginary_frequency": "cm^-1",
            "temperature": "K",
            "u": "dimensionless",
            "alpha_1": "dimensionless",
            "alpha_2": "dimensionless",
            "g": "dimensionless",
            "kappa_tst": "dimensionless",
        },
        "input_event_count": input_event_count,
    }


@PluginRegistry.register(PLUGIN_NAME)
def tunnel_effect_plugin(
    parameters: JSONMap,
    progress_callback: PluginProgressCallback,
    log_callback: PluginLogCallback | None = None,
) -> JSONMap:
    """Ejecuta cálculo Tunnel usando CK_TEST y emite trazabilidad completa."""
    emit_log: PluginLogCallback = (
        log_callback
        if log_callback is not None
        else lambda _level, _source, _message, _payload: None
    )

    progress_callback(5, "running", "Validando parámetros de entrada Tunnel.")
    normalized_input: TunnelCalculationInput = _build_tunnel_input(parameters)

    emit_log(
        "info",
        "tunnel.plugin",
        "Parámetros de Tunnel validados correctamente.",
        {
            "reaction_barrier_zpe": normalized_input["reaction_barrier_zpe"],
            "imaginary_frequency": normalized_input["imaginary_frequency"],
            "reaction_energy_zpe": normalized_input["reaction_energy_zpe"],
            "temperature": normalized_input["temperature"],
            "input_event_count": len(normalized_input["input_change_events"]),
        },
    )

    progress_callback(20, "running", "Persistiendo eventos de cambios de entradas.")
    for input_event in normalized_input["input_change_events"]:
        emit_log(
            "debug",
            "tunnel.input",
            "Cambio de entrada registrado desde frontend.",
            {
                "field_name": input_event["field_name"],
                "previous_value": input_event["previous_value"],
                "new_value": input_event["new_value"],
                "changed_at": input_event["changed_at"],
            },
        )

    progress_callback(45, "running", "Ejecutando cálculo CK_TEST para efecto túnel.")
    calculator = TST()
    calc_result = calculator.set_parameters(
        delta_zpe=normalized_input["reaction_energy_zpe"],
        barrier_zpe=normalized_input["reaction_barrier_zpe"],
        frequency=normalized_input["imaginary_frequency"],
        temperature=normalized_input["temperature"],
    )

    if not calc_result.success:
        message_value: str = (
            calc_result.error_message
            if calc_result.error_message is not None
            else "Error desconocido en cálculo Tunnel."
        )
        raise ValueError(message_value)

    if not all(
        math.isfinite(float(value))
        for value in [
            calc_result.u,
            calc_result.alpha_1,
            calc_result.alpha_2,
            calc_result.g,
        ]
    ):
        raise ValueError("El cálculo Tunnel produjo valores no finitos.")

    baseline_value, kappa_tst = _emit_math_operation_logs(
        emit_log=emit_log,
        normalized_input=normalized_input,
        calc_u=float(calc_result.u),
        calc_alpha_1=float(calc_result.alpha_1),
        calc_alpha_2=float(calc_result.alpha_2),
        calc_g=float(calc_result.g),
    )

    if baseline_value <= 0 or not math.isfinite(baseline_value):
        raise ValueError("No se pudo calcular baseline físico exp(-U) para kappa_tst.")

    progress_callback(80, "running", "Construyendo resultado final de Tunnel.")
    result_payload: TunnelCalculationResult = {
        "u": float(calc_result.u),
        "alpha_1": float(calc_result.alpha_1),
        "alpha_2": float(calc_result.alpha_2),
        "g": float(calc_result.g),
        "kappa_tst": float(kappa_tst),
        "metadata": _build_metadata(len(normalized_input["input_change_events"])),
    }

    emit_log(
        "info",
        "tunnel.plugin",
        "Cálculo Tunnel completado correctamente.",
        {
            "u": result_payload["u"],
            "alpha_1": result_payload["alpha_1"],
            "alpha_2": result_payload["alpha_2"],
            "g": result_payload["g"],
            "kappa_tst": result_payload["kappa_tst"],
        },
    )

    logger.info(
        "Job Tunnel completado con U=%s, Alpha1=%s, Alpha2=%s, G=%s",
        result_payload["u"],
        result_payload["alpha_1"],
        result_payload["alpha_2"],
        result_payload["g"],
    )
    progress_callback(100, "completed", "Cálculo Tunnel finalizado.")

    return result_payload
