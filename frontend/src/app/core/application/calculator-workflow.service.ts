// calculator-workflow.service.ts: Orquesta el flujo de calculadora y separa la logica de UI.

import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import type {
  CalculatorJobResponse,
  CalculatorOperationEnum,
  JobProgressSnapshot,
} from '../api/generated';
import { CalculatorParams, JobsApiService } from '../api/jobs-api.service';

/** Descriptor de visualizacion para cada operacion disponible en el selector */
export interface OperationOption {
  value: CalculatorOperationEnum;
  label: string;
  requiresB: boolean;
}

/** Seccion activa del flujo de UI */
export type UiSection = 'idle' | 'dispatching' | 'progress' | 'result' | 'error';

/** Etapas del ciclo de vida del job tal como las emite el backend */
const STAGE_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  queued: 'En cola',
  running: 'Ejecutando',
  caching: 'Almacenando en cache',
  completed: 'Completado',
  failed: 'Fallido',
};

/** Orden de etapas para stepper visual */
const STAGE_STEPS: string[] = ['pending', 'queued', 'running', 'caching', 'completed'];

@Injectable()
export class CalculatorWorkflowService implements OnDestroy {
  private readonly jobsApiService = inject(JobsApiService);
  private progressSubscription: Subscription | null = null;

  readonly operations: OperationOption[] = [
    { value: 'add', label: 'Suma (+)', requiresB: true },
    { value: 'sub', label: 'Resta (-)', requiresB: true },
    { value: 'mul', label: 'Multiplicacion (x)', requiresB: true },
    { value: 'div', label: 'Division (/)', requiresB: true },
    { value: 'pow', label: 'Potencia (^)', requiresB: true },
    { value: 'factorial', label: 'Factorial (n!)', requiresB: false },
  ];

  readonly stageSteps: string[] = STAGE_STEPS;

  readonly selectedOperation = signal<CalculatorOperationEnum>('add');
  readonly firstOperand = signal<number>(5);
  readonly secondOperand = signal<number>(3);
  readonly activeSection = signal<UiSection>('idle');
  readonly currentJobId = signal<string | null>(null);
  readonly progressSnapshot = signal<JobProgressSnapshot | null>(null);
  readonly lastResult = signal<CalculatorJobResponse | null>(null);
  readonly errorMessage = signal<string | null>(null);

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
    () => this.progressSnapshot()?.progress_message ?? 'Preparando ejecucion...',
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
    this.activeSection.set('dispatching');
    this.errorMessage.set(null);
    this.lastResult.set(null);
    this.progressSnapshot.set(null);
    this.currentJobId.set(null);

    const jobParams: CalculatorParams = {
      op: this.selectedOperation(),
      a: this.firstOperand(),
      ...(this.requiresSecondOperand() ? { b: this.secondOperand() } : {}),
    };

    this.jobsApiService.dispatchCalculatorJob(jobParams).subscribe({
      next: (jobResponse: CalculatorJobResponse) => {
        this.currentJobId.set(jobResponse.id);

        if (jobResponse.status === 'completed') {
          this.lastResult.set(jobResponse);
          this.activeSection.set('result');
          return;
        }

        this.activeSection.set('progress');
        this.startProgressStream(jobResponse.id);
      },
      error: (dispatchError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Error al despachar: ${dispatchError.message}`);
      },
    });
  }

  reset(): void {
    this.progressSubscription?.unsubscribe();
    this.activeSection.set('idle');
    this.progressSnapshot.set(null);
    this.lastResult.set(null);
    this.errorMessage.set(null);
    this.currentJobId.set(null);
  }

  ngOnDestroy(): void {
    this.progressSubscription?.unsubscribe();
  }

  /** Permite cargar un resultado previo de calculadora usando un jobId existente */
  openHistoricalJob(jobId: string): void {
    this.progressSubscription?.unsubscribe();
    this.activeSection.set('dispatching');
    this.currentJobId.set(jobId);
    this.errorMessage.set(null);

    this.jobsApiService.getJobStatus(jobId).subscribe({
      next: (jobResponse: CalculatorJobResponse) => {
        if (jobResponse.status === 'failed') {
          this.activeSection.set('error');
          this.errorMessage.set(jobResponse.error_trace ?? 'El job histórico falló.');
          return;
        }

        this.lastResult.set(jobResponse);
        this.activeSection.set('result');
      },
      error: (statusError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Error recuperando job histórico: ${statusError.message}`);
      },
    });
  }

  private startProgressStream(jobId: string): void {
    this.progressSubscription = this.jobsApiService.streamJobEvents(jobId).subscribe({
      next: (jobSnapshot: JobProgressSnapshot) => this.progressSnapshot.set(jobSnapshot),
      complete: () => this.fetchFinalResult(jobId),
      error: () => this.startPollingFallback(jobId),
    });
  }

  private startPollingFallback(jobId: string): void {
    this.progressSubscription = this.jobsApiService.pollJobUntilCompleted(jobId, 1000).subscribe({
      next: (jobSnapshot: JobProgressSnapshot) => {
        this.progressSnapshot.set(jobSnapshot);
        this.fetchFinalResult(jobId);
      },
      error: (pollingError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Error verificando progreso: ${pollingError.message}`);
      },
    });
  }

  private fetchFinalResult(jobId: string): void {
    this.jobsApiService.getJobStatus(jobId).subscribe({
      next: (jobResponse: CalculatorJobResponse) => {
        if (jobResponse.status === 'failed') {
          this.activeSection.set('error');
          this.errorMessage.set(jobResponse.error_trace ?? 'El job fallo sin detalle disponible.');
          return;
        }

        this.lastResult.set(jobResponse);
        this.activeSection.set('result');
      },
      error: (statusError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Error obteniendo resultado: ${statusError.message}`);
      },
    });
  }
}
