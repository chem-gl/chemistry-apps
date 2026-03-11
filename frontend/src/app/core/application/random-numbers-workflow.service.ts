// random-numbers-workflow.service.ts: Orquesta formulario, progreso y resultado de random numbers.

import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { JobProgressSnapshot, ScientificJob } from '../api/generated';
import { JobsApiService } from '../api/jobs-api.service';

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
}

@Injectable()
export class RandomNumbersWorkflowService implements OnDestroy {
  private readonly jobsApiService = inject(JobsApiService);
  private progressSubscription: Subscription | null = null;

  readonly seedUrl = signal<string>('https://example.com/seed.txt');
  readonly numbersPerBatch = signal<number>(5);
  readonly intervalSeconds = signal<number>(120);
  readonly totalNumbers = signal<number>(55);

  readonly activeSection = signal<RandomNumbersSection>('idle');
  readonly currentJobId = signal<string | null>(null);
  readonly progressSnapshot = signal<JobProgressSnapshot | null>(null);
  readonly resultData = signal<RandomNumbersResultData | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly historyJobs = signal<ScientificJob[]>([]);
  readonly isHistoryLoading = signal<boolean>(false);

  readonly isProcessing = computed(
    () => this.activeSection() === 'dispatching' || this.activeSection() === 'progress',
  );

  readonly progressPercentage = computed(() => this.progressSnapshot()?.progress_percentage ?? 0);

  readonly progressMessage = computed(
    () => this.progressSnapshot()?.progress_message ?? 'Preparando generación...',
  );

  dispatch(): void {
    this.progressSubscription?.unsubscribe();
    this.activeSection.set('dispatching');
    this.errorMessage.set(null);
    this.resultData.set(null);
    this.progressSnapshot.set(null);
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
        next: (jobResponse: ScientificJob) => {
          this.currentJobId.set(jobResponse.id);

          if (jobResponse.status === 'completed') {
            const immediateResultData: RandomNumbersResultData | null =
              this.extractResultData(jobResponse);
            if (immediateResultData === null) {
              this.activeSection.set('error');
              this.errorMessage.set('El payload final no tiene el formato esperado.');
              return;
            }

            this.resultData.set(immediateResultData);
            this.activeSection.set('result');
            this.loadHistory();
            return;
          }

          this.activeSection.set('progress');
          this.startProgressStream(jobResponse.id);
        },
        error: (dispatchError: Error) => {
          this.activeSection.set('error');
          this.errorMessage.set(`Error al crear job random numbers: ${dispatchError.message}`);
        },
      });
  }

  reset(): void {
    this.progressSubscription?.unsubscribe();
    this.activeSection.set('idle');
    this.currentJobId.set(null);
    this.progressSnapshot.set(null);
    this.resultData.set(null);
    this.errorMessage.set(null);
  }

  /** Carga historial de jobs random-numbers para reabrir resultados pasados */
  loadHistory(): void {
    this.isHistoryLoading.set(true);

    this.jobsApiService.listJobs({ pluginName: 'random-numbers' }).subscribe({
      next: (jobItems: ScientificJob[]) => {
        const orderedJobs: ScientificJob[] = [...jobItems].sort(
          (leftJob: ScientificJob, rightJob: ScientificJob) =>
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
    this.activeSection.set('dispatching');
    this.errorMessage.set(null);
    this.currentJobId.set(jobId);

    this.jobsApiService.getScientificJobStatus(jobId).subscribe({
      next: (jobResponse: ScientificJob) => {
        if (jobResponse.status === 'failed') {
          this.activeSection.set('error');
          this.errorMessage.set(jobResponse.error_trace ?? 'El job histórico terminó con error.');
          return;
        }

        const historicalResultData: RandomNumbersResultData | null =
          this.extractResultData(jobResponse);
        if (historicalResultData === null) {
          this.activeSection.set('error');
          this.errorMessage.set('No fue posible reconstruir el resultado histórico del job.');
          return;
        }

        this.resultData.set(historicalResultData);
        this.activeSection.set('result');
      },
      error: (statusError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Error recuperando job histórico: ${statusError.message}`);
      },
    });
  }

  ngOnDestroy(): void {
    this.progressSubscription?.unsubscribe();
  }

  private startProgressStream(jobId: string): void {
    this.progressSubscription = this.jobsApiService.streamJobEvents(jobId).subscribe({
      next: (snapshot: JobProgressSnapshot) => this.progressSnapshot.set(snapshot),
      complete: () => this.fetchFinalResult(jobId),
      error: () => this.startPollingFallback(jobId),
    });
  }

  private startPollingFallback(jobId: string): void {
    this.progressSubscription = this.jobsApiService.pollJobUntilCompleted(jobId, 1000).subscribe({
      next: (snapshot: JobProgressSnapshot) => {
        this.progressSnapshot.set(snapshot);
        this.fetchFinalResult(jobId);
      },
      error: (pollingError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Error verificando progreso: ${pollingError.message}`);
      },
    });
  }

  private fetchFinalResult(jobId: string): void {
    this.jobsApiService.getScientificJobStatus(jobId).subscribe({
      next: (jobResponse: ScientificJob) => {
        if (jobResponse.status === 'failed') {
          this.activeSection.set('error');
          this.errorMessage.set(jobResponse.error_trace ?? 'El job terminó con error sin detalle.');
          return;
        }

        const finalResultData: RandomNumbersResultData | null = this.extractResultData(jobResponse);
        if (finalResultData === null) {
          this.activeSection.set('error');
          this.errorMessage.set('El payload final no tiene el formato esperado.');
          return;
        }

        this.resultData.set(finalResultData);
        this.activeSection.set('result');
        this.loadHistory();
      },
      error: (statusError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Error recuperando resultado: ${statusError.message}`);
      },
    });
  }

  private extractResultData(jobResponse: ScientificJob): RandomNumbersResultData | null {
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
    };
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
