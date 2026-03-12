// calculator-workflow.service.ts: Orquesta el flujo de calculadora y separa la logica de UI.

import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import {
  CalculatorJobResponseView,
  CalculatorOperationView,
  CalculatorParams,
  JobLogEntryView,
  JobProgressSnapshotView,
  JobsApiService,
  ScientificJobView,
} from '../api/jobs-api.service';

/** Descriptor de visualizacion para cada operacion disponible en el selector */
export interface OperationOption {
  value: CalculatorOperationView;
  label: string;
  requiresB: boolean;
}

/** Seccion activa del flujo de UI */
export type UiSection = 'idle' | 'dispatching' | 'progress' | 'result' | 'error';

/** Etapas del ciclo de vida del job tal como las emite el backend */
const STAGE_LABELS: Record<string, string> = {
  pending: 'Pending',
  queued: 'Queued',
  running: 'Running',
  recovering: 'Recovering',
  caching: 'Caching',
  completed: 'Completed',
  failed: 'Failed',
};

/** Orden de etapas para stepper visual */
const STAGE_STEPS: string[] = [
  'pending',
  'queued',
  'running',
  'recovering',
  'caching',
  'completed',
];

@Injectable()
export class CalculatorWorkflowService implements OnDestroy {
  private readonly jobsApiService = inject(JobsApiService);
  private progressSubscription: Subscription | null = null;
  private logsSubscription: Subscription | null = null;

  readonly operations: OperationOption[] = [
    { value: 'add', label: 'Addition (+)', requiresB: true },
    { value: 'sub', label: 'Subtraction (-)', requiresB: true },
    { value: 'mul', label: 'Multiplication (x)', requiresB: true },
    { value: 'div', label: 'Division (/)', requiresB: true },
    { value: 'pow', label: 'Power (^)', requiresB: true },
    { value: 'factorial', label: 'Factorial (n!)', requiresB: false },
  ];

  readonly stageSteps: string[] = STAGE_STEPS;

  readonly selectedOperation = signal<CalculatorOperationView>('add');
  readonly firstOperand = signal<number>(5);
  readonly secondOperand = signal<number>(3);
  readonly activeSection = signal<UiSection>('idle');
  readonly currentJobId = signal<string | null>(null);
  readonly progressSnapshot = signal<JobProgressSnapshotView | null>(null);
  readonly jobLogs = signal<JobLogEntryView[]>([]);
  readonly lastResult = signal<CalculatorJobResponseView | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly historyJobs = signal<ScientificJobView[]>([]);
  readonly isHistoryLoading = signal<boolean>(false);

  readonly requiresSecondOperand = computed(
    () =>
      this.operations.find((operation) => operation.value === this.selectedOperation())
        ?.requiresB ?? true,
  );

  readonly isProcessing = computed(
    () => this.activeSection() === 'dispatching' || this.activeSection() === 'progress',
  );

  readonly progressPercentage = computed(() => this.progressSnapshot()?.progress_percentage ?? 0);

  readonly progressMessage = computed(
    () => this.progressSnapshot()?.progress_message ?? 'Preparing execution...',
  );

  readonly currentStage = computed(() => this.progressSnapshot()?.progress_stage ?? 'pending');

  stageLabel(stageName: string): string {
    return STAGE_LABELS[stageName] ?? stageName;
  }

  isStepDone(stepName: string): boolean {
    const currentStageIndex: number = STAGE_STEPS.indexOf(this.currentStage());
    const stepIndex: number = STAGE_STEPS.indexOf(stepName);
    return stepIndex < currentStageIndex;
  }

  isStepActive(stepName: string): boolean {
    return this.currentStage() === stepName;
  }

  dispatch(): void {
    this.progressSubscription?.unsubscribe();
    this.logsSubscription?.unsubscribe();
    this.activeSection.set('dispatching');
    this.errorMessage.set(null);
    this.lastResult.set(null);
    this.progressSnapshot.set(null);
    this.jobLogs.set([]);
    this.currentJobId.set(null);

    const jobParams: CalculatorParams = {
      op: this.selectedOperation(),
      a: this.firstOperand(),
      ...(this.requiresSecondOperand() ? { b: this.secondOperand() } : {}),
    };

    this.jobsApiService.dispatchCalculatorJob(jobParams).subscribe({
      next: (jobResponse: CalculatorJobResponseView) => {
        this.currentJobId.set(jobResponse.id);

        if (jobResponse.status === 'completed') {
          this.lastResult.set(jobResponse);
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
        this.errorMessage.set(`Unable to dispatch job: ${dispatchError.message}`);
      },
    });
  }

  reset(): void {
    this.progressSubscription?.unsubscribe();
    this.logsSubscription?.unsubscribe();
    this.activeSection.set('idle');
    this.progressSnapshot.set(null);
    this.jobLogs.set([]);
    this.lastResult.set(null);
    this.errorMessage.set(null);
    this.currentJobId.set(null);
  }

  ngOnDestroy(): void {
    this.progressSubscription?.unsubscribe();
    this.logsSubscription?.unsubscribe();
  }

  /** Permite cargar un resultado previo de calculadora usando un jobId existente */
  openHistoricalJob(jobId: string): void {
    this.progressSubscription?.unsubscribe();
    this.logsSubscription?.unsubscribe();
    this.activeSection.set('dispatching');
    this.currentJobId.set(jobId);
    this.errorMessage.set(null);
    this.jobLogs.set([]);

    this.jobsApiService.getJobStatus(jobId).subscribe({
      next: (jobResponse: CalculatorJobResponseView) => {
        if (jobResponse.status === 'failed') {
          this.loadHistoricalLogs(jobId);
          this.activeSection.set('error');
          this.errorMessage.set(jobResponse.error_trace ?? 'Historical job failed.');
          return;
        }

        this.lastResult.set(jobResponse);
        this.loadHistoricalLogs(jobId);
        this.activeSection.set('result');
      },
      error: (statusError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to recover historical job: ${statusError.message}`);
      },
    });
  }

  /** Carga historial de jobs de calculadora para reabrir resultados previos */
  loadHistory(): void {
    this.isHistoryLoading.set(true);

    this.jobsApiService.listJobs({ pluginName: 'calculator' }).subscribe({
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

  private startProgressStream(jobId: string): void {
    this.startLogStream(jobId);
    this.progressSubscription = this.jobsApiService.streamJobEvents(jobId).subscribe({
      next: (jobSnapshot: JobProgressSnapshotView) => this.progressSnapshot.set(jobSnapshot),
      complete: () => this.fetchFinalResult(jobId),
      error: () => this.startPollingFallback(jobId),
    });
  }

  private startLogStream(jobId: string): void {
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
        // El stream SSE de logs puede cerrarse en reconexiones; no interrumpir flujo principal.
      },
    });
  }

  private loadHistoricalLogs(jobId: string): void {
    this.jobsApiService.getJobLogs(jobId, { limit: 200 }).subscribe({
      next: (logsPage) => this.jobLogs.set(logsPage.results),
      error: () => {
        // Mantener la UI funcional aunque no se puedan recuperar logs históricos.
      },
    });
  }

  private startPollingFallback(jobId: string): void {
    this.progressSubscription = this.jobsApiService.pollJobUntilCompleted(jobId, 1000).subscribe({
      next: (jobSnapshot: JobProgressSnapshotView) => {
        this.progressSnapshot.set(jobSnapshot);
        this.fetchFinalResult(jobId);
      },
      error: (pollingError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to track progress: ${pollingError.message}`);
      },
    });
  }

  private fetchFinalResult(jobId: string): void {
    this.jobsApiService.getJobStatus(jobId).subscribe({
      next: (jobResponse: CalculatorJobResponseView) => {
        if (jobResponse.status === 'failed') {
          this.loadHistoricalLogs(jobId);
          this.activeSection.set('error');
          this.errorMessage.set(jobResponse.error_trace ?? 'Job failed with no details available.');
          return;
        }

        this.lastResult.set(jobResponse);
        this.loadHistoricalLogs(jobId);
        this.activeSection.set('result');
        this.loadHistory();
      },
      error: (statusError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to load final result: ${statusError.message}`);
      },
    });
  }
}
