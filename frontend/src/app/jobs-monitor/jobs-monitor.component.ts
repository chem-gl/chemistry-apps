// jobs-monitor.component.ts: Monitor UI con acciones condicionadas por RBAC frontend.

import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ScientificJobView } from '../core/api/jobs-api.service';
import {
  JobStatusFilterOption,
  JobsMonitorFacadeService,
} from '../core/application/jobs-monitor.facade.service';
import { IdentitySessionService } from '../core/auth/identity-session.service';
import { JobLogsPanelComponent } from '../core/shared/components/job-logs-panel/job-logs-panel.component';
import { JobManagementActionsComponent } from '../core/shared/components/job-management-actions/job-management-actions.component';
import {
  resolveScientificJobRouteKey,
  resolveScientificJobRoutePath,
} from '../core/shared/scientific-apps.config';

@Component({
  selector: 'app-jobs-monitor',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    TranslocoPipe,
    JobLogsPanelComponent,
    JobManagementActionsComponent,
  ],
  providers: [JobsMonitorFacadeService],
  templateUrl: './jobs-monitor.component.html',
  styleUrl: './jobs-monitor.component.scss',
})
export class JobsMonitorComponent implements OnInit, OnDestroy {
  readonly facade = inject(JobsMonitorFacadeService);
  readonly sessionService = inject(IdentitySessionService);
  private readonly translocoService = inject(TranslocoService);

  readonly statusOptions: ReadonlyArray<{ value: JobStatusFilterOption; labelKey: string }> = [
    { value: 'all', labelKey: 'common.statusFilters.all' },
    { value: 'pending', labelKey: 'common.jobStatus.pending' },
    { value: 'running', labelKey: 'common.jobStatus.running' },
    { value: 'paused', labelKey: 'common.jobStatus.paused' },
    { value: 'completed', labelKey: 'common.jobStatus.completed' },
    { value: 'failed', labelKey: 'common.jobStatus.failed' },
    { value: 'cancelled', labelKey: 'common.jobStatus.cancelled' },
  ];

  ngOnInit(): void {
    this.facade.loadJobs();
    this.facade.startAutoRefresh();
  }

  ngOnDestroy(): void {
    this.facade.stopAutoRefresh();
  }

  refreshNow(): void {
    this.facade.loadJobs();
  }

  toggleAutoRefresh(): void {
    this.facade.toggleAutoRefresh();
  }

  onStatusFilterChanged(nextStatus: JobStatusFilterOption): void {
    this.facade.setStatusFilter(nextStatus);
  }

  onPluginFilterChanged(nextPluginName: string): void {
    this.facade.setPluginFilter(nextPluginName);
  }

  openJobDetails(jobId: string): void {
    this.facade.openJobDetails(jobId);
  }

  closeJobDetails(): void {
    this.facade.closeJobDetails();
  }

  pauseJob(jobId: string): void {
    this.facade.pauseJob(jobId);
  }

  resumeJob(jobId: string): void {
    this.facade.resumeJob(jobId);
  }

  cancelJob(jobId: string): void {
    this.facade.cancelJob(jobId);
  }

  deleteJob(jobId: string): void {
    this.facade.deleteJob(jobId);
  }

  restoreJob(jobId: string): void {
    this.facade.restoreJob(jobId);
  }

  statusClassName(jobStatus: ScientificJobView['status']): string {
    return `job-status status-${jobStatus}`;
  }

  stageClassName(progressStage: string): string {
    return `stage-pill stage-${progressStage}`;
  }

  appRouteForJob(jobItem: ScientificJobView): string | null {
    const routeKey = resolveScientificJobRouteKey(jobItem.plugin_name);
    if (routeKey === null || !this.sessionService.canAccessRoute(routeKey)) {
      return null;
    }

    return resolveScientificJobRoutePath(jobItem.plugin_name);
  }

  canManageJob(jobItem: ScientificJobView): boolean {
    return this.sessionService.canManageJob({
      owner: jobItem.owner ?? null,
      group: jobItem.group ?? null,
    });
  }

  canDeleteJob(jobItem: ScientificJobView): boolean {
    return (
      this.isTerminalJob(jobItem) &&
      this.sessionService.canDeleteJob({
        owner: jobItem.owner ?? null,
        group: jobItem.group ?? null,
      })
    );
  }

  canRestoreJob(jobItem: ScientificJobView): boolean {
    return this.sessionService.canRestoreJob({
      owner: jobItem.owner ?? null,
      group: jobItem.group ?? null,
    });
  }

  deleteActionLabel(jobItem: ScientificJobView): string {
    const deleteMode = this.sessionService.resolveDeleteMode({
      owner: jobItem.owner ?? null,
      group: jobItem.group ?? null,
    });

    return deleteMode === 'hard'
      ? this.translateOrFallback('common.actions.deletePermanently', 'Delete permanently')
      : this.translateOrFallback('common.actions.moveToTrash', 'Move to trash');
  }

  isTerminalJob(jobItem: ScientificJobView): boolean {
    return (
      jobItem.status === 'completed' ||
      jobItem.status === 'failed' ||
      jobItem.status === 'cancelled'
    );
  }

  ownerGroupLabel(jobItem: ScientificJobView): string {
    const ownerLabel =
      jobItem.owner_username ?? this.translocoService.translate('common.fallback.unknownUser');
    const groupLabel =
      jobItem.group_name ?? this.translocoService.translate('common.fallback.noGroup');
    return `${ownerLabel} · ${groupLabel}`;
  }

  resultActionLabel(jobItem: ScientificJobView): string {
    if (jobItem.plugin_name === 'random-numbers' && !this.hasFinalRandomNumbersResult(jobItem)) {
      return this.translateOrFallback('jobsMonitor.actions.viewSummary', 'View summary');
    }

    return this.translateOrFallback('common.actions.openResult', 'Open result');
  }

  private hasFinalRandomNumbersResult(jobItem: ScientificJobView): boolean {
    if (jobItem.plugin_name !== 'random-numbers') {
      return true;
    }

    const rawResults: unknown = jobItem.results;
    if (rawResults === null || typeof rawResults !== 'object' || Array.isArray(rawResults)) {
      return false;
    }

    const resultRecord: { generated_numbers?: unknown; metadata?: unknown } = rawResults as {
      generated_numbers?: unknown;
      metadata?: unknown;
    };

    return (
      Array.isArray(resultRecord.generated_numbers) &&
      resultRecord.metadata !== null &&
      typeof resultRecord.metadata === 'object' &&
      !Array.isArray(resultRecord.metadata)
    );
  }

  private translateOrFallback(translationKey: string, fallbackText: string): string {
    const translatedText = this.translocoService.translate(translationKey);
    return translatedText === translationKey ? fallbackText : translatedText;
  }
}
