// tunnel-workflow.service.ts: Orquesta formulario, trazabilidad de entradas, progreso y resultados de Tunnel.

import { Injectable, signal } from '@angular/core';
import { Observable } from 'rxjs';
import {
  DownloadedReportFile,
  ScientificJobView,
  TunnelInputChangeEvent,
} from '../api/jobs-api.service';
import { BaseJobWorkflowService } from './base-job-workflow.service';

export interface TunnelResultData {
  reactionBarrierZpe: number;
  imaginaryFrequency: number;
  reactionEnergyZpe: number;
  temperature: number;
  u: number | null;
  alpha1: number | null;
  alpha2: number | null;
  g: number | null;
  kappaTst: number | null;
  modelName: string | null;
  sourceLibrary: string | null;
  inputEventCount: number;
  isHistoricalSummary: boolean;
  summaryMessage: string | null;
}

@Injectable()
export class TunnelWorkflowService extends BaseJobWorkflowService<TunnelResultData> {
  protected override get defaultProgressMessage(): string {
    return 'Preparing tunnel effect calculation...';
  }

  readonly reactionBarrierZpe = signal<number>(3.5);
  readonly imaginaryFrequency = signal<number>(625);
  readonly reactionEnergyZpe = signal<number>(-8.2);
  readonly temperature = signal<number>(298.15);

  readonly inputChangeEvents = signal<TunnelInputChangeEvent[]>([]);

  updateReactionBarrierZpe(nextValue: number): void {
    const previousValue: number = this.reactionBarrierZpe();
    this.reactionBarrierZpe.set(Number(nextValue));
    this.recordInputChange('reaction_barrier_zpe', previousValue, Number(nextValue));
  }

  updateImaginaryFrequency(nextValue: number): void {
    const previousValue: number = this.imaginaryFrequency();
    this.imaginaryFrequency.set(Number(nextValue));
    this.recordInputChange('imaginary_frequency', previousValue, Number(nextValue));
  }

  updateReactionEnergyZpe(nextValue: number): void {
    const previousValue: number = this.reactionEnergyZpe();
    this.reactionEnergyZpe.set(Number(nextValue));
    this.recordInputChange('reaction_energy_zpe', previousValue, Number(nextValue));
  }

  updateTemperature(nextValue: number): void {
    const previousValue: number = this.temperature();
    this.temperature.set(Number(nextValue));
    this.recordInputChange('temperature', previousValue, Number(nextValue));
  }

  clearInputHistory(): void {
    this.inputChangeEvents.set([]);
  }

  private recordInputChange(fieldName: string, previousValue: number, newValue: number): void {
    const changeEvent: TunnelInputChangeEvent = {
      fieldName,
      previousValue,
      newValue,
      changedAt: new Date().toISOString(),
    };
    this.inputChangeEvents.update((events) => [...events, changeEvent]);
  }

  override dispatch(): void {
    this.prepareForDispatch();

    this.jobsApiService
      .dispatchTunnelJob({
        reactionBarrierZpe: this.reactionBarrierZpe(),
        imaginaryFrequency: this.imaginaryFrequency(),
        reactionEnergyZpe: this.reactionEnergyZpe(),
        temperature: this.temperature(),
        inputChangeEvents: this.inputChangeEvents(),
      })
      .subscribe({
        next: (jobResponse: ScientificJobView) => {
          this.syncInputsFromJobParameters(jobResponse);
          this.handleDispatchJobResponse(
            jobResponse,
            (job) => this.extractResultData(job),
            'tunnel effect',
          );
        },
        error: (dispatchError: Error) => {
          this.activeSection.set('error');
          this.errorMessage.set(`Unable to create tunnel job: ${dispatchError.message}`);
        },
      });
  }

  override loadHistory(): void {
    this.loadHistoryForPlugin('tunnel-effect');
  }

  openHistoricalJob(jobId: string): void {
    this.prepareForDispatch();
    this.currentJobId.set(jobId);

    this.jobsApiService.getScientificJobStatus(jobId).subscribe({
      next: (jobResponse: ScientificJobView) => {
        this.syncInputsFromJobParameters(jobResponse);
        this.handleJobOutcome(
          jobId,
          jobResponse,
          (job) => this.extractResultData(job) ?? this.extractSummaryData(job),
          { loadHistoryAfter: false },
        );
      },
      error: (statusError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to recover historical tunnel job: ${statusError.message}`);
      },
    });
  }

  downloadCsvReport(): Observable<DownloadedReportFile> {
    return this.buildDownloadStream(
      this.jobsApiService.downloadTunnelCsvReport(this.currentJobId()!),
      'CSV report',
    );
  }

  downloadLogReport(): Observable<DownloadedReportFile> {
    return this.buildDownloadStream(
      this.jobsApiService.downloadTunnelLogReport(this.currentJobId()!),
      'LOG report',
    );
  }

  protected override fetchFinalResult(jobId: string): void {
    this.jobsApiService.getScientificJobStatus(jobId).subscribe({
      next: (jobResponse: ScientificJobView) => {
        this.syncInputsFromJobParameters(jobResponse);
        this.handleJobOutcome(jobId, jobResponse, (job) => this.extractResultData(job));
      },
      error: (statusError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to get tunnel final result: ${statusError.message}`);
      },
    });
  }

  private extractResultData(jobResponse: ScientificJobView): TunnelResultData | null {
    const rawResults: unknown = jobResponse.results;
    if (!this.isRecord(rawResults)) {
      return null;
    }

    const rawU: unknown = rawResults['u'];
    const rawAlpha1: unknown = rawResults['alpha_1'];
    const rawAlpha2: unknown = rawResults['alpha_2'];
    const rawG: unknown = rawResults['g'];
    const rawKappa: unknown = rawResults['kappa_tst'];
    const rawMetadata: unknown = rawResults['metadata'];

    if (
      typeof rawU !== 'number' ||
      typeof rawAlpha1 !== 'number' ||
      typeof rawAlpha2 !== 'number' ||
      typeof rawG !== 'number' ||
      typeof rawKappa !== 'number' ||
      !this.isRecord(rawMetadata)
    ) {
      return null;
    }

    const parametersData: TunnelResultData | null = this.extractSummaryData(jobResponse);
    if (parametersData === null) {
      return null;
    }

    const modelName: unknown = rawMetadata['model_name'];
    const sourceLibrary: unknown = rawMetadata['source_library'];
    const inputEventCount: unknown = rawMetadata['input_event_count'];

    return {
      ...parametersData,
      u: rawU,
      alpha1: rawAlpha1,
      alpha2: rawAlpha2,
      g: rawG,
      kappaTst: rawKappa,
      modelName: typeof modelName === 'string' ? modelName : null,
      sourceLibrary: typeof sourceLibrary === 'string' ? sourceLibrary : null,
      inputEventCount: typeof inputEventCount === 'number' ? inputEventCount : 0,
      isHistoricalSummary: false,
      summaryMessage: null,
    };
  }

  private extractSummaryData(jobResponse: ScientificJobView): TunnelResultData | null {
    const rawParameters: unknown = jobResponse.parameters;
    if (!this.isRecord(rawParameters)) {
      return null;
    }

    const rawReactionBarrierZpe: unknown = rawParameters['reaction_barrier_zpe'];
    const rawImaginaryFrequency: unknown = rawParameters['imaginary_frequency'];
    const rawReactionEnergyZpe: unknown = rawParameters['reaction_energy_zpe'];
    const rawTemperature: unknown = rawParameters['temperature'];

    if (
      typeof rawReactionBarrierZpe !== 'number' ||
      typeof rawImaginaryFrequency !== 'number' ||
      typeof rawReactionEnergyZpe !== 'number' ||
      typeof rawTemperature !== 'number'
    ) {
      return null;
    }

    return {
      reactionBarrierZpe: rawReactionBarrierZpe,
      imaginaryFrequency: rawImaginaryFrequency,
      reactionEnergyZpe: rawReactionEnergyZpe,
      temperature: rawTemperature,
      u: null,
      alpha1: null,
      alpha2: null,
      g: null,
      kappaTst: null,
      modelName: null,
      sourceLibrary: null,
      inputEventCount: this.extractInputEventsFromParameters(rawParameters).length,
      isHistoricalSummary: true,
      summaryMessage: this.buildHistoricalSummaryMessage(jobResponse.status),
    };
  }

  private syncInputsFromJobParameters(jobResponse: ScientificJobView): void {
    const rawParameters: unknown = jobResponse.parameters;
    if (!this.isRecord(rawParameters)) {
      return;
    }

    const rawReactionBarrierZpe: unknown = rawParameters['reaction_barrier_zpe'];
    const rawImaginaryFrequency: unknown = rawParameters['imaginary_frequency'];
    const rawReactionEnergyZpe: unknown = rawParameters['reaction_energy_zpe'];
    const rawTemperature: unknown = rawParameters['temperature'];

    if (typeof rawReactionBarrierZpe === 'number') {
      this.reactionBarrierZpe.set(rawReactionBarrierZpe);
    }

    if (typeof rawImaginaryFrequency === 'number') {
      this.imaginaryFrequency.set(rawImaginaryFrequency);
    }

    if (typeof rawReactionEnergyZpe === 'number') {
      this.reactionEnergyZpe.set(rawReactionEnergyZpe);
    }

    if (typeof rawTemperature === 'number') {
      this.temperature.set(rawTemperature);
    }

    this.inputChangeEvents.set(this.extractInputEventsFromParameters(rawParameters));
  }

  private extractInputEventsFromParameters(
    rawParameters: Record<string, unknown>,
  ): TunnelInputChangeEvent[] {
    const rawEvents: unknown = rawParameters['input_change_events'];
    if (!Array.isArray(rawEvents)) {
      return [];
    }

    const parsedEvents: TunnelInputChangeEvent[] = [];
    for (const eventCandidate of rawEvents) {
      if (!this.isRecord(eventCandidate)) {
        continue;
      }

      const rawFieldName: unknown = eventCandidate['field_name'];
      const rawPreviousValue: unknown = eventCandidate['previous_value'];
      const rawNewValue: unknown = eventCandidate['new_value'];
      const rawChangedAt: unknown = eventCandidate['changed_at'];

      if (
        typeof rawFieldName !== 'string' ||
        typeof rawPreviousValue !== 'number' ||
        typeof rawNewValue !== 'number' ||
        typeof rawChangedAt !== 'string'
      ) {
        continue;
      }

      parsedEvents.push({
        fieldName: rawFieldName,
        previousValue: rawPreviousValue,
        newValue: rawNewValue,
        changedAt: rawChangedAt,
      });
    }

    return parsedEvents;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
