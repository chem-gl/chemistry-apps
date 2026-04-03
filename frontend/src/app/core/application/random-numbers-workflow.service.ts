// random-numbers-workflow.service.ts: Orquesta formulario, progreso y resultado de random numbers.

import { Injectable, computed, signal } from '@angular/core';
import {
  JobControlActionResult,
  JobProgressSnapshotView,
  ScientificJobView,
} from '../api/jobs-api.service';
import { BaseJobWorkflowService } from './base-job-workflow.service';

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

const SUPPORTED_PROGRESS_STAGES = new Set<JobProgressSnapshotView['progress_stage']>([
  'pending',
  'queued',
  'running',
  'paused',
  'recovering',
  'caching',
  'completed',
  'failed',
  'cancelled',
]);

const SUPPORTED_JOB_STATUSES = new Set<ScientificJobView['status']>([
  'pending',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
]);

@Injectable()
export class RandomNumbersWorkflowService extends BaseJobWorkflowService<RandomNumbersResultData> {
  protected override get defaultProgressMessage(): string {
    return 'Preparing generation...';
  }

  readonly seedUrl = signal<string>('https://example.com/seed.txt');
  readonly numbersPerBatch = signal<number>(5);
  readonly intervalSeconds = signal<number>(120);
  readonly totalNumbers = signal<number>(55);

  readonly isControlActionLoading = signal<boolean>(false);

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

  private normalizeProgressStage(
    rawProgressStage: string,
    fallbackStage: JobProgressSnapshotView['progress_stage'],
  ): JobProgressSnapshotView['progress_stage'] {
    return SUPPORTED_PROGRESS_STAGES.has(
      rawProgressStage as JobProgressSnapshotView['progress_stage'],
    )
      ? (rawProgressStage as JobProgressSnapshotView['progress_stage'])
      : fallbackStage;
  }

  override dispatch(): void {
    this.prepareForDispatch();

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
          this.handleDispatchJobResponse(
            jobResponse,
            (job) => this.extractResultData(job),
            'random numbers',
          );
        },
        error: (dispatchError: Error) => {
          this.activeSection.set('error');
          this.errorMessage.set(`Unable to create random numbers job: ${dispatchError.message}`);
        },
      });
  }

  override reset(): void {
    super.reset();
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

  override loadHistory(): void {
    this.loadHistoryForPlugin('random-numbers');
  }

  /** Reabre un job histórico por id para visualizar su resultado en la app */
  openHistoricalJob(jobId: string): void {
    this.prepareForDispatch();
    this.currentJobId.set(jobId);

    this.jobsApiService.getScientificJobStatus(jobId).subscribe({
      next: (jobResponse: ScientificJobView) => {
        this.handleJobOutcome(
          jobId,
          jobResponse,
          (job) => {
            const result = this.extractResultData(job) ?? this.extractSummaryData(job);
            if (result !== null) this.syncProgressSnapshotFromJob(job);
            return result;
          },
          { loadHistoryAfter: false },
        );
      },
      error: (statusError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to recover historical job: ${statusError.message}`);
      },
    });
  }

  protected override startProgressStream(jobId: string): void {
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

  protected override fetchFinalResult(jobId: string): void {
    this.jobsApiService.getScientificJobStatus(jobId).subscribe({
      next: (jobResponse: ScientificJobView) => {
        this.handleJobOutcome(jobId, jobResponse, (job) => this.extractResultData(job));
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
    const summaryMessage: string = this.buildPartialSummaryMessage(
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

  private buildPartialSummaryMessage(
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
    return SUPPORTED_JOB_STATUSES.has(rawStatus as ScientificJobView['status'])
      ? (rawStatus as ScientificJobView['status'])
      : 'pending';
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
