// tunnel-workflow.service.ts: Orquesta formulario, ejecución inmediata y resultados de Tunnel.

import { Injectable, signal } from '@angular/core';
import { ScientificJobView } from '../api/jobs-api.service';
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

  updateReactionBarrierZpe(nextValue: number): void {
    this.reactionBarrierZpe.set(Number(nextValue));
  }

  updateImaginaryFrequency(nextValue: number): void {
    this.imaginaryFrequency.set(Number(nextValue));
  }

  updateReactionEnergyZpe(nextValue: number): void {
    this.reactionEnergyZpe.set(Number(nextValue));
  }

  updateTemperature(nextValue: number): void {
    this.temperature.set(Number(nextValue));
  }

  override dispatch(): void {
    this.prepareForDispatch();

    this.jobsApiService
      .dispatchTunnelJob({
        reactionBarrierZpe: this.reactionBarrierZpe(),
        imaginaryFrequency: this.imaginaryFrequency(),
        reactionEnergyZpe: this.reactionEnergyZpe(),
        temperature: this.temperature(),
      })
      .subscribe({
        next: (jobResponse: ScientificJobView) => {
          this.syncInputsFromJobParameters(jobResponse);
          this.handleTransientDispatchJobResponse(
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
    this.historyJobs.set([]);
    this.isHistoryLoading.set(false);
  }

  protected override fetchFinalResult(jobId: string): void {
    this.jobsApiService.getScientificJobStatus(jobId).subscribe({
      next: (jobResponse: ScientificJobView) => {
        this.syncInputsFromJobParameters(jobResponse);
        this.handleJobOutcome(jobId, jobResponse, (job) => this.extractResultData(job), {
          loadLogs: false,
          loadHistoryAfter: false,
        });
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

    const parametersData: TunnelResultData | null = this.extractParametersData(jobResponse);
    if (parametersData === null) {
      return null;
    }

    const modelName: unknown = rawMetadata['model_name'];
    const sourceLibrary: unknown = rawMetadata['source_library'];

    return {
      ...parametersData,
      u: rawU,
      alpha1: rawAlpha1,
      alpha2: rawAlpha2,
      g: rawG,
      kappaTst: rawKappa,
      modelName: typeof modelName === 'string' ? modelName : null,
      sourceLibrary: typeof sourceLibrary === 'string' ? sourceLibrary : null,
    };
  }

  private extractParametersData(jobResponse: ScientificJobView): TunnelResultData | null {
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
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
