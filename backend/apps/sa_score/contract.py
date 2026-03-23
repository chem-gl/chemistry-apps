"""contract.py: Contrato declarativo para la app SA Score.

Expone la implementación de SA score de forma reutilizable para consumo
interno/externo sin acoplamiento HTTP.

Uso:
    from apps.sa_score.contract import get_sa_score_contract

    contract = get_sa_score_contract()
    result = contract["execute"](
        parameters={
            "smiles_list": ["CCO", "c1ccccc1"],
            "methods": ["ambit", "brsa", "rdkit"],
        },
    )
"""

from .definitions import DEFAULT_ALGORITHM_VERSION
from .definitions import PLUGIN_NAME as SA_SCORE_PLUGIN_NAME
from .plugin import sa_score_plugin
from .types import SaMoleculeResult, SaScoreJobParameters, SaScoreJobResult


def get_sa_score_contract() -> dict:
    """Retorna contrato declarativo de SA score para reutilización.

    Expone metadatos tipados del plugin para consumo de APIs declarativas
    sin acoplamiento HTTP.
    """
    return {
        "plugin_name": SA_SCORE_PLUGIN_NAME,
        "version": DEFAULT_ALGORITHM_VERSION,
        "supports_pause_resume": False,
        "input_type": SaScoreJobParameters,
        "result_type": SaScoreJobResult,
        "molecule_result_type": SaMoleculeResult,
        "execute": sa_score_plugin,
        "description": (
            "Calcula accesibilidad sintética (SA score) para una lista de SMILES "
            "usando hasta tres métodos: AMBIT (Java), BRSAScore (RDKit + pickles) "
            "y RDKit SA Score nativo (rdkit.Contrib.SA_Score)."
        ),
    }
