// tunnel.component.ts: Tunnel effect screen with Tkinter-equivalent inputs and result panel.

import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { DownloadedReportFile, ScientificJobView } from '../core/api/jobs-api.service';
import {
  TunnelResultData,
  TunnelWorkflowService,
} from '../core/application/tunnel-workflow.service';
import {
  downloadBlobFile,
  subscribeToRouteHistoricalJob,
} from '../core/shared/scientific-app-ui.utils';
import { JobLogsPanelComponent } from '../core/shared/components/job-logs-panel/job-logs-panel.component';
import { JobProgressCardComponent } from '../core/shared/components/job-progress-card/job-progress-card.component';

@Component({
  selector: 'app-tunnel',
  imports: [CommonModule, FormsModule, JobProgressCardComponent, JobLogsPanelComponent],
  providers: [TunnelWorkflowService],
  templateUrl: './tunnel.component.html',
  styleUrl: './tunnel.component.scss',
})
export class TunnelComponent implements OnInit, OnDestroy {
  readonly workflow = inject(TunnelWorkflowService);
  private readonly route = inject(ActivatedRoute);
  private routeSubscription: Subscription | null = null;

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

  clearInputHistory(): void {
    this.workflow.clearInputHistory();
  }

  openHistoricalJob(jobId: string): void {
    this.workflow.openHistoricalJob(jobId);
  }

  historicalStatusClass(jobStatus: ScientificJobView['status']): string {
    return `history-status history-${jobStatus}`;
  }

  canExportRows(): boolean {
    return this.workflow.currentJobId() !== null && !this.workflow.isExporting();
  }

  exportCsv(): void {
    this.workflow.downloadCsvReport().subscribe({
      next: (downloadedFile: DownloadedReportFile) => {
        downloadBlobFile(downloadedFile.filename, downloadedFile.blob);
      },
      error: () => {
        // El workflow ya expone mensaje de error en UI.
      },
    });
  }

  exportLog(): void {
    this.workflow.downloadLogReport().subscribe({
      next: (downloadedFile: DownloadedReportFile) => {
        downloadBlobFile(downloadedFile.filename, downloadedFile.blob);
      },
      error: () => {
        // El workflow ya expone mensaje de error en UI.
      },
    });
  }

  readonly toNumber = Number;

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

}
