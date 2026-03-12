"""types.py: Tipos estrictos de dominio para la app Marcus.

Objetivo del archivo:
- Definir contratos tipados de parámetros, snapshots y resultados.
"""

from __future__ import annotations

from typing import TypedDict


class MarcusArtifactDescriptor(TypedDict):
    """Descriptor de archivo cargado en create multipart."""

    field_name: str
    original_filename: str
    content_type: str
    sha256: str
    size_bytes: int


class MarcusJobParameters(TypedDict):
    """Parámetros persistidos del job Marcus."""

    title: str
    diffusion: bool
    radius_reactant_1: float | None
    radius_reactant_2: float | None
    reaction_distance: float | None
    file_descriptors: list[MarcusArtifactDescriptor]


class MarcusStructureSnapshot(TypedDict):
    """Resumen de variables necesarias por estructura Gaussian."""

    source_field: str
    original_filename: str
    scf_energy: float
    thermal_free_enthalpy: float
    temperature: float


class MarcusResultMetadata(TypedDict):
    """Metadatos de trazabilidad del cálculo Marcus."""

    model_name: str
    source_library: str
    units: dict[str, str]
    input_artifact_count: int


class MarcusCalculationResult(TypedDict):
    """Salida principal de cinética por modelo Marcus."""

    title: str
    adiabatic_energy_kcal_mol: float
    adiabatic_energy_corrected_kcal_mol: float
    vertical_energy_kcal_mol: float
    reorganization_energy_kcal_mol: float
    barrier_kcal_mol: float
    rate_constant_tst: float
    rate_constant: float
    diffusion_applied: bool
    k_diff: float | None
    temperature_k: float
    viscosity_pa_s: float | None
    structures: dict[str, MarcusStructureSnapshot]
    metadata: MarcusResultMetadata
