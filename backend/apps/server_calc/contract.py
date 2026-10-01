"""contract.py: Contrato declarativo reusable para la app Server Calc.

Objetivo del archivo:
- Exponer el plugin Server Calc con metadata tipada para APIs internas.

Cómo se usa:
    from apps.server_calc.contract import get_server_calc_contract

    contract = get_server_calc_contract()
    result = contract["execute"](parameters={...})
"""

from .definitions import DEFAULT_ALGORITHM_VERSION
from .definitions import PLUGIN_NAME as SERVER_CALC_PLUGIN_NAME
from .plugin import _build_server_calc_input, server_calc_plugin
from .types import (
    ServerCalcCalculationInput,
    ServerCalcCalculationMetadata,
    ServerCalcCalculationResult,
)


def get_server_calc_contract() -> dict:
    """Retorna contrato declarativo de Server Calc para consumo desacoplado."""
    return {
        "plugin_name": SERVER_CALC_PLUGIN_NAME,
        "version": DEFAULT_ALGORITHM_VERSION,
        "supports_pause_resume": False,
        "input_type": ServerCalcCalculationInput,
        "result_type": ServerCalcCalculationResult,
        "metadata_type": ServerCalcCalculationMetadata,
        "validate_input": _build_server_calc_input,
        "execute": server_calc_plugin,
        "description": "Cálculo remoto PoC ejecutado en el servidor qta vía SSH",
    }
