// molar-fractions.component.ts: Molar fractions screen with table rendering and export actions.

import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import type { EChartsCoreOption } from 'echarts/core';
import {
  MolarFractionsResultRow,
  MolarFractionsWorkflowService,
} from '../core/application/molar-fractions-workflow.service';
import { ScientificChartComponent } from '../core/shared/components/scientific-chart/scientific-chart.component';
import { downloadBlobFile } from '../core/shared/scientific-app-ui.utils';
import {
  DEFAULT_PROBE_PH,
  ProbeSpeciesReading,
  buildMolarFractionsChartOptions,
  buildProbeReadings,
  clampProbePh,
  formatFractionValue,
  shouldRenderMolarFractionsChart,
} from './molar-fractions-chart.options';
import {
  BatchSpeciesRow,
  buildBatchCsvContent,
  buildBatchSpeciesRows,
} from './molar-fractions-computation';

@Component({
  selector: 'app-molar-fractions',
  imports: [CommonModule, FormsModule, TranslocoPipe, ScientificChartComponent],
  providers: [MolarFractionsWorkflowService],
  templateUrl: './molar-fractions.component.html',
  styleUrl: './molar-fractions.component.scss',
})
export class MolarFractionsComponent {
  readonly workflow = inject(MolarFractionsWorkflowService);

  readonly pkaCountOptions: number[] = [1, 2, 3, 4, 5, 6];
  readonly inputMode = signal<'single' | 'batch'>('single');
  readonly probePh = signal<number>(DEFAULT_PROBE_PH);
  readonly batchCsvFile = signal<File | null>(null);
  readonly batchTargetPh = signal<number>(7.4);
  readonly batchThreshold = signal<number>(0);
  readonly batchRows = signal<BatchSpeciesRow[] | null>(null);
  readonly batchErrorMessage = signal<string | null>(null);
  readonly isBatchProcessing = signal<boolean>(false);
  readonly showResultChart = computed<boolean>(() =>
    shouldRenderMolarFractionsChart(this.workflow.resultData()),
  );
  readonly hasBatchRows = computed<boolean>(() => (this.batchRows()?.length ?? 0) > 0);
  readonly resolvedProbePh = computed<number>(() =>
    clampProbePh(this.workflow.resultData(), this.probePh()),
  );
  readonly probeReadings = computed<ProbeSpeciesReading[]>(() => {
    const resultData = this.workflow.resultData();
    if (!shouldRenderMolarFractionsChart(resultData)) {
      return [];
    }

    return buildProbeReadings(resultData!, this.resolvedProbePh());
  });
  readonly chartOptions = computed<EChartsCoreOption | null>(() => {
    const resultData = this.workflow.resultData();
    if (!shouldRenderMolarFractionsChart(resultData)) {
      return null;
    }

    return buildMolarFractionsChartOptions(resultData!, this.resolvedProbePh());
  });

  dispatch(): void {
    this.workflow.dispatch();
  }

  reset(): void {
    this.workflow.reset();
  }

  onInputModeChange(rawValue: unknown): void {
    const nextMode: 'single' | 'batch' = rawValue === 'batch' ? 'batch' : 'single';
    this.inputMode.set(nextMode);
    if (nextMode === 'batch') {
      this.workflow.reset();
    } else {
      this.resetBatch();
    }
    this.batchErrorMessage.set(null);
  }

  onPkaCountChange(rawValue: number | string): void {
    this.workflow.setPkaCount(this.toNumber(rawValue));
  }

  formatPh(row: MolarFractionsResultRow): string {
    return row.ph.toFixed(2);
  }

  formatFractionValue(value: number): string {
    return formatFractionValue(value);
  }

  onProbePhChange(rawValue: number | string): void {
    const nextValue = this.toNumber(rawValue);
    if (!Number.isFinite(nextValue)) {
      return;
    }

    this.probePh.set(clampProbePh(this.workflow.resultData(), nextValue));
  }

  onCsvFileChange(event: Event): void {
    const inputElement = event.target as HTMLInputElement | null;
    const selectedFile = inputElement?.files?.item(0) ?? null;
    this.batchCsvFile.set(selectedFile);
    this.batchErrorMessage.set(null);
  }

  async dispatchBatch(): Promise<void> {
    const csvFile = this.batchCsvFile();
    if (csvFile === null) {
      this.batchErrorMessage.set('Select a CSV file before running the batch calculation.');
      return;
    }

    this.isBatchProcessing.set(true);
    this.batchErrorMessage.set(null);

    try {
      const csvContent = await csvFile.text();
      this.batchRows.set(
        buildBatchSpeciesRows(csvContent, this.batchTargetPh(), this.batchThreshold()),
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown batch error.';
      this.batchRows.set(null);
      this.batchErrorMessage.set(errorMessage);
    } finally {
      this.isBatchProcessing.set(false);
    }
  }

  resetBatch(): void {
    this.batchCsvFile.set(null);
    this.batchTargetPh.set(7.4);
    this.batchThreshold.set(0);
    this.batchRows.set(null);
    this.batchErrorMessage.set(null);
  }

  exportBatchCsv(): void {
    const batchRows = this.batchRows();
    if (batchRows === null || batchRows.length === 0) {
      return;
    }

    downloadBlobFile(
      'molar_fractions_batch_report.csv',
      new Blob([buildBatchCsvContent(batchRows)], {
        type: 'text/csv;charset=utf-8',
      }),
    );
  }

  exportCsv(): void {
    const resultData = this.workflow.resultData();
    if (resultData === null) {
      return;
    }

    const headerColumns: string[] = ['ph', ...resultData.speciesLabels, 'sum_fraction'];
    const csvRows: string[] = resultData.rows.map((rowValue) =>
      [
        rowValue.ph.toFixed(2),
        ...rowValue.fractions.map((fractionValue) => fractionValue.toString()),
        rowValue.sumFraction.toString(),
      ].join(','),
    );

    downloadBlobFile(
      'molar_fractions_report.csv',
      new Blob([[headerColumns.join(','), ...csvRows].join('\n')], {
        type: 'text/csv;charset=utf-8',
      }),
    );
  }

  readonly selectedBatchFileName = computed<string>(() => this.batchCsvFile()?.name ?? '');

  readonly toText = String;
  readonly toNumber = Number;
}
