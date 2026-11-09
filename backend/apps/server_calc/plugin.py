"""plugin.py: Lógica de dominio para el cálculo remoto en el servidor qta vía SSH.

Objetivo del archivo:
- Ejecutar a op b en el servidor remoto qta, desacoplado de HTTP/ORM.
- Sin cálculo de respaldo: si qta no responde, el job falla con traza clara.
- Sin `QTA_SSH_HOST` configurado el job falla antes de invocar `ssh`: el destino
  remoto nunca se infiere de una IP hardcodeada en el código.

Cómo se usa:
- `PluginRegistry` ejecuta `server_calc_plugin` desde `JobService.run_job`.
- El plugin emite progreso y logs para observabilidad técnica.
"""

from __future__ import annotations

import json
import logging
import math
import os
import shlex
import subprocess

from django.conf import settings

from apps.core.processing import PluginRegistry
from apps.core.types import JSONMap, PluginLogCallback, PluginProgressCallback

from .definitions import PLUGIN_NAME
from .types import (
    ServerCalcCalculationInput,
    ServerCalcCalculationMetadata,
    ServerCalcCalculationResult,
)

logger = logging.getLogger(__name__)

SERVER_CALC_LOG_SOURCE = "server-calc.plugin"
REMOTE_CALC_SCRIPT = "/home/chemistry-apps/server-apps/calc.py"
LOCAL_VERIFICATION_TOLERANCE = 1e-9
SUPPORTED_OPERATORS: tuple[str, ...] = ("+", "-", "*", "/")

# Fallbacks de configuración usados SOLO si el atributo no existe en Django
# settings; `QTA_SSH_HOST` se excluye a propósito: el destino remoto nunca se
# deduce de un valor fijo en el código (settings.py es la fuente de verdad y su
# default está vacío).
DEFAULT_QTA_SSH_USER = "chemistry-apps"
DEFAULT_QTA_SSH_KEY_PATH = os.path.expanduser("~/.ssh/chemistry-apps_qta_ed25519")
DEFAULT_QTA_SSH_KNOWN_HOSTS_PATH = os.path.expanduser(
    "~/.ssh/chemistry-apps_qta_known_hosts"
)
DEFAULT_QTA_SSH_TIMEOUT = 25

QTA_SSH_NOT_CONFIGURED_MESSAGE = (
    "Server Calc no está configurado: define QTA_SSH_HOST con el host o la "
    "dirección del servidor qta (variable de entorno leída por Django settings)."
)


def _read_ssh_settings() -> tuple[str, str, str, str, int]:
    """Lee y valida la configuración SSH desde Django settings.

    Retorna (host, user, key_path, known_hosts_path, timeout_s).

    El host no tiene default: si `QTA_SSH_HOST` llega vacío (entorno sin
    configurar), falla aquí con un mensaje claro antes de invocar `ssh`, en lugar
    de conectar contra una IP arbitraria hardcodeada.
    """
    host_value: str = str(getattr(settings, "QTA_SSH_HOST", "") or "").strip()
    if host_value == "":
        raise ValueError(QTA_SSH_NOT_CONFIGURED_MESSAGE)

    user_value: str = str(getattr(settings, "QTA_SSH_USER", DEFAULT_QTA_SSH_USER))
    key_value: str = str(
        getattr(settings, "QTA_SSH_KEY_PATH", DEFAULT_QTA_SSH_KEY_PATH)
    )
    known_hosts_value: str = os.path.expanduser(
        str(
            getattr(
                settings,
                "QTA_SSH_KNOWN_HOSTS_PATH",
                DEFAULT_QTA_SSH_KNOWN_HOSTS_PATH,
            )
        )
    )
    raw_timeout: object = getattr(settings, "QTA_SSH_TIMEOUT", DEFAULT_QTA_SSH_TIMEOUT)
    try:
        timeout_value: int = int(str(raw_timeout))
    except (TypeError, ValueError):
        timeout_value = DEFAULT_QTA_SSH_TIMEOUT
    return host_value, user_value, key_value, known_hosts_value, timeout_value


def _read_settings_or_fail(
    emit_log: PluginLogCallback,
) -> tuple[str, str, str, str, int]:
    """Lee la configuración SSH y deja trazabilidad en los logs si falta el host."""
    try:
        return _read_ssh_settings()
    except ValueError as config_error:
        emit_log(
            "error",
            SERVER_CALC_LOG_SOURCE,
            "Configuración SSH de Server Calc incompleta.",
            {"reason": str(config_error)},
        )
        raise


def _apply_operator(a: float, op: str, b: float) -> float:
    """Aplica el operador localmente para verificar el resultado remoto."""
    if op == "+":
        return a + b
    if op == "-":
        return a - b
    if op == "*":
        return a * b
    return a / b


def _build_server_calc_input(parameters: JSONMap) -> ServerCalcCalculationInput:
    """Valida y normaliza parámetros de entrada para el cálculo Server Calc."""
    try:
        a_value: float = float(parameters.get("a", math.nan))
        b_value: float = float(parameters.get("b", math.nan))
    except (TypeError, ValueError) as exc:
        raise ValueError("Los parámetros a y b deben ser numéricos.") from exc

    if not math.isfinite(a_value) or not math.isfinite(b_value):
        raise ValueError("Los parámetros a y b deben ser numéricos finitos.")

    op_value: str = str(parameters.get("op", "")).strip()
    if op_value not in SUPPORTED_OPERATORS:
        raise ValueError("op debe ser uno de + - * /.")

    if op_value == "/" and not b_value:
        raise ValueError("División por cero no permitida.")

    return {"a": a_value, "op": op_value, "b": b_value}


def _run_remote_calc(
    a: float,
    op: str,
    b: float,
    job_label: str,
    host: str,
    user: str,
    key_path: str,
    timeout_s: int,
    known_hosts_path: str = DEFAULT_QTA_SSH_KNOWN_HOSTS_PATH,
) -> dict:
    """Ejecuta el cálculo remoto vía SSH y retorna el JSON parseado.

    Lanza excepción si el comando falla, expira o la salida no es JSON válido.

    La verificación de la clave del host usa un known_hosts dedicado: la
    primera conexión registra la clave (accept-new) y las siguientes exigen
    que coincida; una clave cambiada aborta la conexión (anti-MITM).

    Los argumentos del script se citan con shlex.quote porque ssh los
    concatena y el shell remoto los reinterpreta (sin cita, `*` se expandiría
    como glob en el home remoto).
    """
    ssh_command: list[str] = [
        "ssh",
        "-o",
        "IdentitiesOnly=yes",
        "-i",
        key_path,
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        f"UserKnownHostsFile={known_hosts_path}",
        "-o",
        f"ConnectTimeout={timeout_s}",
        f"{user}@{host}",
        "python3",
        REMOTE_CALC_SCRIPT,
        shlex.quote(repr(a)),
        shlex.quote(op),
        shlex.quote(repr(b)),
        shlex.quote(job_label),
    ]
    completed = subprocess.run(
        ssh_command,
        capture_output=True,
        text=True,
        timeout=timeout_s,
    )
    if completed.returncode != 0:
        raise RuntimeError(
            f"SSH retornó código {completed.returncode}: "
            f"stdout={(completed.stdout or '').strip()!r} "
            f"stderr={(completed.stderr or '').strip()}"
        )
    raw_stdout: str = (completed.stdout or "").strip()
    if raw_stdout == "":
        raise ValueError("La salida remota está vacía.")
    parsed: object = json.loads(raw_stdout)
    if not isinstance(parsed, dict):
        raise ValueError("La salida remota no es un objeto JSON.")
    return parsed


def _build_metadata(remote_host: str) -> ServerCalcCalculationMetadata:
    """Construye metadatos de salida con el host remoto de ejecución."""
    return {"executed_on": "qta", "remote_host": remote_host}


@PluginRegistry.register(PLUGIN_NAME)
def server_calc_plugin(
    parameters: JSONMap,
    progress_callback: PluginProgressCallback,
    log_callback: PluginLogCallback | None = None,
) -> JSONMap:
    """Ejecuta el cálculo en el servidor qta vía SSH; falla si qta no responde."""
    emit_log: PluginLogCallback = (
        log_callback
        if log_callback is not None
        else lambda _level, _source, _message, _payload: None
    )

    progress_callback(5, "running", "Validando parámetros de entrada Server Calc.")
    normalized_input: ServerCalcCalculationInput = _build_server_calc_input(parameters)
    a_value: float = normalized_input["a"]
    op_value: str = normalized_input["op"]
    b_value: float = normalized_input["b"]

    emit_log(
        "info",
        SERVER_CALC_LOG_SOURCE,
        "Parámetros de Server Calc validados correctamente.",
        {"a": a_value, "op": op_value, "b": b_value},
    )

    host, user, key_path, known_hosts_path, timeout_s = _read_settings_or_fail(emit_log)
    raw_job_id: object = parameters.get("job_id", "local")
    job_label: str = str(raw_job_id)[:8] if str(raw_job_id).strip() != "" else "local"

    progress_callback(10, "running", "Conectando con qta...")

    try:
        remote_payload: dict = _run_remote_calc(
            a_value,
            op_value,
            b_value,
            job_label,
            host,
            user,
            key_path,
            timeout_s,
            known_hosts_path,
        )
    except Exception as exc:
        emit_log(
            "error",
            SERVER_CALC_LOG_SOURCE,
            "No se pudo ejecutar el cálculo en qta.",
            {"reason": str(exc), "host": host, "user": user},
        )
        raise ValueError(
            f"No se pudo ejecutar el cálculo remoto en qta ({host}): {exc}"
        ) from exc

    emit_log(
        "info",
        SERVER_CALC_LOG_SOURCE,
        "Conexión SSH establecida con qta.",
        {"host": host, "user": user, "job_label": job_label},
    )
    emit_log(
        "info",
        SERVER_CALC_LOG_SOURCE,
        "Salida remota recibida.",
        {"remote_output": remote_payload},
    )

    if remote_payload.get("ok") is not True:
        raise ValueError(f"El servidor remoto reportó ok=false: {remote_payload!r}.")
    remote_result_raw: object = remote_payload.get("result")
    try:
        remote_result: float = float(remote_result_raw)  # type: ignore[arg-type]
    except (TypeError, ValueError) as exc:
        raise ValueError(
            f"El resultado remoto no es numérico: {remote_result_raw!r}."
        ) from exc
    if not math.isfinite(remote_result):
        raise ValueError("El resultado remoto no es finito.")

    expected_value: float = _apply_operator(a_value, op_value, b_value)
    if abs(expected_value - remote_result) >= LOCAL_VERIFICATION_TOLERANCE:
        raise ValueError(
            "La verificación local falló: "
            f"esperado {expected_value!r} vs remoto {remote_result!r}."
        )

    emit_log(
        "info",
        SERVER_CALC_LOG_SOURCE,
        "Verificación local superada.",
        {"expected": expected_value, "remote_result": remote_result},
    )

    remote_file_name: object = remote_payload.get("file_name")
    remote_file_path: object = remote_payload.get("file_path")
    if not isinstance(remote_file_name, str) or remote_file_name == "":
        raise ValueError("El remoto no reportó file_name.")
    if not isinstance(remote_file_path, str) or remote_file_path == "":
        raise ValueError("El remoto no reportó file_path.")

    result_payload: ServerCalcCalculationResult = {
        "a": a_value,
        "op": op_value,
        "b": b_value,
        "result": remote_result,
        "file_name": remote_file_name,
        "file_path": remote_file_path,
        "metadata": _build_metadata(host),
    }
    emit_log(
        "info",
        SERVER_CALC_LOG_SOURCE,
        "Cálculo Server Calc completado en qta.",
        {
            "a": a_value,
            "op": op_value,
            "b": b_value,
            "result": remote_result,
            "file_name": remote_file_name,
            "file_path": remote_file_path,
        },
    )

    logger.info(
        "Job Server Calc completado con a=%s, op=%s, b=%s, result=%s",
        result_payload["a"],
        result_payload["op"],
        result_payload["b"],
        result_payload["result"],
    )
    progress_callback(100, "completed", "Cálculo Server Calc finalizado.")

    return result_payload
