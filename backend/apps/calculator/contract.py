"""contract.py: Contrato declarativo para la app calculator.

Expone la implementación de calculator de forma reutilizable para consumo
interno/externo sin acoplamiento a HTTP o Django ORM directamente.

Uso:
    from apps.calculator.contract import get_calculator_contract

    contract = get_calculator_contract()
    result = contract.execute(
        parameters={"op": "add", "a": 2.0, "b": 3.0},
    )
"""
from .definitions import DEFAULT_ALGORITHM_VERSION
from .definitions import PLUGIN_NAME as CALC_PLUGIN_NAME
from .plugin import _build_calculator_input, calculator_plugin
from .types import CalculatorInput, CalculatorMetadata, CalculatorResult


def get_calculator_contract() -> dict:
    """Retorna contrato declarativo de calculator para reutilización.

    Expone metadatos tipados del plugin para consumo de APIs declarativas
    sin exponer detalles de infraestructura HTTP o Django.
    """
    return {
        "plugin_name": CALC_PLUGIN_NAME,
        "version": DEFAULT_ALGORITHM_VERSION,
        "supports_pause_resume": False,
        "input_type": CalculatorInput,
        "result_type": CalculatorResult,
        "metadata_type": CalculatorMetadata,
        "validate_input": _build_calculator_input,
        "execute": calculator_plugin,
        "description": "Calculadora científica con operaciones aritméticas",
    }
