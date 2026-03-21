"""types.py: Tipos estrictamente tipados para Smile-it profesional.

Objetivo del archivo:
- Definir contratos tipados del catálogo persistente, asignación por bloques,
  inspección estructural y trazabilidad de generación.

Cómo se usa:
- `schemas.py` refleja estos contratos en OpenAPI.
- `routers.py` valida/normaliza payloads para creación de jobs y CRUD.
- `plugin.py` consume `SmileitInput` y retorna `SmileitResult`.
"""

from __future__ import annotations

from typing import Literal, NotRequired, TypedDict

SmileitSiteOverlapPolicy = Literal["last_block_wins"]
SmileitPatternType = Literal["toxicophore", "privileged"]
SmileitCategoryVerificationRule = Literal[
    "aromatic",
    "hbond_donor",
    "hbond_acceptor",
    "hydrophobic",
    "smarts",
]


class SmileitCategory(TypedDict):
    """Categoría química persistente y verificable."""

    id: str
    key: str
    version: int
    name: str
    description: str
    verification_rule: SmileitCategoryVerificationRule
    verification_smarts: str


class SmileitCatalogEntry(TypedDict):
    """Sustituyente persistente expuesto por API."""

    id: str
    stable_id: str
    version: int
    name: str
    smiles: str
    anchor_atom_indices: list[int]
    categories: list[str]
    source_reference: str
    provenance_metadata: dict[str, str]


class SmileitPatternEntry(TypedDict):
    """Patrón estructural persistente para anotación visual."""

    id: str
    stable_id: str
    version: int
    name: str
    smarts: str
    pattern_type: SmileitPatternType
    caption: str
    source_reference: str
    provenance_metadata: dict[str, str]


class SmileitQuickProperties(TypedDict):
    """Propiedades fisicoquímicas rápidas calculadas para la molécula."""

    molecular_weight: float
    clogp: float
    rotatable_bonds: int
    hbond_donors: int
    hbond_acceptors: int
    tpsa: float
    aromatic_rings: int


class SmileitAtomInfo(TypedDict):
    """Información de átomo para selección interactiva de sitios."""

    index: int
    symbol: str
    implicit_hydrogens: int
    is_aromatic: bool


class SmileitStructuralAnnotation(TypedDict):
    """Región estructural anotada en la molécula inspeccionada."""

    pattern_stable_id: str
    pattern_version: int
    name: str
    pattern_type: SmileitPatternType
    caption: str
    atom_indices: list[int]
    color: str


class SmileitStructureInspectionResult(TypedDict):
    """Respuesta de inspección estructural enriquecida."""

    canonical_smiles: str
    atom_count: int
    atoms: list[SmileitAtomInfo]
    svg: str
    quick_properties: SmileitQuickProperties
    annotations: list[SmileitStructuralAnnotation]
    active_pattern_refs: list[dict[str, str | int]]


class SmileitSubstituentReferenceInput(TypedDict):
    """Referencia inmutable a sustituyente persistido por stable_id + version."""

    stable_id: str
    version: int


class SmileitManualSubstituentInput(TypedDict):
    """Sustituyente manual incorporado directamente en el bloque."""

    name: str
    smiles: str
    anchor_atom_indices: list[int]
    categories: list[str]
    source_reference: NotRequired[str]
    provenance_metadata: NotRequired[dict[str, str]]


class SmileitAssignmentBlockInput(TypedDict):
    """Bloque de asignación de sustituyentes para uno o más sitios."""

    label: str
    site_atom_indices: list[int]
    category_keys: list[str]
    substituent_refs: list[SmileitSubstituentReferenceInput]
    manual_substituents: list[SmileitManualSubstituentInput]


class SmileitResolvedSubstituent(TypedDict):
    """Sustituyente normalizado para ejecución del plugin."""

    source_kind: Literal["catalog", "manual"]
    stable_id: str
    version: int
    name: str
    smiles: str
    selected_atom_index: int
    categories: list[str]


class SmileitResolvedAssignmentBlock(TypedDict):
    """Bloque normalizado con prioridad y sustituyentes resueltos."""

    label: str
    priority: int
    site_atom_indices: list[int]
    resolved_substituents: list[SmileitResolvedSubstituent]


class SmileitGenerationOptions(TypedDict):
    """Opciones de ejecución combinatoria y exportación."""

    r_substitutes: int
    num_bonds: int
    allow_repeated: bool
    max_structures: int
    site_overlap_policy: SmileitSiteOverlapPolicy
    export_name_base: str
    export_padding: int


class SmileitInput(TypedDict):
    """Entrada completa del plugin después de validación del router."""

    principal_smiles: str
    selected_atom_indices: list[int]
    assignment_blocks: list[SmileitResolvedAssignmentBlock]
    options: SmileitGenerationOptions
    version: str
    references: dict[str, list[dict[str, str | int]]]


class SmileitSubstitutionTraceEvent(TypedDict):
    """Evento de sustitución aplicado dentro de un derivado."""

    round_index: int
    site_atom_index: int
    block_label: str
    block_priority: int
    substituent_name: str
    substituent_smiles: str
    substituent_stable_id: str
    substituent_version: int
    source_kind: Literal["catalog", "manual"]
    bond_order: int


class SmileitSubstituentPreview(TypedDict):
    """Previsualización de sustituyente aplicado para contexto visual del derivado."""

    name: str
    smiles: str
    svg: str


class SmileitPlaceholderAssignment(TypedDict):
    """Relación estable placeholder -> sustituyente aplicado en el derivado."""

    placeholder_label: str
    site_atom_index: int
    substituent_name: str
    substituent_smiles: str


class SmileitGeneratedStructure(TypedDict):
    """Derivado generado con trazabilidad de sustituciones aplicadas."""

    smiles: str
    name: str
    svg: str
    scaffold_svg: str
    placeholder_svg: str
    placeholder_assignments: list[SmileitPlaceholderAssignment]
    substituent_svgs: list[SmileitSubstituentPreview]
    traceability: list[SmileitSubstitutionTraceEvent]


class SmileitTraceabilityRow(TypedDict):
    """Fila exportable para auditoría de derivado y sustituciones."""

    derivative_name: str
    derivative_smiles: str
    round_index: int
    site_atom_index: int
    block_label: str
    block_priority: int
    substituent_name: str
    substituent_smiles: str
    substituent_stable_id: str
    substituent_version: int
    source_kind: str
    bond_order: int


class SmileitCoverageItem(TypedDict):
    """Cobertura efectiva de sitio contra bloque seleccionado."""

    site_atom_index: int
    covered: bool
    block_label: str
    block_priority: int


class SmileitResult(TypedDict):
    """Resultado completo de ejecución del plugin Smile-it."""

    total_generated: int
    generated_structures: list[SmileitGeneratedStructure]
    traceability_rows: list[SmileitTraceabilityRow]
    truncated: bool
    principal_smiles: str
    selected_atom_indices: list[int]
    export_name_base: str
    export_padding: int
    references: dict[str, list[dict[str, str | int]]]


class SmileitMetadata(TypedDict):
    """Metadata de job para auditoría funcional."""

    principal_smiles: str
    selected_sites_count: int
    assignment_blocks_count: int
    r_substitutes: int
    num_bonds: int
    allow_repeated: bool
    max_structures: int
    site_overlap_policy: SmileitSiteOverlapPolicy
    version: str


class SmileitSubstituentCreatePayload(TypedDict):
    """Payload de alta de sustituyente persistente."""

    name: str
    smiles: str
    anchor_atom_indices: list[int]
    category_keys: list[str]
    source_reference: str
    provenance_metadata: dict[str, str]


class SmileitPatternCreatePayload(TypedDict):
    """Payload de alta de patrón estructural persistente."""

    name: str
    smarts: str
    pattern_type: SmileitPatternType
    caption: str
    source_reference: str
    provenance_metadata: dict[str, str]


class SmileitJobCreatePayload(TypedDict):
    """Payload de creación de job en contrato v2."""

    principal_smiles: str
    selected_atom_indices: list[int]
    assignment_blocks: list[SmileitAssignmentBlockInput]
    r_substitutes: int
    num_bonds: int
    allow_repeated: bool
    max_structures: int
    version: str
    site_overlap_policy: SmileitSiteOverlapPolicy
    export_name_base: str
    export_padding: int
