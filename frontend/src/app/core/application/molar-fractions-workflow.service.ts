// molar-fractions-workflow.service.ts: Orquesta formulario, progreso y resultados de molar fractions.

import { Injectable, computed, signal } from '@angular/core';
import { Observable } from 'rxjs';
import {
  DownloadedReportFile,
  MolarFractionsParams,
  ScientificJobView,
} from '../api/jobs-api.service';
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
  isHistoricalSummary: boolean;
  summaryMessage: string | null;
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
        this.handleDispatchJobResponse(
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

  openHistoricalJob(jobId: string): void {
    this.prepareForDispatch();
    this.currentJobId.set(jobId);

    this.jobsApiService.getScientificJobStatus(jobId).subscribe({
      next: (jobResponse: ScientificJobView) => {
        this.handleJobOutcome(
          jobId,
          jobResponse,
          (job) => this.extractResultData(job) ?? this.extractSummaryData(job),
          { loadHistoryAfter: false },
        );
      },
      error: (statusError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to recover historical job: ${statusError.message}`);
      },
    });
  }

  override loadHistory(): void {
    this.loadHistoryForPlugin('molar-fractions');
  }

  downloadCsvReport(): Observable<DownloadedReportFile> {
    return this.buildDownloadStream(
      this.jobsApiService.downloadMolarFractionsCsvReport(this.currentJobId()!),
      'CSV report',
    );
  }

  downloadLogReport(): Observable<DownloadedReportFile> {
    return this.buildDownloadStream(
      this.jobsApiService.downloadMolarFractionsLogReport(this.currentJobId()!),
      'LOG report',
    );
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
        this.handleJobOutcome(jobId, jobResponse, (job) => this.extractResultData(job));
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
      isHistoricalSummary: false,
      summaryMessage: null,
    };
  }

  private extractSummaryData(jobResponse: ScientificJobView): MolarFractionsResultData | null {
    const rawParameters: unknown = jobResponse.parameters;
    if (!this.isRecord(rawParameters)) {
      return null;
    }

    const rawPkaValues: unknown = rawParameters['pka_values'];
    const rawPhMode: unknown = rawParameters['ph_mode'];

    if (!Array.isArray(rawPkaValues) || (rawPhMode !== 'single' && rawPhMode !== 'range')) {
      return null;
    }

    const pkaValues: number[] = rawPkaValues.filter(
      (value: unknown): value is number => typeof value === 'number',
    );
    if (pkaValues.length < 1) {
      return null;
    }

    let phMin: number;
    let phMax: number;
    let phStep: number;

    if (rawPhMode === 'single') {
      const phValue: unknown = rawParameters['ph_value'];
      if (typeof phValue !== 'number') {
        return null;
      }
      phMin = phValue;
      phMax = phValue;
      phStep = 0.1;
    } else {
      const rawPhMin: unknown = rawParameters['ph_min'];
      const rawPhMax: unknown = rawParameters['ph_max'];
      const rawPhStep: unknown = rawParameters['ph_step'];
      if (
        typeof rawPhMin !== 'number' ||
        typeof rawPhMax !== 'number' ||
        typeof rawPhStep !== 'number'
      ) {
        return null;
      }
      phMin = Math.min(rawPhMin, rawPhMax);
      phMax = Math.max(rawPhMin, rawPhMax);
      phStep = rawPhStep;
    }

    const speciesLabels: string[] = Array.from(
      { length: pkaValues.length + 1 },
      (_v, index) => `f${index}`,
    );
    const summaryMessage: string = this.buildHistoricalSummaryMessage(jobResponse.status);

    return {
      speciesLabels,
      rows: [],
      metadata: {
        pkaValues,
        phMode: rawPhMode,
        phMin,
        phMax,
        phStep,
        totalSpecies: speciesLabels.length,
        totalPoints: 0,
      },
      isHistoricalSummary: true,
      summaryMessage,
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
