"""plugin.py: Motor puro de scoring y comparación para CADMA Py.

Implementa una variante transparente y reproducible del flujo legado CADMA,
centrada en comparar candidatos frente a un set de referencia mediante métricas
fisicoquímicas, toxicológicas y de accesibilidad sintética.
"""

from __future__ import annotations

import json
import math
import statistics
from typing import Literal, cast

from apps.core.processing import PluginRegistry
from apps.core.types import (
    JobPauseRequested,
    JSONMap,
    PluginControlCallback,
    PluginLogCallback,
    PluginProgressCallback,
)

from .definitions import (
    ADME_METRIC_NAMES,
    ALL_METRIC_NAMES,
    DEFAULT_ADME_INTERVALS,
    DEFAULT_SCORE_REFERENCE_LINE,
    DEFAULT_SCORE_WEIGHTS,
    PLUGIN_NAME,
)
from .types import (
    CadmaCompoundRow,
    CadmaMetricChart,
    CadmaMetricSummary,
    CadmaPyResult,
    CadmaRankingRow,
    CadmaScoreConfig,
    CadmaScoreWeights,
    MetricName,
)

PLUGIN_LOG_SOURCE = "cadma_py.plugin"


def _pause_if_requested(
    control_callback: PluginControlCallback | None,
    *,
    stage_label: str,
    checkpoint: JSONMap | None = None,
) -> None:
    """Permite pausa cooperativa del ranking sin perder trazabilidad del job."""
    if control_callback is None:
        return
    if control_callback() == "pause":
        raise JobPauseRequested(
            message=f"CADMA Py paused while {stage_label}.",
            checkpoint=checkpoint or {"stage": stage_label},
        )


def _emit_log(
    log_callback: PluginLogCallback | None,
    level: str,
    message: str,
    payload: JSONMap | None = None,
) -> None:
    if log_callback is None:
        return
    log_callback(level, PLUGIN_LOG_SOURCE, message, payload or {})


def _coerce_rows(raw_rows: object) -> list[CadmaCompoundRow]:
    if not isinstance(raw_rows, list):
        raise ValueError("CADMA Py requiere una lista serializable de compuestos.")

    normalized_rows: list[CadmaCompoundRow] = []
    for raw_row in raw_rows:
        if not isinstance(raw_row, dict):
            raise ValueError("Cada compuesto debe serializarse como un objeto JSON.")

        row: CadmaCompoundRow = {
            "name": str(raw_row["name"]),
            "smiles": str(raw_row["smiles"]),
            "MW": float(raw_row["MW"]),
            "logP": float(raw_row["logP"]),
            "MR": float(raw_row["MR"]),
            "AtX": float(raw_row["AtX"]),
            "HBLA": float(raw_row["HBLA"]),
            "HBLD": float(raw_row["HBLD"]),
            "RB": float(raw_row["RB"]),
            "PSA": float(raw_row["PSA"]),
            "DT": float(raw_row["DT"]),
            "M": float(raw_row["M"]),
            "LD50": float(raw_row["LD50"]),
            "SA": float(raw_row["SA"]),
            "paper_reference": str(raw_row.get("paper_reference", "")),
            "paper_url": str(raw_row.get("paper_url", "")),
            "evidence_note": str(raw_row.get("evidence_note", "")),
        }
        normalized_rows.append(row)
    return normalized_rows


def _safe_stdev(values: list[float]) -> float:
    if len(values) < 2:
        return 1.0
    stdev_value = float(statistics.pstdev(values))
    return stdev_value if stdev_value > 1e-9 else 1.0


def _build_reference_stats(
    reference_rows: list[CadmaCompoundRow],
) -> list[CadmaMetricSummary]:
    stats: list[CadmaMetricSummary] = []
    for metric_name in ALL_METRIC_NAMES:
        values = [float(row[metric_name]) for row in reference_rows]
        stats.append(
            {
                "metric": cast(MetricName, metric_name),
                "mean": float(statistics.fmean(values)),
                "stdev": _safe_stdev(values),
                "min_value": float(min(values)),
                "max_value": float(max(values)),
            }
        )
    return stats


def _metric_summary_map(
    summaries: list[CadmaMetricSummary],
) -> dict[str, CadmaMetricSummary]:
    return {summary["metric"]: summary for summary in summaries}


def _safe_positive(value: object, fallback: float) -> float:
    try:
        numeric_value = float(value)
    except (TypeError, ValueError):
        return fallback
    return numeric_value if numeric_value > 0 else fallback


def _resolve_weights(raw_weights: object) -> CadmaScoreWeights:
    fallback = dict(DEFAULT_SCORE_WEIGHTS)
    if not isinstance(raw_weights, dict):
        return cast(CadmaScoreWeights, fallback)

    candidate_weights = {
        "adme": max(float(raw_weights.get("adme", fallback["adme"])), 0.0),
        "toxicity": max(float(raw_weights.get("toxicity", fallback["toxicity"])), 0.0),
        "sa": max(float(raw_weights.get("sa", fallback["sa"])), 0.0),
    }
    total = sum(candidate_weights.values())
    if total <= 1e-9:
        return cast(CadmaScoreWeights, fallback)

    normalized = {
        key: round(value / total, 4) for key, value in candidate_weights.items()
    }
    return cast(CadmaScoreWeights, normalized)


def _decode_score_config(parameters: JSONMap) -> dict[str, object]:
    raw_config: object = parameters.get("score_config")
    if isinstance(raw_config, dict):
        return cast(dict[str, object], raw_config)

    raw_json = parameters.get("score_config_json", "")
    if not isinstance(raw_json, str) or not raw_json.strip():
        return {}

    try:
        decoded = json.loads(raw_json)
    except json.JSONDecodeError:
        return {}

    return cast(dict[str, object], decoded) if isinstance(decoded, dict) else {}


def _resolve_interval_map(raw_intervals: object) -> dict[str, dict[str, float]]:
    interval_map: dict[str, dict[str, float]] = {}
    for metric_name in ADME_METRIC_NAMES:
        default_low, default_high = DEFAULT_ADME_INTERVALS[metric_name]
        raw_metric_range = (
            raw_intervals.get(metric_name) if isinstance(raw_intervals, dict) else None
        )
        if isinstance(raw_metric_range, dict):
            min_value = float(raw_metric_range.get("min", default_low))
            max_value = float(raw_metric_range.get("max", default_high))
        else:
            min_value = default_low
            max_value = default_high
        if min_value > max_value:
            min_value, max_value = max_value, min_value
        interval_map[metric_name] = {
            "min": round(min_value, 4),
            "max": round(max_value, 4),
        }
    return interval_map


def _resolve_reference_values(
    raw_reference_values: object,
    summary_map: dict[str, CadmaMetricSummary],
) -> dict[str, float]:
    return {
        "LD50": round(
            _safe_positive(
                raw_reference_values.get("LD50")
                if isinstance(raw_reference_values, dict)
                else None,
                float(summary_map["LD50"]["mean"]),
            ),
            4,
        ),
        "M": round(
            _safe_positive(
                raw_reference_values.get("M")
                if isinstance(raw_reference_values, dict)
                else None,
                max(float(summary_map["M"]["mean"]), 0.001),
            ),
            4,
        ),
        "DT": round(
            _safe_positive(
                raw_reference_values.get("DT")
                if isinstance(raw_reference_values, dict)
                else None,
                max(float(summary_map["DT"]["mean"]), 0.001),
            ),
            4,
        ),
        "SA": round(
            _safe_positive(
                raw_reference_values.get("SA")
                if isinstance(raw_reference_values, dict)
                else None,
                max(float(summary_map["SA"]["mean"]), 1.0),
            ),
            4,
        ),
    }


def _resolve_score_config(
    parameters: JSONMap,
    summary_map: dict[str, CadmaMetricSummary],
) -> CadmaScoreConfig:
    raw_config_dict = _decode_score_config(parameters)
    interval_map = _resolve_interval_map(raw_config_dict.get("adme_intervals"))
    reference_values = _resolve_reference_values(
        raw_config_dict.get("reference_values"),
        summary_map,
    )
    adme_reference_hits = max(
        1,
        sum(
            1
            for metric_name in ADME_METRIC_NAMES
            if interval_map[metric_name]["min"]
            <= float(summary_map[metric_name]["mean"])
            <= interval_map[metric_name]["max"]
        ),
    )

    return {
        "adme_intervals": interval_map,
        "weights": _resolve_weights(raw_config_dict.get("weights")),
        "reference_values": reference_values,
        "adme_reference_hits": adme_reference_hits,
    }


def _safe_log_ratio(numerator: float, denominator: float) -> float:
    safe_numerator = max(numerator, 0.0)
    safe_denominator = max(denominator, 0.0)
    return math.log10((1.0 + safe_numerator) / (1.0 + safe_denominator))


def _score_candidate(
    candidate_row: CadmaCompoundRow,
    score_config: CadmaScoreConfig,
) -> CadmaRankingRow:
    metrics_in_band: list[str] = []
    for metric_name in ADME_METRIC_NAMES:
        interval = score_config["adme_intervals"][metric_name]
        metric_value = float(candidate_row[metric_name])
        if interval["min"] <= metric_value <= interval["max"]:
            metrics_in_band.append(metric_name)

    reference_values = score_config["reference_values"]
    weights = score_config["weights"]
    adme_alignment = round(
        len(metrics_in_band) / max(score_config["adme_reference_hits"], 1),
        4,
    )
    toxicity_alignment = round(
        (
            1.0
            + _safe_log_ratio(float(candidate_row["LD50"]), reference_values["LD50"])
            + 1.0
            - _safe_log_ratio(float(candidate_row["M"]), reference_values["M"])
            + 1.0
            - _safe_log_ratio(float(candidate_row["DT"]), reference_values["DT"])
        )
        / 3.0,
        4,
    )
    sa_alignment = round(
        float(candidate_row["SA"]) / max(reference_values["SA"], 1e-9),
        4,
    )
    selection_score = round(
        (adme_alignment * weights["adme"])
        + (toxicity_alignment * weights["toxicity"])
        + (sa_alignment * weights["sa"]),
        4,
    )

    return {
        "name": candidate_row["name"],
        "smiles": candidate_row["smiles"],
        "selection_score": selection_score,
        "adme_alignment": adme_alignment,
        "toxicity_alignment": toxicity_alignment,
        "sa_alignment": sa_alignment,
        "adme_hits_in_band": len(metrics_in_band),
        "MW": float(candidate_row["MW"]),
        "logP": float(candidate_row["logP"]),
        "MR": float(candidate_row["MR"]),
        "AtX": float(candidate_row["AtX"]),
        "HBLA": float(candidate_row["HBLA"]),
        "HBLD": float(candidate_row["HBLD"]),
        "RB": float(candidate_row["RB"]),
        "PSA": float(candidate_row["PSA"]),
        "DT": float(candidate_row["DT"]),
        "M": float(candidate_row["M"]),
        "LD50": float(candidate_row["LD50"]),
        "SA": float(candidate_row["SA"]),
        "metrics_in_band": metrics_in_band,
        "best_fit_summary": (
            f"{len(metrics_in_band)}/{score_config['adme_reference_hits']} ADME properties inside the CADMA interval"
        ),
    }


def _build_metric_charts(
    ranking_rows: list[CadmaRankingRow],
    candidate_rows: list[CadmaCompoundRow],
    summary_map: dict[str, CadmaMetricSummary],
    score_config: CadmaScoreConfig,
) -> list[CadmaMetricChart]:
    ordered_names = [row["name"] for row in ranking_rows]
    candidate_map = {row["name"]: row for row in candidate_rows}
    chart_rows: list[CadmaMetricChart] = []

    for metric_name in ALL_METRIC_NAMES:
        summary = summary_map[metric_name]
        values = [float(candidate_map[name][metric_name]) for name in ordered_names]
        better_direction: Literal["balanced", "higher", "lower"] = "balanced"
        if metric_name in {"DT", "M"}:
            better_direction = "lower"
        elif metric_name in {"LD50", "SA"}:
            better_direction = "higher"

        if metric_name in ADME_METRIC_NAMES:
            interval = score_config["adme_intervals"][metric_name]
            reference_low = float(interval["min"])
            reference_high = float(interval["max"])
            reference_mean = (reference_low + reference_high) / 2.0
        else:
            reference_mean = float(summary["mean"])
            reference_low = float(summary["mean"] - summary["stdev"])
            reference_high = float(summary["mean"] + summary["stdev"])

        chart_rows.append(
            {
                "metric": cast(MetricName, metric_name),
                "label": metric_name,
                "categories": ordered_names,
                "values": values,
                "reference_mean": reference_mean,
                "reference_low": reference_low,
                "reference_high": reference_high,
                "better_direction": better_direction,
            }
        )
    return chart_rows


@PluginRegistry.register(PLUGIN_NAME)
def cadma_py_plugin(
    parameters: JSONMap,
    progress_callback: PluginProgressCallback,
    log_callback: PluginLogCallback | None = None,
    control_callback: PluginControlCallback | None = None,
) -> JSONMap:
    """Ejecuta el ranking transparente de CADMA Py."""
    reference_rows = _coerce_rows(parameters.get("reference_rows"))
    candidate_rows = _coerce_rows(parameters.get("candidate_rows"))

    if len(reference_rows) == 0:
        raise ValueError("La familia de referencia está vacía; no se puede comparar.")
    if len(candidate_rows) == 0:
        raise ValueError("No se recibieron compuestos candidatos para comparar.")

    progress_callback(10, "Validating reference and candidate datasets...")
    _pause_if_requested(
        control_callback,
        stage_label="validating datasets",
        checkpoint={"progress": 10},
    )
    _emit_log(
        log_callback,
        "info",
        "Datasets de CADMA Py recibidos correctamente.",
        {
            "reference_count": len(reference_rows),
            "candidate_count": len(candidate_rows),
        },
    )

    reference_stats = _build_reference_stats(reference_rows)
    summary_map = _metric_summary_map(reference_stats)
    score_config = _resolve_score_config(parameters, summary_map)
    progress_callback(40, "Computing legacy CADMA intervals and candidate scores...")
    _pause_if_requested(
        control_callback,
        stage_label="computing reference bands",
        checkpoint={"progress": 40},
    )

    ranking = [
        _score_candidate(candidate_row, score_config)
        for candidate_row in candidate_rows
    ]
    ranking.sort(key=lambda row: float(row["selection_score"]), reverse=True)
    progress_callback(70, "Preparing ergonomic chart payloads...")
    _pause_if_requested(
        control_callback,
        stage_label="building ranking payloads",
        checkpoint={"progress": 70},
    )

    metric_charts = _build_metric_charts(
        ranking, candidate_rows, summary_map, score_config
    )
    score_chart = {
        "categories": [row["name"] for row in ranking],
        "values": [float(row["selection_score"]) for row in ranking],
        "reference_line": DEFAULT_SCORE_REFERENCE_LINE,
    }

    result_payload: CadmaPyResult = {
        "library_name": str(parameters.get("library_name", "Reference family")),
        "disease_name": str(parameters.get("disease_name", "Target disease")),
        "reference_count": len(reference_rows),
        "candidate_count": len(candidate_rows),
        "reference_stats": reference_stats,
        "ranking": ranking,
        "score_chart": score_chart,
        "metric_charts": metric_charts,
        "score_config": score_config,
        "methodology_note": (
            "The final score follows the legacy CADMA-Chem style formula with editable "
            "ADME intervals plus weighted contributions from toxicity and synthetic accessibility."
        ),
    }
    progress_callback(100, "CADMA Py comparison completed.")
    _emit_log(log_callback, "info", "CADMA Py finalizó el ranking de candidatos.")
    return cast(JSONMap, result_payload)
