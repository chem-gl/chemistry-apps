"""types.py: Tipos de dominio para Toxicity Properties Table.

Define contratos estrictos para entrada del job, resultados por molécula
y payload final serializable consumido por frontend y reportes.
"""

from typing import Literal, TypedDict

MutagenicityLabel = Literal["Positive", "Negative"]
DevToxLabel = Literal["Positive", "Negative"]


class ToxicityMoleculeInput(TypedDict):
    """Fila de entrada del lote con nombre visible y SMILES."""

    name: str
    smiles: str


class ToxicityJobParameters(TypedDict):
    """Parámetros de entrada persistidos para ejecutar el plugin."""

    molecules: list[ToxicityMoleculeInput]


class ToxicityMoleculeResult(TypedDict):
    """Resultado toxicológico normalizado para una molécula individual."""

    name: str
    smiles: str
    LD50_mgkg: float | None
    mutagenicity: MutagenicityLabel | None
    ames_score: float | None
    DevTox: DevToxLabel | None
    devtox_score: float | None
    error_message: str | None


class ToxicityJobResult(TypedDict):
    """Resultado completo del job de toxicidad."""

    molecules: list[ToxicityMoleculeResult]
    total: int
    scientific_references: list[str]
