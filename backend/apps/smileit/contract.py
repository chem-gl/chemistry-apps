"""contract.py: Contrato declarativo para la app smileit.

Expone la implementación de smileit de forma reutilizable para consumo
interno/externo, sin soporte de pause/resume (la generación es instantánea
en relación al ciclo del job).

Uso:
    from apps.smileit.contract import get_smileit_contract

    contract = get_smileit_contract()
    result = contract["execute"](
        parameters={
            "principal_smiles": "c1ccccc1",
            "selected_atom_indices": [0],
            "substituents": [{"name": "Amine", "smiles": "[NH2]", "selected_atom_index": 0}],
            "r_substitutes": 1,
            "num_bonds": 1,
            "allow_repeated": False,
            "max_structures": 0,
        },
    )
"""

from .definitions import DEFAULT_ALGORITHM_VERSION
from .definitions import PLUGIN_NAME as SMILEIT_PLUGIN_NAME
from .plugin import smileit_plugin
from .types import SmileitInput, SmileitMetadata, SmileitResult


def get_smileit_contract() -> dict:
    """Retorna contrato declarativo de smileit para reutilización.

    Expone metadatos tipados del plugin para consumo de APIs declarativas
    sin acoplamiento HTTP.
    """
    return {
        "plugin_name": SMILEIT_PLUGIN_NAME,
        "version": DEFAULT_ALGORITHM_VERSION,
        "supports_pause_resume": False,
        "input_type": SmileitInput,
        "result_type": SmileitResult,
        "metadata_type": SmileitMetadata,
        "execute": smileit_plugin,
        "description": (
            "Generador combinatorio de moléculas por sustitución en átomos seleccionados "
            "de una molécula principal usando RDKit como motor químico."
        ),
    }
