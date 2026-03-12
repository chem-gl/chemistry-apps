"""types.py: Tipos estrictos de dominio para la app Easy-rate.

Objetivo del archivo:
- Definir contratos tipados de entrada/salida para serializers, router y plugin.

Cómo se usa:
- Evita uso de estructuras dinámicas no tipadas al mover datos entre capas.
"""

from __future__ import annotations

from typing import TypedDict

from django.core.files.uploadedfile import UploadedFile


class EasyRateArtifactDescriptor(TypedDict):
    """Metadatos resumidos de un archivo cargado en create multipart."""

    field_name: str
    original_filename: str
    content_type: str
    sha256: str
    size_bytes: int


class EasyRateCreateValidatedPayload(TypedDict):
    """Payload validado en router para creación de jobs Easy-rate."""

    version: str
    title: str
    reaction_path_degeneracy: float
    cage_effects: bool
    diffusion: bool
    solvent: str
    custom_viscosity: float | None
    radius_reactant_1: float | None
    radius_reactant_2: float | None
    reaction_distance: float | None
    print_data_input: bool
    reactant_1_file: UploadedFile | None
    reactant_2_file: UploadedFile | None
    transition_state_file: UploadedFile
    product_1_file: UploadedFile | None
    product_2_file: UploadedFile | None


class EasyRateJobParameters(TypedDict):
    """Parámetros persistidos del job para ejecución reproducible."""

    title: str
    reaction_path_degeneracy: float
    cage_effects: bool
    diffusion: bool
    solvent: str
    custom_viscosity: float | None
    radius_reactant_1: float | None
    radius_reactant_2: float | None
    reaction_distance: float | None
    print_data_input: bool
    file_descriptors: list[EasyRateArtifactDescriptor]


class EasyRateStructureSnapshot(TypedDict):
    """Resumen termodinámico normalizado de una estructura Gaussian."""

    source_field: str
    original_filename: str | None
    free_energy: float
    thermal_enthalpy: float
    zero_point_energy: float
    scf_energy: float
    temperature: float
    negative_frequencies: int
    imaginary_frequency: float


class EasyRateResultMetadata(TypedDict):
    """Metadatos de trazabilidad científica del cálculo Easy-rate."""

    model_name: str
    source_library: str
    units: dict[str, str]
    input_artifact_count: int


class EasyRateCalculationResult(TypedDict):
    """Resultado final del cálculo cinético Easy-rate."""

    title: str
    rate_constant: float | None
    rate_constant_tst: float | None
    rate_constant_diffusion_corrected: float | None
    k_diff: float | None
    gibbs_reaction_kcal_mol: float
    gibbs_activation_kcal_mol: float
    enthalpy_reaction_kcal_mol: float
    enthalpy_activation_kcal_mol: float
    zpe_reaction_kcal_mol: float
    zpe_activation_kcal_mol: float
    tunnel_u: float | None
    tunnel_alpha_1: float | None
    tunnel_alpha_2: float | None
    tunnel_g: float | None
    kappa_tst: float
    temperature_k: float
    imaginary_frequency_cm1: float
    delta_n_reaction: int
    delta_n_transition: int
    warn_negative_activation: bool
    cage_effects_applied: bool
    diffusion_applied: bool
    solvent_used: str
    viscosity_pa_s: float | None
    reaction_path_degeneracy: float
    structures: dict[str, EasyRateStructureSnapshot]
    metadata: EasyRateResultMetadata
