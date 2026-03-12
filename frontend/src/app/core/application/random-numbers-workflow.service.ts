// random-numbers-workflow.service.ts: Orquesta formulario, progreso y resultado de random numbers.

import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import {
  JobControlActionResult,
  JobLogEntryView,
  JobProgressSnapshotView,
  JobsApiService,
  ScientificJobView,
} from '../api/jobs-api.service';

/** Secciones de flujo para la UI de random numbers */
type RandomNumbersSection = 'idle' | 'dispatching' | 'progress' | 'result' | 'error';

/** Resultado tipado de random numbers para desacoplar UI de payload dinámico */
export interface RandomNumbersResultData {
  generatedNumbers: number[];
  seedUrl: string;
  seedDigest: string;
  numbersPerBatch: number;
  intervalSeconds: number;
  totalNumbers: number;
  isHistoricalSummary: boolean;
  summaryMessage: string | null;
}

const SUPPORTED_PROGRESS_STAGES: ReadonlyArray<JobProgressSnapshotView['progress_stage']> = [
  'pending',
  'queued',
  'running',
  'paused',
  'recovering',
  'caching',
  'completed',
  'failed',
  'cancelled',
];

const SUPPORTED_JOB_STATUSES: ReadonlyArray<ScientificJobView['status']> = [
  'pending',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
];

@Injectable()
export class RandomNumbersWorkflowService implements OnDestroy {
  private readonly jobsApiService = inject(JobsApiService);
  private progressSubscription: Subscription | null = null;
  private logsSubscription: Subscription | null = null;

  readonly seedUrl = signal<string>('https://example.com/seed.txt');
  readonly numbersPerBatch = signal<number>(5);
  readonly intervalSeconds = signal<number>(120);
  readonly totalNumbers = signal<number>(55);

  readonly activeSection = signal<RandomNumbersSection>('idle');
  readonly currentJobId = signal<string | null>(null);
  readonly progressSnapshot = signal<JobProgressSnapshotView | null>(null);
  readonly jobLogs = signal<JobLogEntryView[]>([]);
  readonly resultData = signal<RandomNumbersResultData | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly historyJobs = signal<ScientificJobView[]>([]);
  readonly isHistoryLoading = signal<boolean>(false);
  readonly isControlActionLoading = signal<boolean>(false);

  readonly isProcessing = computed(
    () => this.activeSection() === 'dispatching' || this.activeSection() === 'progress',
  );

  readonly progressPercentage = computed(() => this.progressSnapshot()?.progress_percentage ?? 0);

  readonly isPaused = computed(() => this.progressSnapshot()?.status === 'paused');

  readonly canResumeFromResult = computed(() => {
    const currentResultData: RandomNumbersResultData | null = this.resultData();
    return (
      this.activeSection() === 'result' &&
      currentResultData !== null &&
      currentResultData.isHistoricalSummary &&
      this.progressSnapshot()?.status === 'paused' &&
      this.currentJobId() !== null
    );
  });

  readonly progressMessage = computed(
    () => this.progressSnapshot()?.progress_message ?? 'Preparing generation...',
  );

  private normalizeProgressStage(
    rawProgressStage: string,
    fallbackStage: JobProgressSnapshotView['progress_stage'],
  ): JobProgressSnapshotView['progress_stage'] {
    return SUPPORTED_PROGRESS_STAGES.includes(
      rawProgressStage as JobProgressSnapshotView['progress_stage'],
    )
      ? (rawProgressStage as JobProgressSnapshotView['progress_stage'])
      : fallbackStage;
  }

  dispatch(): void {
    this.progressSubscription?.unsubscribe();
    this.logsSubscription?.unsubscribe();
    this.activeSection.set('dispatching');
    this.errorMessage.set(null);
    this.resultData.set(null);
    this.progressSnapshot.set(null);
    this.jobLogs.set([]);
    this.currentJobId.set(null);

    this.jobsApiService
      .dispatchScientificJob({
        pluginName: 'random-numbers',
        parameters: {
          seed_url: this.seedUrl(),
          numbers_per_batch: this.numbersPerBatch(),
          interval_seconds: this.intervalSeconds(),
          total_numbers: this.totalNumbers(),
        },
      })
      .subscribe({
        next: (jobResponse: ScientificJobView) => {
          this.currentJobId.set(jobResponse.id);

          if (jobResponse.status === 'completed') {
            const immediateResultData: RandomNumbersResultData | null =
              this.extractResultData(jobResponse);
            if (immediateResultData === null) {
              this.activeSection.set('error');
              this.errorMessage.set('The final payload format is invalid.');
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
          this.errorMessage.set(`Unable to create random numbers job: ${dispatchError.message}`);
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
    this.isControlActionLoading.set(false);
  }

  pauseCurrentJob(): void {
    const currentJobId: string | null = this.currentJobId();
    if (currentJobId === null) {
      return;
    }

    this.isControlActionLoading.set(true);
    this.jobsApiService.pauseJob(currentJobId).subscribe({
      next: (controlResult: JobControlActionResult) => {
        this.isControlActionLoading.set(false);
        this.progressSnapshot.update((currentSnapshot) =>
          currentSnapshot === null
            ? currentSnapshot
            : {
                ...currentSnapshot,
                status: controlResult.job.status,
                progress_stage: this.normalizeProgressStage(
                  controlResult.job.progress_stage,
                  currentSnapshot.progress_stage,
                ),
                progress_message: controlResult.job.progress_message,
                progress_percentage: controlResult.job.progress_percentage,
              },
        );
      },
      error: (controlError: Error) => {
        this.isControlActionLoading.set(false);
        this.errorMessage.set(`Unable to pause job: ${controlError.message}`);
      },
    });
  }

  resumeCurrentJob(): void {
    const currentJobId: string | null = this.currentJobId();
    if (currentJobId === null) {
      return;
    }

    this.isControlActionLoading.set(true);
    this.jobsApiService.resumeJob(currentJobId).subscribe({
      next: (controlResult: JobControlActionResult) => {
        this.isControlActionLoading.set(false);
        this.activeSection.set('progress');
        this.progressSnapshot.update((currentSnapshot) =>
          currentSnapshot === null
            ? currentSnapshot
            : {
                ...currentSnapshot,
                status: controlResult.job.status,
                progress_stage: this.normalizeProgressStage(
                  controlResult.job.progress_stage,
                  currentSnapshot.progress_stage,
                ),
                progress_message: controlResult.job.progress_message,
                progress_percentage: controlResult.job.progress_percentage,
              },
        );
        this.startProgressStream(currentJobId);
      },
      error: (controlError: Error) => {
        this.isControlActionLoading.set(false);
        this.errorMessage.set(`Unable to resume job: ${controlError.message}`);
      },
    });
  }

  /** Carga historial de jobs random-numbers para reabrir resultados pasados */
  loadHistory(): void {
    this.isHistoryLoading.set(true);

    this.jobsApiService.listJobs({ pluginName: 'random-numbers' }).subscribe({
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

  /** Reabre un job histórico por id para visualizar su resultado en la app */
  openHistoricalJob(jobId: string): void {
    this.logsSubscription?.unsubscribe();
    this.progressSubscription?.unsubscribe();
    this.activeSection.set('dispatching');
    this.errorMessage.set(null);
    this.currentJobId.set(jobId);
    this.jobLogs.set([]);
    this.progressSnapshot.set(null);

    this.jobsApiService.getScientificJobStatus(jobId).subscribe({
      next: (jobResponse: ScientificJobView) => {
        if (jobResponse.status === 'failed') {
          this.loadHistoricalLogs(jobId);
          this.activeSection.set('error');
          this.errorMessage.set(jobResponse.error_trace ?? 'Historical job failed.');
          return;
        }

        const historicalResultData: RandomNumbersResultData | null =
          this.extractResultData(jobResponse) ?? this.extractSummaryData(jobResponse);
        if (historicalResultData === null) {
          this.activeSection.set('error');
          this.errorMessage.set('Unable to reconstruct result or historical summary for this job.');
          return;
        }

        this.resultData.set(historicalResultData);
        this.syncProgressSnapshotFromJob(jobResponse);
        this.loadHistoricalLogs(jobId);
        this.activeSection.set('result');
      },
      error: (statusError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to recover historical job: ${statusError.message}`);
      },
    });
  }

  ngOnDestroy(): void {
    this.progressSubscription?.unsubscribe();
    this.logsSubscription?.unsubscribe();
  }

  private startProgressStream(jobId: string): void {
    this.progressSubscription?.unsubscribe();
    this.startLogsStream(jobId);
    this.progressSubscription = this.jobsApiService.streamJobEvents(jobId).subscribe({
      next: (snapshot: JobProgressSnapshotView) => this.progressSnapshot.set(snapshot),
      complete: () => {
        const latestSnapshot: JobProgressSnapshotView | null = this.progressSnapshot();
        this.logsSubscription?.unsubscribe();
        this.logsSubscription = null;
        if (latestSnapshot !== null && latestSnapshot.status === 'paused') {
          return;
        }
        this.fetchFinalResult(jobId);
      },
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
        // Mantener flujo de progreso aun cuando falle stream SSE de logs.
      },
    });
  }

  private loadHistoricalLogs(jobId: string): void {
    this.jobsApiService.getJobLogs(jobId, { limit: 250 }).subscribe({
      next: (logsPage) => this.jobLogs.set(logsPage.results),
      error: () => {
        // No bloquear render de resultados si falla la consulta de logs históricos.
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
          this.errorMessage.set(jobResponse.error_trace ?? 'Job failed with no details.');
          return;
        }

        const finalResultData: RandomNumbersResultData | null = this.extractResultData(jobResponse);
        if (finalResultData === null) {
          this.activeSection.set('error');
          this.errorMessage.set('The final payload format is invalid.');
          return;
        }

        this.resultData.set(finalResultData);
        this.loadHistoricalLogs(jobId);
        this.activeSection.set('result');
        this.loadHistory();
      },
      error: (statusError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to recover final result: ${statusError.message}`);
      },
    });
  }

  private extractResultData(jobResponse: ScientificJobView): RandomNumbersResultData | null {
    const rawResults: unknown = jobResponse.results;
    if (!this.isRecord(rawResults)) {
      return null;
    }

    const rawGeneratedNumbers: unknown = rawResults['generated_numbers'];
    const rawMetadata: unknown = rawResults['metadata'];
    if (!Array.isArray(rawGeneratedNumbers) || !this.isRecord(rawMetadata)) {
      return null;
    }

    const generatedNumbers: number[] = rawGeneratedNumbers.filter(
      (value: unknown): value is number => typeof value === 'number',
    );

    const seedUrl: unknown = rawMetadata['seed_url'];
    const seedDigest: unknown = rawMetadata['seed_digest'];
    const numbersPerBatch: unknown = rawMetadata['numbers_per_batch'];
    const intervalSeconds: unknown = rawMetadata['interval_seconds'];
    const totalNumbers: unknown = rawMetadata['total_numbers'];

    if (
      typeof seedUrl !== 'string' ||
      typeof seedDigest !== 'string' ||
      typeof numbersPerBatch !== 'number' ||
      typeof intervalSeconds !== 'number' ||
      typeof totalNumbers !== 'number'
    ) {
      return null;
    }

    return {
      generatedNumbers,
      seedUrl,
      seedDigest,
      numbersPerBatch,
      intervalSeconds,
      totalNumbers,
      isHistoricalSummary: false,
      summaryMessage: null,
    };
  }

  private extractSummaryData(jobResponse: ScientificJobView): RandomNumbersResultData | null {
    const rawParameters: unknown = jobResponse.parameters;
    if (!this.isRecord(rawParameters)) {
      return null;
    }

    const seedUrl: unknown = rawParameters['seed_url'];
    const numbersPerBatch: unknown = rawParameters['numbers_per_batch'];
    const intervalSeconds: unknown = rawParameters['interval_seconds'];
    const totalNumbers: unknown = rawParameters['total_numbers'];

    if (
      typeof seedUrl !== 'string' ||
      typeof numbersPerBatch !== 'number' ||
      typeof intervalSeconds !== 'number' ||
      typeof totalNumbers !== 'number'
    ) {
      return null;
    }

    const rawRuntimeState: unknown = jobResponse.runtime_state;
    const generatedNumbers: number[] = this.extractGeneratedNumbersFromRuntime(rawRuntimeState);
    const summaryMessage: string = this.buildHistoricalSummaryMessage(
      jobResponse.status,
      generatedNumbers.length,
      totalNumbers,
    );

    return {
      generatedNumbers,
      seedUrl,
      seedDigest: 'Not available yet (job not completed)',
      numbersPerBatch,
      intervalSeconds,
      totalNumbers,
      isHistoricalSummary: true,
      summaryMessage,
    };
  }

  private extractGeneratedNumbersFromRuntime(rawRuntimeState: unknown): number[] {
    if (!this.isRecord(rawRuntimeState)) {
      return [];
    }

    const runtimeGeneratedNumbers: unknown = rawRuntimeState['generated_numbers'];
    if (!Array.isArray(runtimeGeneratedNumbers)) {
      return [];
    }

    return runtimeGeneratedNumbers.filter(
      (value: unknown): value is number => typeof value === 'number',
    );
  }

  private buildHistoricalSummaryMessage(
    jobStatus: ScientificJobView['status'],
    generatedCount: number,
    totalNumbers: number,
  ): string {
    if (jobStatus === 'paused') {
      return `Partial summary: paused job with ${generatedCount}/${totalNumbers} generated numbers.`;
    }
    if (jobStatus === 'running' || jobStatus === 'pending') {
      return `Partial summary: running job with ${generatedCount}/${totalNumbers} generated numbers.`;
    }
    if (jobStatus === 'completed') {
      return `Historical summary rebuilt: ${generatedCount}/${totalNumbers} numbers available.`;
    }
    return `Historical summary available: ${generatedCount}/${totalNumbers} generated numbers.`;
  }

  private syncProgressSnapshotFromJob(jobResponse: ScientificJobView): void {
    const normalizedStage: JobProgressSnapshotView['progress_stage'] = this.normalizeProgressStage(
      jobResponse.progress_stage,
      'pending',
    );

    this.progressSnapshot.set({
      job_id: jobResponse.id,
      status: this.normalizeStatus(jobResponse.status),
      progress_percentage: jobResponse.progress_percentage,
      progress_stage: normalizedStage,
      progress_message: jobResponse.progress_message,
      progress_event_index: jobResponse.progress_event_index,
      updated_at: jobResponse.updated_at,
    });
  }

  private normalizeStatus(rawStatus: string): ScientificJobView['status'] {
    return SUPPORTED_JOB_STATUSES.includes(rawStatus as ScientificJobView['status'])
      ? (rawStatus as ScientificJobView['status'])
      : 'pending';
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
