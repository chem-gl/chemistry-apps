// jobs-api.service.ts: Wrapper que encapsula el cliente generado de OpenAPI.
// Este servicio actua como fachada estable: protege al resto del frontend de cambios en
// el cliente generado y centraliza la logica de despacho, polling y streaming de progreso.

import { HttpClient, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, filter, interval, map, shareReplay, switchMap, take } from 'rxjs';
import { API_BASE_URL, JOBS_WEBSOCKET_URL } from '../shared/constants';
import {
  CalculatorJobCreateRequest,
  CalculatorJobResponse,
  CalculatorOperationEnum,
  CalculatorService,
  EasyRateJobResponse,
  EasyRateService,
  JobControlActionResponse,
  JobCreateRequest,
  JobLogList,
  JobProgressSnapshot,
  JobsService,
  MarcusJobResponse,
  MarcusService,
  MethodsEnum,
  MolarFractionsService,
  PatchedSmileitCatalogEntryCreateRequest,
  PatternTypeEnum,
  SAScoreService,
  SaMoleculeResult,
  SaScoreJobCreateRequest,
  SaScoreJobResponse,
  ScientificJob,
  SiteOverlapPolicyEnum,
  SmileitAssignmentBlockInputRequest,
  SmileitCatalogEntry,
  SmileitCatalogEntryCreateRequest,
  SmileitCategory,
  SmileitJobCreateRequest,
  SmileitJobResponse,
  SmileitManualSubstituentInputRequest,
  SmileitPatternEntry,
  SmileitPatternEntryCreateRequest,
  SmileitPatternReference,
  SmileitQuickProperties,
  SmileitResolvedAssignmentBlock,
  SmileitService,
  SmileitStructuralAnnotation,
  SmileitStructureInspectionRequestRequest,
  SmileitStructureInspectionResponse,
  SmileitSubstituentReferenceInputRequest,
  SmileitTraceabilityRow,
  TunnelService,
} from './generated';

/**
 * Parámetros de entrada para crear un job de calculadora.
 *
 * - `op`: operación a ejecutar. 'factorial' usa solo `a` e ignora `b`.
 * - `a`: primer operando (base en pow, único en factorial).
 * - `b`: segundo operando; obligatorio para add/sub/mul/div/pow; omitir en factorial.
 *
 * Ejemplos:
 *   `{ op: 'add', a: 5, b: 3 }`       → suma: 5 + 3
 *   `{ op: 'pow', a: 2, b: 10 }`      → potencia: 2^10
 *   `{ op: 'factorial', a: 7 }`        → factorial: 7!
 */
export interface CalculatorParams {
  op: CalculatorOperationEnum;
  a: number;
  b?: number;
}

/** Parámetros de entrada para crear un job de fracciones molares */
export interface MolarFractionsParams {
  pkaValues: number[];
  phMode: 'single' | 'range';
  phValue?: number;
  phMin?: number;
  phMax?: number;
  phStep?: number;
  version?: string;
}

/** Evento de modificación de una entrada de Tunnel capturado en UI */
export interface TunnelInputChangeEvent {
  fieldName: string;
  previousValue: number;
  newValue: number;
  changedAt: string;
}

/** Parámetros de entrada para crear un job de efecto túnel */
export interface TunnelParams {
  reactionBarrierZpe: number;
  imaginaryFrequency: number;
  reactionEnergyZpe: number;
  temperature: number;
  inputChangeEvents: TunnelInputChangeEvent[];
  version?: string;
}

/** Parámetros de entrada para crear un job Easy-rate con archivos Gaussian */
export interface EasyRateParams {
  transitionStateFile: File;
  reactant1File: File;
  reactant2File: File;
  product1File?: File;
  product2File?: File;
  transitionStateExecutionIndex?: number;
  reactant1ExecutionIndex?: number;
  reactant2ExecutionIndex?: number;
  product1ExecutionIndex?: number;
  product2ExecutionIndex?: number;
  title?: string;
  reactionPathDegeneracy?: number;
  cageEffects?: boolean;
  diffusion?: boolean;
  solvent?: string;
  customViscosity?: number;
  radiusReactant1?: number;
  radiusReactant2?: number;
  reactionDistance?: number;
  printDataInput?: boolean;
  version?: string;
}

/** Campos Gaussian soportados por Easy-rate para inspección y selección. */
export type EasyRateInputFieldName =
  | 'transition_state_file'
  | 'reactant_1_file'
  | 'reactant_2_file'
  | 'product_1_file'
  | 'product_2_file';

/** Resumen normalizado de una ejecución candidata detectada en un archivo Gaussian. */
export interface EasyRateInspectionExecutionView {
  sourceField: EasyRateInputFieldName;
  originalFilename: string | null;
  executionIndex: number;
  jobTitle: string | null;
  checkpointFile: string | null;
  charge: number;
  multiplicity: number;
  freeEnergy: number | null;
  thermalEnthalpy: number | null;
  zeroPointEnergy: number | null;
  scfEnergy: number | null;
  temperature: number | null;
  negativeFrequencies: number;
  imaginaryFrequency: number | null;
  normalTermination: boolean;
  isOptFreq: boolean;
  isValidForRole: boolean;
  validationErrors: string[];
}

/** Resultado de inspección previa de un archivo Gaussian en la UI de Easy-rate. */
export interface EasyRateFileInspectionView {
  sourceField: EasyRateInputFieldName;
  originalFilename: string | null;
  parseErrors: string[];
  executionCount: number;
  defaultExecutionIndex: number | null;
  executions: EasyRateInspectionExecutionView[];
}

interface EasyRateInspectionExecutionApiResponse {
  source_field: EasyRateInputFieldName;
  original_filename: string | null;
  execution_index: number;
  job_title: string | null;
  checkpoint_file: string | null;
  charge: number;
  multiplicity: number;
  free_energy: number | null;
  thermal_enthalpy: number | null;
  zero_point_energy: number | null;
  scf_energy: number | null;
  temperature: number | null;
  negative_frequencies: number;
  imaginary_frequency: number | null;
  normal_termination: boolean;
  is_opt_freq: boolean;
  is_valid_for_role: boolean;
  validation_errors: string[];
}

interface EasyRateInspectionApiResponse {
  source_field: EasyRateInputFieldName;
  original_filename: string | null;
  parse_errors: string[];
  execution_count: number;
  default_execution_index: number | null;
  executions: EasyRateInspectionExecutionApiResponse[];
}

/** Parámetros de entrada para crear un job Marcus con 6 archivos Gaussian */
export interface MarcusParams {
  reactant1File: File;
  reactant2File: File;
  product1AdiabaticFile: File;
  product2AdiabaticFile: File;
  product1VerticalFile: File;
  product2VerticalFile: File;
  title?: string;
  diffusion?: boolean;
  radiusReactant1?: number;
  radiusReactant2?: number;
  reactionDistance?: number;
  version?: string;
}

/** Métodos soportados para cálculo SA score en backend. */
export type SaScoreMethod = MethodsEnum;

/** Payload tipado para crear jobs de SA score desde UI. */
export interface SaScoreParams {
  smiles: string[];
  methods: SaScoreMethod[];
  version?: string;
}

/** Fila normalizada para la tabla de resultados de SA score. */
export type SaScoreMoleculeResultView = SaMoleculeResult;

/** Respuesta tipada de job SA score para workflows y componentes. */
export type SaScoreJobResponseView = SaScoreJobResponse;

/** Estados válidos para filtrado de jobs en listados globales */
export type JobListStatusFilter =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Filtros opcionales para consultar jobs en el monitor */
export interface JobListFilters {
  pluginName?: string;
  status?: JobListStatusFilter;
}

/** Parámetros genéricos para despachar jobs de cualquier app científica */
export interface ScientificJobDispatchParams {
  pluginName: string;
  version?: string;
  parameters: Record<string, unknown>;
}

/** Severidad de eventos de log por job emitidos por backend */
export type JobLogLevel = 'debug' | 'info' | 'warning' | 'error';

/** Evento de log normalizado para consumo de componentes/facades */
export interface JobLogEntryView {
  jobId: string;
  eventIndex: number;
  level: JobLogLevel;
  source: string;
  message: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

/** Parámetros de consulta para historial de logs por job */
export interface JobLogsQuery {
  afterEventIndex?: number;
  limit?: number;
}

/** Página de historial de logs normalizada */
export interface JobLogsPageView {
  jobId: string;
  count: number;
  nextAfterEventIndex: number;
  results: JobLogEntryView[];
}

/** Resultado normalizado de acciones de control de ejecución (pause/resume) */
export interface JobControlActionResult {
  detail: string;
  job: ScientificJob;
}

/** Representa un archivo descargable retornado por reportes backend */
export interface DownloadedReportFile {
  filename: string;
  blob: Blob;
}

// Tipos de vista exportados por la capa wrapper para evitar dependencias directas
// desde componentes/facades al cliente OpenAPI autogenerado.
export type ScientificJobView = ScientificJob;
export type JobProgressSnapshotView = JobProgressSnapshot;
export type CalculatorJobResponseView = CalculatorJobResponse;
export type EasyRateJobResponseView = EasyRateJobResponse;
export type MarcusJobResponseView = MarcusJobResponse;
export type CalculatorOperationView = CalculatorOperationEnum;

/** Entrada de catálogo de sustituyentes normalizada para la UI. */
export type SmileitCatalogEntryView = SmileitCatalogEntry;
export type SmileitCategoryView = SmileitCategory;
export type SmileitPatternEntryView = SmileitPatternEntry;
export type SmileitQuickPropertiesView = SmileitQuickProperties;
export type SmileitStructuralAnnotationView = SmileitStructuralAnnotation;
export type SmileitPatternReferenceView = SmileitPatternReference;
export type SmileitTraceabilityRowView = SmileitTraceabilityRow;
export type SmileitResolvedAssignmentBlockView = SmileitResolvedAssignmentBlock;

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

/** Respuesta de job smileit normalizada para componentes. */
export type SmileitJobResponseView = SmileitJobResponse;

export interface JobsRealtimeQuery {
  jobId?: string;
  pluginName?: string;
  includeLogs?: boolean;
  includeSnapshot?: boolean;
  activeOnly?: boolean;
}

export interface JobsSnapshotRealtimeEvent {
  event: 'jobs.snapshot';
  data: {
    items: ScientificJob[];
  };
}

export interface JobUpdatedRealtimeEvent {
  event: 'job.updated';
  data: ScientificJob;
}

export interface JobProgressRealtimeEvent {
  event: 'job.progress';
  data: JobProgressSnapshot;
}

export interface JobLogRealtimeEvent {
  event: 'job.log';
  data: JobLogEntryView;
}

export type JobsRealtimeEvent =
  | JobsSnapshotRealtimeEvent
  | JobUpdatedRealtimeEvent
  | JobProgressRealtimeEvent
  | JobLogRealtimeEvent;

@Injectable({
  providedIn: 'root',
})
export class JobsApiService {
  private readonly httpClient = inject(HttpClient);
  private readonly calculatorClient = inject(CalculatorService);
  private readonly easyRateClient = inject(EasyRateService);
  private readonly marcusClient = inject(MarcusService);
  private readonly saScoreClient = inject(SAScoreService);
  private readonly smileitClient = inject(SmileitService);
  private readonly molarFractionsClient = inject(MolarFractionsService);
  private readonly tunnelClient = inject(TunnelService);
  private readonly jobsClient = inject(JobsService);

  // ---------------------------------------------------------------------------
  // Smileit API
  // ---------------------------------------------------------------------------

  /**
   * Devuelve el catálogo persistente y versionado de sustituyentes.
   * Usar para poblar la lista inicial y referencias inmutables por bloque.
   */
  listSmileitCatalog(): Observable<SmileitCatalogEntryView[]> {
    return this.smileitClient.smileitJobsCatalogList().pipe(shareReplay(1));
  }

  /** Devuelve las categorías químicas verificables para filtros y validación. */
  listSmileitCategories(): Observable<SmileitCategoryView[]> {
    return this.smileitClient.smileitJobsCategoriesList().pipe(shareReplay(1));
  }

  /** Devuelve el catálogo de patrones estructurales activos para anotación visual. */
  listSmileitPatterns(): Observable<SmileitPatternEntryView[]> {
    return this.smileitClient.smileitJobsPatternsList().pipe(shareReplay(1));
  }

  /** Crea una nueva entrada persistente en el catálogo de sustituyentes. */
  createSmileitCatalogEntry(
    params: SmileitCatalogEntryCreateParams,
  ): Observable<SmileitCatalogEntryView[]> {
    const payload: SmileitCatalogEntryCreateRequest = {
      name: params.name,
      smiles: params.smiles,
      anchor_atom_indices: params.anchorAtomIndices,
      category_keys: params.categoryKeys,
      source_reference: params.sourceReference,
      provenance_metadata: params.provenanceMetadata,
    };

    return this.smileitClient.smileitJobsCatalogCreate(payload).pipe(shareReplay(1));
  }

  /** Versiona una entrada editable del catálogo y retorna el catálogo activo actualizado. */
  updateSmileitCatalogEntry(
    stableId: string,
    params: SmileitCatalogEntryCreateParams,
  ): Observable<SmileitCatalogEntryView[]> {
    const payload: PatchedSmileitCatalogEntryCreateRequest = {
      name: params.name,
      smiles: params.smiles,
      anchor_atom_indices: params.anchorAtomIndices,
      category_keys: params.categoryKeys,
      source_reference: params.sourceReference,
      provenance_metadata: params.provenanceMetadata,
    };

    return this.smileitClient
      .smileitJobsCatalogPartialUpdate(stableId, payload)
      .pipe(shareReplay(1));
  }

  /** Crea un nuevo patrón persistente para anotación estructural. */
  createSmileitPatternEntry(
    params: SmileitPatternEntryCreateParams,
  ): Observable<SmileitPatternEntryView[]> {
    const payload: SmileitPatternEntryCreateRequest = {
      name: params.name,
      smarts: params.smarts,
      pattern_type: params.patternType,
      caption: params.caption,
      source_reference: params.sourceReference,
      provenance_metadata: params.provenanceMetadata,
    };

    return this.smileitClient.smileitJobsPatternsCreate(payload).pipe(shareReplay(1));
  }

  /**
   * Inspecciona un SMILES y devuelve la estructura canónica, átomos indexados y SVG.
   * Usar para que el usuario seleccione los átomos de sustitución antes de despachar el job.
   */
  inspectSmileitStructure(smiles: string): Observable<SmileitStructureInspectionView> {
    const request: SmileitStructureInspectionRequestRequest = { smiles };
    return this.smileitClient.smileitJobsInspectStructureCreate(request).pipe(
      map(
        (raw: SmileitStructureInspectionResponse): SmileitStructureInspectionView => ({
          canonicalSmiles: raw.canonical_smiles,
          atomCount: raw.atom_count,
          atoms: raw.atoms.map((atom) => ({
            index: atom.index,
            symbol: atom.symbol,
            implicitHydrogens: atom.implicit_hydrogens,
            isAromatic: atom.is_aromatic,
          })),
          svg: raw.svg,
          quickProperties: raw.quick_properties,
          annotations: raw.annotations,
          activePatternRefs: raw.active_pattern_refs,
        }),
      ),
      shareReplay(1),
    );
  }

  /**
   * Despacha un job de generación combinatoria smileit.
   * Retorna el job creado con status 'pending'; usar streamJobEvents() para progreso.
   */
  dispatchSmileitJob(params: SmileitGenerationParams): Observable<SmileitJobResponseView> {
    const payload: SmileitJobCreateRequest = {
      version: params.version ?? '2.0.0',
      principal_smiles: params.principalSmiles,
      selected_atom_indices: params.selectedAtomIndices,
      assignment_blocks: params.assignmentBlocks.map(
        (block: SmileitAssignmentBlockParams): SmileitAssignmentBlockInputRequest => ({
          label: block.label,
          site_atom_indices: block.siteAtomIndices,
          category_keys: block.categoryKeys,
          substituent_refs: block.substituentRefs.map(
            (
              reference: SmileitSubstituentReferenceParams,
            ): SmileitSubstituentReferenceInputRequest => ({
              stable_id: reference.stableId,
              version: reference.version,
            }),
          ),
          manual_substituents: block.manualSubstituents.map(
            (manual: SmileitManualSubstituentParams): SmileitManualSubstituentInputRequest => ({
              name: manual.name,
              smiles: manual.smiles,
              anchor_atom_indices: manual.anchorAtomIndices,
              categories: manual.categories,
              source_reference: manual.sourceReference,
              provenance_metadata: manual.provenanceMetadata,
            }),
          ),
        }),
      ),
      site_overlap_policy: params.siteOverlapPolicy,
      r_substitutes: params.rSubstitutes,
      num_bonds: params.numBonds,
      max_structures: params.maxStructures,
      export_name_base: params.exportNameBase,
      export_padding: params.exportPadding,
    };
    return this.smileitClient.smileitJobsCreate(payload).pipe(shareReplay(1));
  }

  /** Consulta estado completo de un job smileit por UUID. */
  getSmileitJobStatus(jobId: string): Observable<SmileitJobResponseView> {
    return this.smileitClient.smileitJobsRetrieve(jobId);
  }

  /** Lista derivados Smile-it paginados para evitar payload gigante al frontend. */
  listSmileitDerivations(
    jobId: string,
    offset: number,
    limit: number,
  ): Observable<SmileitDerivationPageView> {
    const endpointUrl = `${API_BASE_URL}/api/smileit/jobs/${jobId}/derivations/`;
    return this.httpClient
      .get<{
        total_generated: number;
        offset: number;
        limit: number;
        items: Array<{
          structure_index: number;
          name: string;
          smiles: string;
          placeholder_assignments: Array<{
            placeholder_label: string;
            site_atom_index: number;
            substituent_name: string;
            substituent_smiles?: string;
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
        }>;
      }>(endpointUrl, {
        params: {
          offset: String(offset),
          limit: String(limit),
        },
      })
      .pipe(
        map((rawPage) => ({
          totalGenerated: rawPage.total_generated,
          offset: rawPage.offset,
          limit: rawPage.limit,
          items: rawPage.items.map((item) => ({
            structureIndex: item.structure_index,
            name: item.name,
            smiles: item.smiles,
            placeholderAssignments: item.placeholder_assignments.map((assignment) => ({
              placeholderLabel: assignment.placeholder_label,
              siteAtomIndex: assignment.site_atom_index,
              substituentName: assignment.substituent_name,
              substituentSmiles: assignment.substituent_smiles ?? '',
            })),
            traceability: item.traceability,
          })),
        })),
        shareReplay(1),
      );
  }

  /** Obtiene SVG on-demand de un derivado específico para grid/modal. */
  getSmileitDerivationSvg(
    jobId: string,
    structureIndex: number,
    variant: 'thumb' | 'detail' = 'detail',
  ): Observable<string> {
    const endpointUrl = `${API_BASE_URL}/api/smileit/jobs/${jobId}/derivations/${structureIndex}/svg/`;
    return this.httpClient
      .get(endpointUrl, {
        responseType: 'text',
        params: {
          variant,
        },
      })
      .pipe(shareReplay(1));
  }

  /** Descarga el reporte CSV de smileit (listado de estructuras generadas). */
  downloadSmileitCsvReport(jobId: string): Observable<DownloadedReportFile> {
    return this.downloadReport(
      this.smileitClient.smileitJobsReportCsvRetrieve(jobId, 'response'),
      `smileit_${jobId}_report.csv`,
    );
  }

  /** Descarga el archivo enumerado de SMILES listo para DataWarrior u otros flujos. */
  downloadSmileitSmilesReport(jobId: string): Observable<DownloadedReportFile> {
    return this.downloadReport(
      this.smileitClient.smileitJobsReportSmilesRetrieve(jobId, 'response'),
      `smileit_${jobId}_structures.smi`,
    );
  }

  /** Descarga el reporte tabular de trazabilidad sitio -> sustituyente por derivado. */
  downloadSmileitTraceabilityReport(jobId: string): Observable<DownloadedReportFile> {
    return this.downloadReport(
      this.smileitClient.smileitJobsReportTraceabilityRetrieve(jobId, 'response'),
      `smileit_${jobId}_traceability.csv`,
    );
  }

  /** Descarga el reporte LOG de smileit (descripción de la generación). */
  downloadSmileitLogReport(jobId: string): Observable<DownloadedReportFile> {
    return this.downloadReport(
      this.smileitClient.smileitJobsReportLogRetrieve(jobId, 'response'),
      `smileit_${jobId}_report.log`,
    );
  }

  /** Descarga el reporte de error de smileit cuando el job falla. */
  downloadSmileitErrorReport(jobId: string): Observable<DownloadedReportFile> {
    return this.downloadReport(
      this.smileitClient.smileitJobsReportErrorRetrieve(jobId, 'response'),
      `smileit_${jobId}_error.txt`,
    );
  }

  /** Descarga ZIP server-side con imágenes SVG para jobs Smile-it muy grandes. */
  downloadSmileitImagesZipServer(jobId: string): Observable<DownloadedReportFile> {
    const endpointUrl = `${API_BASE_URL}/api/smileit/jobs/${jobId}/report-images-zip/`;
    return this.downloadReport(
      this.httpClient.get(endpointUrl, {
        observe: 'response',
        responseType: 'blob',
      }),
      `smileit_${jobId}_images.zip`,
    );
  }

  private normalizeScientificJob(rawJob: ScientificJob): ScientificJob {
    return rawJob as ScientificJob;
  }

  private normalizeControlActionResult(
    rawResponse: JobControlActionResponse,
  ): JobControlActionResult {
    return {
      detail: rawResponse.detail,
      job: rawResponse.job as ScientificJob,
    };
  }

  private normalizeDownloadedReport(
    response: HttpResponse<Blob>,
    fallbackFilename: string,
  ): DownloadedReportFile {
    const responseBlob: Blob | null = response.body;
    if (responseBlob === null) {
      throw new Error('Backend report response is empty.');
    }

    const contentDispositionHeader: string | null = response.headers.get('content-disposition');
    const filename: string = this.extractFilenameFromHeader(
      contentDispositionHeader,
      fallbackFilename,
    );

    return {
      filename,
      blob: responseBlob,
    };
  }

  /**
   * Helper centralizado para descargar reportes desde cualquier endpoint generado.
   * Elimina la duplicación del patrón pipe(map → normalizeDownloadedReport, shareReplay).
   */
  private downloadReport(
    source$: Observable<HttpResponse<Blob>>,
    fallbackFilename: string,
  ): Observable<DownloadedReportFile> {
    return source$.pipe(
      map((response: HttpResponse<Blob>) =>
        this.normalizeDownloadedReport(response, fallbackFilename),
      ),
      shareReplay(1),
    );
  }

  private extractFilenameFromHeader(
    contentDispositionHeader: string | null,
    fallbackFilename: string,
  ): string {
    if (contentDispositionHeader === null) {
      return fallbackFilename;
    }

    const utf8Match: RegExpMatchArray | null =
      contentDispositionHeader.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match !== null) {
      const encodedFilename: string | undefined = utf8Match[1];
      if (encodedFilename !== undefined && encodedFilename.trim() !== '') {
        return decodeURIComponent(encodedFilename.trim());
      }
    }

    const regularMatch: RegExpMatchArray | null =
      contentDispositionHeader.match(/filename="?([^";]+)"?/i);
    if (regularMatch !== null) {
      const rawFilename: string | undefined = regularMatch[1];
      if (rawFilename !== undefined && rawFilename.trim() !== '') {
        return rawFilename.trim();
      }
    }

    return fallbackFilename;
  }

  private normalizeLogEntry(rawEvent: {
    job_id: string;
    event_index: number;
    level: string;
    source: string;
    message: string;
    payload: unknown;
    created_at: string;
  }): JobLogEntryView {
    const normalizedPayload: Record<string, unknown> =
      rawEvent.payload !== null &&
      typeof rawEvent.payload === 'object' &&
      !Array.isArray(rawEvent.payload)
        ? (rawEvent.payload as Record<string, unknown>)
        : {};

    const normalizedLevel: JobLogLevel =
      rawEvent.level === 'debug' || rawEvent.level === 'warning' || rawEvent.level === 'error'
        ? rawEvent.level
        : 'info';

    return {
      jobId: rawEvent.job_id,
      eventIndex: rawEvent.event_index,
      level: normalizedLevel,
      source: rawEvent.source,
      message: rawEvent.message,
      payload: normalizedPayload,
      createdAt: rawEvent.created_at,
    };
  }

  private normalizeEasyRateInspectionExecution(
    rawExecution: EasyRateInspectionExecutionApiResponse,
  ): EasyRateInspectionExecutionView {
    return {
      sourceField: rawExecution.source_field,
      originalFilename: rawExecution.original_filename,
      executionIndex: rawExecution.execution_index,
      jobTitle: rawExecution.job_title,
      checkpointFile: rawExecution.checkpoint_file,
      charge: rawExecution.charge,
      multiplicity: rawExecution.multiplicity,
      freeEnergy: rawExecution.free_energy,
      thermalEnthalpy: rawExecution.thermal_enthalpy,
      zeroPointEnergy: rawExecution.zero_point_energy,
      scfEnergy: rawExecution.scf_energy,
      temperature: rawExecution.temperature,
      negativeFrequencies: rawExecution.negative_frequencies,
      imaginaryFrequency: rawExecution.imaginary_frequency,
      normalTermination: rawExecution.normal_termination,
      isOptFreq: rawExecution.is_opt_freq,
      isValidForRole: rawExecution.is_valid_for_role,
      validationErrors: rawExecution.validation_errors,
    };
  }

  private normalizeEasyRateInspection(
    rawInspection: EasyRateInspectionApiResponse,
  ): EasyRateFileInspectionView {
    return {
      sourceField: rawInspection.source_field,
      originalFilename: rawInspection.original_filename,
      parseErrors: rawInspection.parse_errors,
      executionCount: rawInspection.execution_count,
      defaultExecutionIndex: rawInspection.default_execution_index,
      executions: rawInspection.executions.map((execution) =>
        this.normalizeEasyRateInspectionExecution(execution),
      ),
    };
  }

  private buildJobsRealtimeUrl(query: JobsRealtimeQuery = {}): string {
    const url: URL = new URL(JOBS_WEBSOCKET_URL);

    if (query.jobId !== undefined) {
      url.searchParams.set('job_id', query.jobId);
    }

    if (query.pluginName !== undefined) {
      url.searchParams.set('plugin_name', query.pluginName);
    }

    if (query.includeLogs !== undefined) {
      url.searchParams.set('include_logs', String(query.includeLogs));
    }

    if (query.includeSnapshot !== undefined) {
      url.searchParams.set('include_snapshot', String(query.includeSnapshot));
    }

    if (query.activeOnly !== undefined) {
      url.searchParams.set('active_only', String(query.activeOnly));
    }

    return url.toString();
  }

  private normalizeRealtimeEvent(rawEvent: unknown): JobsRealtimeEvent | null {
    if (rawEvent === null || typeof rawEvent !== 'object' || Array.isArray(rawEvent)) {
      return null;
    }

    const candidateEvent: Record<string, unknown> = rawEvent as Record<string, unknown>;
    const rawEventName: unknown = candidateEvent['event'];
    const rawData: unknown = candidateEvent['data'];

    if (typeof rawEventName !== 'string' || rawData === null || rawData === undefined) {
      return null;
    }

    if (rawEventName === 'jobs.snapshot') {
      const snapshotContainer: Record<string, unknown> | null =
        typeof rawData === 'object' && !Array.isArray(rawData)
          ? (rawData as Record<string, unknown>)
          : null;
      const rawItems: unknown[] = Array.isArray(snapshotContainer?.['items'])
        ? (snapshotContainer?.['items'] as unknown[])
        : [];

      return {
        event: 'jobs.snapshot',
        data: {
          items: rawItems.map((rawItem: unknown) =>
            this.normalizeScientificJob(rawItem as ScientificJob),
          ),
        },
      };
    }

    if (rawEventName === 'job.updated') {
      return {
        event: 'job.updated',
        data: this.normalizeScientificJob(rawData as ScientificJob),
      };
    }

    if (rawEventName === 'job.progress') {
      return {
        event: 'job.progress',
        data: rawData as JobProgressSnapshot,
      };
    }

    if (rawEventName === 'job.log') {
      return {
        event: 'job.log',
        data: this.normalizeLogEntry(
          rawData as {
            job_id: string;
            event_index: number;
            level: string;
            source: string;
            message: string;
            payload: unknown;
            created_at: string;
          },
        ),
      };
    }

    return null;
  }

  /**
   * Lista jobs globales del sistema con filtros opcionales por plugin y estado.
   * Se usa en el monitor para visualizar activos, completados y fallidos.
   */
  listJobs(filters: JobListFilters = {}): Observable<ScientificJob[]> {
    return this.jobsClient.jobsList(filters.pluginName, filters.status).pipe(shareReplay(1));
  }

  /**
   * Despacha un job científico genérico vía el endpoint core /api/jobs/.
   * Se usa para nuevas apps sin acoplar componentes al código generado.
   */
  dispatchScientificJob(params: ScientificJobDispatchParams): Observable<ScientificJob> {
    const payload: JobCreateRequest = {
      plugin_name: params.pluginName,
      version: params.version ?? '1.0.0',
      parameters: params.parameters,
    };
    return this.jobsClient.jobsCreate(payload).pipe(shareReplay(1));
  }

  /** Despacha un job de molar fractions vía API core desacoplada */
  dispatchMolarFractionsJob(params: MolarFractionsParams): Observable<ScientificJob> {
    const normalizedPkaValues: number[] = params.pkaValues.map((value) => Number(value));
    if (normalizedPkaValues.length < 1 || normalizedPkaValues.length > 6) {
      throw new Error('molar-fractions requiere entre 1 y 6 valores pKa.');
    }

    const payloadParameters: Record<string, unknown> = {
      pka_values: normalizedPkaValues,
      ph_mode: params.phMode,
    };

    if (params.phMode === 'single') {
      if (params.phValue === undefined) {
        throw new Error('phValue es obligatorio cuando phMode=single.');
      }
      payloadParameters['ph_value'] = Number(params.phValue);
    } else {
      if (params.phMin === undefined || params.phMax === undefined || params.phStep === undefined) {
        throw new Error('phMin, phMax y phStep son obligatorios cuando phMode=range.');
      }
      payloadParameters['ph_min'] = Number(params.phMin);
      payloadParameters['ph_max'] = Number(params.phMax);
      payloadParameters['ph_step'] = Number(params.phStep);
    }

    return this.dispatchScientificJob({
      pluginName: 'molar-fractions',
      version: params.version ?? '1.0.0',
      parameters: payloadParameters,
    });
  }

  /** Despacha un job de efecto túnel vía API core desacoplada */
  dispatchTunnelJob(params: TunnelParams): Observable<ScientificJob> {
    if (params.reactionBarrierZpe <= 0) {
      throw new Error('reactionBarrierZpe must be greater than zero.');
    }

    if (params.imaginaryFrequency <= 0) {
      throw new Error('imaginaryFrequency must be greater than zero.');
    }

    if (params.temperature <= 0) {
      throw new Error('temperature must be greater than zero.');
    }

    const payloadParameters: Record<string, unknown> = {
      reaction_barrier_zpe: Number(params.reactionBarrierZpe),
      imaginary_frequency: Number(params.imaginaryFrequency),
      reaction_energy_zpe: Number(params.reactionEnergyZpe),
      temperature: Number(params.temperature),
      input_change_events: params.inputChangeEvents.map((eventItem: TunnelInputChangeEvent) => ({
        field_name: eventItem.fieldName,
        previous_value: Number(eventItem.previousValue),
        new_value: Number(eventItem.newValue),
        changed_at: eventItem.changedAt,
      })),
    };

    return this.dispatchScientificJob({
      pluginName: 'tunnel-effect',
      version: params.version ?? '2.0.0',
      parameters: payloadParameters,
    });
  }

  /** Consulta un job científico genérico por id mediante /api/jobs/{id}/ */
  getScientificJobStatus(jobId: string): Observable<ScientificJob> {
    return this.jobsClient.jobsRetrieve(jobId);
  }

  /** Descarga el reporte CSV de molar fractions directamente desde backend */
  downloadMolarFractionsCsvReport(jobId: string): Observable<DownloadedReportFile> {
    return this.downloadReport(
      this.molarFractionsClient.molarFractionsJobsReportCsvRetrieve(jobId, 'response'),
      `molar_fractions_${jobId}_report.csv`,
    );
  }

  /** Descarga el reporte LOG de molar fractions directamente desde backend */
  downloadMolarFractionsLogReport(jobId: string): Observable<DownloadedReportFile> {
    return this.downloadReport(
      this.molarFractionsClient.molarFractionsJobsReportLogRetrieve(jobId, 'response'),
      `molar_fractions_${jobId}_report.log`,
    );
  }

  /** Descarga el reporte CSV de Tunnel directamente desde backend */
  downloadTunnelCsvReport(jobId: string): Observable<DownloadedReportFile> {
    return this.downloadReport(
      this.tunnelClient.tunnelJobsReportCsvRetrieve(jobId, 'response'),
      `tunnel_effect_${jobId}_report.csv`,
    );
  }

  /** Descarga el reporte LOG de Tunnel directamente desde backend */
  downloadTunnelLogReport(jobId: string): Observable<DownloadedReportFile> {
    return this.downloadReport(
      this.tunnelClient.tunnelJobsReportLogRetrieve(jobId, 'response'),
      `tunnel_effect_${jobId}_report.log`,
    );
  }

  /** Descarga el reporte de error de Tunnel cuando el job falla */
  downloadTunnelErrorReport(jobId: string): Observable<DownloadedReportFile> {
    return this.downloadReport(
      this.tunnelClient.tunnelJobsReportErrorRetrieve(jobId, 'response'),
      `tunnel_effect_${jobId}_error.txt`,
    );
  }

  /** Consulta historial de logs por job con cursor incremental */
  getJobLogs(jobId: string, query: JobLogsQuery = {}): Observable<JobLogsPageView> {
    return this.jobsClient.jobsLogsRetrieve(jobId, query.afterEventIndex, query.limit).pipe(
      map(
        (rawPage: JobLogList): JobLogsPageView => ({
          jobId: rawPage.job_id,
          count: rawPage.count,
          nextAfterEventIndex: rawPage.next_after_event_index,
          results: rawPage.results.map((rawEvent) => this.normalizeLogEntry(rawEvent)),
        }),
      ),
      shareReplay(1),
    );
  }

  /** Solicita pausa cooperativa de un job cuando su plugin lo permite */
  pauseJob(jobId: string): Observable<JobControlActionResult> {
    return this.jobsClient.jobsPauseCreate(jobId).pipe(
      map((rawResponse: JobControlActionResponse) =>
        this.normalizeControlActionResult(rawResponse),
      ),
      shareReplay(1),
    );
  }

  /** Reanuda un job pausado y dispara su reencolado */
  resumeJob(jobId: string): Observable<JobControlActionResult> {
    return this.jobsClient.jobsResumeCreate(jobId).pipe(
      map((rawResponse: JobControlActionResponse) =>
        this.normalizeControlActionResult(rawResponse),
      ),
      shareReplay(1),
    );
  }

  /** Cancela un job de forma irreversible (pending/running/paused -> cancelled) */
  cancelJob(jobId: string): Observable<JobControlActionResult> {
    return this.jobsClient.jobsCancelCreate(jobId).pipe(
      map((rawResponse: JobControlActionResponse) =>
        this.normalizeControlActionResult(rawResponse),
      ),
      shareReplay(1),
    );
  }

  /**
   * Despacha un job de calculadora al backend.
   * Si existe caché (job_hash conocido), el backend retorna resultado inmediato con status 'completed'.
   * En caso contrario el job queda 'pending' hasta que el worker Celery lo procese.
   *
   * Para monitorear el progreso usar `streamJobEvents()` o `pollJobUntilCompleted()`.
   */
  dispatchCalculatorJob(
    params: CalculatorParams,
    version: string = '1.0.0',
  ): Observable<CalculatorJobResponse> {
    const payload: CalculatorJobCreateRequest = {
      version,
      op: params.op,
      a: params.a,
      // Omitir b completamente cuando no aplica (factorial)
      ...(params.b !== undefined ? { b: params.b } : {}),
    };
    return this.calculatorClient.calculatorJobsCreate(payload).pipe(shareReplay(1));
  }

  /**
   * Consulta el estado completo y resultados de un job de calculadora.
   * Usar tras confirmar status 'completed' para obtener el CalculatorResult con tipos estrictos.
   */
  getJobStatus(jobId: string): Observable<CalculatorJobResponse> {
    return this.calculatorClient.calculatorJobsRetrieve(jobId);
  }

  /**
   * Obtiene un snapshot puntual del progreso del job: porcentaje, etapa y mensaje legible.
   * Util para polling manual o para sincronizar estado tras reconexion de stream SSE.
   *
   * Ejemplo: `getJobProgress('uuid').subscribe(s => console.log(s.progress_percentage))`.
   */
  getJobProgress(jobId: string): Observable<JobProgressSnapshot> {
    return this.jobsClient.jobsProgressRetrieve(jobId);
  }

  /**
   * Abre un stream SSE (Server-Sent Events) para recibir actualizaciones de progreso
   * en tiempo real. Emite `JobProgressSnapshot` en cada evento `job.progress` del backend.
   * El Observable completa automáticamente al recibir status 'completed' o 'failed'.
   * Si la conexión falla, emite error para que el consumidor active el fallback de polling.
   *
   * Usa la API nativa `EventSource` del navegador (compatible con todos los navegadores modernos).
   * El cliente generado por OpenAPI no es apto para SSE porque cierra la conexión al recibir
   * el primer chunk; por eso este método usa EventSource directamente.
   *
   * Ejemplo de uso en componente:
   * ```typescript
   * this.jobsApi.streamJobEvents(jobId).subscribe({
   *   next: snap  => this.progress.set(snap),
   *   complete: () => this.fetchFinalResult(jobId),
   *   error:    () => this.startPollingFallback(jobId),
   * });
   * ```
   */
  streamJobEvents(jobId: string): Observable<JobProgressSnapshot> {
    return new Observable<JobProgressSnapshot>((observer) => {
      const url = `${API_BASE_URL}/api/jobs/${jobId}/events/`;
      const source = new EventSource(url);

      source.addEventListener('job.progress', (rawEvent: Event) => {
        const messageEvent = rawEvent as MessageEvent<string>;
        try {
          const snapshot = JSON.parse(messageEvent.data) as JobProgressSnapshot;
          observer.next(snapshot);
          // El stream termina cuando el job llega a estado terminal
          if (
            snapshot.status === 'completed' ||
            snapshot.status === 'failed' ||
            snapshot.status === 'paused'
          ) {
            source.close();
            observer.complete();
          }
        } catch {
          // Ignorar eventos malformados; el stream continúa con el siguiente evento
        }
      });

      source.onerror = () => {
        source.close();
        observer.error(new Error('SSE connection error'));
      };

      // Teardown: el EventSource se cierra al cancelar la suscripcion (ngOnDestroy, etc.)
      return () => source.close();
    });
  }

  /** Abre stream SSE de logs en tiempo real para un job específico */
  streamJobLogEvents(jobId: string): Observable<JobLogEntryView> {
    return new Observable<JobLogEntryView>((observer) => {
      const url = `${API_BASE_URL}/api/jobs/${jobId}/logs/events/`;
      const source = new EventSource(url);

      source.addEventListener('job.log', (rawEvent: Event) => {
        const messageEvent = rawEvent as MessageEvent<string>;
        try {
          const parsedEvent = JSON.parse(messageEvent.data) as {
            job_id: string;
            event_index: number;
            level: string;
            source: string;
            message: string;
            payload: unknown;
            created_at: string;
          };
          observer.next(this.normalizeLogEntry(parsedEvent));
        } catch {
          // Ignorar eventos malformados y continuar escuchando.
        }
      });

      source.onerror = () => {
        source.close();
        observer.error(new Error('SSE logs connection error'));
      };

      return () => source.close();
    });
  }

  /** Abre stream WebSocket global o filtrado para jobs, progreso y logs. */
  streamJobsRealtime(query: JobsRealtimeQuery = {}): Observable<JobsRealtimeEvent> {
    return new Observable<JobsRealtimeEvent>((observer) => {
      const socket = new WebSocket(this.buildJobsRealtimeUrl(query));

      socket.onmessage = (messageEvent: MessageEvent<string>) => {
        try {
          const parsedPayload: unknown = JSON.parse(messageEvent.data);
          const normalizedEvent: JobsRealtimeEvent | null =
            this.normalizeRealtimeEvent(parsedPayload);
          if (normalizedEvent !== null) {
            observer.next(normalizedEvent);
          }
        } catch {
          // Ignorar frames malformados y continuar escuchando.
        }
      };

      socket.onerror = () => {
        observer.error(new Error('WebSocket jobs stream connection error'));
      };

      socket.onclose = () => {
        observer.complete();
      };

      return () => {
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close();
        }
      };
    });
  }

  /**
   * Polling de progreso mediante snapshots periódicos hasta estado terminal.
   * Retorna el `JobProgressSnapshot` final (completed o failed).
   * Alternativa robusta cuando SSE no está disponible o hay problemas de red.
   *
   * Ejemplo: `pollJobUntilCompleted('uuid', 1000).subscribe(snap => ...)`.
   */
  pollJobUntilCompleted(jobId: string, intervalMs: number = 1000): Observable<JobProgressSnapshot> {
    return interval(intervalMs).pipe(
      switchMap(() => this.getJobProgress(jobId)),
      filter((snap) => snap.status === 'completed' || snap.status === 'failed'),
      take(1),
    );
  }

  private appendOptionalString(formData: FormData, key: string, value: string | undefined): void {
    if (value === undefined) {
      return;
    }
    formData.append(key, value);
  }

  private appendOptionalNumber(formData: FormData, key: string, value: number | undefined): void {
    if (value === undefined) {
      return;
    }
    formData.append(key, String(value));
  }

  private appendOptionalBoolean(formData: FormData, key: string, value: boolean | undefined): void {
    if (value === undefined) {
      return;
    }
    formData.append(key, String(value));
  }

  private buildEasyRateMultipartPayload(params: EasyRateParams): FormData {
    const formData = new FormData();

    // Campos obligatorios del contrato estricto.
    formData.append('reactant_1_file', params.reactant1File);
    formData.append('reactant_2_file', params.reactant2File);
    formData.append('transition_state_file', params.transitionStateFile);

    // Al menos un producto es obligatorio; el workflow lo valida antes de invocar.
    if (params.product1File !== undefined) {
      formData.append('product_1_file', params.product1File);
    }
    if (params.product2File !== undefined) {
      formData.append('product_2_file', params.product2File);
    }

    this.appendOptionalNumber(
      formData,
      'reactant_1_execution_index',
      params.reactant1ExecutionIndex,
    );
    this.appendOptionalNumber(
      formData,
      'reactant_2_execution_index',
      params.reactant2ExecutionIndex,
    );
    this.appendOptionalNumber(
      formData,
      'transition_state_execution_index',
      params.transitionStateExecutionIndex,
    );
    this.appendOptionalNumber(formData, 'product_1_execution_index', params.product1ExecutionIndex);
    this.appendOptionalNumber(formData, 'product_2_execution_index', params.product2ExecutionIndex);

    this.appendOptionalString(formData, 'version', params.version ?? '2.0.0');
    this.appendOptionalString(formData, 'title', params.title);
    this.appendOptionalNumber(formData, 'reaction_path_degeneracy', params.reactionPathDegeneracy);
    this.appendOptionalBoolean(formData, 'cage_effects', params.cageEffects);
    this.appendOptionalBoolean(formData, 'diffusion', params.diffusion);
    this.appendOptionalString(formData, 'solvent', params.solvent);
    this.appendOptionalNumber(formData, 'custom_viscosity', params.customViscosity);
    this.appendOptionalNumber(formData, 'radius_reactant_1', params.radiusReactant1);
    this.appendOptionalNumber(formData, 'radius_reactant_2', params.radiusReactant2);
    this.appendOptionalNumber(formData, 'reaction_distance', params.reactionDistance);
    this.appendOptionalBoolean(formData, 'print_data_input', params.printDataInput);

    return formData;
  }

  /** Inspecciona un archivo Gaussian y devuelve ejecuciones candidatas para Easy-rate. */
  inspectEasyRateInput(
    sourceField: EasyRateInputFieldName,
    gaussianFile: File,
  ): Observable<EasyRateFileInspectionView> {
    const formData = new FormData();
    formData.append('source_field', sourceField);
    formData.append('gaussian_file', gaussianFile);

    return this.httpClient
      .post<EasyRateInspectionApiResponse>(
        `${API_BASE_URL}/api/easy-rate/jobs/inspect-input/`,
        formData,
      )
      .pipe(
        map((rawInspection: EasyRateInspectionApiResponse) =>
          this.normalizeEasyRateInspection(rawInspection),
        ),
        shareReplay(1),
      );
  }

  /** Despacha un job Easy-rate con archivos Gaussian en multipart */
  dispatchEasyRateJob(params: EasyRateParams): Observable<EasyRateJobResponse> {
    const payload = this.buildEasyRateMultipartPayload(params);
    return this.httpClient
      .post<EasyRateJobResponse>(`${API_BASE_URL}/api/easy-rate/jobs/`, payload)
      .pipe(shareReplay(1));
  }

  /** Consulta estado completo de un job Easy-rate por UUID */
  getEasyRateJobStatus(jobId: string): Observable<EasyRateJobResponse> {
    return this.easyRateClient.easyRateJobsRetrieve(jobId);
  }

  /** Descarga reporte CSV de Easy-rate */
  downloadEasyRateCsvReport(jobId: string): Observable<DownloadedReportFile> {
    return this.downloadReport(
      this.easyRateClient.easyRateJobsReportCsvRetrieve(jobId, 'response'),
      `easy_rate_${jobId}_report.csv`,
    );
  }

  /** Descarga reporte LOG de Easy-rate */
  downloadEasyRateLogReport(jobId: string): Observable<DownloadedReportFile> {
    return this.downloadReport(
      this.easyRateClient.easyRateJobsReportLogRetrieve(jobId, 'response'),
      `easy_rate_${jobId}_report.log`,
    );
  }

  /** Descarga reporte de error de Easy-rate */
  downloadEasyRateErrorReport(jobId: string): Observable<DownloadedReportFile> {
    return this.downloadReport(
      this.easyRateClient.easyRateJobsReportErrorRetrieve(jobId, 'response'),
      `easy_rate_${jobId}_error.txt`,
    );
  }

  /** Descarga ZIP de archivos de entrada originales de Easy-rate */
  downloadEasyRateInputsZip(jobId: string): Observable<DownloadedReportFile> {
    return this.downloadReport(
      this.easyRateClient.easyRateJobsReportInputsRetrieve(jobId, 'response'),
      `easy_rate_${jobId}_inputs.zip`,
    );
  }

  /** Despacha un job Marcus con 6 archivos Gaussian en multipart */
  dispatchMarcusJob(params: MarcusParams): Observable<MarcusJobResponse> {
    return this.marcusClient
      .marcusJobsCreate(
        params.reactant1File,
        params.reactant2File,
        params.product1AdiabaticFile,
        params.product2AdiabaticFile,
        params.product1VerticalFile,
        params.product2VerticalFile,
        params.version ?? '1.0.0',
        params.title,
        params.diffusion,
        params.radiusReactant1,
        params.radiusReactant2,
        params.reactionDistance,
      )
      .pipe(shareReplay(1));
  }

  /** Consulta estado completo de un job Marcus por UUID */
  getMarcusJobStatus(jobId: string): Observable<MarcusJobResponse> {
    return this.marcusClient.marcusJobsRetrieve(jobId);
  }

  /** Descarga reporte CSV de Marcus */
  downloadMarcusCsvReport(jobId: string): Observable<DownloadedReportFile> {
    return this.downloadReport(
      this.marcusClient.marcusJobsReportCsvRetrieve(jobId, 'response'),
      `marcus_${jobId}_report.csv`,
    );
  }

  /** Descarga reporte LOG de Marcus */
  downloadMarcusLogReport(jobId: string): Observable<DownloadedReportFile> {
    return this.downloadReport(
      this.marcusClient.marcusJobsReportLogRetrieve(jobId, 'response'),
      `marcus_${jobId}_report.log`,
    );
  }

  /** Descarga reporte de error de Marcus */
  downloadMarcusErrorReport(jobId: string): Observable<DownloadedReportFile> {
    return this.downloadReport(
      this.marcusClient.marcusJobsReportErrorRetrieve(jobId, 'response'),
      `marcus_${jobId}_error.txt`,
    );
  }

  /** Descarga ZIP de archivos de entrada originales de Marcus */
  downloadMarcusInputsZip(jobId: string): Observable<DownloadedReportFile> {
    return this.downloadReport(
      this.marcusClient.marcusJobsReportInputsRetrieve(jobId, 'response'),
      `marcus_${jobId}_inputs.zip`,
    );
  }

  /** Despacha un job SA score para una lista de SMILES y métodos seleccionados. */
  dispatchSaScoreJob(params: SaScoreParams): Observable<SaScoreJobResponseView> {
    const payload: SaScoreJobCreateRequest = {
      smiles: params.smiles,
      methods: params.methods,
      version: params.version ?? '1.0.0',
    };

    return this.saScoreClient.saScoreJobsCreate(payload).pipe(shareReplay(1));
  }

  /** Consulta estado completo de un job SA score por UUID. */
  getSaScoreJobStatus(jobId: string): Observable<SaScoreJobResponseView> {
    return this.saScoreClient.saScoreJobsRetrieve(jobId).pipe(shareReplay(1));
  }

  /** Descarga CSV completo (todas las columnas de métodos solicitados) para SA score. */
  downloadSaScoreCsvReport(jobId: string): Observable<DownloadedReportFile> {
    return this.downloadReport(
      this.saScoreClient.saScoreJobsReportCsvRetrieve(jobId, 'response'),
      `sa_score_${jobId}_report.csv`,
    );
  }

  /** Descarga CSV de un método específico con formato smiles,sa para SA score. */
  downloadSaScoreCsvMethodReport(
    jobId: string,
    method: SaScoreMethod,
  ): Observable<DownloadedReportFile> {
    return this.downloadReport(
      this.saScoreClient.saScoreJobsReportCsvMethodRetrieve(jobId, method, 'response'),
      `sa_score_${jobId}_${method}.csv`,
    );
  }
}
