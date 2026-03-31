// smileit-api.service.ts: Sub-servicio API exclusivo para operaciones Smileit.
// Encapsula catálogo, inspección estructural, validación, despacho y reportes.

import { HttpClient, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, forkJoin, map, of, shareReplay } from 'rxjs';
import { API_BASE_URL } from '../shared/constants';
import { createReportDownload$ } from './api-download.utils';
import {
  PatchedSmileitCatalogEntryCreateRequest,
  SmileitAssignmentBlockInputRequest,
  SmileitCatalogEntryCreateRequest,
  SmileitJobCreateRequest,
  SmileitManualSubstituentInputRequest,
  SmileitPatternEntryCreateRequest,
  SmileitService,
  SmileitStructureInspectionRequestRequest,
  SmileitStructureInspectionResponse,
  SmileitSubstituentReferenceInputRequest,
} from './generated';
import type {
  DownloadedReportFile,
  SmileitAssignmentBlockParams,
  SmileitCatalogEntryCreateParams,
  SmileitCatalogEntryView,
  SmileitCategoryView,
  SmileitDerivationPageView,
  SmileitGenerationParams,
  SmileitJobResponseView,
  SmileitManualSubstituentParams,
  SmileitPatternEntryCreateParams,
  SmileitPatternEntryView,
  SmileitStructureInspectionView,
  SmileitSubstituentReferenceParams,
  SmilesCompatibilityIssueView,
  SmilesCompatibilityResultView,
} from './types';

@Injectable({
  providedIn: 'root',
})
export class SmileitApiService {
  private readonly httpClient = inject(HttpClient);
  private readonly smileitClient = inject(SmileitService);

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
    return this.smileitClient
      .smileitJobsCatalogCreate(this.buildCatalogCreateRequest(params))
      .pipe(shareReplay(1));
  }

  /** Versiona una entrada editable del catálogo y retorna el catálogo activo actualizado. */
  updateSmileitCatalogEntry(
    stableId: string,
    params: SmileitCatalogEntryCreateParams,
  ): Observable<SmileitCatalogEntryView[]> {
    return this.smileitClient
      .smileitJobsCatalogPartialUpdate(stableId, this.buildCatalogPatchRequest(params))
      .pipe(shareReplay(1));
  }

  /** Crea un nuevo patrón persistente para anotación estructural. */
  createSmileitPatternEntry(
    params: SmileitPatternEntryCreateParams,
  ): Observable<SmileitPatternEntryView[]> {
    return this.smileitClient
      .smileitJobsPatternsCreate(this.buildPatternEntryRequest(params))
      .pipe(shareReplay(1));
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
   * Verifica compatibilidad estructural de todos los SMILES antes de despachar jobs.
   * Reutiliza el endpoint de inspección como validador central y reporta incompatibilidades.
   */
  validateSmilesCompatibility(smilesList: string[]): Observable<SmilesCompatibilityResultView> {
    const normalizedSmiles: string[] = smilesList
      .map((rawSmiles: string) => rawSmiles.trim())
      .filter((rawSmiles: string) => rawSmiles.length > 0);

    if (normalizedSmiles.length === 0) {
      return of({ compatible: true, issues: [] });
    }

    const validationRequests: Array<Observable<SmilesCompatibilityIssueView | null>> =
      normalizedSmiles.map((smilesValue: string) =>
        this.inspectSmileitStructure(smilesValue).pipe(
          map(() => null),
          catchError((validationError: unknown) =>
            of({
              smiles: smilesValue,
              reason: this.extractErrorMessage(validationError),
            }),
          ),
        ),
      );

    return forkJoin(validationRequests).pipe(
      map((issuesOrNull: Array<SmilesCompatibilityIssueView | null>) => {
        const issues: SmilesCompatibilityIssueView[] = issuesOrNull.filter(
          (
            issueItem: SmilesCompatibilityIssueView | null,
          ): issueItem is SmilesCompatibilityIssueView => issueItem !== null,
        );
        return {
          compatible: issues.length === 0,
          issues,
        };
      }),
    );
  }

  private extractErrorMessage(error: unknown): string {
    if (typeof error === 'string' && error.trim() !== '') {
      return error;
    }

    if (error !== null && typeof error === 'object') {
      const errorRecord: Record<string, unknown> = error as Record<string, unknown>;
      const directMessage = errorRecord['message'];
      if (typeof directMessage === 'string' && directMessage.trim() !== '') {
        return directMessage;
      }

      const nestedError = errorRecord['error'];
      if (nestedError !== null && typeof nestedError === 'object') {
        const nestedRecord: Record<string, unknown> = nestedError as Record<string, unknown>;
        const detailMessage = nestedRecord['detail'];
        if (typeof detailMessage === 'string' && detailMessage.trim() !== '') {
          return detailMessage;
        }
      }
    }

    return 'Unsupported SMILES for chemistry services.';
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
        params: { variant },
      })
      .pipe(shareReplay(1));
  }

  /** Descarga el reporte CSV de smileit (listado de estructuras generadas). */
  downloadSmileitCsvReport(jobId: string): Observable<DownloadedReportFile> {
    return this.downloadReportFile$(
      this.smileitClient.smileitJobsReportCsvRetrieve(jobId, 'response'),
      `smileit_${jobId}_report.csv`,
    );
  }

  /** Descarga el archivo enumerado de SMILES listo para DataWarrior u otros flujos. */
  downloadSmileitSmilesReport(jobId: string): Observable<DownloadedReportFile> {
    return this.downloadReportFile$(
      this.smileitClient.smileitJobsReportSmilesRetrieve(jobId, 'response'),
      `smileit_${jobId}_structures.smi`,
    );
  }

  /** Descarga el reporte tabular de trazabilidad sitio -> sustituyente por derivado. */
  downloadSmileitTraceabilityReport(jobId: string): Observable<DownloadedReportFile> {
    return this.downloadReportFile$(
      this.smileitClient.smileitJobsReportTraceabilityRetrieve(jobId, 'response'),
      `smileit_${jobId}_traceability.csv`,
    );
  }

  /** Descarga el reporte LOG de smileit (descripción de la generación). */
  downloadSmileitLogReport(jobId: string): Observable<DownloadedReportFile> {
    return this.downloadReportFile$(
      this.smileitClient.smileitJobsReportLogRetrieve(jobId, 'response'),
      `smileit_${jobId}_report.log`,
    );
  }

  /** Descarga el reporte de error de smileit cuando el job falla. */
  downloadSmileitErrorReport(jobId: string): Observable<DownloadedReportFile> {
    return this.downloadReportFile$(
      this.smileitClient.smileitJobsReportErrorRetrieve(jobId, 'response'),
      `smileit_${jobId}_error.txt`,
    );
  }

  /** Descarga ZIP server-side con imágenes SVG para jobs Smile-it muy grandes. */
  downloadSmileitImagesZipServer(jobId: string): Observable<DownloadedReportFile> {
    const endpointUrl = `${API_BASE_URL}/api/smileit/jobs/${jobId}/report-images-zip/`;
    return this.downloadReportFile$(
      this.httpClient.get(endpointUrl, {
        observe: 'response',
        responseType: 'blob',
      }),
      `smileit_${jobId}_images.zip`,
    );
  }

  private buildCatalogCreateRequest(
    params: SmileitCatalogEntryCreateParams,
  ): SmileitCatalogEntryCreateRequest {
    return {
      name: params.name,
      smiles: params.smiles,
      anchor_atom_indices: params.anchorAtomIndices,
      category_keys: params.categoryKeys,
      source_reference: params.sourceReference,
      provenance_metadata: params.provenanceMetadata,
    };
  }

  private buildCatalogPatchRequest(
    params: SmileitCatalogEntryCreateParams,
  ): PatchedSmileitCatalogEntryCreateRequest {
    return {
      anchor_atom_indices: params.anchorAtomIndices,
      category_keys: params.categoryKeys,
      provenance_metadata: params.provenanceMetadata,
      smiles: params.smiles,
      source_reference: params.sourceReference,
      name: params.name,
    };
  }

  private buildPatternEntryRequest(
    params: SmileitPatternEntryCreateParams,
  ): SmileitPatternEntryCreateRequest {
    return {
      name: params.name,
      smarts: params.smarts,
      pattern_type: params.patternType,
      caption: params.caption,
      source_reference: params.sourceReference,
      provenance_metadata: params.provenanceMetadata,
    };
  }

  private downloadReportFile$(
    report$: Observable<HttpResponse<Blob>>,
    filename: string,
  ): Observable<DownloadedReportFile> {
    return createReportDownload$(report$, filename);
  }
}
