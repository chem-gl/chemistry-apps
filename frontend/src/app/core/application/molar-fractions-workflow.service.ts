// molar-fractions-workflow.service.ts: Orquesta formulario, progreso y resultados de molar fractions.

import { Injectable, computed, signal } from '@angular/core';
import { MolarFractionsParams, ScientificJobView } from '../api/jobs-api.service';
import { BaseJobWorkflowService } from './base-job-workflow.service';

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
}

@Injectable()
export class MolarFractionsWorkflowService extends BaseJobWorkflowService<MolarFractionsResultData> {
  protected override get defaultProgressMessage(): string {
    return 'Preparing molar fractions calculation...';
  }

  readonly pkaCount = signal<number>(3);
  readonly pkaValues = signal<number[]>([2.2, 7.2, 12.3, 0, 0, 0]);
  readonly phMode = signal<MolarFractionsPhMode>('range');
  readonly phValue = signal<number>(7);
  readonly phMin = signal<number>(0);
  readonly phMax = signal<number>(14);
  readonly phStep = signal<number>(1);

  readonly pkaInputSlots = computed<number[]>(() =>
    Array.from({ length: this.pkaCount() }, (_value, index) => index),
  );

  readonly activePkaValues = computed<number[]>(() =>
    this.pkaValues().slice(0, this.pkaCount()).map(Number),
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

  override dispatch(): void {
    this.prepareForDispatch();

    const dispatchParams: MolarFractionsParams = this.buildDispatchParams();

    this.jobsApiService.dispatchMolarFractionsJob(dispatchParams).subscribe({
      next: (jobResponse: ScientificJobView) => {
        this.handleTransientDispatchJobResponse(
          jobResponse,
          (job) => this.extractResultData(job),
          'molar fractions',
        );
      },
      error: (dispatchError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to create molar fractions job: ${dispatchError.message}`);
      },
    });
  }

  override loadHistory(): void {
    this.historyJobs.set([]);
    this.isHistoryLoading.set(false);
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

  protected override fetchFinalResult(jobId: string): void {
    this.jobsApiService.getScientificJobStatus(jobId).subscribe({
      next: (jobResponse: ScientificJobView) => {
        this.handleJobOutcome(jobId, jobResponse, (job) => this.extractResultData(job), {
          loadLogs: false,
          loadHistoryAfter: false,
        });
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

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
