// jobs-trash.component.ts: Pantalla separada para restaurar jobs desde la papelera de reciclaje.

import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ScientificJobView } from '../core/api/jobs-api.service';
import {
  JobStatusFilterOption,
  JobsMonitorFacadeService,
} from '../core/application/jobs-monitor.facade.service';
import { JobFiltersComponent } from '../core/shared/components/job-filters/job-filters.component';
import { JobManagementActionsComponent } from '../core/shared/components/job-management-actions/job-management-actions.component';
import { buildJobOwnershipLabel } from '../core/shared/job-ownership-label.utils';

@Component({
  selector: 'app-jobs-trash',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    JobManagementActionsComponent,
    JobFiltersComponent,
    TranslocoPipe,
  ],
  providers: [JobsMonitorFacadeService],
  templateUrl: './jobs-trash.component.html',
  styleUrl: './jobs-trash.component.scss',
})
export class JobsTrashComponent implements OnInit {
  readonly facade = inject(JobsMonitorFacadeService);
  private readonly translocoService = inject(TranslocoService);

  readonly statusOptions: ReadonlyArray<{ value: JobStatusFilterOption; labelKey: string }> = [
    { value: 'all', labelKey: 'common.statusFilters.all' },
    { value: 'completed', labelKey: 'common.jobStatus.completed' },
    { value: 'failed', labelKey: 'common.jobStatus.failed' },
    { value: 'cancelled', labelKey: 'common.jobStatus.cancelled' },
  ];

  ngOnInit(): void {
    this.facade.loadDeletedJobs();
  }

  refreshNow(): void {
    this.facade.loadDeletedJobs();
  }

  onStatusFilterChanged(nextStatus: string): void {
    this.facade.setStatusFilter(nextStatus as JobStatusFilterOption);
    this.facade.loadDeletedJobs({ silent: true });
  }

  onPluginFilterChanged(nextPluginName: string): void {
    this.facade.setPluginFilter(nextPluginName);
    this.facade.loadDeletedJobs({ silent: true });
  }

  restoreJob(jobId: string): void {
    this.facade.restoreJob(jobId);
  }

  deleteJobPermanently(jobId: string): void {
    this.facade.deleteJob(jobId);
  }

  ownerGroupLabel(jobItem: ScientificJobView): string {
    return buildJobOwnershipLabel(jobItem, (translationKey: string) =>
      this.translocoService.translate(translationKey),
    );
  }

  deletedByLabel(jobItem: ScientificJobView): string {
    return (
      jobItem.deleted_by_username ?? this.translocoService.translate('trash.fallback.unknownActor')
    );
  }

  scheduledDeletionLabel(jobItem: ScientificJobView): string {
    return (
      jobItem.scheduled_hard_delete_at ??
      this.translocoService.translate('trash.fallback.noDeadline')
    );
  }
}
