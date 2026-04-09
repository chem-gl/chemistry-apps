"""types.py: Tipos de dominio estrictos para la app SA Score.

Objetivo del archivo:
- Definir contratos de entrada/salida entre capas (router → plugin → resultados)
  con tipado estricto sin dependencia de DRF ni Django.

Cómo se usa:
- `plugin.py` usa SaScoreJobParameters para leer los parámetros validados.
- `routers.py` castea los resultados a SaScoreJobResult para construir CSVs.
- Los TypedDict son serializables a JSONMap directamente.
"""

from typing import Literal, TypedDict

# Tipo literal para los métodos de SA score soportados
SaScoreMethod = Literal["ambit", "brsa", "rdkit"]


class SaScoreMoleculeInput(TypedDict):
    """Fila de entrada del lote químico con nombre visible y SMILES."""

    name: str
    smiles: str


class SaScoreJobParameters(TypedDict):
    """Parámetros de entrada para un job de SA score."""

    molecules: list[SaScoreMoleculeInput]
    methods: list[str]  # valores de SaScoreMethod


class SaMoleculeResult(TypedDict):
    """Resultado de SA score para una molécula individual con todos los métodos."""

    name: str
    smiles: str
    ambit_sa: float | None
    brsa_sa: float | None
    rdkit_sa: float | None
    ambit_error: str | None
    brsa_error: str | None
    rdkit_error: str | None


class SaScoreJobResult(TypedDict):
    """Resultado completo de un job de SA score con todos los SMILES procesados."""

    molecules: list[SaMoleculeResult]
    total: int
    requested_methods: list[str]
