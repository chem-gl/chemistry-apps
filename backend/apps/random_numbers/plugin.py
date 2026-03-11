"""plugin.py: Lógica de generación de números aleatorios con progreso incremental."""

from __future__ import annotations

import hashlib
import logging
import random
from time import sleep
from urllib.error import URLError
from urllib.request import urlopen

from apps.core.processing import PluginRegistry
from apps.core.types import JSONMap, PluginProgressCallback

from .definitions import PLUGIN_NAME
from .types import RandomNumbersInput, RandomNumbersResult

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


def _resolve_seed_digest(seed_url: str) -> str:
    """Obtiene digest determinista usando URL y, cuando sea posible, su contenido.

    Si la lectura remota falla (SSL, red, DNS, etc.), se aplica fallback seguro
    usando solo la URL para que el job continúe y siga siendo determinista.
    """
    response_content: bytes = b""

    try:
        with urlopen(seed_url, timeout=5.0) as response:
            response_content = response.read(4096)
    except URLError as fetch_error:
        logger.warning(
            "No se pudo leer la URL semilla '%s'. Se usará fallback local: %s",
            seed_url,
            fetch_error,
        )

    digest_source: bytes = seed_url.encode("utf-8") + b"|" + response_content
    return hashlib.sha256(digest_source).hexdigest()


@PluginRegistry.register(PLUGIN_NAME)
def random_numbers_plugin(
    parameters: JSONMap,
    progress_callback: PluginProgressCallback,
) -> JSONMap:
    """Genera números pseudoaleatorios en lotes y reporta progreso por iteración."""
    validated_input: RandomNumbersInput = _build_random_numbers_input(parameters)

    seed_url: str = validated_input["seed_url"]
    numbers_per_batch: int = validated_input["numbers_per_batch"]
    interval_seconds: int = validated_input["interval_seconds"]
    total_numbers: int = validated_input["total_numbers"]

    seed_digest: str = _resolve_seed_digest(seed_url)
    seed_integer: int = int(seed_digest[:16], 16)
    random_generator = random.Random(seed_integer)

    logger.info(
        "Generando %s números aleatorios cada %s segundos con semilla URL %s",
        total_numbers,
        interval_seconds,
        seed_url,
    )

    generated_numbers: list[int] = []
    generated_count: int = 0

    while generated_count < total_numbers:
        remaining_numbers: int = total_numbers - generated_count
        current_batch_size: int = min(numbers_per_batch, remaining_numbers)

        for _ in range(current_batch_size):
            next_number: int = random_generator.randint(0, 1_000_000)
            generated_numbers.append(next_number)
            generated_count += 1

            completion_percentage: int = int((generated_count / total_numbers) * 100)
            progress_callback(
                completion_percentage,
                "running",
                f"Generados {generated_count}/{total_numbers} números aleatorios.",
            )

        if generated_count < total_numbers:
            sleep(interval_seconds)

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
