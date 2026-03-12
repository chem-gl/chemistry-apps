// jobs-monitor.component.ts: Monitor UI for active and historical scientific jobs.

import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ScientificJob } from '../core/api/generated';
import { JobLogEntryView } from '../core/api/jobs-api.service';
import {
  JobStatusFilterOption,
  JobsMonitorFacadeService,
} from '../core/application/jobs-monitor.facade.service';

@Component({
  selector: 'app-jobs-monitor',
  imports: [CommonModule, FormsModule, RouterLink],
  providers: [JobsMonitorFacadeService],
  templateUrl: './jobs-monitor.component.html',
  styleUrl: './jobs-monitor.component.scss',
})
export class JobsMonitorComponent implements OnInit, OnDestroy {
  readonly facade = inject(JobsMonitorFacadeService);

  readonly statusOptions: ReadonlyArray<{ value: JobStatusFilterOption; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'pending', label: 'Pending' },
    { value: 'running', label: 'Running' },
    { value: 'paused', label: 'Paused' },
    { value: 'completed', label: 'Completed' },
    { value: 'failed', label: 'Failed' },
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

  statusClassName(jobStatus: ScientificJob['status']): string {
    return `job-status status-${jobStatus}`;
  }

  stageClassName(progressStage: string): string {
    return `stage-pill stage-${progressStage}`;
  }

  appRouteForJob(jobItem: ScientificJob): string | null {
    if (jobItem.plugin_name === 'random-numbers') {
      return '/random-numbers';
    }

    if (jobItem.plugin_name === 'calculator') {
      return '/calculator';
    }

    if (jobItem.plugin_name === 'molar-fractions') {
      return '/molar-fractions';
    }

    return null;
  }

  resultActionLabel(jobItem: ScientificJob): string {
    if (jobItem.plugin_name === 'random-numbers' && !this.hasFinalRandomNumbersResult(jobItem)) {
      return 'View summary';
    }

    return 'Open result';
  }

  private hasFinalRandomNumbersResult(jobItem: ScientificJob): boolean {
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

  hasPayload(logEntry: JobLogEntryView): boolean {
    return Object.keys(logEntry.payload).length > 0;
  }

  logLevelClass(logLevel: JobLogEntryView['level']): string {
    return `log-level log-level-${logLevel}`;
  }
}
