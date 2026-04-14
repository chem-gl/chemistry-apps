"""_species_labels.py: Formateo de etiquetas químicas para molar_fractions.

Objetivo del archivo:
- Portar la lógica del notebook legado para nombrar especies ácido-base.

Cómo se usa:
- `plugin.py` llama `generate_species_labels()` para construir etiquetas Unicode.
- `tests.py` valida que las etiquetas sean compatibles con los ejemplos científicos.
"""

from __future__ import annotations

from typing import Final

SUBSCRIPT_MAP: Final[dict[int, str]] = str.maketrans("0123456789-+", "₀₁₂₃₄₅₆₇₈₉₋₊")
SUPERSCRIPT_MAP: Final[dict[int, str]] = str.maketrans(
    "0123456789-+q()", "⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺q⁽⁾"
)

InitialChargeValue = int | str


def validate_initial_charge(initial_charge: InitialChargeValue) -> None:
    """Valida que la carga inicial sea un entero o el literal simbólico q."""
    if isinstance(initial_charge, str):
        if initial_charge != "q":
            raise ValueError("Si initial_charge es string, debe ser exactamente 'q'.")
        return

    if not isinstance(initial_charge, int):
        raise TypeError(
            "initial_charge debe ser un entero o el string 'q'. "
            "No se aceptan cargas fraccionarias."
        )


def format_numeric_charge_unicode(charge: int) -> str:
    """Devuelve la carga numérica formateada en Unicode."""
    if charge == 0:
        return ""
    if charge == 1:
        return "⁺"
    if charge == -1:
        return "⁻"
    if charge > 1:
        return str(charge).translate(SUPERSCRIPT_MAP) + "⁺"
    return str(abs(charge)).translate(SUPERSCRIPT_MAP) + "⁻"


def symbolic_charge_value(
    initial_charge: InitialChargeValue, index: int
) -> InitialChargeValue:
    """Calcula la carga de la especie según el índice de desprotonación."""
    if initial_charge == "q":
        if index == 0:
            return "q"
        return f"q-{index}"
    return initial_charge - index


def proton_prefix_unicode(n_protons: int, label: str) -> str:
    """Agrega el prefijo Hₙ a la etiqueta base según protonación."""
    if n_protons == 0:
        return label
    if n_protons == 1:
        return f"H{label}"
    return "H" + str(n_protons).translate(SUBSCRIPT_MAP) + label


def proton_prefix_ascii(n_protons: int, label: str) -> str:
    """Agrega el prefijo ASCII Hn a la etiqueta base."""
    if n_protons == 0:
        return label
    if n_protons == 1:
        return f"H{label}"
    return f"H{n_protons}{label}"


def format_species_label(
    n_protons: int,
    label: str,
    charge: InitialChargeValue,
) -> str:
    """Construye la etiqueta Unicode final para una especie."""
    base_label: str = proton_prefix_unicode(n_protons, label)

    if isinstance(charge, str):
        if charge == "q":
            charge_text: str = "q"
        else:
            parts: list[str] = charge.split("-")
            if len(parts) == 2 and parts[0] == "q":
                charge_text = "q" + f"-{parts[1]}".translate(SUPERSCRIPT_MAP)
            else:
                charge_text = charge.translate(SUPERSCRIPT_MAP)
    else:
        charge_text = format_numeric_charge_unicode(charge)

    return f"{base_label}{charge_text}"


def format_ascii_charge(charge: InitialChargeValue) -> str:
    """Construye una representación ASCII simple de la carga."""
    if isinstance(charge, str):
        return charge
    if charge == 0:
        return ""
    if charge == 1:
        return "+"
    if charge == -1:
        return "-"
    if charge > 1:
        return f"{charge}+"
    return f"{abs(charge)}-"


def generate_species_labels(
    pka_values: list[float],
    initial_charge: InitialChargeValue = "q",
    label: str = "A",
) -> dict[str, list[InitialChargeValue] | list[str]]:
    """Genera etiquetas Unicode y ASCII para todas las especies del sistema."""
    validate_initial_charge(initial_charge)

    pka_count: int = len(pka_values)
    labels_pretty: list[str] = []
    labels_ascii: list[str] = []
    charges: list[InitialChargeValue] = []

    for index in range(pka_count + 1):
        n_protons: int = pka_count - index
        charge_value: InitialChargeValue = symbolic_charge_value(initial_charge, index)
        labels_pretty.append(format_species_label(n_protons, label, charge_value))
        labels_ascii.append(
            f"{proton_prefix_ascii(n_protons, label)}{format_ascii_charge(charge_value)}"
        )
        charges.append(charge_value)

    return {
        "labels_pretty": labels_pretty,
        "labels_ascii": labels_ascii,
        "charges": charges,
    }
