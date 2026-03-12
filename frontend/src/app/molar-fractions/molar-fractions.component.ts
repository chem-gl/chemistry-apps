// molar-fractions.component.ts: Molar fractions screen with table rendering and export actions.

import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { ScientificJob } from '../core/api/generated';
import { JobLogEntryView } from '../core/api/jobs-api.service';
import {
  MolarFractionsResultData,
  MolarFractionsResultRow,
  MolarFractionsWorkflowService,
} from '../core/application/molar-fractions-workflow.service';

@Component({
  selector: 'app-molar-fractions',
  imports: [CommonModule, FormsModule],
  providers: [MolarFractionsWorkflowService],
  templateUrl: './molar-fractions.component.html',
  styleUrl: './molar-fractions.component.scss',
})
export class MolarFractionsComponent implements OnInit, OnDestroy {
  readonly workflow = inject(MolarFractionsWorkflowService);
  private readonly route = inject(ActivatedRoute);
  private routeSubscription: Subscription | null = null;

  readonly pkaCountOptions: number[] = [1, 2, 3, 4, 5, 6];

  ngOnInit(): void {
    this.workflow.loadHistory();

    this.routeSubscription = this.route.queryParamMap.subscribe((paramsMap) => {
      const jobId: string | null = paramsMap.get('jobId');
      if (jobId !== null && jobId.trim() !== '') {
        this.workflow.openHistoricalJob(jobId);
      }
    });
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

  historicalStatusClass(jobStatus: ScientificJob['status']): string {
    return `history-status history-${jobStatus}`;
  }

  historicalModeLabel(job: ScientificJob): string {
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

  hasPayload(logEntry: JobLogEntryView): boolean {
    return Object.keys(logEntry.payload).length > 0;
  }

  logLevelClass(logLevel: JobLogEntryView['level']): string {
    return `log-level log-level-${logLevel}`;
  }

  formatPh(row: MolarFractionsResultRow): string {
    return row.ph.toFixed(2);
  }

  formatFractionValue(value: number): string {
    return value.toExponential(3).toUpperCase();
  }

  canExportRows(): boolean {
    const resultData: MolarFractionsResultData | null = this.workflow.resultData();
    return resultData !== null && resultData.rows.length > 0;
  }

  exportCsv(): void {
    const resultData: MolarFractionsResultData | null = this.workflow.resultData();
    if (resultData === null || resultData.rows.length === 0) {
      return;
    }

    const csvContent: string = this.buildCsv(resultData);
    const filename: string = this.buildFilename('csv');
    this.downloadFile(filename, csvContent, 'text/csv;charset=utf-8');
  }

  exportLog(): void {
    const resultData: MolarFractionsResultData | null = this.workflow.resultData();
    if (resultData === null) {
      return;
    }

    const csvContent: string = this.buildCsv(resultData);
    const generatedAtIso: string = new Date().toISOString();
    const currentJobId: string = this.workflow.currentJobId() ?? 'unknown';

    const logContent: string = [
      `MOLAR FRACTIONS EXPORT LOG`,
      `Generated at: ${generatedAtIso}`,
      `Job ID: ${currentJobId}`,
      '',
      'INPUT DATA',
      `- pKa values: ${resultData.metadata.pkaValues.join(', ')}`,
      `- pH mode: ${resultData.metadata.phMode}`,
      `- pH min: ${resultData.metadata.phMin}`,
      `- pH max: ${resultData.metadata.phMax}`,
      `- pH step: ${resultData.metadata.phStep}`,
      `- Total species: ${resultData.metadata.totalSpecies}`,
      `- Total points: ${resultData.metadata.totalPoints}`,
      '',
      'CSV DATA',
      csvContent,
    ].join('\n');

    const filename: string = this.buildFilename('log');
    this.downloadFile(filename, logContent, 'text/plain;charset=utf-8');
  }

  toNumber(rawValue: number | string): number {
    return Number(rawValue);
  }

  private buildCsv(resultData: MolarFractionsResultData): string {
    const headers: string[] = ['pH', ...resultData.speciesLabels, 'Sum'];
    const lines: string[] = [headers.join(',')];

    for (const rowItem of resultData.rows) {
      const cells: string[] = [
        rowItem.ph.toFixed(2),
        ...rowItem.fractions.map((fractionValue) => fractionValue.toExponential(6).toUpperCase()),
        rowItem.sumFraction.toExponential(6).toUpperCase(),
      ];
      lines.push(cells.map((cellValue) => this.escapeCsvCell(cellValue)).join(','));
    }

    return lines.join('\n');
  }

  private escapeCsvCell(rawValue: string): string {
    if (rawValue.includes(',') || rawValue.includes('"') || rawValue.includes('\n')) {
      return `"${rawValue.replace(/"/g, '""')}"`;
    }
    return rawValue;
  }

  private buildFilename(extension: 'csv' | 'log'): string {
    const currentJobId: string = this.workflow.currentJobId() ?? 'result';
    const safeJobId: string = currentJobId.replace(/[^a-zA-Z0-9-_]/g, '_');
    const timestamp: string = new Date().toISOString().replace(/[:.]/g, '-');
    return `molar-fractions-${safeJobId}-${timestamp}.${extension}`;
  }

  private downloadFile(filename: string, content: string, mimeType: string): void {
    const blob: Blob = new Blob([content], { type: mimeType });
    const objectUrl: string = URL.createObjectURL(blob);
    const linkElement: HTMLAnchorElement = document.createElement('a');

    linkElement.href = objectUrl;
    linkElement.download = filename;
    linkElement.click();

    URL.revokeObjectURL(objectUrl);
  }
}
