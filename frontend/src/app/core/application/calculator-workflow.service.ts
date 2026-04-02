// calculator-workflow.service.ts: Orquesta el flujo de calculadora y separa la logica de UI.

import { Injectable, computed, signal } from '@angular/core';
import {
  CalculatorJobResponseView,
  CalculatorOperationView,
  CalculatorParams,
} from '../api/jobs-api.service';
import { BaseJobWorkflowService } from './base-job-workflow.service';

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
export class CalculatorWorkflowService extends BaseJobWorkflowService<CalculatorJobResponseView> {
  protected override get defaultProgressMessage(): string {
    return 'Preparing execution...';
  }

  /** Alias para compatibilidad con componentes que referencian lastResult */
  readonly lastResult = this.resultData;

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

  readonly requiresSecondOperand = computed(
    () =>
      this.operations.find((operation) => operation.value === this.selectedOperation())
        ?.requiresB ?? true,
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

  override dispatch(): void {
    this.prepareForDispatch();

    const jobParams: CalculatorParams = {
      op: this.selectedOperation(),
      a: this.firstOperand(),
      ...(this.requiresSecondOperand() ? { b: this.secondOperand() } : {}),
    };

    this.jobsApiService.dispatchCalculatorJob(jobParams).subscribe({
      next: (jobResponse: CalculatorJobResponseView) => {
        this.currentJobId.set(jobResponse.id);

        if (jobResponse.status === 'completed') {
          this.resultData.set(jobResponse);
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

  /** Permite cargar un resultado previo de calculadora usando un jobId existente */
  openHistoricalJob(jobId: string): void {
    this.prepareForDispatch();
    this.currentJobId.set(jobId);

    this.jobsApiService.getJobStatus(jobId).subscribe({
      next: (jobResponse: CalculatorJobResponseView) => {
        this.handleJobOutcome(jobId, jobResponse, (job) => job, { loadHistoryAfter: false });
      },
      error: (statusError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to recover historical job: ${statusError.message}`);
      },
    });
  }

  /** Carga historial de jobs de calculadora para reabrir resultados previos */
  override loadHistory(): void {
    this.loadHistoryForPlugin('calculator');
  }

  protected override fetchFinalResult(jobId: string): void {
    this.jobsApiService.getJobStatus(jobId).subscribe({
      next: (jobResponse: CalculatorJobResponseView) => {
        this.handleJobOutcome(jobId, jobResponse, (job) => job);
      },
      error: (statusError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to load final result: ${statusError.message}`);
      },
    });
  }
}
