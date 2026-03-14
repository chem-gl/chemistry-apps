"""types.py: Tipos estrictamente tipados para el dominio smileit.

Objetivo del archivo:
- Definir TypedDict y TypeAlias para todos los contratos de entrada, salida,
  metadata y resultado del plugin de generación de sustituyentes SMILES.

Cómo se usa:
- `plugin.py` consume SmileitInput y produce SmileitResult.
- `routers.py` y `schemas.py` referencian SmileitJobCreatePayload.
- Ningún tipo aquí debe contener `Any`.
"""

from typing import TypedDict


# --- Catálogo de sustituyente (entrada y respuesta del endpoint catalog) ---
class SmileitCatalogEntry(TypedDict):
    """Un sustituyente del catálogo inicial o definido por el usuario."""

    name: str
    smiles: str
    description: str
    selected_atom_index: int


# --- Descripción de átomo en la molécula principal (respuesta inspect) ---
class SmileitAtomInfo(TypedDict):
    """Información de un átomo de la molécula principal para la UI de selección."""

    index: int
    symbol: str
    implicit_hydrogens: int
    is_aromatic: bool


# --- Resultado de inspección de estructura (endpoint inspect-structure) ---
class SmileitStructureInspectionResult(TypedDict):
    """Retornado por el endpoint inspect-structure: átomo indexado + SVG."""

    canonical_smiles: str
    atom_count: int
    atoms: list[SmileitAtomInfo]
    svg: str


# --- Entrada principal del plugin ---
class SmileitSubstituentInput(TypedDict):
    """Un sustituyente seleccionado para participar en la generación."""

    name: str
    smiles: str
    selected_atom_index: int


class SmileitGenerationOptions(TypedDict):
    """Opciones de control de la generación combinatoria."""

    r_substitutes: int  # profundidad de sustitución (rondas)
    num_bonds: int  # orden de enlace máximo (1=single, 2=double, 3=triple)
    allow_repeated: bool  # si se permiten SMILES duplicados en la salida
    max_structures: int  # límite de seguridad para la explosión combinatoria


class SmileitInput(TypedDict):
    """Entrada completa del plugin smileit recibida desde el job."""

    principal_smiles: str
    selected_atom_indices: list[int]
    substituents: list[SmileitSubstituentInput]
    options: SmileitGenerationOptions
    version: str


# --- Resultado del plugin ---
class SmileitGeneratedStructure(TypedDict):
    """Una molécula generada como resultado de la sustitución."""

    smiles: str
    name: str
    svg: str


class SmileitResult(TypedDict):
    """Salida completa del plugin smileit después de la generación."""

    total_generated: int
    generated_structures: list[SmileitGeneratedStructure]
    truncated: bool  # True si se alcanzó max_structures antes de terminar
    principal_smiles: str
    selected_atom_indices: list[int]


# --- Metadata del job ---
class SmileitMetadata(TypedDict):
    """Metadata almacenada junto al job para trazabilidad."""

    principal_smiles: str
    substituents_count: int
    r_substitutes: int
    num_bonds: int
    allow_repeated: bool
    max_structures: int
    version: str


# --- Payload de creación del job (validado por schemas.py) ---
class SmileitJobCreatePayload(TypedDict):
    """Payload deserializado antes de encolar el job."""

    principal_smiles: str
    selected_atom_indices: list[int]
    substituents: list[SmileitSubstituentInput]
    r_substitutes: int
    num_bonds: int
    allow_repeated: bool
    max_structures: int
    version: str
