"""contract.py: Contrato declarativo reusable para la app Easy-rate.

Objetivo del archivo:
- Publicar metadata de plugin y funciones de validación/ejecución desacopladas.

Cómo se usa:
- Consumidores internos pueden descubrir y ejecutar Easy-rate sin HTTP.
"""

from .definitions import DEFAULT_ALGORITHM_VERSION
from .definitions import PLUGIN_NAME as EASY_RATE_PLUGIN_NAME
from .plugin import _build_easy_rate_parameters, easy_rate_plugin
from .types import (
    EasyRateCalculationResult,
    EasyRateJobParameters,
    EasyRateResultMetadata,
)


def get_easy_rate_contract() -> dict:
    """Retorna contrato declarativo de Easy-rate para integración interna."""
    return {
        "plugin_name": EASY_RATE_PLUGIN_NAME,
        "version": DEFAULT_ALGORITHM_VERSION,
        "supports_pause_resume": False,
        "input_type": EasyRateJobParameters,
        "result_type": EasyRateCalculationResult,
        "metadata_type": EasyRateResultMetadata,
        "validate_input": _build_easy_rate_parameters,
        "execute": easy_rate_plugin,
        "description": (
            "Cálculo cinético Easy-rate con parseo Gaussian, TST, túnel y difusión"
        ),
    }
