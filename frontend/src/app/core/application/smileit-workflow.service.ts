// smileit-workflow.service.ts: Fachada del flujo Smileit con estructura, ejecución, historial y reportes.
// Re-expone señales del estado centralizado y delega operaciones de catálogo y bloques a sub-servicios.
// Los consumidores acceden a las señales directamente (workflow.principalSmiles()) y a sub-servicios
// a través de las propiedades públicas (workflow.catalog.xxx(), workflow.blocks.xxx()).

import { Injectable, OnDestroy, inject } from '@angular/core';
import { Observable, Subscription, catchError, finalize, throwError } from 'rxjs';
import { SiteOverlapPolicyEnum } from '../api/generated';
import type {
  DownloadedReportFile,
  JobLogEntryView,
  JobLogsPageView,
  JobProgressSnapshotView,
  ScientificJobView,
  SmileitAssignmentBlockParams,
  SmileitGenerationParams,
  SmileitJobResponseView,
  SmileitManualSubstituentParams,
  SmileitStructureInspectionView,
} from '../api/jobs-api.service';
import { JobsApiService } from '../api/jobs-api.service';
import { SmileitApiService } from '../api/smileit-api.service';

import { SmileitBlockWorkflowService } from './smileit/smileit-block-workflow.service';
import { SmileitCatalogWorkflowService } from './smileit/smileit-catalog-workflow.service';
import { SmileitWorkflowState } from './smileit/smileit-workflow-state.service';
import type {
  SmileitAssignmentBlockDraft,
  SmileitManualSubstituentDraft,
  SmileitResultData,
} from './smileit/smileit-workflow.types';

// Re-exportar tipos públicos para que los consumidores existentes no cambien sus import paths.
export { SmileitBlockWorkflowService } from './smileit/smileit-block-workflow.service';
export { SmileitCatalogWorkflowService } from './smileit/smileit-catalog-workflow.service';
export { SmileitWorkflowState } from './smileit/smileit-workflow-state.service';
export type {
  SmileitAssignmentBlockDraft,
  SmileitBlockCollapsedSummary,
  SmileitCatalogDraftPreview,
  SmileitCatalogGroupView,
  SmileitCatalogQueuedDraft,
  SmileitChemicalNotationKind,
  SmileitGeneratedStructureView,
  SmileitManualSubstituentDraft,
  SmileitResultData,
  SmileitSection,
  SmileitSiteCoverageView,
} from './smileit/smileit-workflow.types';

@Injectable()
export class SmileitWorkflowService implements OnDestroy {
  // Constantes funcionales de Smileit para evitar duplicación y mantener un único punto de cambio.
  private readonly FIXED_NUM_BONDS: number = 1;
  private readonly FIXED_EXPORT_PADDING: number = 5;
  private readonly FIXED_SITE_OVERLAP_POLICY: SiteOverlapPolicyEnum =
    SiteOverlapPolicyEnum.LastBlockWins;
  private readonly FIXED_ALGORITHM_VERSION: string = '2.0.0';

  private readonly jobsApiService = inject(JobsApiService);
  private readonly smileitApiService = inject(SmileitApiService);
  private progressSubscription: Subscription | null = null;
  private logsSubscription: Subscription | null = null;

  // ── Sub-servicios públicos ────────────────────────────────────────────
  readonly state = inject(SmileitWorkflowState);
  readonly catalog = inject(SmileitCatalogWorkflowService);
  readonly blocks = inject(SmileitBlockWorkflowService);

  // ── Re-exportación de señales del estado para compatibilidad ──────────
  readonly principalSmiles = this.state.principalSmiles;
  readonly inspection = this.state.inspection;
  readonly selectedAtomIndices = this.state.selectedAtomIndices;
  readonly catalogEntries = this.state.catalogEntries;
  readonly categories = this.state.categories;
  readonly patterns = this.state.patterns;
  readonly assignmentBlocks = this.state.assignmentBlocks;
  readonly catalogCreateName = this.state.catalogCreateName;
  readonly catalogCreateSmiles = this.state.catalogCreateSmiles;
  readonly catalogCreateAnchorIndicesText = this.state.catalogCreateAnchorIndicesText;
  readonly catalogCreateCategoryKeys = this.state.catalogCreateCategoryKeys;
  readonly catalogCreateSourceReference = this.state.catalogCreateSourceReference;
  readonly catalogEditingStableId = this.state.catalogEditingStableId;
  readonly catalogDraftQueue = this.state.catalogDraftQueue;
  readonly patternCreateName = this.state.patternCreateName;
  readonly patternCreateSmarts = this.state.patternCreateSmarts;
  readonly patternCreateType = this.state.patternCreateType;
  readonly patternCreateCaption = this.state.patternCreateCaption;
  readonly patternCreateSourceReference = this.state.patternCreateSourceReference;
  readonly siteOverlapPolicy = this.state.siteOverlapPolicy;
  readonly rSubstitutes = this.state.rSubstitutes;
  readonly numBonds = this.state.numBonds;
  readonly maxStructures = this.state.maxStructures;
  readonly exportNameBase = this.state.exportNameBase;
  readonly exportPadding = this.state.exportPadding;
  readonly activeSection = this.state.activeSection;
  readonly currentJobId = this.state.currentJobId;
  readonly progressSnapshot = this.state.progressSnapshot;
  readonly jobLogs = this.state.jobLogs;
  readonly resultData = this.state.resultData;
  readonly errorMessage = this.state.errorMessage;
  readonly exportErrorMessage = this.state.exportErrorMessage;
  readonly isExporting = this.state.isExporting;
  readonly historyJobs = this.state.historyJobs;
  readonly isHistoryLoading = this.state.isHistoryLoading;

  // ── Computed re-exports ───────────────────────────────────────────────
  readonly isProcessing = this.state.isProcessing;
  readonly inspectionSvg = this.state.inspectionSvg;
  readonly quickProperties = this.state.quickProperties;
  readonly progressPercentage = this.state.progressPercentage;
  readonly progressMessage = this.state.progressMessage;
  readonly selectedSiteCoverage = this.state.selectedSiteCoverage;
  readonly uncoveredSelectedSites = this.state.uncoveredSelectedSites;
  readonly canConfigureGeneration = this.state.canConfigureGeneration;
  readonly canDispatch = this.state.canDispatch;
  readonly maxRSubstitutesByPositions = this.state.maxRSubstitutesByPositions;
  readonly isCatalogEditing = this.state.isCatalogEditing;
  readonly hasQueuedCatalogDrafts = this.state.hasQueuedCatalogDrafts;
  readonly catalogGroups = this.state.catalogGroups;
  readonly catalogDraftPreview = this.state.catalogDraftPreview;

  // ── Estructura principal ──────────────────────────────────────────────

  /** Inspecciona la molécula principal con el backend. */
  inspectPrincipalStructure(): void {
    const rawSmiles: string = this.state.principalSmiles().trim();
    if (rawSmiles === '') {
      this.state.activeSection.set('error');
      this.state.errorMessage.set('Principal SMILES is required before inspection.');
      return;
    }

    this.state.activeSection.set('inspecting');
    this.state.errorMessage.set(null);

    this.smileitApiService.inspectSmileitStructure(rawSmiles).subscribe({
      next: (inspectionResult: SmileitStructureInspectionView) => {
        this.state.inspection.set(inspectionResult);
        this.state.selectedAtomIndices.update((currentSelection: number[]) =>
          currentSelection.filter((atomIndex: number) => atomIndex < inspectionResult.atomCount),
        );
        this.blocks.pruneBlocksToSelectedSites();
        this.state.activeSection.set('idle');
      },
      error: (requestError: Error) => {
        this.state.activeSection.set('error');
        this.state.errorMessage.set(
          `Unable to inspect principal structure: ${requestError.message}`,
        );
      },
    });
  }

  /** Alterna la selección de un átomo en la estructura principal. */
  toggleSelectedAtom(atomIndex: number): void {
    this.state.selectedAtomIndices.update((currentSelection: number[]) => {
      const nextSelection: number[] = currentSelection.includes(atomIndex)
        ? currentSelection.filter((item: number) => item !== atomIndex)
        : [...currentSelection, atomIndex];
      return nextSelection.sort((left: number, right: number) => left - right);
    });
    this.blocks.pruneBlocksToSelectedSites();
  }

  // ── Parámetros de generación ──────────────────────────────────────────

  setRSubstitutes(rawValue: number): void {
    const maxAllowed: number = this.state.maxRSubstitutesByPositions();
    const clampedValue: number = Math.max(1, Math.min(maxAllowed, Math.trunc(rawValue)));
    this.state.rSubstitutes.set(clampedValue);
  }

  setNumBonds(_rawValue: number): void {
    this.state.numBonds.set(this.FIXED_NUM_BONDS);
  }

  setMaxStructures(rawValue: number): void {
    this.state.maxStructures.set(Math.max(0, Math.trunc(rawValue)));
  }

  setExportPadding(_rawValue: number): void {
    this.state.exportPadding.set(this.FIXED_EXPORT_PADDING);
  }

  // ── Patrones (delegación con re-inspección) ───────────────────────────

  /** Crea un patrón y re-inspecciona la estructura principal si corresponde. */
  createPatternEntry(): void {
    this.catalog.createPatternEntry(() => {
      if (this.state.principalSmiles().trim() !== '') {
        this.inspectPrincipalStructure();
      }
    });
  }

  // ── Ejecución ─────────────────────────────────────────────────────────

  /** Despacha un job Smileit al backend. */
  dispatch(): void {
    if (!this.state.canDispatch()) {
      this.state.activeSection.set('error');
      this.state.errorMessage.set(
        'Every selected site must be covered by at least one effective Smile-it assignment block before dispatch.',
      );
      return;
    }

    this.progressSubscription?.unsubscribe();
    this.logsSubscription?.unsubscribe();

    this.state.activeSection.set('dispatching');
    this.state.errorMessage.set(null);
    this.state.exportErrorMessage.set(null);
    this.state.resultData.set(null);
    this.state.progressSnapshot.set(null);
    this.state.jobLogs.set([]);
    this.state.currentJobId.set(null);

    const dispatchParams: SmileitGenerationParams = this.buildDispatchParams();

    this.smileitApiService.dispatchSmileitJob(dispatchParams).subscribe({
      next: (jobResponse: SmileitJobResponseView) => {
        this.state.currentJobId.set(jobResponse.id);

        if (jobResponse.status === 'completed') {
          const immediateResultData: SmileitResultData | null = this.extractResultData(jobResponse);
          if (immediateResultData === null) {
            this.state.activeSection.set('error');
            this.state.errorMessage.set(
              'Completed job payload is invalid for Smileit result rendering.',
            );
            return;
          }
          this.state.resultData.set(immediateResultData);
          this.loadHistoricalLogs(jobResponse.id);
          this.state.activeSection.set('result');
          this.loadHistory();
          return;
        }

        this.state.activeSection.set('progress');
        this.startProgressStream(jobResponse.id);
      },
      error: (dispatchError: Error) => {
        this.state.activeSection.set('error');
        this.state.errorMessage.set(`Unable to create Smileit job: ${dispatchError.message}`);
      },
    });
  }

  /** Reinicia el flujo al estado idle. */
  reset(): void {
    this.progressSubscription?.unsubscribe();
    this.logsSubscription?.unsubscribe();

    this.state.activeSection.set('idle');
    this.state.currentJobId.set(null);
    this.state.progressSnapshot.set(null);
    this.state.jobLogs.set([]);
    this.state.resultData.set(null);
    this.state.errorMessage.set(null);
    this.state.exportErrorMessage.set(null);
  }

  // ── Historial ─────────────────────────────────────────────────────────

  /** Abre un job histórico para visualización. */
  openHistoricalJob(jobId: string): void {
    this.progressSubscription?.unsubscribe();
    this.logsSubscription?.unsubscribe();

    this.state.activeSection.set('dispatching');
    this.state.errorMessage.set(null);
    this.state.exportErrorMessage.set(null);
    this.state.currentJobId.set(jobId);
    this.state.jobLogs.set([]);

    this.smileitApiService.getSmileitJobStatus(jobId).subscribe({
      next: (jobResponse: SmileitJobResponseView) => {
        if (jobResponse.status === 'failed') {
          this.loadHistoricalLogs(jobId);
          this.state.activeSection.set('error');
          this.state.errorMessage.set(
            jobResponse.error_trace ?? 'Historical Smileit job ended with error.',
          );
          return;
        }
        const historicalData: SmileitResultData | null =
          this.extractResultData(jobResponse) ?? this.extractSummaryData(jobResponse);
        if (historicalData === null) {
          this.state.activeSection.set('error');
          this.state.errorMessage.set('Unable to reconstruct historical Smileit result.');
          return;
        }
        this.state.resultData.set(historicalData);
        this.loadHistoricalLogs(jobId);
        this.state.activeSection.set('result');
      },
      error: (statusError: Error) => {
        this.state.activeSection.set('error');
        this.state.errorMessage.set(
          `Unable to recover Smileit historical job: ${statusError.message}`,
        );
      },
    });
  }

  /** Carga la lista de jobs históricos de Smileit. */
  loadHistory(): void {
    this.state.isHistoryLoading.set(true);

    this.jobsApiService.listJobs({ pluginName: 'smileit' }).subscribe({
      next: (jobItems: ScientificJobView[]) => {
        const orderedJobs: ScientificJobView[] = [...jobItems].sort(
          (leftJob: ScientificJobView, rightJob: ScientificJobView) =>
            new Date(rightJob.updated_at).getTime() - new Date(leftJob.updated_at).getTime(),
        );
        this.state.historyJobs.set(orderedJobs);
        this.state.isHistoryLoading.set(false);
      },
      error: () => {
        this.state.isHistoryLoading.set(false);
      },
    });
  }

  // ── Descarga de reportes ──────────────────────────────────────────────

  downloadCsvReport(): Observable<DownloadedReportFile> {
    return this.downloadCurrentReport(
      (jobId: string) => this.smileitApiService.downloadSmileitCsvReport(jobId),
      'CSV',
    );
  }

  downloadSmilesReport(): Observable<DownloadedReportFile> {
    return this.downloadCurrentReport(
      (jobId: string) => this.smileitApiService.downloadSmileitSmilesReport(jobId),
      'SMILES',
    );
  }

  downloadTraceabilityReport(): Observable<DownloadedReportFile> {
    return this.downloadCurrentReport(
      (jobId: string) => this.smileitApiService.downloadSmileitTraceabilityReport(jobId),
      'traceability',
    );
  }

  downloadLogReport(): Observable<DownloadedReportFile> {
    return this.downloadCurrentReport(
      (jobId: string) => this.smileitApiService.downloadSmileitLogReport(jobId),
      'LOG',
    );
  }

  downloadErrorReport(): Observable<DownloadedReportFile> {
    return this.downloadCurrentReport(
      (jobId: string) => this.smileitApiService.downloadSmileitErrorReport(jobId),
      'error',
    );
  }

  ngOnDestroy(): void {
    this.progressSubscription?.unsubscribe();
    this.logsSubscription?.unsubscribe();
  }

  // ── Helpers privados ──────────────────────────────────────────────────

  private downloadCurrentReport(
    downloadFactory: (jobId: string) => Observable<DownloadedReportFile>,
    reportLabel: string,
  ): Observable<DownloadedReportFile> {
    const selectedJobId: string | null = this.state.currentJobId();
    if (selectedJobId === null || selectedJobId.trim() === '') {
      throw new Error(`No Smileit job selected for ${reportLabel} export.`);
    }

    this.state.exportErrorMessage.set(null);
    this.state.isExporting.set(true);

    return downloadFactory(selectedJobId).pipe(
      finalize(() => this.state.isExporting.set(false)),
      catchError((requestError: unknown) => {
        const normalizedErrorMessage: string =
          requestError instanceof Error
            ? requestError.message
            : `Unknown error while downloading Smileit ${reportLabel} report.`;
        this.state.exportErrorMessage.set(
          `Unable to download ${reportLabel} report: ${normalizedErrorMessage}`,
        );
        return throwError(() => requestError);
      }),
    );
  }

  private buildDispatchParams(): SmileitGenerationParams {
    return {
      principalSmiles: this.state.principalSmiles().trim(),
      selectedAtomIndices: [...this.state.selectedAtomIndices()],
      assignmentBlocks: this.state.assignmentBlocks().map(
        (block: SmileitAssignmentBlockDraft): SmileitAssignmentBlockParams => ({
          label: block.label.trim() || 'Unnamed block',
          siteAtomIndices: block.siteAtomIndices,
          categoryKeys: [...block.categoryKeys],
          substituentRefs: block.catalogRefs.map(
            (entry: { stable_id: string; version: number }) => ({
              stableId: entry.stable_id,
              version: entry.version,
            }),
          ),
          manualSubstituents: block.manualSubstituents.map(
            (entry: SmileitManualSubstituentDraft): SmileitManualSubstituentParams => ({
              name: entry.name,
              smiles: entry.smiles,
              anchorAtomIndices: entry.anchorAtomIndices,
              categories: [...entry.categories],
              sourceReference: entry.sourceReference,
              provenanceMetadata: entry.provenanceMetadata,
            }),
          ),
        }),
      ),
      siteOverlapPolicy: this.FIXED_SITE_OVERLAP_POLICY,
      rSubstitutes: this.state.rSubstitutes(),
      numBonds: this.FIXED_NUM_BONDS,
      maxStructures: this.state.maxStructures(),
      exportNameBase: this.state.exportNameBase().trim() || 'smileit_run',
      exportPadding: this.FIXED_EXPORT_PADDING,
      version: this.FIXED_ALGORITHM_VERSION,
    };
  }

  private startProgressStream(jobId: string): void {
    this.startLogsStream(jobId);

    this.progressSubscription = this.jobsApiService.streamJobEvents(jobId).subscribe({
      next: (snapshot: JobProgressSnapshotView) => this.state.progressSnapshot.set(snapshot),
      complete: () => this.fetchFinalResult(jobId),
      error: () => this.startPollingFallback(jobId),
    });
  }

  private startLogsStream(jobId: string): void {
    this.logsSubscription?.unsubscribe();

    this.logsSubscription = this.jobsApiService.streamJobLogEvents(jobId).subscribe({
      next: (logEntry: JobLogEntryView) => {
        this.state.jobLogs.update((currentLogs: JobLogEntryView[]) => {
          if (
            currentLogs.some((item: JobLogEntryView) => item.eventIndex === logEntry.eventIndex)
          ) {
            return currentLogs;
          }
          return [...currentLogs, logEntry].sort(
            (leftEntry: JobLogEntryView, rightEntry: JobLogEntryView) =>
              leftEntry.eventIndex - rightEntry.eventIndex,
          );
        });
      },
      error: () => {
        // Mantener funcional la UI incluso si falla la suscripción SSE de logs.
      },
    });
  }

  private loadHistoricalLogs(jobId: string): void {
    this.jobsApiService.getJobLogs(jobId, { limit: 250 }).subscribe({
      next: (logsPage: JobLogsPageView) => this.state.jobLogs.set(logsPage.results),
      error: () => {
        // Si falla la carga de logs históricos, el resultado principal sigue visible.
      },
    });
  }

  private startPollingFallback(jobId: string): void {
    this.progressSubscription = this.jobsApiService.pollJobUntilCompleted(jobId, 1000).subscribe({
      next: (snapshot: JobProgressSnapshotView) => {
        this.state.progressSnapshot.set(snapshot);
        this.fetchFinalResult(jobId);
      },
      error: (pollingError: Error) => {
        this.state.activeSection.set('error');
        this.state.errorMessage.set(`Unable to track Smileit progress: ${pollingError.message}`);
      },
    });
  }

  private fetchFinalResult(jobId: string): void {
    this.smileitApiService.getSmileitJobStatus(jobId).subscribe({
      next: (jobResponse: SmileitJobResponseView) => {
        if (jobResponse.status === 'failed') {
          this.loadHistoricalLogs(jobId);
          this.state.activeSection.set('error');
          this.state.errorMessage.set(
            jobResponse.error_trace ?? 'Smileit job ended without details.',
          );
          this.loadHistory();
          return;
        }
        const finalData: SmileitResultData | null =
          this.extractResultData(jobResponse) ?? this.extractSummaryData(jobResponse);
        if (finalData === null) {
          this.state.activeSection.set('error');
          this.state.errorMessage.set('Unable to parse Smileit final result payload.');
          this.loadHistory();
          return;
        }
        this.state.resultData.set(finalData);
        this.loadHistoricalLogs(jobId);
        this.state.activeSection.set('result');
        this.loadHistory();
      },
      error: (resultError: Error) => {
        this.state.activeSection.set('error');
        this.state.errorMessage.set(
          `Unable to retrieve Smileit final result: ${resultError.message}`,
        );
        this.loadHistory();
      },
    });
  }

  private extractResultData(jobResponse: SmileitJobResponseView): SmileitResultData | null {
    const rawResult = jobResponse.results;
    if (rawResult === null || rawResult === undefined) {
      return null;
    }

    return {
      totalGenerated: rawResult.total_generated,
      generatedStructures: (rawResult.generated_structures ?? []).map((structureItem, index) => {
        const normalizedName: string = structureItem.name.trim();
        return {
          structureIndex: index,
          name: normalizedName === '' ? `Generated molecule ${index + 1}` : normalizedName,
          smiles: structureItem.smiles,
          svg: structureItem.svg ?? '',
          placeholderAssignments: structureItem.placeholder_assignments.map((assignmentItem) => ({
            placeholderLabel: assignmentItem.placeholder_label,
            siteAtomIndex: assignmentItem.site_atom_index,
            substituentName: assignmentItem.substituent_name,
            substituentSmiles: assignmentItem.substituent_smiles ?? '',
          })),
          traceability: structureItem.traceability,
        };
      }),
      truncated: rawResult.truncated ?? false,
      principalSmiles: rawResult.principal_smiles,
      selectedAtomIndices: rawResult.selected_atom_indices,
      assignmentBlocks: jobResponse.parameters.assignment_blocks ?? [],
      traceabilityRows: rawResult.traceability_rows ?? [],
      exportNameBase:
        rawResult.export_name_base ?? jobResponse.parameters.export_name_base ?? 'SMILEIT',
      exportPadding: rawResult.export_padding ?? jobResponse.parameters.export_padding ?? 5,
      references: (rawResult.references ?? jobResponse.parameters.references ?? {}) as Record<
        string,
        Array<Record<string, unknown>>
      >,
      isHistoricalSummary: false,
      summaryMessage: null,
    };
  }

  private extractSummaryData(jobResponse: SmileitJobResponseView): SmileitResultData | null {
    const rawParameters = jobResponse.parameters;
    if (rawParameters === null || rawParameters === undefined) {
      return null;
    }

    return {
      totalGenerated: 0,
      generatedStructures: [],
      truncated: false,
      principalSmiles: rawParameters.principal_smiles,
      selectedAtomIndices: rawParameters.selected_atom_indices,
      assignmentBlocks: rawParameters.assignment_blocks ?? [],
      traceabilityRows: [],
      exportNameBase: rawParameters.export_name_base ?? 'SMILEIT',
      exportPadding: rawParameters.export_padding ?? 5,
      references: (rawParameters.references ?? {}) as Record<
        string,
        Array<Record<string, unknown>>
      >,
      isHistoricalSummary: true,
      summaryMessage: `Historical job status: ${jobResponse.status}. Final structures are not available in this snapshot.`,
    };
  }
}
