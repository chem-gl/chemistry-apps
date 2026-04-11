// dashboard.component.ts: Dashboard principal adaptado al rol y al alcance del usuario.

import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IdentityApiService,
  IdentityUserSummaryView,
  WorkGroupView,
} from '../core/api/identity-api.service';
import { JobsApiService, ScientificJobView } from '../core/api/jobs-api.service';
import { IdentitySessionService } from '../core/auth/identity-session.service';
import { JobManagementActionsComponent } from '../core/shared/components/job-management-actions/job-management-actions.component';
import {
  resolveScientificJobRouteKey,
  resolveScientificJobRoutePath,
} from '../core/shared/scientific-apps.config';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, JobManagementActionsComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {
  readonly sessionService = inject(IdentitySessionService);
  private readonly jobsApiService = inject(JobsApiService);
  private readonly identityApiService = inject(IdentityApiService);

  readonly isLoading = signal<boolean>(true);
  readonly visibleJobs = signal<ScientificJobView[]>([]);
  readonly visibleUsers = signal<IdentityUserSummaryView[]>([]);
  readonly visibleGroups = signal<WorkGroupView[]>([]);
  readonly errorMessage = signal<string | null>(null);
  readonly deletingJobId = signal<string | null>(null);
  readonly deleteErrorMessage = signal<string | null>(null);

  readonly runningJobsCount = computed(
    () =>
      this.visibleJobs().filter((jobItem: ScientificJobView) => jobItem.status === 'running')
        .length,
  );
  readonly completedJobsCount = computed(
    () =>
      this.visibleJobs().filter((jobItem: ScientificJobView) => jobItem.status === 'completed')
        .length,
  );
  readonly pausedJobsCount = computed(
    () =>
      this.visibleJobs().filter((jobItem: ScientificJobView) => jobItem.status === 'paused').length,
  );
  readonly recentJobs = computed(() => this.visibleJobs().slice(0, 6));
  readonly enabledApps = computed(() =>
    this.sessionService.accessibleApps().filter((appItem) => appItem.enabled),
  );

  recentJobRoutePath(jobItem: ScientificJobView): string | null {
    const routeKey = resolveScientificJobRouteKey(jobItem.plugin_name);
    if (routeKey === null || !this.sessionService.canAccessRoute(routeKey)) {
      return null;
    }

    return resolveScientificJobRoutePath(jobItem.plugin_name);
  }

  recentJobNavigationLabel(jobItem: ScientificJobView): string {
    return this.recentJobRoutePath(jobItem) === null ? 'Result unavailable' : 'Open result';
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

  deleteActionLabel(jobItem: ScientificJobView): string {
    const deleteMode = this.sessionService.resolveDeleteMode({
      owner: jobItem.owner ?? null,
      group: jobItem.group ?? null,
    });

    return deleteMode === 'hard' ? 'Delete permanently' : 'Move to trash';
  }

  deleteJob(jobId: string): void {
    this.deletingJobId.set(jobId);
    this.deleteErrorMessage.set(null);
    this.jobsApiService.deleteJob(jobId).subscribe({
      next: () => {
        this.visibleJobs.update((currentJobs: ScientificJobView[]) =>
          currentJobs.filter((jobItem: ScientificJobView) => jobItem.id !== jobId),
        );
        this.deletingJobId.set(null);
      },
      error: (deleteError: Error) => {
        this.deleteErrorMessage.set(deleteError.message ?? 'Unable to delete job.');
        this.deletingJobId.set(null);
      },
    });
  }

  isDeletingJob(jobId: string): boolean {
    return this.deletingJobId() === jobId;
  }

  private isTerminalJob(jobItem: ScientificJobView): boolean {
    return (
      jobItem.status === 'completed' ||
      jobItem.status === 'failed' ||
      jobItem.status === 'cancelled'
    );
  }

  ngOnInit(): void {
    this.sessionService.initializeSession().subscribe({
      next: (isAuthenticated: boolean) => {
        if (!isAuthenticated) {
          this.isLoading.set(false);
          return;
        }
        this.loadDashboardData();
      },
      error: (dashboardError: { message?: string }) => {
        this.errorMessage.set(dashboardError.message ?? 'Unable to load dashboard.');
        this.isLoading.set(false);
      },
    });
  }

  private loadDashboardData(): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    this.jobsApiService.listJobs().subscribe({
      next: (jobs: ScientificJobView[]) => {
        this.visibleJobs.set(jobs);
        this.loadIdentityScope();
      },
      error: (jobsError: { message?: string }) => {
        this.errorMessage.set(jobsError.message ?? 'Unable to load dashboard jobs.');
        this.isLoading.set(false);
      },
    });
  }

  private loadIdentityScope(): void {
    if (!this.sessionService.hasAdminAccess()) {
      this.isLoading.set(false);
      return;
    }

    this.identityApiService.listUsers().subscribe({
      next: (users: IdentityUserSummaryView[]) => {
        this.visibleUsers.set(users);
      },
    });

    this.identityApiService.listGroups().subscribe({
      next: (groups: WorkGroupView[]) => {
        this.visibleGroups.set(groups);
        this.isLoading.set(false);
      },
      error: (identityError: { message?: string }) => {
        this.errorMessage.set(identityError.message ?? 'Unable to load identity scope.');
        this.isLoading.set(false);
      },
    });
  }
}
