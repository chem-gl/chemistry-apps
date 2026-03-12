"""reporting.py: Utilidades compartidas para reportes síncronos descargables por job.

Objetivo del archivo:
- Centralizar construcción de reportes de texto/CSV para evitar duplicación en
  routers de apps científicas.

Cómo se usa:
- Cada app define solo su constructor de CSV de dominio.
- Los routers reutilizan estas funciones para validaciones por estado,
  formateo de logs y respuestas HTTP descargables.
"""

from __future__ import annotations

from json import dumps
from typing import cast

from django.http import HttpResponse

from .models import ScientificJob, ScientificJobLogEvent
from .types import JSONMap, JSONValue


def build_download_filename(
    plugin_name: str,
    job_id: str,
    report_suffix: str,
    extension: str,
) -> str:
    """Construye un nombre de archivo estable para descargas por job."""
    normalized_plugin_name: str = plugin_name.replace("-", "_")
    return f"{normalized_plugin_name}_{job_id}_{report_suffix}.{extension}"


def build_text_download_response(
    content: str,
    filename: str,
    content_type: str,
) -> HttpResponse:
    """Genera respuesta HTTP de descarga de texto con charset UTF-8."""
    response = HttpResponse(content, content_type=content_type)
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


def validate_job_for_csv_report(job: ScientificJob) -> str | None:
    """Valida reglas mínimas para habilitar exportación CSV de un job."""
    if job.status != "completed":
        return (
            "El reporte CSV solo está disponible cuando el job está en estado "
            "completed."
        )

    if job.results is None:
        return "El job no tiene resultados persistidos para exportar en CSV."

    return None


def build_job_log_report(
    job: ScientificJob,
    csv_content: str | None = None,
) -> str:
    """Construye un reporte de auditoría con contexto, resultados y eventos."""
    parameters_payload: JSONMap = cast(JSONMap, job.parameters)
    parameters_text: str = _to_pretty_json(parameters_payload)

    results_text: str = "Sin resultados persistidos."
    if job.results is not None:
        result_payload: JSONValue = cast(JSONValue, job.results)
        results_text = _to_pretty_json(result_payload)

    lines: list[str] = [
        "=== JOB REPORT ===",
        f"job_id: {job.id}",
        f"plugin_name: {job.plugin_name}",
        f"status: {job.status}",
        f"algorithm_version: {job.algorithm_version}",
        f"created_at: {job.created_at.isoformat()}",
        f"updated_at: {job.updated_at.isoformat()}",
        "",
        "=== INPUT PARAMETERS ===",
        parameters_text,
        "",
        "=== RESULTS SNAPSHOT ===",
        results_text,
    ]

    if job.error_trace is not None and job.error_trace.strip() != "":
        lines.extend(
            [
                "",
                "=== ERROR TRACE ===",
                job.error_trace,
            ]
        )

    lines.extend(["", "=== LOG EVENTS ==="])
    job_log_events = ScientificJobLogEvent.objects.filter(job=job).order_by("event_index")
    if not job_log_events.exists():
        lines.append("No hay eventos de log persistidos para este job.")
    else:
        for log_event in job_log_events:
            payload_text: str = dumps(
                cast(JSONMap, log_event.payload),
                ensure_ascii=False,
                sort_keys=True,
            )
            lines.append(
                "["
                f"{log_event.event_index:04d}] "
                f"{log_event.created_at.isoformat()} "
                f"{log_event.level.upper()} "
                f"{log_event.source}: "
                f"{log_event.message} | payload={payload_text}"
            )

    if csv_content is not None and csv_content.strip() != "":
        lines.extend(["", "=== CSV REPORT ===", csv_content])

    return "\n".join(lines)


def build_job_error_report(job: ScientificJob) -> str | None:
    """Devuelve reporte de error cuando el job falló con traza persistida."""
    if job.status != "failed":
        return None

    if job.error_trace is None or job.error_trace.strip() == "":
        return None

    parameters_payload: JSONMap = cast(JSONMap, job.parameters)
    parameters_text: str = _to_pretty_json(parameters_payload)

    lines: list[str] = [
        "=== JOB ERROR REPORT ===",
        f"job_id: {job.id}",
        f"plugin_name: {job.plugin_name}",
        f"status: {job.status}",
        f"updated_at: {job.updated_at.isoformat()}",
        "",
        "=== INPUT PARAMETERS ===",
        parameters_text,
        "",
        "=== ERROR TRACE ===",
        job.error_trace,
    ]

    return "\n".join(lines)


def _to_pretty_json(json_value: JSONValue) -> str:
    """Serializa JSON tipado de forma legible para reportes de texto."""
    return dumps(
        json_value,
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    )
