// sa-score-workflow.service.ts: Orquesta entrada, ejecución async, tabla de resultados y exportes CSV para SA Score.

import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { Observable, Subscription, catchError, finalize, throwError } from 'rxjs';
import {
  DownloadedReportFile,
  JobLogEntryView,
  JobLogsPageView,
  JobProgressSnapshotView,
  JobsApiService,
  SaScoreJobResponseView,
  SaScoreMethod,
  SaScoreMoleculeResultView,
  SaScoreParams,
  ScientificJobView,
} from '../api/jobs-api.service';

type SaScoreSection = 'idle' | 'dispatching' | 'progress' | 'result' | 'error';

export interface SaScoreResultData {
  molecules: SaScoreMoleculeResultView[];
  total: number;
  requestedMethods: SaScoreMethod[];
  isHistoricalSummary: boolean;
  summaryMessage: string | null;
}

@Injectable()
export class SaScoreWorkflowService implements OnDestroy {
  private readonly jobsApiService = inject(JobsApiService);
  private progressSubscription: Subscription | null = null;
  private logsSubscription: Subscription | null = null;

  readonly smilesInput = signal<string>('CCO\nCC(=O)O\nc1ccccc1');
  readonly selectedMethods = signal<Record<SaScoreMethod, boolean>>({
    ambit: true,
    brsa: true,
    rdkit: true,
  });

  readonly activeSection = signal<SaScoreSection>('idle');
  readonly currentJobId = signal<string | null>(null);
  readonly progressSnapshot = signal<JobProgressSnapshotView | null>(null);
  readonly jobLogs = signal<JobLogEntryView[]>([]);
  readonly resultData = signal<SaScoreResultData | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly exportErrorMessage = signal<string | null>(null);
  readonly isExporting = signal<boolean>(false);
  readonly historyJobs = signal<ScientificJobView[]>([]);
  readonly isHistoryLoading = signal<boolean>(false);

  readonly isProcessing = computed(
    () => this.activeSection() === 'dispatching' || this.activeSection() === 'progress',
  );
  readonly progressPercentage = computed(() => this.progressSnapshot()?.progress_percentage ?? 0);
  readonly progressMessage = computed(
    () => this.progressSnapshot()?.progress_message ?? 'Preparing SA score calculation...',
  );

  readonly selectedMethodList = computed<SaScoreMethod[]>(() => {
    const methodFlags: Record<SaScoreMethod, boolean> = this.selectedMethods();
    const enabledMethods: SaScoreMethod[] = [];

    if (methodFlags.ambit) {
      enabledMethods.push('ambit');
    }
    if (methodFlags.brsa) {
      enabledMethods.push('brsa');
    }
    if (methodFlags.rdkit) {
      enabledMethods.push('rdkit');
    }

    return enabledMethods;
  });

  dispatch(): void {
    this.progressSubscription?.unsubscribe();
    this.logsSubscription?.unsubscribe();

    this.activeSection.set('dispatching');
    this.errorMessage.set(null);
    this.exportErrorMessage.set(null);
    this.resultData.set(null);
    this.progressSnapshot.set(null);
    this.jobLogs.set([]);
    this.currentJobId.set(null);

    const normalizedSmiles: string[] = this.parseSmilesInput(this.smilesInput());
    if (normalizedSmiles.length === 0) {
      this.activeSection.set('error');
      this.errorMessage.set('At least one SMILES is required.');
      return;
    }

    const enabledMethods: SaScoreMethod[] = this.selectedMethodList();
    if (enabledMethods.length === 0) {
      this.activeSection.set('error');
      this.errorMessage.set('Select at least one SA method (AMBIT, BRSA or RDKit).');
      return;
    }

    const dispatchParams: SaScoreParams = {
      smiles: normalizedSmiles,
      methods: enabledMethods,
      version: '1.0.0',
    };

    this.jobsApiService.dispatchSaScoreJob(dispatchParams).subscribe({
      next: (jobResponse: SaScoreJobResponseView) => {
        this.currentJobId.set(jobResponse.id);

        if (jobResponse.status === 'completed') {
          const immediateResultData: SaScoreResultData | null = this.extractResultData(jobResponse);
          if (immediateResultData === null) {
            this.activeSection.set('error');
            this.errorMessage.set('The completed job payload is invalid for SA score.');
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
        this.errorMessage.set(`Unable to create SA score job: ${dispatchError.message}`);
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

  toggleMethod(method: SaScoreMethod): void {
    this.selectedMethods.update((currentFlags: Record<SaScoreMethod, boolean>) => ({
      ...currentFlags,
      [method]: !currentFlags[method],
    }));
  }

  loadHistory(): void {
    this.isHistoryLoading.set(true);

    this.jobsApiService.listJobs({ pluginName: 'sa-score' }).subscribe({
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

  openHistoricalJob(jobId: string): void {
    this.progressSubscription?.unsubscribe();
    this.logsSubscription?.unsubscribe();

    this.activeSection.set('dispatching');
    this.errorMessage.set(null);
    this.exportErrorMessage.set(null);
    this.currentJobId.set(jobId);
    this.jobLogs.set([]);

    this.jobsApiService.getSaScoreJobStatus(jobId).subscribe({
      next: (jobResponse: SaScoreJobResponseView) => {
        if (jobResponse.status === 'failed') {
          this.loadHistoricalLogs(jobId);
          this.activeSection.set('error');
          this.errorMessage.set('Historical job ended with error.');
          return;
        }

        const historicalData: SaScoreResultData | null = this.extractResultData(jobResponse);
        if (historicalData === null) {
          this.activeSection.set('error');
          this.errorMessage.set('Unable to reconstruct historical SA score result.');
          return;
        }

        this.resultData.set(historicalData);
        this.loadHistoricalLogs(jobId);
        this.activeSection.set('result');
      },
      error: (statusError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to recover historical job: ${statusError.message}`);
      },
    });
  }

  downloadFullCsvReport(): Observable<DownloadedReportFile> {
    const selectedJobId: string | null = this.currentJobId();
    if (selectedJobId === null || selectedJobId.trim() === '') {
      throw new Error('No job selected for CSV export.');
    }

    this.exportErrorMessage.set(null);
    this.isExporting.set(true);

    return this.jobsApiService.downloadSaScoreCsvReport(selectedJobId).pipe(
      finalize(() => this.isExporting.set(false)),
      catchError((requestError: unknown) => {
        const normalizedErrorMessage: string =
          requestError instanceof Error
            ? requestError.message
            : 'Unknown error while downloading CSV report.';
        this.exportErrorMessage.set(`Unable to download CSV report: ${normalizedErrorMessage}`);
        return throwError(() => requestError);
      }),
    );
  }

  downloadMethodCsvReport(method: SaScoreMethod): Observable<DownloadedReportFile> {
    const selectedJobId: string | null = this.currentJobId();
    if (selectedJobId === null || selectedJobId.trim() === '') {
      throw new Error('No job selected for method CSV export.');
    }

    this.exportErrorMessage.set(null);
    this.isExporting.set(true);

    return this.jobsApiService.downloadSaScoreCsvMethodReport(selectedJobId, method).pipe(
      finalize(() => this.isExporting.set(false)),
      catchError((requestError: unknown) => {
        const normalizedErrorMessage: string =
          requestError instanceof Error
            ? requestError.message
            : 'Unknown error while downloading method CSV report.';
        this.exportErrorMessage.set(
          `Unable to download ${method.toUpperCase()} CSV report: ${normalizedErrorMessage}`,
        );
        return throwError(() => requestError);
      }),
    );
  }

  ngOnDestroy(): void {
    this.progressSubscription?.unsubscribe();
    this.logsSubscription?.unsubscribe();
  }

  private parseSmilesInput(rawInput: string): string[] {
    return rawInput
      .split(/\r?\n/)
      .map((smilesItem: string) => smilesItem.trim())
      .filter((smilesItem: string) => smilesItem.length > 0);
  }

  private startProgressStream(jobId: string): void {
    this.progressSubscription?.unsubscribe();
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
        this.jobLogs.update((currentLogs: JobLogEntryView[]) => {
          if (
            currentLogs.some(
              (existingLog: JobLogEntryView) => existingLog.eventIndex === logEntry.eventIndex,
            )
          ) {
            return currentLogs;
          }
          return [...currentLogs, logEntry].sort(
            (left, right) => left.eventIndex - right.eventIndex,
          );
        });
      },
      error: () => {
        this.loadHistoricalLogs(jobId);
      },
    });
  }

  private startPollingFallback(jobId: string): void {
    this.jobsApiService.pollJobUntilCompleted(jobId).subscribe({
      next: (snapshot: JobProgressSnapshotView) => this.progressSnapshot.set(snapshot),
      complete: () => this.fetchFinalResult(jobId),
      error: (pollingError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to track SA score job progress: ${pollingError.message}`);
      },
    });
  }

  private fetchFinalResult(jobId: string): void {
    this.jobsApiService.getSaScoreJobStatus(jobId).subscribe({
      next: (jobResponse: SaScoreJobResponseView) => {
        const finalResultData: SaScoreResultData | null = this.extractResultData(jobResponse);
        if (finalResultData === null) {
          this.activeSection.set('error');
          this.errorMessage.set('The final SA score payload is invalid.');
          return;
        }

        this.resultData.set(finalResultData);
        this.activeSection.set('result');
        this.loadHistory();
      },
      error: (statusError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to retrieve final SA score result: ${statusError.message}`);
      },
    });
  }

  private extractResultData(jobResponse: SaScoreJobResponseView): SaScoreResultData | null {
    const resultsPayload: unknown = jobResponse.results;
    if (
      resultsPayload === null ||
      typeof resultsPayload !== 'object' ||
      Array.isArray(resultsPayload)
    ) {
      return null;
    }

    const typedResults: {
      molecules?: unknown;
      total?: unknown;
      requested_methods?: unknown;
    } = resultsPayload as {
      molecules?: unknown;
      total?: unknown;
      requested_methods?: unknown;
    };

    if (!Array.isArray(typedResults.molecules) || !Array.isArray(typedResults.requested_methods)) {
      return null;
    }

    const normalizedMethods: SaScoreMethod[] = typedResults.requested_methods.filter(
      (methodItem: unknown): methodItem is SaScoreMethod =>
        methodItem === 'ambit' || methodItem === 'brsa' || methodItem === 'rdkit',
    );

    if (normalizedMethods.length === 0) {
      return null;
    }

    return {
      molecules: typedResults.molecules as SaScoreMoleculeResultView[],
      total:
        typeof typedResults.total === 'number' ? typedResults.total : typedResults.molecules.length,
      requestedMethods: normalizedMethods,
      isHistoricalSummary: false,
      summaryMessage: null,
    };
  }

  private loadHistoricalLogs(jobId: string): void {
    this.jobsApiService.getJobLogs(jobId, { limit: 300 }).subscribe({
      next: (logsPage: JobLogsPageView) => {
        const sortedLogs: JobLogEntryView[] = [...logsPage.results].sort(
          (leftLog: JobLogEntryView, rightLog: JobLogEntryView) =>
            leftLog.eventIndex - rightLog.eventIndex,
        );
        this.jobLogs.set(sortedLogs);
      },
      error: () => {
        this.jobLogs.set([]);
      },
    });
  }
}
