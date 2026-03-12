"""contract.py: Contrato declarativo reusable para la app molar_fractions.

Objetivo del archivo:
- Exponer el plugin con metadata tipada para uso desacoplado de HTTP.

Cómo se usa:
    from apps.molar_fractions.contract import get_molar_fractions_contract

    contract = get_molar_fractions_contract()
    result = contract.execute(parameters={...})
"""

from .definitions import DEFAULT_ALGORITHM_VERSION
from .definitions import PLUGIN_NAME as MOLAR_FRACTIONS_PLUGIN_NAME
from .plugin import _build_molar_fractions_input, molar_fractions_plugin
from .types import MolarFractionsInput, MolarFractionsMetadata, MolarFractionsResult


def get_molar_fractions_contract() -> dict:
    """Retorna contrato declarativo de molar_fractions para APIs internas."""
    return {
        "plugin_name": MOLAR_FRACTIONS_PLUGIN_NAME,
        "version": DEFAULT_ALGORITHM_VERSION,
        "supports_pause_resume": False,
        "input_type": MolarFractionsInput,
        "result_type": MolarFractionsResult,
        "metadata_type": MolarFractionsMetadata,
        "validate_input": _build_molar_fractions_input,
        "execute": molar_fractions_plugin,
        "description": "Cálculo de fracciones molares para equilibrios ácido-base",
    }
