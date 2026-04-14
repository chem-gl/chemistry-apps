// molar-fractions.component.ts: Molar fractions screen with table rendering and export actions.

import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { EChartsCoreOption } from 'echarts/core';
import { Subscription } from 'rxjs';
import { DownloadedReportFile, ScientificJobView } from '../core/api/jobs-api.service';
import {
  MolarFractionsResultRow,
  MolarFractionsWorkflowService,
} from '../core/application/molar-fractions-workflow.service';
import { JobLogsPanelComponent } from '../core/shared/components/job-logs-panel/job-logs-panel.component';
import { JobProgressCardComponent } from '../core/shared/components/job-progress-card/job-progress-card.component';
import { ScientificChartComponent } from '../core/shared/components/scientific-chart/scientific-chart.component';
import { subscribeToRouteHistoricalJob } from '../core/shared/scientific-app-ui.utils';
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
  imports: [
    CommonModule,
    FormsModule,
    TranslocoPipe,
    JobProgressCardComponent,
    JobLogsPanelComponent,
    ScientificChartComponent,
  ],
  providers: [MolarFractionsWorkflowService],
  templateUrl: './molar-fractions.component.html',
  styleUrl: './molar-fractions.component.scss',
})
export class MolarFractionsComponent implements OnInit, OnDestroy {
  readonly workflow = inject(MolarFractionsWorkflowService);
  private readonly route = inject(ActivatedRoute);
  private routeSubscription: Subscription | null = null;

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

  ngOnInit(): void {
    this.routeSubscription = subscribeToRouteHistoricalJob(this.route, this.workflow);
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
  }

  dispatch(): void {
    this.workflow.dispatch();
  }

  reset(): void {
    this.workflow.reset();
  }

  openHistoricalJob(jobId: string): void {
    this.workflow.openHistoricalJob(jobId);
  }

  onPkaCountChange(rawValue: number | string): void {
    this.workflow.setPkaCount(this.toNumber(rawValue));
  }

  historicalStatusClass(jobStatus: ScientificJobView['status']): string {
    return `history-status history-${jobStatus}`;
  }

  historicalModeLabel(job: ScientificJobView): string {
    const rawParameters: unknown = job.parameters;
    if (
      rawParameters === null ||
      typeof rawParameters !== 'object' ||
      Array.isArray(rawParameters)
    ) {
      return '-';
    }

    const paramsRecord: { ph_mode?: unknown } = rawParameters as { ph_mode?: unknown };
    return typeof paramsRecord.ph_mode === 'string' ? paramsRecord.ph_mode : '-';
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

  canExportRows(): boolean {
    return this.workflow.currentJobId() !== null && !this.workflow.isExporting();
  }

  exportCsv(): void {
    this.workflow.downloadCsvReport().subscribe({
      next: (downloadedFile: DownloadedReportFile) => {
        this.downloadFile(downloadedFile.filename, downloadedFile.blob);
      },
      error: () => {
        // El workflow ya expone mensaje de error para la UI.
      },
    });
  }

  exportLog(): void {
    this.workflow.downloadLogReport().subscribe({
      next: (downloadedFile: DownloadedReportFile) => {
        this.downloadFile(downloadedFile.filename, downloadedFile.blob);
      },
      error: () => {
        // El workflow ya expone mensaje de error para la UI.
      },
    });
  }

  readonly toNumber = Number;

  private downloadFile(filename: string, blob: Blob): void {
    const objectUrl: string = URL.createObjectURL(blob);
    const linkElement: HTMLAnchorElement = document.createElement('a');

    linkElement.href = objectUrl;
    linkElement.download = filename;
    linkElement.click();

    URL.revokeObjectURL(objectUrl);
  }
}
