"""plugin.py: Lógica de generación de números aleatorios con progreso incremental.

Objetivo del archivo:
- Implementar la lógica de dominio del plugin random_numbers de forma pura,
    reutilizable y desacoplada de HTTP/ORM.

Cómo se usa:
- `PluginRegistry` ejecuta `random_numbers_plugin` durante `JobService.run_job`.
- El plugin reporta progreso/logs mediante callbacks y soporta pausa cooperativa
    lanzando `JobPauseRequested` con checkpoint.
"""

from __future__ import annotations

import hashlib
import logging
import random
from time import sleep
from urllib.error import URLError
from urllib.request import urlopen

from apps.core.exceptions import JobPauseRequested
from apps.core.processing import PluginRegistry
from apps.core.types import (
    JSONMap,
    PluginControlCallback,
    PluginLogCallback,
    PluginProgressCallback,
)

from .definitions import PLUGIN_NAME
from .types import RandomNumbersInput, RandomNumbersResult, RandomNumbersRuntimeState

logger = logging.getLogger(__name__)


def _build_random_numbers_input(parameters: JSONMap) -> RandomNumbersInput:
    """Valida y normaliza el contrato de entrada del plugin random_numbers."""
    seed_url: str = str(parameters.get("seed_url", "")).strip()
    if seed_url == "":
        raise ValueError("seed_url es obligatorio para generar números aleatorios.")

    numbers_per_batch: int = int(parameters.get("numbers_per_batch", 1))
    interval_seconds: int = int(parameters.get("interval_seconds", 60))
    total_numbers: int = int(parameters.get("total_numbers", 1))

    if numbers_per_batch <= 0:
        raise ValueError("numbers_per_batch debe ser mayor que cero.")
    if interval_seconds <= 0:
        raise ValueError("interval_seconds debe ser mayor que cero.")
    if total_numbers <= 0:
        raise ValueError("total_numbers debe ser mayor que cero.")

    return {
        "seed_url": seed_url,
        "numbers_per_batch": numbers_per_batch,
        "interval_seconds": interval_seconds,
        "total_numbers": total_numbers,
    }


def _resolve_seed_digest(
    seed_url: str,
    log_callback: PluginLogCallback,
) -> str:
    """Obtiene digest determinista usando URL y, cuando sea posible, su contenido.

    Si la lectura remota falla (SSL, red, DNS, etc.), se aplica fallback seguro
    usando solo la URL para que el job continúe y siga siendo determinista.
    """
    response_content: bytes = b""

    try:
        with urlopen(seed_url, timeout=5.0) as response:
            response_content = response.read(4096)
            log_callback(
                "info",
                "random_numbers.plugin",
                "Semilla remota leída correctamente.",
                {
                    "seed_url": seed_url,
                    "bytes_read": len(response_content),
                },
            )
    except URLError as fetch_error:
        logger.warning(
            "No se pudo leer la URL semilla '%s'. Se usará fallback local: %s",
            seed_url,
            fetch_error,
        )
        log_callback(
            "warning",
            "random_numbers.plugin",
            "Fallo al leer semilla remota; se aplica fallback determinista local.",
            {
                "seed_url": seed_url,
                "error": str(fetch_error),
            },
        )

    digest_source: bytes = seed_url.encode("utf-8") + b"|" + response_content
    return hashlib.sha256(digest_source).hexdigest()


def _extract_runtime_state(parameters: JSONMap) -> RandomNumbersRuntimeState | None:
    """Lee estado serializado de ejecución, si existe, para reanudar el job."""
    raw_runtime_state: JSONMap | None = (
        parameters.get("__runtime_state")
        if isinstance(parameters.get("__runtime_state"), dict)
        else None
    )
    if raw_runtime_state is None:
        return None

    raw_generated_numbers: JSONMap | list[object] | None = raw_runtime_state.get(
        "generated_numbers"
    )
    if not isinstance(raw_generated_numbers, list):
        return None

    generated_numbers: list[int] = [
        int(value) for value in raw_generated_numbers if isinstance(value, int)
    ]
    generated_count_value: int = int(raw_runtime_state.get("generated_count", 0))
    total_numbers_value: int = int(raw_runtime_state.get("total_numbers", 0))

    normalized_generated_count: int = max(len(generated_numbers), generated_count_value)
    return {
        "generated_numbers": list(generated_numbers),
        "generated_count": normalized_generated_count,
        "total_numbers": total_numbers_value,
    }


def _build_pause_checkpoint(
    generated_numbers: list[int],
    generated_count: int,
    total_numbers: int,
) -> JSONMap:
    """Construye checkpoint JSON para pausar y luego reanudar ejecución."""
    return {
        "generated_numbers": list(generated_numbers),
        "generated_count": int(generated_count),
        "total_numbers": int(total_numbers),
    }


@PluginRegistry.register(PLUGIN_NAME)
def random_numbers_plugin(
    parameters: JSONMap,
    progress_callback: PluginProgressCallback,
    log_callback: PluginLogCallback | None = None,
    control_callback: PluginControlCallback | None = None,
) -> JSONMap:
    """Genera números pseudoaleatorios en lotes y reporta progreso por iteración."""
    emit_log: PluginLogCallback = (
        log_callback
        if log_callback is not None
        else lambda _level, _source, _message, _payload: None
    )
    request_control_action: PluginControlCallback = (
        control_callback if control_callback is not None else lambda: "continue"
    )

    validated_input: RandomNumbersInput = _build_random_numbers_input(parameters)

    seed_url: str = validated_input["seed_url"]
    numbers_per_batch: int = validated_input["numbers_per_batch"]
    interval_seconds: int = validated_input["interval_seconds"]
    total_numbers: int = validated_input["total_numbers"]

    emit_log(
        "info",
        "random_numbers.plugin",
        "Iniciando generación de números aleatorios.",
        {
            "seed_url": seed_url,
            "numbers_per_batch": numbers_per_batch,
            "interval_seconds": interval_seconds,
            "total_numbers": total_numbers,
        },
    )

    seed_digest: str = _resolve_seed_digest(seed_url, emit_log)
    seed_integer: int = int(seed_digest[:16], 16)
    random_generator = random.Random(seed_integer)
    emit_log(
        "info",
        "random_numbers.plugin",
        "Generador pseudoaleatorio inicializado con digest determinista.",
        {
            "seed_url": seed_url,
            "seed_digest_prefix": seed_digest[:12],
        },
    )

    logger.info(
        "Generando %s números aleatorios cada %s segundos con semilla URL %s",
        total_numbers,
        interval_seconds,
        seed_url,
    )

    generated_numbers: list[int] = []
    generated_count: int = 0

    runtime_state: RandomNumbersRuntimeState | None = _extract_runtime_state(parameters)
    if runtime_state is not None:
        generated_numbers = list(runtime_state["generated_numbers"])
        generated_count = int(runtime_state["generated_count"])
        emit_log(
            "info",
            "random_numbers.plugin",
            "Reanudando ejecución desde checkpoint persistido.",
            {
                "generated_count": generated_count,
                "total_numbers": total_numbers,
            },
        )

        for _ in range(generated_count):
            random_generator.randint(0, 1_000_000)

    while generated_count < total_numbers:
        if request_control_action() == "pause":
            raise JobPauseRequested(
                checkpoint=_build_pause_checkpoint(
                    generated_numbers,
                    generated_count,
                    total_numbers,
                )
            )

        remaining_numbers: int = total_numbers - generated_count
        current_batch_size: int = min(numbers_per_batch, remaining_numbers)
        batch_generated_numbers: list[int] = []
        emit_log(
            "info",
            "random_numbers.plugin",
            "Procesando lote de generación.",
            {
                "current_batch_size": current_batch_size,
                "generated_count_before_batch": generated_count,
                "remaining_numbers": remaining_numbers,
            },
        )

        for _ in range(current_batch_size):
            next_number: int = random_generator.randint(0, 1_000_000)
            generated_numbers.append(next_number)
            batch_generated_numbers.append(next_number)
            generated_count += 1
            emit_log(
                "debug",
                "random_numbers.plugin",
                "Número generado correctamente.",
                {
                    "generated_count": generated_count,
                    "generated_number": next_number,
                    "total_numbers": total_numbers,
                },
            )

            completion_percentage: int = int((generated_count / total_numbers) * 100)
            progress_callback(
                completion_percentage,
                "running",
                f"Generados {generated_count}/{total_numbers} números aleatorios.",
            )

            if request_control_action() == "pause":
                raise JobPauseRequested(
                    checkpoint=_build_pause_checkpoint(
                        generated_numbers,
                        generated_count,
                        total_numbers,
                    )
                )

        emit_log(
            "info",
            "random_numbers.plugin",
            "Lote generado; se publica snapshot acumulado de números generados.",
            {
                "batch_generated_numbers": batch_generated_numbers,
                "generated_count": generated_count,
                "generated_numbers_so_far": list(generated_numbers),
                "total_numbers": total_numbers,
            },
        )

        if generated_count < total_numbers:
            if request_control_action() == "pause":
                raise JobPauseRequested(
                    checkpoint=_build_pause_checkpoint(
                        generated_numbers,
                        generated_count,
                        total_numbers,
                    )
                )
            emit_log(
                "info",
                "random_numbers.plugin",
                "Esperando intervalo antes del siguiente lote.",
                {
                    "interval_seconds": interval_seconds,
                    "generated_count": generated_count,
                },
            )
            sleep(interval_seconds)

    emit_log(
        "info",
        "random_numbers.plugin",
        "Generación completada exitosamente.",
        {
            "total_numbers": total_numbers,
            "generated_count": generated_count,
        },
    )

    result_payload: RandomNumbersResult = {
        "generated_numbers": generated_numbers,
        "metadata": {
            "seed_url": seed_url,
            "seed_digest": seed_digest,
            "numbers_per_batch": numbers_per_batch,
            "interval_seconds": interval_seconds,
            "total_numbers": total_numbers,
        },
    }
    return result_payload
