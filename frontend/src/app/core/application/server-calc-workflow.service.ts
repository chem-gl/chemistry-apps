// server-calc-workflow.service.ts: Orquesta formulario, ejecución remota y resultados de Server Calc.

import { Injectable, signal } from '@angular/core';
import { ScientificJobView } from '../api/jobs-api.service';
import { BaseJobWorkflowService } from './base-job-workflow.service';

export type ServerCalcOperator = '+' | '-' | '*' | '/';

export const SERVER_CALC_OPERATORS: ReadonlyArray<ServerCalcOperator> = ['+', '-', '*', '/'];

export interface ServerCalcResultData {
  a: number;
  op: ServerCalcOperator;
  b: number;
  result: number | null;
  fileName: string | null;
  filePath: string | null;
  executedOn: string | null;
  remoteHost: string | null;
  fallbackUsed: boolean | null;
}

@Injectable()
export class ServerCalcWorkflowService extends BaseJobWorkflowService<ServerCalcResultData> {
  protected override get workflowPluginName(): string {
    return 'server-calc';
  }
  protected override get defaultProgressMessage(): string {
    return 'Preparing remote calculation...';
  }

  readonly a = signal<number>(7);
  readonly b = signal<number>(6);
  readonly op = signal<ServerCalcOperator>('*');

  updateA(nextValue: number): void {
    this.a.set(Number(nextValue));
  }

  updateB(nextValue: number): void {
    this.b.set(Number(nextValue));
  }

  updateOp(nextValue: string): void {
    if (nextValue === '+' || nextValue === '-' || nextValue === '*' || nextValue === '/') {
      this.op.set(nextValue);
    }
  }

  override dispatch(): void {
    if (this.op() === '/' && this.b() === 0) {
      this.activeSection.set('error');
      this.errorMessage.set('Division by zero is not allowed.');
      return;
    }
    this.prepareForDispatch();

    this.jobsApiService
      .dispatchServerCalcJob({
        a: this.a(),
        op: this.op(),
        b: this.b(),
      })
      .subscribe({
        next: (jobResponse: ScientificJobView) => {
          this.syncInputsFromJobParameters(jobResponse);
          this.handleTransientDispatchJobResponse(
            jobResponse,
            (job) => this.extractResultData(job),
            'server calc',
          );
          if (this.activeSection() === 'result') {
            this.loadHistoricalLogs(jobResponse.id);
          }
        },
        error: (dispatchError: Error) => {
          this.activeSection.set('error');
          this.errorMessage.set(`Unable to create server calc job: ${dispatchError.message}`);
        },
      });
  }

  override loadHistory(): void {
    this.historyJobs.set([]);
    this.isHistoryLoading.set(false);
  }

  protected override fetchFinalResult(jobId: string): void {
    const api = this.jobsApiService as unknown as Record<string, unknown>;
    const statusRequest$ =
      typeof api['getServerCalcJobStatus'] === 'function'
        ? this.jobsApiService.getServerCalcJobStatus(jobId)
        : this.jobsApiService.getScientificJobStatus(jobId);
    statusRequest$.subscribe({
      next: (jobResponse: ScientificJobView) => {
        this.syncInputsFromJobParameters(jobResponse);
        this.handleJobOutcome(jobId, jobResponse, (job) => this.extractResultData(job), {
          loadHistoryAfter: false,
        });
      },
      error: (statusError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to get server calc final result: ${statusError.message}`);
      },
    });
  }

  private extractResultData(jobResponse: ScientificJobView): ServerCalcResultData | null {
    const rawResults: unknown = jobResponse.results;
    if (!this.isRecord(rawResults)) {
      return null;
    }

    const rawResult: unknown = rawResults['result'];
    const rawFileName: unknown = rawResults['file_name'];
    const rawFilePath: unknown = rawResults['file_path'];
    const rawMetadata: unknown = rawResults['metadata'];

    if (typeof rawResult !== 'number' || !this.isRecord(rawMetadata)) {
      return null;
    }

    const parametersData: ServerCalcResultData | null = this.extractParametersData(jobResponse);
    if (parametersData === null) {
      return null;
    }

    const executedOn: unknown = rawMetadata['executed_on'];
    const remoteHost: unknown = rawMetadata['remote_host'];
    const fallbackUsed: unknown = rawMetadata['fallback_used'];

    return {
      ...parametersData,
      result: rawResult,
      fileName: typeof rawFileName === 'string' ? rawFileName : null,
      filePath: typeof rawFilePath === 'string' ? rawFilePath : null,
      executedOn: typeof executedOn === 'string' ? executedOn : null,
      remoteHost: typeof remoteHost === 'string' ? remoteHost : null,
      fallbackUsed: typeof fallbackUsed === 'boolean' ? fallbackUsed : null,
    };
  }

  private extractParametersData(jobResponse: ScientificJobView): ServerCalcResultData | null {
    const rawParameters: unknown = jobResponse.parameters;
    if (!this.isRecord(rawParameters)) {
      return null;
    }

    const rawA: unknown = rawParameters['a'];
    const rawOp: unknown = rawParameters['op'];
    const rawB: unknown = rawParameters['b'];

    if (typeof rawA !== 'number' || typeof rawB !== 'number' || typeof rawOp !== 'string') {
      return null;
    }
    if (rawOp !== '+' && rawOp !== '-' && rawOp !== '*' && rawOp !== '/') {
      return null;
    }

    return {
      a: rawA,
      op: rawOp,
      b: rawB,
      result: null,
      fileName: null,
      filePath: null,
      executedOn: null,
      remoteHost: null,
      fallbackUsed: null,
    };
  }

  private syncInputsFromJobParameters(jobResponse: ScientificJobView): void {
    const rawParameters: unknown = jobResponse.parameters;
    if (!this.isRecord(rawParameters)) {
      return;
    }

    const rawA: unknown = rawParameters['a'];
    const rawOp: unknown = rawParameters['op'];
    const rawB: unknown = rawParameters['b'];

    if (typeof rawA === 'number') {
      this.a.set(rawA);
    }

    if (typeof rawOp === 'string') {
      this.updateOp(rawOp);
    }

    if (typeof rawB === 'number') {
      this.b.set(rawB);
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
