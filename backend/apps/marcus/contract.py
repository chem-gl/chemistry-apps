"""contract.py: Contrato declarativo reusable para la app Marcus.

Objetivo del archivo:
- Exponer plugin Marcus con metadata tipada para consumo interno.
"""

from .definitions import DEFAULT_ALGORITHM_VERSION
from .definitions import PLUGIN_NAME as MARCUS_PLUGIN_NAME
from .plugin import _build_marcus_parameters, marcus_plugin
from .types import MarcusCalculationResult, MarcusJobParameters, MarcusResultMetadata


def get_marcus_contract() -> dict:
    """Retorna contrato declarativo de Marcus para integraciones desacopladas."""
    return {
        "plugin_name": MARCUS_PLUGIN_NAME,
        "version": DEFAULT_ALGORITHM_VERSION,
        "supports_pause_resume": False,
        "input_type": MarcusJobParameters,
        "result_type": MarcusCalculationResult,
        "metadata_type": MarcusResultMetadata,
        "validate_input": _build_marcus_parameters,
        "execute": marcus_plugin,
        "description": "Cálculo de cinética por modelo Marcus con parseo Gaussian",
    }
