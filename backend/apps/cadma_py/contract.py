"""contract.py: Contrato declarativo reusable de CADMA Py.

Expone el plugin y una descripción resumida para otras capas del sistema.
"""

from __future__ import annotations

from .definitions import PLUGIN_NAME
from .plugin import cadma_py_plugin


def get_cadma_py_contract() -> dict[str, object]:
    """Retorna el contrato público del plugin CADMA Py."""
    return {
        "plugin_name": PLUGIN_NAME,
        "execute": cadma_py_plugin,
        "description": (
            "Compara compuestos candidatos frente a un set de referencia con "
            "scores y gráficas orientadas a selección transparente."
        ),
    }
