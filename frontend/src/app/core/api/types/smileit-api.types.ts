// smileit-api.types.ts: Tipos de la app Smile-it para la capa API del frontend.
// Uso: importar cuando se necesite tipado de catálogo, inspecciones, bloques, derivaciones o generación Smileit.

import {
  PatternTypeEnum,
  SiteOverlapPolicyEnum,
  SmileitCatalogEntry,
  SmileitCategory,
  SmileitJobResponse,
  SmileitPatternEntry,
  SmileitPatternReference,
  SmileitQuickProperties,
  SmileitResolvedAssignmentBlock,
  SmileitStructuralAnnotation,
  SmileitTraceabilityRow,
} from '../generated';

// Re-exports tipados para evitar dependencias directas al cliente OpenAPI autogenerado
export type SmileitCatalogEntryView = SmileitCatalogEntry;
export type SmileitCategoryView = SmileitCategory;
export type SmileitPatternEntryView = SmileitPatternEntry;
export type SmileitQuickPropertiesView = SmileitQuickProperties;
export type SmileitStructuralAnnotationView = SmileitStructuralAnnotation;
export type SmileitPatternReferenceView = SmileitPatternReference;
export type SmileitTraceabilityRowView = SmileitTraceabilityRow;
export type SmileitResolvedAssignmentBlockView = SmileitResolvedAssignmentBlock;
export type SmileitJobResponseView = SmileitJobResponse;

/** Información de átomo normalizada para la UI de selección. */
export interface SmileitAtomInfoView {
  index: number;
  symbol: string;
  implicitHydrogens: number;
  isAromatic: boolean;
}

/** Resultado de inspección estructural normalizado para la UI. */
export interface SmileitStructureInspectionView {
  canonicalSmiles: string;
  atomCount: number;
  atoms: SmileitAtomInfoView[];
  svg: string;
  quickProperties: SmileitQuickPropertiesView;
  annotations: SmileitStructuralAnnotationView[];
  activePatternRefs: SmileitPatternReferenceView[];
}

/** Referencia inmutable a un sustituyente persistente. */
export interface SmileitSubstituentReferenceParams {
  stableId: string;
  version: number;
}

/** Sustituyente manual transportado por la UI. */
export interface SmileitManualSubstituentParams {
  name: string;
  smiles: string;
  anchorAtomIndices: number[];
  categories: string[];
  sourceReference?: string;
  provenanceMetadata?: Record<string, string>;
}

/** Bloque de asignación editable desde la UI. */
export interface SmileitAssignmentBlockParams {
  label: string;
  siteAtomIndices: number[];
  categoryKeys: string[];
  substituentRefs: SmileitSubstituentReferenceParams[];
  manualSubstituents: SmileitManualSubstituentParams[];
}

/** Payload para registrar una nueva entrada persistente del catálogo. */
export interface SmileitCatalogEntryCreateParams {
  name: string;
  smiles: string;
  anchorAtomIndices: number[];
  categoryKeys: string[];
  sourceReference?: string;
  provenanceMetadata?: Record<string, string>;
}

/** Payload para registrar un nuevo patrón estructural persistente. */
export interface SmileitPatternEntryCreateParams {
  name: string;
  smarts: string;
  patternType: PatternTypeEnum;
  caption: string;
  sourceReference?: string;
  provenanceMetadata?: Record<string, string>;
}

/** Parámetros de creación de un job smileit (vista camelCase). */
export interface SmileitGenerationParams {
  principalSmiles: string;
  selectedAtomIndices: number[];
  assignmentBlocks: SmileitAssignmentBlockParams[];
  siteOverlapPolicy?: SiteOverlapPolicyEnum;
  rSubstitutes?: number;
  numBonds?: number;
  maxStructures?: number;
  exportNameBase?: string;
  exportPadding?: number;
  version?: string;
}

/** Item paginado de derivado Smile-it sin SVG embebido. */
export interface SmileitDerivationPageItemView {
  structureIndex: number;
  name: string;
  smiles: string;
  placeholderAssignments: Array<{
    placeholderLabel: string;
    siteAtomIndex: number;
    substituentName: string;
    substituentSmiles?: string;
  }>;
  traceability: Array<{
    round_index: number;
    site_atom_index: number;
    block_label: string;
    block_priority: number;
    substituent_name: string;
    substituent_smiles?: string;
    substituent_stable_id: string;
    substituent_version: number;
    source_kind: string;
    bond_order: number;
  }>;
}

/** Respuesta paginada de derivados Smile-it. */
export interface SmileitDerivationPageView {
  totalGenerated: number;
  offset: number;
  limit: number;
  items: SmileitDerivationPageItemView[];
}

/** Resultado de validación de compatibilidad de un SMILES individual. */
export interface SmilesCompatibilityIssueView {
  smiles: string;
  reason: string;
}

/** Resultado agregado de validación previa de un lote de SMILES. */
export interface SmilesCompatibilityResultView {
  compatible: boolean;
  issues: SmilesCompatibilityIssueView[];
}
