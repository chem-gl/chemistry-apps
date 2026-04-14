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
  readonly probePh = signal<number>(DEFAULT_PROBE_PH);
  readonly showResultChart = computed<boolean>(() =>
    shouldRenderMolarFractionsChart(this.workflow.resultData()),
  );
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

  readonly toNumber = Number;
}
