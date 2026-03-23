"""contract.py: Contrato declarativo reutilizable de Toxicity Properties.

Expone metadatos y función de ejecución del plugin para consumo interno
sin acoplamiento HTTP.
"""

from .definitions import DEFAULT_ALGORITHM_VERSION
from .definitions import PLUGIN_NAME as TOXICITY_PROPERTIES_PLUGIN_NAME
from .plugin import toxicity_properties_plugin
from .types import ToxicityJobParameters, ToxicityJobResult


def get_toxicity_properties_contract() -> dict:
    """Retorna contrato declarativo de Toxicity Properties."""
    return {
        "plugin_name": TOXICITY_PROPERTIES_PLUGIN_NAME,
        "version": DEFAULT_ALGORITHM_VERSION,
        "supports_pause_resume": False,
        "input_type": ToxicityJobParameters,
        "result_type": ToxicityJobResult,
        "execute": toxicity_properties_plugin,
        "description": (
            "Predice propiedades toxicológicas con ADMET-AI para una lista de "
            "SMILES y retorna una tabla fija de cinco columnas: LD50_mgkg, "
            "mutagenicity, ames_score, DevTox y devtox_score."
        ),
    }
