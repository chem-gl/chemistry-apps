// smileit-workflow.service.ts: Orquesta inspección, generación y reportes del flujo Smileit.

import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { Observable, Subscription, catchError, finalize, throwError } from 'rxjs';
import {
  DownloadedReportFile,
  JobLogEntryView,
  JobLogsPageView,
  JobProgressSnapshotView,
  JobsApiService,
  ScientificJobView,
  SmileitCatalogEntryView,
  SmileitGenerationParams,
  SmileitJobResponseView,
  SmileitStructureInspectionView,
  SmileitSubstituentParams,
} from '../api/jobs-api.service';

type SmileitSection = 'idle' | 'inspecting' | 'dispatching' | 'progress' | 'result' | 'error';

export interface SmileitGeneratedStructureView {
  name: string;
  smiles: string;
  svg: string;
}

export interface SmileitResultData {
  totalGenerated: number;
  generatedStructures: SmileitGeneratedStructureView[];
  truncated: boolean;
  principalSmiles: string;
  selectedAtomIndices: number[];
  isHistoricalSummary: boolean;
  summaryMessage: string | null;
}

@Injectable()
export class SmileitWorkflowService implements OnDestroy {
  private readonly jobsApiService = inject(JobsApiService);
  private progressSubscription: Subscription | null = null;
  private logsSubscription: Subscription | null = null;

  readonly principalSmiles = signal<string>('c1ccccc1');
  readonly inspection = signal<SmileitStructureInspectionView | null>(null);
  readonly selectedAtomIndices = signal<number[]>([]);

  readonly catalogEntries = signal<SmileitCatalogEntryView[]>([]);
  readonly substituents = signal<SmileitSubstituentParams[]>([]);

  readonly customSubstituentName = signal<string>('Custom substituent');
  readonly customSubstituentSmiles = signal<string>('[NH2]');
  readonly customSubstituentSelectedAtomIndex = signal<number>(0);

  readonly rSubstitutes = signal<number>(1);
  readonly numBonds = signal<number>(1);
  readonly allowRepeated = signal<boolean>(false);
  readonly maxStructures = signal<number>(300);

  readonly activeSection = signal<SmileitSection>('idle');
  readonly currentJobId = signal<string | null>(null);
  readonly progressSnapshot = signal<JobProgressSnapshotView | null>(null);
  readonly jobLogs = signal<JobLogEntryView[]>([]);
  readonly resultData = signal<SmileitResultData | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly exportErrorMessage = signal<string | null>(null);
  readonly isExporting = signal<boolean>(false);
  readonly historyJobs = signal<ScientificJobView[]>([]);
  readonly isHistoryLoading = signal<boolean>(false);

  readonly isProcessing = computed(
    () =>
      this.activeSection() === 'inspecting' ||
      this.activeSection() === 'dispatching' ||
      this.activeSection() === 'progress',
  );

  readonly inspectionSvg = computed(() => this.inspection()?.svg ?? '');

  readonly progressPercentage = computed(() => this.progressSnapshot()?.progress_percentage ?? 0);

  readonly progressMessage = computed(
    () => this.progressSnapshot()?.progress_message ?? 'Preparing Smileit generation...',
  );

  readonly canDispatch = computed(() => {
    const principal: string = this.principalSmiles().trim();
    return (
      principal.length > 0 &&
      this.selectedAtomIndices().length > 0 &&
      this.substituents().length > 0 &&
      !this.isProcessing()
    );
  });

  loadCatalog(): void {
    this.jobsApiService.listSmileitCatalog().subscribe({
      next: (entries: SmileitCatalogEntryView[]) => {
        this.catalogEntries.set(entries);
        if (this.substituents().length === 0 && entries.length > 0) {
          this.substituents.set([
            {
              name: entries[0].name,
              smiles: entries[0].smiles,
              selectedAtomIndex: entries[0].selected_atom_index,
            },
          ]);
        }
      },
      error: (requestError: Error) => {
        this.errorMessage.set(`Unable to load Smileit catalog: ${requestError.message}`);
      },
    });
  }

  inspectPrincipalStructure(): void {
    const rawSmiles: string = this.principalSmiles().trim();
    if (rawSmiles === '') {
      this.activeSection.set('error');
      this.errorMessage.set('Principal SMILES is required before inspection.');
      return;
    }

    this.activeSection.set('inspecting');
    this.errorMessage.set(null);

    this.jobsApiService.inspectSmileitStructure(rawSmiles).subscribe({
      next: (inspectionResult: SmileitStructureInspectionView) => {
        this.inspection.set(inspectionResult);

        if (this.selectedAtomIndices().length === 0 && inspectionResult.atomCount > 0) {
          this.selectedAtomIndices.set([0]);
        }

        this.activeSection.set('idle');
      },
      error: (requestError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to inspect principal structure: ${requestError.message}`);
      },
    });
  }

  toggleSelectedAtom(atomIndex: number): void {
    this.selectedAtomIndices.update((currentSelection) => {
      if (currentSelection.includes(atomIndex)) {
        return currentSelection.filter((item) => item !== atomIndex);
      }

      return [...currentSelection, atomIndex].sort(
        (leftIndex, rightIndex) => leftIndex - rightIndex,
      );
    });
  }

  setRSubstitutes(rawValue: number): void {
    const normalizedValue: number = Math.max(1, Math.min(10, Math.trunc(rawValue)));
    this.rSubstitutes.set(normalizedValue);
  }

  setNumBonds(rawValue: number): void {
    const normalizedValue: number = Math.max(1, Math.min(3, Math.trunc(rawValue)));
    this.numBonds.set(normalizedValue);
  }

  setMaxStructures(rawValue: number): void {
    const normalizedValue: number = Math.max(1, Math.min(5000, Math.trunc(rawValue)));
    this.maxStructures.set(normalizedValue);
  }

  addCatalogSubstituent(catalogEntry: SmileitCatalogEntryView): void {
    this.substituents.update((currentEntries) => [
      ...currentEntries,
      {
        name: catalogEntry.name,
        smiles: catalogEntry.smiles,
        selectedAtomIndex: catalogEntry.selected_atom_index,
      },
    ]);
  }

  addCustomSubstituent(): void {
    const entryName: string = this.customSubstituentName().trim();
    const entrySmiles: string = this.customSubstituentSmiles().trim();

    if (entryName === '' || entrySmiles === '') {
      this.errorMessage.set('Custom substituent requires both name and SMILES.');
      return;
    }

    this.errorMessage.set(null);
    this.substituents.update((currentEntries) => [
      ...currentEntries,
      {
        name: entryName,
        smiles: entrySmiles,
        selectedAtomIndex: this.customSubstituentSelectedAtomIndex(),
      },
    ]);
  }

  removeSubstituent(indexToRemove: number): void {
    this.substituents.update((currentEntries) =>
      currentEntries.filter((_entry, index) => index !== indexToRemove),
    );
  }

  updateSubstituentAnchor(indexToUpdate: number, rawAnchorValue: number): void {
    this.substituents.update((currentEntries) =>
      currentEntries.map((entry, index) =>
        index === indexToUpdate
          ? {
              ...entry,
              selectedAtomIndex: Math.max(0, Math.trunc(rawAnchorValue)),
            }
          : entry,
      ),
    );
  }

  clearSubstituents(): void {
    this.substituents.set([]);
  }

  dispatch(): void {
    if (!this.canDispatch()) {
      this.activeSection.set('error');
      this.errorMessage.set(
        'Select principal atoms and at least one substituent before dispatching.',
      );
      return;
    }

    this.progressSubscription?.unsubscribe();
    this.logsSubscription?.unsubscribe();

    this.activeSection.set('dispatching');
    this.errorMessage.set(null);
    this.exportErrorMessage.set(null);
    this.resultData.set(null);
    this.progressSnapshot.set(null);
    this.jobLogs.set([]);
    this.currentJobId.set(null);

    const dispatchParams: SmileitGenerationParams = this.buildDispatchParams();

    this.jobsApiService.dispatchSmileitJob(dispatchParams).subscribe({
      next: (jobResponse: SmileitJobResponseView) => {
        this.currentJobId.set(jobResponse.id);

        if (jobResponse.status === 'completed') {
          const immediateResultData: SmileitResultData | null = this.extractResultData(jobResponse);
          if (immediateResultData === null) {
            this.activeSection.set('error');
            this.errorMessage.set('Completed job payload is invalid for Smileit result rendering.');
            return;
          }

          this.resultData.set(immediateResultData);
          this.loadHistoricalLogs(jobResponse.id);
          this.activeSection.set('result');
          this.loadHistory();
          return;
        }

        this.activeSection.set('progress');
        this.startProgressStream(jobResponse.id);
      },
      error: (dispatchError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to create Smileit job: ${dispatchError.message}`);
      },
    });
  }

  reset(): void {
    this.progressSubscription?.unsubscribe();
    this.logsSubscription?.unsubscribe();

    this.activeSection.set('idle');
    this.currentJobId.set(null);
    this.progressSnapshot.set(null);
    this.jobLogs.set([]);
    this.resultData.set(null);
    this.errorMessage.set(null);
    this.exportErrorMessage.set(null);
  }

  openHistoricalJob(jobId: string): void {
    this.progressSubscription?.unsubscribe();
    this.logsSubscription?.unsubscribe();

    this.activeSection.set('dispatching');
    this.errorMessage.set(null);
    this.exportErrorMessage.set(null);
    this.currentJobId.set(jobId);
    this.jobLogs.set([]);

    this.jobsApiService.getSmileitJobStatus(jobId).subscribe({
      next: (jobResponse: SmileitJobResponseView) => {
        if (jobResponse.status === 'failed') {
          this.loadHistoricalLogs(jobId);
          this.activeSection.set('error');
          this.errorMessage.set(
            jobResponse.error_trace ?? 'Historical Smileit job ended with error.',
          );
          return;
        }

        const historicalData: SmileitResultData | null =
          this.extractResultData(jobResponse) ?? this.extractSummaryData(jobResponse);

        if (historicalData === null) {
          this.activeSection.set('error');
          this.errorMessage.set('Unable to reconstruct historical Smileit result.');
          return;
        }

        this.resultData.set(historicalData);
        this.loadHistoricalLogs(jobId);
        this.activeSection.set('result');
      },
      error: (statusError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to recover Smileit historical job: ${statusError.message}`);
      },
    });
  }

  loadHistory(): void {
    this.isHistoryLoading.set(true);

    this.jobsApiService.listJobs({ pluginName: 'smileit' }).subscribe({
      next: (jobItems: ScientificJobView[]) => {
        const orderedJobs: ScientificJobView[] = [...jobItems].sort(
          (leftJob: ScientificJobView, rightJob: ScientificJobView) =>
            new Date(rightJob.updated_at).getTime() - new Date(leftJob.updated_at).getTime(),
        );
        this.historyJobs.set(orderedJobs);
        this.isHistoryLoading.set(false);
      },
      error: () => {
        this.isHistoryLoading.set(false);
      },
    });
  }

  downloadCsvReport(): Observable<DownloadedReportFile> {
    const selectedJobId: string | null = this.currentJobId();
    if (selectedJobId === null || selectedJobId.trim() === '') {
      throw new Error('No Smileit job selected for CSV export.');
    }

    this.exportErrorMessage.set(null);
    this.isExporting.set(true);

    return this.jobsApiService.downloadSmileitCsvReport(selectedJobId).pipe(
      finalize(() => this.isExporting.set(false)),
      catchError((requestError: unknown) => {
        const normalizedErrorMessage: string =
          requestError instanceof Error
            ? requestError.message
            : 'Unknown error while downloading Smileit CSV report.';
        this.exportErrorMessage.set(`Unable to download CSV report: ${normalizedErrorMessage}`);
        return throwError(() => requestError);
      }),
    );
  }

  downloadLogReport(): Observable<DownloadedReportFile> {
    const selectedJobId: string | null = this.currentJobId();
    if (selectedJobId === null || selectedJobId.trim() === '') {
      throw new Error('No Smileit job selected for LOG export.');
    }

    this.exportErrorMessage.set(null);
    this.isExporting.set(true);

    return this.jobsApiService.downloadSmileitLogReport(selectedJobId).pipe(
      finalize(() => this.isExporting.set(false)),
      catchError((requestError: unknown) => {
        const normalizedErrorMessage: string =
          requestError instanceof Error
            ? requestError.message
            : 'Unknown error while downloading Smileit LOG report.';
        this.exportErrorMessage.set(`Unable to download LOG report: ${normalizedErrorMessage}`);
        return throwError(() => requestError);
      }),
    );
  }

  downloadErrorReport(): Observable<DownloadedReportFile> {
    const selectedJobId: string | null = this.currentJobId();
    if (selectedJobId === null || selectedJobId.trim() === '') {
      throw new Error('No Smileit job selected for error report export.');
    }

    this.exportErrorMessage.set(null);
    this.isExporting.set(true);

    return this.jobsApiService.downloadSmileitErrorReport(selectedJobId).pipe(
      finalize(() => this.isExporting.set(false)),
      catchError((requestError: unknown) => {
        const normalizedErrorMessage: string =
          requestError instanceof Error
            ? requestError.message
            : 'Unknown error while downloading Smileit error report.';
        this.exportErrorMessage.set(`Unable to download error report: ${normalizedErrorMessage}`);
        return throwError(() => requestError);
      }),
    );
  }

  ngOnDestroy(): void {
    this.progressSubscription?.unsubscribe();
    this.logsSubscription?.unsubscribe();
  }

  private buildDispatchParams(): SmileitGenerationParams {
    return {
      principalSmiles: this.principalSmiles().trim(),
      selectedAtomIndices: [...this.selectedAtomIndices()],
      substituents: [...this.substituents()],
      rSubstitutes: this.rSubstitutes(),
      numBonds: this.numBonds(),
      allowRepeated: this.allowRepeated(),
      maxStructures: this.maxStructures(),
      version: '1.0.0',
    };
  }

  private startProgressStream(jobId: string): void {
    this.startLogsStream(jobId);

    this.progressSubscription = this.jobsApiService.streamJobEvents(jobId).subscribe({
      next: (snapshot: JobProgressSnapshotView) => this.progressSnapshot.set(snapshot),
      complete: () => this.fetchFinalResult(jobId),
      error: () => this.startPollingFallback(jobId),
    });
  }

  private startLogsStream(jobId: string): void {
    this.logsSubscription?.unsubscribe();

    this.logsSubscription = this.jobsApiService.streamJobLogEvents(jobId).subscribe({
      next: (logEntry: JobLogEntryView) => {
        this.jobLogs.update((currentLogs) => {
          if (currentLogs.some((item) => item.eventIndex === logEntry.eventIndex)) {
            return currentLogs;
          }

          return [...currentLogs, logEntry].sort(
            (leftEntry, rightEntry) => leftEntry.eventIndex - rightEntry.eventIndex,
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
      next: (logsPage: JobLogsPageView) => this.jobLogs.set(logsPage.results),
      error: () => {
        // Si falla la carga de logs históricos, el resultado principal sigue visible.
      },
    });
  }

  private startPollingFallback(jobId: string): void {
    this.progressSubscription = this.jobsApiService.pollJobUntilCompleted(jobId, 1000).subscribe({
      next: (snapshot: JobProgressSnapshotView) => {
        this.progressSnapshot.set(snapshot);
        this.fetchFinalResult(jobId);
      },
      error: (pollingError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to track Smileit progress: ${pollingError.message}`);
      },
    });
  }

  private fetchFinalResult(jobId: string): void {
    this.jobsApiService.getSmileitJobStatus(jobId).subscribe({
      next: (jobResponse: SmileitJobResponseView) => {
        if (jobResponse.status === 'failed') {
          this.loadHistoricalLogs(jobId);
          this.activeSection.set('error');
          this.errorMessage.set(jobResponse.error_trace ?? 'Smileit job ended without details.');
          this.loadHistory();
          return;
        }

        const finalData: SmileitResultData | null =
          this.extractResultData(jobResponse) ?? this.extractSummaryData(jobResponse);

        if (finalData === null) {
          this.activeSection.set('error');
          this.errorMessage.set('Unable to parse Smileit final result payload.');
          this.loadHistory();
          return;
        }

        this.resultData.set(finalData);
        this.loadHistoricalLogs(jobId);
        this.activeSection.set('result');
        this.loadHistory();
      },
      error: (resultError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to retrieve Smileit final result: ${resultError.message}`);
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
      generatedStructures: rawResult.generated_structures.map((structureItem, index) => {
        const normalizedName: string = structureItem.name.trim();
        return {
          name: normalizedName === '' ? `Generated molecule ${index + 1}` : normalizedName,
          smiles: structureItem.smiles,
          svg: structureItem.svg,
        };
      }),
      truncated: rawResult.truncated,
      principalSmiles: rawResult.principal_smiles,
      selectedAtomIndices: rawResult.selected_atom_indices,
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
      isHistoricalSummary: true,
      summaryMessage: `Historical job status: ${jobResponse.status}. Final structures are not available in this snapshot.`,
    };
  }
}
