// jobs-monitor.facade.service.ts: Gestiona estado y filtros del monitor de jobs globales.

import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { Subscription, forkJoin, interval } from 'rxjs';
import { ScientificJob } from '../api/generated';
import {
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
      (jobItem: ScientificJob) => jobItem.status === 'pending' || jobItem.status === 'running',
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
    this.selectedJobId.set(jobId);
    this.isDetailsLoading.set(true);
    this.detailsErrorMessage.set(null);

    forkJoin({
      job: this.jobsApiService.getScientificJobStatus(jobId),
      logsPage: this.jobsApiService.getJobLogs(jobId, { limit: 250 }),
    }).subscribe({
      next: ({ job, logsPage }) => {
        this.selectedJob.set(job);
        this.selectedJobLogs.set(logsPage.results);
        this.isDetailsLoading.set(false);
      },
      error: (detailsError: Error) => {
        this.detailsErrorMessage.set(`No se pudo cargar detalle del job: ${detailsError.message}`);
        this.isDetailsLoading.set(false);
      },
    });
  }

  closeJobDetails(): void {
    this.selectedJobId.set(null);
    this.selectedJob.set(null);
    this.selectedJobLogs.set([]);
    this.isDetailsLoading.set(false);
    this.detailsErrorMessage.set(null);
  }

  ngOnDestroy(): void {
    this.stopAutoRefresh();
  }

  private buildFilters(): JobListFilters {
    const statusFilterValue: JobStatusFilterOption = this.selectedStatus();
    const pluginFilterValue: string = this.selectedPluginName();

    return {
      status: statusFilterValue === 'all' ? undefined : statusFilterValue,
      pluginName: pluginFilterValue === 'all' ? undefined : pluginFilterValue,
    };
  }
}
