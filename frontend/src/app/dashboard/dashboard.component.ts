// dashboard.component.ts: Dashboard principal adaptado al rol y al alcance del usuario.

import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { JobsApiService, ScientificJobView } from '../core/api/jobs-api.service';
import {
  IdentityApiService,
  IdentityUserSummaryView,
  WorkGroupView,
} from '../core/api/identity-api.service';
import { IdentitySessionService } from '../core/auth/identity-session.service';

@Component({
  selector: 'app-dashboard',
  imports: [CommonModule, RouterLink],
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

  readonly runningJobsCount = computed(
    () => this.visibleJobs().filter((jobItem: ScientificJobView) => jobItem.status === 'running').length,
  );
  readonly completedJobsCount = computed(
    () => this.visibleJobs().filter((jobItem: ScientificJobView) => jobItem.status === 'completed').length,
  );
  readonly pausedJobsCount = computed(
    () => this.visibleJobs().filter((jobItem: ScientificJobView) => jobItem.status === 'paused').length,
  );
  readonly recentJobs = computed(() => this.visibleJobs().slice(0, 6));
  readonly enabledApps = computed(() =>
    this.sessionService.accessibleApps().filter((appItem) => appItem.enabled),
  );

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
