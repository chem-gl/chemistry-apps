"""contract.py: Contrato declarativo para la app random_numbers.

Expone la implementación de random_numbers de forma reutilizable para consumo
interno/externo, con soporte explícito de pause/resume y checkpoint.

Uso:
    from apps.random_numbers.contract import get_random_numbers_contract

    contract = get_random_numbers_contract()
    # Ejecutar sin pause/resume
    result = contract.execute(
        parameters={
            "seed_url": "https://example.com/seed.txt",
            "numbers_per_batch": 5,
            "interval_seconds": 60,
            "total_numbers": 100,
        },
    )
"""

from .definitions import DEFAULT_ALGORITHM_VERSION
from .definitions import PLUGIN_NAME as RANDOM_PLUGIN_NAME
from .plugin import _build_random_numbers_input, random_numbers_plugin
from .types import (
    RandomNumbersInput,
    RandomNumbersMetadata,
    RandomNumbersResult,
    RandomNumbersRuntimeState,
)


def get_random_numbers_contract() -> dict:
    """Retorna contrato declarativo de random_numbers para reutilización.

    Expone metadatos tipados del plugin con soporte de pause/resume
    para consumo de APIs declarativas sin acoplamiento HTTP.
    """
    return {
        "plugin_name": RANDOM_PLUGIN_NAME,
        "version": DEFAULT_ALGORITHM_VERSION,
        "supports_pause_resume": True,
        "input_type": RandomNumbersInput,
        "result_type": RandomNumbersResult,
        "metadata_type": RandomNumbersMetadata,
        "runtime_state_type": RandomNumbersRuntimeState,
        "validate_input": _build_random_numbers_input,
        "execute": random_numbers_plugin,
        "description": "Generador de números aleatorios por lotes con checkpoint de pausa",
    }
