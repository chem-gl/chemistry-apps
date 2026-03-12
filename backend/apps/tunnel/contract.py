"""contract.py: Contrato declarativo reusable para la app Tunnel.

Objetivo del archivo:
- Exponer el plugin Tunnel con metadata tipada para APIs internas.

Cómo se usa:
    from apps.tunnel.contract import get_tunnel_contract

    contract = get_tunnel_contract()
    result = contract["execute"](parameters={...})
"""

from .definitions import DEFAULT_ALGORITHM_VERSION
from .definitions import PLUGIN_NAME as TUNNEL_PLUGIN_NAME
from .plugin import _build_tunnel_input, tunnel_effect_plugin
from .types import (
    TunnelCalculationInput,
    TunnelCalculationMetadata,
    TunnelCalculationResult,
)


def get_tunnel_contract() -> dict:
    """Retorna contrato declarativo de Tunnel para consumo desacoplado."""
    return {
        "plugin_name": TUNNEL_PLUGIN_NAME,
        "version": DEFAULT_ALGORITHM_VERSION,
        "supports_pause_resume": False,
        "input_type": TunnelCalculationInput,
        "result_type": TunnelCalculationResult,
        "metadata_type": TunnelCalculationMetadata,
        "validate_input": _build_tunnel_input,
        "execute": tunnel_effect_plugin,
        "description": "Cálculo del efecto túnel mediante teoría de Eckart asimétrica",
    }
