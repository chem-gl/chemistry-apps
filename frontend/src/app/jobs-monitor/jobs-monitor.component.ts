// jobs-monitor.component.ts: Monitor UI con acciones condicionadas por RBAC frontend.

import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ScientificJobView } from '../core/api/jobs-api.service';
import {
    JobStatusFilterOption,
    JobsMonitorFacadeService,
} from '../core/application/jobs-monitor.facade.service';
import { IdentitySessionService } from '../core/auth/identity-session.service';
import { JobLogsPanelComponent } from '../core/shared/components/job-logs-panel/job-logs-panel.component';

@Component({
  selector: 'app-jobs-monitor',
  imports: [CommonModule, FormsModule, RouterLink, JobLogsPanelComponent],
  providers: [JobsMonitorFacadeService],
  templateUrl: './jobs-monitor.component.html',
  styleUrl: './jobs-monitor.component.scss',
})
export class JobsMonitorComponent implements OnInit, OnDestroy {
  readonly facade = inject(JobsMonitorFacadeService);
  readonly sessionService = inject(IdentitySessionService);

  readonly statusOptions: ReadonlyArray<{ value: JobStatusFilterOption; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'pending', label: 'Pending' },
    { value: 'running', label: 'Running' },
    { value: 'paused', label: 'Paused' },
    { value: 'completed', label: 'Completed' },
    { value: 'failed', label: 'Failed' },
    { value: 'cancelled', label: 'Cancelled' },
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

  statusClassName(jobStatus: ScientificJobView['status']): string {
    return `job-status status-${jobStatus}`;
  }

  stageClassName(progressStage: string): string {
    return `stage-pill stage-${progressStage}`;
  }

  appRouteForJob(jobItem: ScientificJobView): string | null {
    const routeKey = this.routeKeyForJob(jobItem);
    if (routeKey === null || !this.sessionService.canAccessRoute(routeKey)) {
      return null;
    }

    return `/${routeKey}`;
  }

  canManageJob(jobItem: ScientificJobView): boolean {
    return this.sessionService.canManageJob({
      owner: jobItem.owner ?? null,
      group: jobItem.group ?? null,
    });
  }

  ownerGroupLabel(jobItem: ScientificJobView): string {
    const ownerLabel = jobItem.owner_username ?? 'Unknown user';
    const groupLabel = jobItem.group_name ?? 'No group';
    return `${ownerLabel} · ${groupLabel}`;
  }

  resultActionLabel(jobItem: ScientificJobView): string {
    if (jobItem.plugin_name === 'random-numbers' && !this.hasFinalRandomNumbersResult(jobItem)) {
      return 'View summary';
    }

    return 'Open result';
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

  private routeKeyForJob(jobItem: ScientificJobView): string | null {
    if (jobItem.plugin_name === 'tunnel-effect') {
      return 'tunnel';
    }

    const pluginToRouteMap: Record<string, string> = {
      calculator: 'calculator',
      'random-numbers': 'random-numbers',
      'molar-fractions': 'molar-fractions',
      'easy-rate': 'easy-rate',
      marcus: 'marcus',
      smileit: 'smileit',
      'sa-score': 'sa-score',
      'toxicity-properties': 'toxicity-properties',
    };

    return pluginToRouteMap[jobItem.plugin_name] ?? null;
  }
}
