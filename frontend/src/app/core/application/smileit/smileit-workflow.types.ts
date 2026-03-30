// smileit-workflow.types.ts: Tipos e interfaces del dominio Smileit-workflow.
// Centraliza las definiciones de tipos usados por el estado, servicios de catálogo, bloques y la fachada.

import type {
    SmileitCatalogEntryView,
    SmileitManualSubstituentParams,
    SmileitResolvedAssignmentBlockView,
    SmileitTraceabilityRowView,
} from '../../api/jobs-api.service';

/** Sección activa del flujo Smileit. */
export type SmileitSection = 'idle' | 'inspecting' | 'dispatching' | 'progress' | 'result' | 'error';

/** Vista de una estructura química generada por Smileit. */
export interface SmileitGeneratedStructureView {
  structureIndex?: number;
  name: string;
  smiles: string;
  svg: string;
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

/** Borrador de sustituyente manual para un bloque de asignación. */
export interface SmileitManualSubstituentDraft extends SmileitManualSubstituentParams {}

/** Borrador de un bloque de asignación con sus referencias de catálogo y sustituyentes manuales. */
export interface SmileitAssignmentBlockDraft {
  id: string;
  label: string;
  siteAtomIndices: number[];
  categoryKeys: string[];
  catalogRefs: SmileitCatalogEntryView[];
  manualSubstituents: SmileitManualSubstituentDraft[];
  draftManualName: string;
  draftManualSmiles: string;
  draftManualAnchorIndicesText: string;
  draftManualSourceReference: string;
  draftManualCategoryKeys: string[];
}

/** Vista de cobertura de un sitio por un bloque. */
export interface SmileitSiteCoverageView {
  siteAtomIndex: number;
  blockId: string;
  blockLabel: string;
  priority: number;
  sourceCount: number;
}

/** Agrupación visual de entradas de catálogo por categoría. */
export interface SmileitCatalogGroupView {
  key: string;
  name: string;
  entries: SmileitCatalogEntryView[];
}

/** Tipo de notación química detectado heurísticamente. */
export type SmileitChemicalNotationKind = 'empty' | 'smiles' | 'smarts';

/** Vista previa del borrador de catálogo en curso de edición. */
export interface SmileitCatalogDraftPreview {
  name: string;
  smiles: string;
  sourceReference: string;
  anchorAtomIndices: number[];
  categoryKeys: string[];
  categoryNames: string[];
  notationKind: SmileitChemicalNotationKind;
  warnings: string[];
  isReady: boolean;
}

/** Borrador encolado de catálogo pendiente de creación en el servidor. */
export interface SmileitCatalogQueuedDraft {
  id: string;
  name: string;
  smiles: string;
  anchorAtomIndices: number[];
  categoryKeys: string[];
  categoryNames: string[];
  sourceReference: string;
}

/** Resumen colapsado de un bloque de asignación. */
export interface SmileitBlockCollapsedSummary {
  selectedSitesLabel: string;
  categoriesLabel: string;
  catalogSmilesLabel: string;
  manualSmilesLabel: string;
  sourceCount: number;
}

/** Datos finales del resultado de un job Smileit. */
export interface SmileitResultData {
  totalGenerated: number;
  generatedStructures: SmileitGeneratedStructureView[];
  truncated: boolean;
  principalSmiles: string;
  selectedAtomIndices: number[];
  assignmentBlocks: SmileitResolvedAssignmentBlockView[];
  traceabilityRows: SmileitTraceabilityRowView[];
  exportNameBase: string;
  exportPadding: number;
  references: Record<string, Array<Record<string, unknown>>>;
  isHistoricalSummary: boolean;
  summaryMessage: string | null;
}
