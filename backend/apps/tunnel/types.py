"""types.py: Tipos estrictos de dominio para la app Tunnel.

Objetivo del archivo:
- Definir contratos tipados compartidos entre serializers, plugin y pruebas.

Cómo se usa:
- `routers.py` tipa `validated_data` para construir parámetros persistidos.
- `plugin.py` usa estos tipos para mantener salida estable y serializable.
"""

from typing import TypedDict


class TunnelInputChangeEvent(TypedDict):
    """Evento de cambio de entrada capturado en frontend y persistido en backend."""

    field_name: str
    previous_value: float
    new_value: float
    changed_at: str


class TunnelCalculationInput(TypedDict):
    """Parámetros normalizados del cálculo de efecto túnel."""

    reaction_barrier_zpe: float
    imaginary_frequency: float
    reaction_energy_zpe: float
    temperature: float
    input_change_events: list[TunnelInputChangeEvent]


class TunnelJobCreatePayload(TypedDict):
    """Payload tipado de creación de jobs para la app Tunnel."""

    version: str
    reaction_barrier_zpe: float
    imaginary_frequency: float
    reaction_energy_zpe: float
    temperature: float
    input_change_events: list[TunnelInputChangeEvent]


class TunnelCalculationMetadata(TypedDict):
    """Metadatos de trazabilidad y origen científico del cálculo."""

    model_name: str
    source_library: str
    units: dict[str, str]
    input_event_count: int


class TunnelCalculationResult(TypedDict):
    """Resultado tipado del plugin Tunnel."""

    u: float
    alpha_1: float
    alpha_2: float
    g: float
    kappa_tst: float
    metadata: TunnelCalculationMetadata
