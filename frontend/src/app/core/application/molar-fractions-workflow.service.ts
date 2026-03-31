// molar-fractions-workflow.service.ts: Orquesta formulario, progreso y resultados de molar fractions.

import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { Observable, Subscription, catchError, finalize, throwError } from 'rxjs';
import {
  DownloadedReportFile,
  JobLogEntryView,
  JobLogsPageView,
  JobProgressSnapshotView,
  JobsApiService,
  MolarFractionsParams,
  ScientificJobView,
} from '../api/jobs-api.service';

type MolarFractionsSection = 'idle' | 'dispatching' | 'progress' | 'result' | 'error';
type MolarFractionsPhMode = 'single' | 'range';

export interface MolarFractionsResultRow {
  ph: number;
  fractions: number[];
  sumFraction: number;
}

export interface MolarFractionsResultMetadata {
  pkaValues: number[];
  phMode: MolarFractionsPhMode;
  phMin: number;
  phMax: number;
  phStep: number;
  totalSpecies: number;
  totalPoints: number;
}

export interface MolarFractionsResultData {
  speciesLabels: string[];
  rows: MolarFractionsResultRow[];
  metadata: MolarFractionsResultMetadata;
  isHistoricalSummary: boolean;
  summaryMessage: string | null;
}

@Injectable()
export class MolarFractionsWorkflowService implements OnDestroy {
  private readonly jobsApiService = inject(JobsApiService);
  private progressSubscription: Subscription | null = null;
  private logsSubscription: Subscription | null = null;

  readonly pkaCount = signal<number>(3);
  readonly pkaValues = signal<number[]>([2.2, 7.2, 12.3, 0, 0, 0]);
  readonly phMode = signal<MolarFractionsPhMode>('range');
  readonly phValue = signal<number>(7);
  readonly phMin = signal<number>(0);
  readonly phMax = signal<number>(14);
  readonly phStep = signal<number>(1);

  readonly activeSection = signal<MolarFractionsSection>('idle');
  readonly currentJobId = signal<string | null>(null);
  readonly progressSnapshot = signal<JobProgressSnapshotView | null>(null);
  readonly jobLogs = signal<JobLogEntryView[]>([]);
  readonly resultData = signal<MolarFractionsResultData | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly exportErrorMessage = signal<string | null>(null);
  readonly isExporting = signal<boolean>(false);
  readonly historyJobs = signal<ScientificJobView[]>([]);
  readonly isHistoryLoading = signal<boolean>(false);

  readonly pkaInputSlots = computed<number[]>(() =>
    Array.from({ length: this.pkaCount() }, (_value, index) => index),
  );

  readonly activePkaValues = computed<number[]>(() =>
    this.pkaValues().slice(0, this.pkaCount()).map(Number),
  );

  readonly isProcessing = computed(
    () => this.activeSection() === 'dispatching' || this.activeSection() === 'progress',
  );

  readonly progressPercentage = computed(() => this.progressSnapshot()?.progress_percentage ?? 0);

  readonly progressMessage = computed(
    () => this.progressSnapshot()?.progress_message ?? 'Preparing molar fractions calculation...',
  );

  setPkaCount(rawCount: number): void {
    const normalizedCount: number = Math.max(1, Math.min(6, Math.trunc(rawCount)));
    this.pkaCount.set(normalizedCount);
  }

  updatePkaValue(index: number, rawValue: number): void {
    this.pkaValues.update((currentValues) => {
      const nextValues: number[] = [...currentValues];
      nextValues[index] = Number(rawValue);
      return nextValues;
    });
  }

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

    const dispatchParams: MolarFractionsParams = this.buildDispatchParams();

    this.jobsApiService.dispatchMolarFractionsJob(dispatchParams).subscribe({
      next: (jobResponse: ScientificJobView) => {
        this.currentJobId.set(jobResponse.id);

        if (jobResponse.status === 'completed') {
          const immediateResultData: MolarFractionsResultData | null =
            this.extractResultData(jobResponse);
          if (immediateResultData === null) {
            this.activeSection.set('error');
            this.errorMessage.set('The completed job payload is invalid for molar fractions.');
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
        this.errorMessage.set(`Unable to create molar fractions job: ${dispatchError.message}`);
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

    this.jobsApiService.getScientificJobStatus(jobId).subscribe({
      next: (jobResponse: ScientificJobView) => {
        if (jobResponse.status === 'failed') {
          this.loadHistoricalLogs(jobId);
          this.activeSection.set('error');
          this.errorMessage.set(jobResponse.error_trace ?? 'Historical job ended with error.');
          return;
        }

        const historicalData: MolarFractionsResultData | null =
          this.extractResultData(jobResponse) ?? this.extractSummaryData(jobResponse);
        if (historicalData === null) {
          this.activeSection.set('error');
          this.errorMessage.set('Unable to reconstruct historical molar fractions result.');
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

  loadHistory(): void {
    this.isHistoryLoading.set(true);

    this.jobsApiService.listJobs({ pluginName: 'molar-fractions' }).subscribe({
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
      throw new Error('No job selected for CSV export.');
    }

    this.exportErrorMessage.set(null);
    this.isExporting.set(true);

    return this.jobsApiService.downloadMolarFractionsCsvReport(selectedJobId).pipe(
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

  downloadLogReport(): Observable<DownloadedReportFile> {
    const selectedJobId: string | null = this.currentJobId();
    if (selectedJobId === null || selectedJobId.trim() === '') {
      throw new Error('No job selected for LOG export.');
    }

    this.exportErrorMessage.set(null);
    this.isExporting.set(true);

    return this.jobsApiService.downloadMolarFractionsLogReport(selectedJobId).pipe(
      finalize(() => this.isExporting.set(false)),
      catchError((requestError: unknown) => {
        const normalizedErrorMessage: string =
          requestError instanceof Error
            ? requestError.message
            : 'Unknown error while downloading LOG report.';
        this.exportErrorMessage.set(`Unable to download LOG report: ${normalizedErrorMessage}`);
        return throwError(() => requestError);
      }),
    );
  }

  ngOnDestroy(): void {
    this.progressSubscription?.unsubscribe();
    this.logsSubscription?.unsubscribe();
  }

  private buildDispatchParams(): MolarFractionsParams {
    const selectedMode: MolarFractionsPhMode = this.phMode();

    if (selectedMode === 'single') {
      return {
        pkaValues: this.activePkaValues(),
        phMode: 'single',
        phValue: this.phValue(),
      };
    }

    return {
      pkaValues: this.activePkaValues(),
      phMode: 'range',
      phMin: this.phMin(),
      phMax: this.phMax(),
      phStep: this.phStep(),
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
        // Keep UI functional even if SSE logs stream reconnects.
      },
    });
  }

  private loadHistoricalLogs(jobId: string): void {
    this.jobsApiService.getJobLogs(jobId, { limit: 250 }).subscribe({
      next: (logsPage: JobLogsPageView) => this.jobLogs.set(logsPage.results),
      error: () => {
        // Keep historical view available even when logs cannot be fetched.
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
        this.errorMessage.set(`Unable to track progress: ${pollingError.message}`);
      },
    });
  }

  private fetchFinalResult(jobId: string): void {
    this.jobsApiService.getScientificJobStatus(jobId).subscribe({
      next: (jobResponse: ScientificJobView) => {
        if (jobResponse.status === 'failed') {
          this.loadHistoricalLogs(jobId);
          this.activeSection.set('error');
          this.errorMessage.set(jobResponse.error_trace ?? 'Job ended with no error details.');
          return;
        }

        const finalResultData: MolarFractionsResultData | null =
          this.extractResultData(jobResponse);
        if (finalResultData === null) {
          this.activeSection.set('error');
          this.errorMessage.set('The final payload is invalid for molar fractions.');
          return;
        }

        this.resultData.set(finalResultData);
        this.loadHistoricalLogs(jobId);
        this.activeSection.set('result');
        this.loadHistory();
      },
      error: (statusError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to get final result: ${statusError.message}`);
      },
    });
  }

  private extractResultData(jobResponse: ScientificJobView): MolarFractionsResultData | null {
    const rawResults: unknown = jobResponse.results;
    if (!this.isRecord(rawResults)) {
      return null;
    }

    const rawSpeciesLabels: unknown = rawResults['species_labels'];
    const rawRows: unknown = rawResults['rows'];
    const rawMetadata: unknown = rawResults['metadata'];

    if (
      !Array.isArray(rawSpeciesLabels) ||
      !Array.isArray(rawRows) ||
      !this.isRecord(rawMetadata)
    ) {
      return null;
    }

    const speciesLabels: string[] = rawSpeciesLabels.filter(
      (value: unknown): value is string => typeof value === 'string',
    );

    if (speciesLabels.length === 0) {
      return null;
    }

    const parsedRows: MolarFractionsResultRow[] = [];
    for (const rowCandidate of rawRows) {
      if (!this.isRecord(rowCandidate)) {
        return null;
      }
      const rowPh: unknown = rowCandidate['ph'];
      const rowFractions: unknown = rowCandidate['fractions'];
      const rowSumFraction: unknown = rowCandidate['sum_fraction'];
      if (
        typeof rowPh !== 'number' ||
        !Array.isArray(rowFractions) ||
        typeof rowSumFraction !== 'number'
      ) {
        return null;
      }
      const fractions: number[] = rowFractions.filter(
        (fractionValue: unknown): fractionValue is number => typeof fractionValue === 'number',
      );
      parsedRows.push({
        ph: rowPh,
        fractions,
        sumFraction: rowSumFraction,
      });
    }

    const metadata: MolarFractionsResultMetadata | null = this.parseMetadata(rawMetadata);
    if (metadata === null) {
      return null;
    }

    return {
      speciesLabels,
      rows: parsedRows,
      metadata,
      isHistoricalSummary: false,
      summaryMessage: null,
    };
  }

  private extractSummaryData(jobResponse: ScientificJobView): MolarFractionsResultData | null {
    const rawParameters: unknown = jobResponse.parameters;
    if (!this.isRecord(rawParameters)) {
      return null;
    }

    const rawPkaValues: unknown = rawParameters['pka_values'];
    const rawPhMode: unknown = rawParameters['ph_mode'];

    if (!Array.isArray(rawPkaValues) || (rawPhMode !== 'single' && rawPhMode !== 'range')) {
      return null;
    }

    const pkaValues: number[] = rawPkaValues.filter(
      (value: unknown): value is number => typeof value === 'number',
    );
    if (pkaValues.length < 1) {
      return null;
    }

    let phMin: number;
    let phMax: number;
    let phStep: number;

    if (rawPhMode === 'single') {
      const phValue: unknown = rawParameters['ph_value'];
      if (typeof phValue !== 'number') {
        return null;
      }
      phMin = phValue;
      phMax = phValue;
      phStep = 0.1;
    } else {
      const rawPhMin: unknown = rawParameters['ph_min'];
      const rawPhMax: unknown = rawParameters['ph_max'];
      const rawPhStep: unknown = rawParameters['ph_step'];
      if (
        typeof rawPhMin !== 'number' ||
        typeof rawPhMax !== 'number' ||
        typeof rawPhStep !== 'number'
      ) {
        return null;
      }
      phMin = Math.min(rawPhMin, rawPhMax);
      phMax = Math.max(rawPhMin, rawPhMax);
      phStep = rawPhStep;
    }

    const speciesLabels: string[] = Array.from(
      { length: pkaValues.length + 1 },
      (_v, index) => `f${index}`,
    );
    const summaryMessage: string = this.buildHistoricalSummaryMessage(jobResponse.status);

    return {
      speciesLabels,
      rows: [],
      metadata: {
        pkaValues,
        phMode: rawPhMode,
        phMin,
        phMax,
        phStep,
        totalSpecies: speciesLabels.length,
        totalPoints: 0,
      },
      isHistoricalSummary: true,
      summaryMessage,
    };
  }

  private parseMetadata(rawMetadata: Record<string, unknown>): MolarFractionsResultMetadata | null {
    const rawPkaValues: unknown = rawMetadata['pka_values'];
    const rawPhMode: unknown = rawMetadata['ph_mode'];
    const rawPhMin: unknown = rawMetadata['ph_min'];
    const rawPhMax: unknown = rawMetadata['ph_max'];
    const rawPhStep: unknown = rawMetadata['ph_step'];
    const rawTotalSpecies: unknown = rawMetadata['total_species'];
    const rawTotalPoints: unknown = rawMetadata['total_points'];

    if (
      !Array.isArray(rawPkaValues) ||
      (rawPhMode !== 'single' && rawPhMode !== 'range') ||
      typeof rawPhMin !== 'number' ||
      typeof rawPhMax !== 'number' ||
      typeof rawPhStep !== 'number' ||
      typeof rawTotalSpecies !== 'number' ||
      typeof rawTotalPoints !== 'number'
    ) {
      return null;
    }

    const pkaValues: number[] = rawPkaValues.filter(
      (value: unknown): value is number => typeof value === 'number',
    );

    return {
      pkaValues,
      phMode: rawPhMode,
      phMin: rawPhMin,
      phMax: rawPhMax,
      phStep: rawPhStep,
      totalSpecies: rawTotalSpecies,
      totalPoints: rawTotalPoints,
    };
  }

  private buildHistoricalSummaryMessage(jobStatus: ScientificJobView['status']): string {
    if (jobStatus === 'pending') {
      return 'Historical summary: this job is still pending execution.';
    }
    if (jobStatus === 'running') {
      return 'Historical summary: this job is still running.';
    }
    if (jobStatus === 'paused') {
      return 'Historical summary: this job is paused.';
    }
    return 'Historical summary: no final result payload was available.';
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
