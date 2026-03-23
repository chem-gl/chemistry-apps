#!/usr/bin/env python3
"""startup_production.py: bootstrap de arranque para backend en produccion.

Objetivo:
- Verificar que las dependencias Python esten consistentes.
- Validar imports criticos de runtime cientifico.
- Ejecutar ensure_runtime_tools y migrate con reintentos.
- Levantar daphne solo cuando el entorno este listo.

Uso:
- Invocar desde Dockerfile prod: python config/startup_production.py
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
from typing import Sequence


def _read_int_env(variable_name: str, default_value: int) -> int:
    """Lee un entero desde entorno con fallback seguro."""
    raw_value: str | None = os.getenv(variable_name)
    if raw_value is None or raw_value.strip() == "":
        return default_value
    try:
        parsed_value: int = int(raw_value)
    except ValueError:
        return default_value
    return parsed_value


def _run_with_retries(
    command: Sequence[str],
    *,
    title: str,
    max_attempts: int,
    retry_seconds: int,
    extra_env: dict[str, str] | None = None,
) -> None:
    """Ejecuta un comando con reintentos y corta si no logra exito."""
    merged_env: dict[str, str] = dict(os.environ)
    if extra_env is not None:
        merged_env.update(extra_env)

    for attempt in range(1, max_attempts + 1):
        print(f"[startup] {title} (attempt {attempt}/{max_attempts})")
        process_result: subprocess.CompletedProcess[str] = subprocess.run(
            command,
            env=merged_env,
            check=False,
            text=True,
        )
        if process_result.returncode == 0:
            print(f"[startup] {title}: ok")
            return

        if attempt >= max_attempts:
            print(f"[startup] {title}: failed after retries")
            raise SystemExit(process_result.returncode)

        print(
            f"[startup] {title}: failed (exit={process_result.returncode}), "
            f"retrying in {retry_seconds}s"
        )
        time.sleep(retry_seconds)


def _exec_daphne(host: str, port: str) -> None:
    """Reemplaza el proceso actual por daphne."""
    daphne_command: list[str] = [
        sys.executable,
        "-m",
        "daphne",
        "-b",
        host,
        "-p",
        port,
        "config.asgi:application",
    ]
    print("[startup] launching daphne")
    os.execv(sys.executable, daphne_command)


def main() -> None:
    """Orquesta el arranque robusto de produccion."""
    max_attempts: int = max(1, _read_int_env("BACKEND_STARTUP_MAX_ATTEMPTS", 20))
    retry_seconds: int = max(1, _read_int_env("BACKEND_STARTUP_RETRY_SECONDS", 5))
    backend_host: str = os.getenv("BACKEND_HOST", "0.0.0.0")
    backend_port: str = os.getenv("BACKEND_PORT", "8000")

    _run_with_retries(
        [sys.executable, "-m", "pip", "check"],
        title="pip check",
        max_attempts=max_attempts,
        retry_seconds=retry_seconds,
    )

    _run_with_retries(
        [
            sys.executable,
            "-c",
            "import django, rdkit, admet_ai, torch, lightning",  # noqa: E501
        ],
        title="python runtime imports",
        max_attempts=max_attempts,
        retry_seconds=retry_seconds,
    )

    _run_with_retries(
        [sys.executable, "manage.py", "ensure_runtime_tools"],
        title="ensure_runtime_tools",
        max_attempts=max_attempts,
        retry_seconds=retry_seconds,
        extra_env={"RUNTIME_TOOLS_STRICT_CHECK": "false"},
    )

    _run_with_retries(
        [sys.executable, "manage.py", "migrate", "--noinput"],
        title="migrate",
        max_attempts=max_attempts,
        retry_seconds=retry_seconds,
    )

    _exec_daphne(host=backend_host, port=backend_port)


if __name__ == "__main__":
    main()
