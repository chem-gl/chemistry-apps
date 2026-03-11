// jobs-monitor.facade.service.ts: Gestiona estado y filtros del monitor de jobs globales.

import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { Subscription, forkJoin, interval } from 'rxjs';
import { ScientificJob } from '../api/generated';
import {
  JobControlActionResult,
  JobListFilters,
  JobListStatusFilter,
  JobLogEntryView,
  JobsApiService,
} from '../api/jobs-api.service';

/** Estado de filtro para UI (incluye opcion all para monitor global) */
export type JobStatusFilterOption = JobListStatusFilter | 'all';

@Injectable()
export class JobsMonitorFacadeService implements OnDestroy {
  private readonly jobsApiService = inject(JobsApiService);
  private refreshSubscription: Subscription | null = null;
  private detailProgressSubscription: Subscription | null = null;
  private detailLogsSubscription: Subscription | null = null;

  readonly jobs = signal<ScientificJob[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);
  readonly selectedStatus = signal<JobStatusFilterOption>('all');
  readonly selectedPluginName = signal<string>('all');
  readonly autoRefreshEnabled = signal<boolean>(true);
  readonly lastUpdatedAt = signal<Date | null>(null);
  readonly selectedJobId = signal<string | null>(null);
  readonly selectedJob = signal<ScientificJob | null>(null);
  readonly selectedJobLogs = signal<JobLogEntryView[]>([]);
  readonly isDetailsLoading = signal<boolean>(false);
  readonly detailsErrorMessage = signal<string | null>(null);
  readonly controllingJobId = signal<string | null>(null);
  readonly controlErrorMessage = signal<string | null>(null);

  readonly pluginOptions = computed(() => {
    const discoveredPlugins: string[] = this.jobs()
      .map((jobItem: ScientificJob) => jobItem.plugin_name)
      .filter(
        (pluginName: string, index: number, values: string[]) =>
          values.indexOf(pluginName) === index,
      )
      .sort((leftName: string, rightName: string) => leftName.localeCompare(rightName));

    return ['all', ...discoveredPlugins];
  });

  readonly activeJobs = computed(() =>
    this.jobs().filter(
      (jobItem: ScientificJob) =>
        jobItem.status === 'pending' || jobItem.status === 'running' || jobItem.status === 'paused',
    ),
  );

  readonly completedJobs = computed(() =>
    this.jobs().filter((jobItem: ScientificJob) => jobItem.status === 'completed'),
  );

  readonly failedJobs = computed(() =>
    this.jobs().filter((jobItem: ScientificJob) => jobItem.status === 'failed'),
  );

  readonly finishedJobs = computed(() => [...this.completedJobs(), ...this.failedJobs()]);

  loadJobs(): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    const listFilters: JobListFilters = this.buildFilters();

    this.jobsApiService.listJobs(listFilters).subscribe({
      next: (jobItems: ScientificJob[]) => {
        this.jobs.set(jobItems);

        const selectedJobIdValue: string | null = this.selectedJobId();
        if (selectedJobIdValue !== null) {
          const refreshedSelectedJob: ScientificJob | undefined = jobItems.find(
            (jobItem: ScientificJob) => jobItem.id === selectedJobIdValue,
          );
          if (refreshedSelectedJob !== undefined) {
            this.selectedJob.set(refreshedSelectedJob);
          }
        }

        this.lastUpdatedAt.set(new Date());
        this.isLoading.set(false);
      },
      error: (loadError: Error) => {
        this.errorMessage.set(`No se pudo cargar el monitor: ${loadError.message}`);
        this.isLoading.set(false);
      },
    });
  }

  setStatusFilter(nextStatusFilter: JobStatusFilterOption): void {
    this.selectedStatus.set(nextStatusFilter);
    this.loadJobs();
  }

  setPluginFilter(nextPluginName: string): void {
    this.selectedPluginName.set(nextPluginName);
    this.loadJobs();
  }

  toggleAutoRefresh(): void {
    const nextEnabledState: boolean = !this.autoRefreshEnabled();
    this.autoRefreshEnabled.set(nextEnabledState);

    if (nextEnabledState) {
      this.startAutoRefresh();
    } else {
      this.stopAutoRefresh();
    }
  }

  startAutoRefresh(refreshIntervalMs: number = 3000): void {
    this.stopAutoRefresh();

    this.refreshSubscription = interval(refreshIntervalMs).subscribe(() => {
      if (!this.autoRefreshEnabled()) {
        return;
      }

      this.loadJobs();
    });
  }

  stopAutoRefresh(): void {
    this.refreshSubscription?.unsubscribe();
    this.refreshSubscription = null;
  }

  openJobDetails(jobId: string): void {
    this.stopDetailStreams();
    this.selectedJobId.set(jobId);
    this.isDetailsLoading.set(true);
    this.detailsErrorMessage.set(null);

    forkJoin({
      job: this.jobsApiService.getScientificJobStatus(jobId),
      logsPage: this.jobsApiService.getJobLogs(jobId, { limit: 250 }),
    }).subscribe({
      next: ({ job, logsPage }) => {
        this.selectedJob.set(job);
        this.selectedJobLogs.set(this.mergeLogEntries([], logsPage.results));
        this.isDetailsLoading.set(false);
        this.startDetailStreams(jobId, job.status);
      },
      error: (detailsError: Error) => {
        this.detailsErrorMessage.set(`No se pudo cargar detalle del job: ${detailsError.message}`);
        this.isDetailsLoading.set(false);
      },
    });
  }

  closeJobDetails(): void {
    this.stopDetailStreams();
    this.selectedJobId.set(null);
    this.selectedJob.set(null);
    this.selectedJobLogs.set([]);
    this.isDetailsLoading.set(false);
    this.detailsErrorMessage.set(null);
  }

  isControlActionRunning(jobId: string): boolean {
    return this.controllingJobId() === jobId;
  }

  pauseJob(jobId: string): void {
    this.controllingJobId.set(jobId);
    this.controlErrorMessage.set(null);

    this.jobsApiService.pauseJob(jobId).subscribe({
      next: (controlResult: JobControlActionResult) => {
        this.controllingJobId.set(null);
        this.replaceJobInState(controlResult.job);
        if (this.selectedJobId() === jobId) {
          this.selectedJob.set(controlResult.job);
        }
      },
      error: (controlError: Error) => {
        this.controllingJobId.set(null);
        this.controlErrorMessage.set(`No se pudo pausar el job: ${controlError.message}`);
      },
    });
  }

  resumeJob(jobId: string): void {
    this.controllingJobId.set(jobId);
    this.controlErrorMessage.set(null);

    this.jobsApiService.resumeJob(jobId).subscribe({
      next: (controlResult: JobControlActionResult) => {
        this.controllingJobId.set(null);
        this.replaceJobInState(controlResult.job);
        if (this.selectedJobId() === jobId) {
          this.selectedJob.set(controlResult.job);
          this.stopDetailStreams();
          this.startDetailStreams(jobId, controlResult.job.status);
        }
      },
      error: (controlError: Error) => {
        this.controllingJobId.set(null);
        this.controlErrorMessage.set(`No se pudo reanudar el job: ${controlError.message}`);
      },
    });
  }

  ngOnDestroy(): void {
    this.stopAutoRefresh();
    this.stopDetailStreams();
  }

  private startDetailStreams(jobId: string, jobStatus: ScientificJob['status']): void {
    if (jobStatus !== 'pending' && jobStatus !== 'running') {
      return;
    }

    this.detailProgressSubscription = this.jobsApiService.streamJobEvents(jobId).subscribe({
      next: (jobSnapshot) => {
        const currentJob: ScientificJob | null = this.selectedJob();
        if (currentJob === null || currentJob.id !== jobId) {
          return;
        }

        this.selectedJob.set({
          ...currentJob,
          status: jobSnapshot.status,
          progress_percentage: jobSnapshot.progress_percentage,
          progress_stage: jobSnapshot.progress_stage,
          progress_message: jobSnapshot.progress_message,
          progress_event_index: jobSnapshot.progress_event_index,
          updated_at: jobSnapshot.updated_at,
        });
      },
      complete: () => {
        this.jobsApiService.getScientificJobStatus(jobId).subscribe({
          next: (job) => this.selectedJob.set(job),
        });
      },
      error: () => {
        // Mantener modal estable aunque falle el stream SSE de progreso.
      },
    });

    this.detailLogsSubscription = this.jobsApiService.streamJobLogEvents(jobId).subscribe({
      next: (logEntry: JobLogEntryView) => {
        this.selectedJobLogs.update((currentLogs) => this.mergeLogEntries(currentLogs, [logEntry]));
      },
      error: () => {
        // Mantener modal estable aunque falle el stream SSE de logs.
      },
    });
  }

  private stopDetailStreams(): void {
    this.detailProgressSubscription?.unsubscribe();
    this.detailLogsSubscription?.unsubscribe();
    this.detailProgressSubscription = null;
    this.detailLogsSubscription = null;
  }

  private mergeLogEntries(
    currentLogs: JobLogEntryView[],
    newLogs: JobLogEntryView[],
  ): JobLogEntryView[] {
    const mergedLogsByEventIndex: Map<number, JobLogEntryView> = new Map(
      currentLogs.map((logEntry: JobLogEntryView) => [logEntry.eventIndex, logEntry]),
    );

    newLogs.forEach((logEntry: JobLogEntryView) => {
      mergedLogsByEventIndex.set(logEntry.eventIndex, logEntry);
    });

    return [...mergedLogsByEventIndex.values()].sort(
      (leftLog: JobLogEntryView, rightLog: JobLogEntryView) =>
        leftLog.eventIndex - rightLog.eventIndex,
    );
  }

  private buildFilters(): JobListFilters {
    const statusFilterValue: JobStatusFilterOption = this.selectedStatus();
    const pluginFilterValue: string = this.selectedPluginName();

    return {
      status: statusFilterValue === 'all' ? undefined : statusFilterValue,
      pluginName: pluginFilterValue === 'all' ? undefined : pluginFilterValue,
    };
  }

  private replaceJobInState(updatedJob: ScientificJob): void {
    this.jobs.update((currentJobs: ScientificJob[]) =>
      currentJobs.map((jobItem: ScientificJob) =>
        jobItem.id === updatedJob.id ? updatedJob : jobItem,
      ),
    );
  }
}
