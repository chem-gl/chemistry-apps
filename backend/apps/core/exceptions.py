"""exceptions.py: Excepciones de dominio para control de ejecución de jobs."""

from __future__ import annotations

from dataclasses import dataclass

from .types import JSONMap


@dataclass(slots=True)
class JobPauseRequested(RuntimeError):
    """Señal de pausa cooperativa emitida por un plugin durante ejecución."""

    message: str = "Ejecución pausada por solicitud del usuario."
    checkpoint: JSONMap | None = None

    def __str__(self) -> str:
        return self.message
