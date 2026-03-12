// tunnel.component.ts: Tunnel effect screen with Tkinter-equivalent inputs and result panel.

import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { ScientificJob } from '../core/api/generated';
import { DownloadedReportFile, JobLogEntryView } from '../core/api/jobs-api.service';
import {
  TunnelResultData,
  TunnelWorkflowService,
} from '../core/application/tunnel-workflow.service';

@Component({
  selector: 'app-tunnel',
  imports: [CommonModule, FormsModule],
  providers: [TunnelWorkflowService],
  templateUrl: './tunnel.component.html',
  styleUrl: './tunnel.component.scss',
})
export class TunnelComponent implements OnInit, OnDestroy {
  readonly workflow = inject(TunnelWorkflowService);
  private readonly route = inject(ActivatedRoute);
  private routeSubscription: Subscription | null = null;

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

  clearInputHistory(): void {
    this.workflow.clearInputHistory();
  }

  openHistoricalJob(jobId: string): void {
    this.workflow.openHistoricalJob(jobId);
  }

  hasPayload(logEntry: JobLogEntryView): boolean {
    return Object.keys(logEntry.payload).length > 0;
  }

  logLevelClass(logLevel: JobLogEntryView['level']): string {
    return `log-level log-level-${logLevel}`;
  }

  historicalStatusClass(jobStatus: ScientificJob['status']): string {
    return `history-status history-${jobStatus}`;
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
        // El workflow ya expone mensaje de error en UI.
      },
    });
  }

  exportLog(): void {
    this.workflow.downloadLogReport().subscribe({
      next: (downloadedFile: DownloadedReportFile) => {
        this.downloadFile(downloadedFile.filename, downloadedFile.blob);
      },
      error: () => {
        // El workflow ya expone mensaje de error en UI.
      },
    });
  }

  toNumber(rawValue: number | string): number {
    return Number(rawValue);
  }

  formatOutputValue(rawValue: number | null): string {
    if (rawValue === null) {
      return '--';
    }
    return rawValue.toExponential(6).toUpperCase();
  }

  hasResultValues(resultData: TunnelResultData): boolean {
    return (
      resultData.u !== null &&
      resultData.alpha1 !== null &&
      resultData.alpha2 !== null &&
      resultData.g !== null &&
      resultData.kappaTst !== null
    );
  }

  private downloadFile(filename: string, blob: Blob): void {
    const objectUrl: string = URL.createObjectURL(blob);
    const linkElement: HTMLAnchorElement = document.createElement('a');

    linkElement.href = objectUrl;
    linkElement.download = filename;
    linkElement.click();

    URL.revokeObjectURL(objectUrl);
  }
}
