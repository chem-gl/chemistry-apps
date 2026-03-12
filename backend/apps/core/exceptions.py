"""exceptions.py: Excepciones de dominio para control de ejecución de jobs.

Objetivo del archivo:
- Definir señales de control explícitas del dominio que no representan fallos
    técnicos, sino cambios esperados en el flujo de ejecución.

Cómo se usa:
- Los plugins lanzan `JobPauseRequested` cuando detectan una pausa cooperativa.
- `services.py` la captura para persistir checkpoint y mover el job a `paused`
    sin tratarlo como error de negocio.
"""

from __future__ import annotations

from dataclasses import dataclass

from .types import JSONMap


@dataclass(slots=True)
class JobPauseRequested(RuntimeError):
    """Señal de pausa cooperativa emitida por un plugin durante ejecución.

    `checkpoint` permite guardar estado serializable para retomar el trabajo
    posteriormente desde `resume`.
    """

    message: str = "Ejecución pausada por solicitud del usuario."
    checkpoint: JSONMap | None = None

    def __str__(self) -> str:
        return self.message
