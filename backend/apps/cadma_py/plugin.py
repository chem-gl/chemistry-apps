"""plugin.py: Motor puro de scoring y comparación para CADMA Py.

Implementa una variante transparente y reproducible del flujo legado CADMA,
centrada en comparar candidatos frente a un set de referencia mediante métricas
fisicoquímicas, toxicológicas y de accesibilidad sintética.
"""

from __future__ import annotations

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
    DEFAULT_SCORE_REFERENCE_LINE,
    PLUGIN_NAME,
)
from .types import (
    CadmaCompoundRow,
    CadmaMetricChart,
    CadmaMetricSummary,
    CadmaPyResult,
    CadmaRankingRow,
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


def _balanced_alignment(value: float, mean: float, stdev: float) -> float:
    distance = abs(value - mean)
    normalized = min(distance / (3.0 * max(stdev, 1e-9)), 1.0)
    return round((1.0 - normalized) * 100.0, 4)


def _lower_is_better_alignment(value: float, mean: float, stdev: float) -> float:
    if value <= mean:
        return 100.0
    normalized = min((value - mean) / (3.0 * max(stdev, 1e-9)), 1.0)
    return round((1.0 - normalized) * 100.0, 4)


def _higher_is_better_alignment(value: float, mean: float, stdev: float) -> float:
    if value >= mean:
        return 100.0
    normalized = min((mean - value) / (3.0 * max(stdev, 1e-9)), 1.0)
    return round((1.0 - normalized) * 100.0, 4)


def _score_candidate(
    candidate_row: CadmaCompoundRow,
    summary_map: dict[str, CadmaMetricSummary],
) -> CadmaRankingRow:
    adme_scores: list[float] = []
    metrics_in_band: list[str] = []

    for metric_name in ADME_METRIC_NAMES:
        summary = summary_map[metric_name]
        metric_value = float(candidate_row[metric_name])
        adme_scores.append(
            _balanced_alignment(metric_value, summary["mean"], summary["stdev"])
        )
        if (
            summary["mean"] - summary["stdev"]
            <= metric_value
            <= summary["mean"] + summary["stdev"]
        ):
            metrics_in_band.append(metric_name)

    dt_summary = summary_map["DT"]
    m_summary = summary_map["M"]
    ld50_summary = summary_map["LD50"]
    sa_summary = summary_map["SA"]

    toxicity_alignment = round(
        (
            _lower_is_better_alignment(
                candidate_row["DT"], dt_summary["mean"], dt_summary["stdev"]
            )
            + _lower_is_better_alignment(
                candidate_row["M"], m_summary["mean"], m_summary["stdev"]
            )
            + _higher_is_better_alignment(
                candidate_row["LD50"], ld50_summary["mean"], ld50_summary["stdev"]
            )
        )
        / 3.0,
        4,
    )
    sa_alignment = _higher_is_better_alignment(
        candidate_row["SA"],
        sa_summary["mean"],
        sa_summary["stdev"],
    )
    adme_alignment = round(sum(adme_scores) / max(len(adme_scores), 1), 4)
    selection_score = round(
        (adme_alignment * 0.50) + (toxicity_alignment * 0.35) + (sa_alignment * 0.15),
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
        "metrics_in_band": metrics_in_band,
        "best_fit_summary": f"{len(metrics_in_band)}/8 ADME metrics inside the reference band",
    }


def _build_metric_charts(
    ranking_rows: list[CadmaRankingRow],
    candidate_rows: list[CadmaCompoundRow],
    summary_map: dict[str, CadmaMetricSummary],
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

        chart_rows.append(
            {
                "metric": cast(MetricName, metric_name),
                "label": metric_name,
                "categories": ordered_names,
                "values": values,
                "reference_mean": float(summary["mean"]),
                "reference_low": float(summary["mean"] - summary["stdev"]),
                "reference_high": float(summary["mean"] + summary["stdev"]),
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
    progress_callback(40, "Computing reference bands and candidate alignment...")
    _pause_if_requested(
        control_callback,
        stage_label="computing reference bands",
        checkpoint={"progress": 40},
    )

    ranking = [
        _score_candidate(candidate_row, summary_map) for candidate_row in candidate_rows
    ]
    ranking.sort(key=lambda row: float(row["selection_score"]), reverse=True)
    progress_callback(70, "Preparing ergonomic chart payloads...")
    _pause_if_requested(
        control_callback,
        stage_label="building ranking payloads",
        checkpoint={"progress": 70},
    )

    metric_charts = _build_metric_charts(ranking, candidate_rows, summary_map)
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
        "methodology_note": (
            "The final score is a CADMA-inspired prioritization heuristic based on "
            "reference-band alignment for ADME, lower-is-better toxicity risk and "
            "higher-is-better synthetic accessibility."
        ),
    }
    progress_callback(100, "CADMA Py comparison completed.")
    _emit_log(log_callback, "info", "CADMA Py finalizó el ranking de candidatos.")
    return cast(JSONMap, result_payload)
