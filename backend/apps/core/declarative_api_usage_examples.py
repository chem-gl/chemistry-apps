"""declarative_api_usage_examples.py: Ejemplos tipados de consumo externo.

Objetivo del archivo:
- Mostrar patrones de consumo de `DeclarativeJobAPI` desde código no HTTP
    (scripts, integraciones internas, servicios externos).

Cómo se usa:
- Importar las funciones de ejemplo como plantilla para construir adaptadores
    reales con manejo explícito de `Result` y errores de dominio.
"""

from __future__ import annotations

from apps.core.declarative_api import DeclarativeJobAPI
from apps.core.types import JSONMap


def submit_job_without_wait(
    plugin_name: str,
    parameters_payload: JSONMap,
    version_value: str = "1.0",
) -> dict[str, str]:
    """Encola un job y devuelve identificador/estado sin esperar resultado final."""
    api = DeclarativeJobAPI()

    submit_result = api.submit_job(
        plugin=plugin_name,
        version=version_value,
        parameters=parameters_payload,
    ).run()

    if submit_result.is_failure():
        error_message: str = submit_result.fold(
            on_failure=lambda error_value: str(error_value),
            on_success=lambda _: "Error desconocido al encolar el job.",
        )
        return {"error": error_message}

    job_handle = submit_result.get_or_else(None)
    if job_handle is None:
        return {"error": "No fue posible obtener el handle del job encolado."}

    return {
        "job_id": job_handle.job_id,
        "status": job_handle.status,
    }


def submit_job_and_wait(
    plugin_name: str,
    parameters_payload: JSONMap,
    version_value: str = "1.0",
    timeout_seconds: int = 60,
) -> JSONMap:
    """Encola un job y espera su estado terminal con timeout configurable."""
    api = DeclarativeJobAPI()

    wait_result = api.submit_and_wait(
        plugin=plugin_name,
        version=version_value,
        parameters=parameters_payload,
        timeout_seconds=timeout_seconds,
    ).run()

    if wait_result.is_failure():
        error_message: str = wait_result.fold(
            on_failure=lambda error_value: str(error_value),
            on_success=lambda _: "Error desconocido durante la espera del job.",
        )
        return {"error": error_message}

    return wait_result.get_or_else({})


def get_existing_job_status(job_id: str) -> dict[str, str]:
    """Consulta estado de un job existente mediante su handle declarativo."""
    api = DeclarativeJobAPI()

    handle_result = api.get_job_handle(job_id=job_id)
    if handle_result.is_failure():
        error_message: str = handle_result.fold(
            on_failure=lambda error_value: str(error_value),
            on_success=lambda _: "Error desconocido al consultar el job.",
        )
        return {"error": error_message}

    job_handle = handle_result.get_or_else(None)
    if job_handle is None:
        return {"error": "No fue posible obtener el handle del job."}

    progress_snapshot = job_handle.get_progress()
    return {
        "job_id": progress_snapshot["job_id"],
        "status": progress_snapshot["status"],
        "progress_stage": progress_snapshot["progress_stage"],
        "progress_message": progress_snapshot["progress_message"],
    }
