// jobs-trash.component.ts: Pantalla separada para restaurar jobs desde la papelera de reciclaje.

import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ScientificJobView } from '../core/api/jobs-api.service';
import {
  JobStatusFilterOption,
  JobsMonitorFacadeService,
} from '../core/application/jobs-monitor.facade.service';
import { JobManagementActionsComponent } from '../core/shared/components/job-management-actions/job-management-actions.component';

@Component({
  selector: 'app-jobs-trash',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, JobManagementActionsComponent],
  providers: [JobsMonitorFacadeService],
  templateUrl: './jobs-trash.component.html',
  styleUrl: './jobs-trash.component.scss',
})
export class JobsTrashComponent implements OnInit {
  readonly facade = inject(JobsMonitorFacadeService);

  readonly statusOptions: ReadonlyArray<{ value: JobStatusFilterOption; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'completed', label: 'Completed' },
    { value: 'failed', label: 'Failed' },
    { value: 'cancelled', label: 'Cancelled' },
  ];

  ngOnInit(): void {
    this.facade.loadDeletedJobs();
  }

  refreshNow(): void {
    this.facade.loadDeletedJobs();
  }

  onStatusFilterChanged(nextStatus: JobStatusFilterOption): void {
    this.facade.setStatusFilter(nextStatus);
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
    const ownerLabel = jobItem.owner_username ?? 'Unknown user';
    const groupLabel = jobItem.group_name ?? 'No group';
    return `${ownerLabel} · ${groupLabel}`;
  }

  deletedByLabel(jobItem: ScientificJobView): string {
    return jobItem.deleted_by_username ?? 'Unknown actor';
  }

  scheduledDeletionLabel(jobItem: ScientificJobView): string {
    return jobItem.scheduled_hard_delete_at ?? 'No deadline';
  }
}
