// random-numbers.component.ts: Random numbers screen backed by async workflow service.

import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { Subscription } from 'rxjs';
import { ScientificJobView } from '../core/api/jobs-api.service';
import { RandomNumbersWorkflowService } from '../core/application/random-numbers-workflow.service';
import { JobLogsPanelComponent } from '../core/shared/components/job-logs-panel/job-logs-panel.component';
import { JobProgressCardComponent } from '../core/shared/components/job-progress-card/job-progress-card.component';
import { subscribeToRouteHistoricalJob } from '../core/shared/scientific-app-ui.utils';

@Component({
  selector: 'app-random-numbers',
  imports: [
    CommonModule,
    FormsModule,
    TranslocoPipe,
    JobProgressCardComponent,
    JobLogsPanelComponent,
  ],
  providers: [RandomNumbersWorkflowService],
  templateUrl: './random-numbers.component.html',
  styleUrl: './random-numbers.component.scss',
})
export class RandomNumbersComponent implements OnInit, OnDestroy {
  readonly workflow = inject(RandomNumbersWorkflowService);
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

  pauseCurrentJob(): void {
    this.workflow.pauseCurrentJob();
  }

  resumeCurrentJob(): void {
    this.workflow.resumeCurrentJob();
  }

  reset(): void {
    this.workflow.reset();
  }

  openHistoricalJob(jobId: string): void {
    this.workflow.openHistoricalJob(jobId);
  }

  historicalActionLabel(job: ScientificJobView): string {
    return this.hasFinalHistoricalResult(job) ? 'Open result' : 'View summary';
  }

  historicalStatusClass(jobStatus: ScientificJobView['status']): string {
    return `history-status history-${jobStatus}`;
  }

  historicalNumbersCount(job: ScientificJobView): number {
    const rawResults: unknown = job.results;
    if (rawResults !== null && typeof rawResults === 'object' && !Array.isArray(rawResults)) {
      const resultsRecord: { generated_numbers?: unknown } = rawResults as {
        generated_numbers?: unknown;
      };
      const rawGeneratedNumbers: unknown = resultsRecord.generated_numbers;
      if (Array.isArray(rawGeneratedNumbers)) {
        return rawGeneratedNumbers.length;
      }
    }

    const rawRuntimeState: unknown = job.runtime_state;
    if (
      rawRuntimeState === null ||
      typeof rawRuntimeState !== 'object' ||
      Array.isArray(rawRuntimeState)
    ) {
      return 0;
    }

    const runtimeStateRecord: { generated_numbers?: unknown } = rawRuntimeState as {
      generated_numbers?: unknown;
    };
    const runtimeGeneratedNumbers: unknown = runtimeStateRecord.generated_numbers;
    return Array.isArray(runtimeGeneratedNumbers) ? runtimeGeneratedNumbers.length : 0;
  }

  private hasFinalHistoricalResult(job: ScientificJobView): boolean {
    const rawResults: unknown = job.results;
    if (rawResults === null || typeof rawResults !== 'object' || Array.isArray(rawResults)) {
      return false;
    }

    const resultsRecord: { generated_numbers?: unknown; metadata?: unknown } = rawResults as {
      generated_numbers?: unknown;
      metadata?: unknown;
    };

    return (
      Array.isArray(resultsRecord.generated_numbers) &&
      resultsRecord.metadata !== null &&
      typeof resultsRecord.metadata === 'object' &&
      !Array.isArray(resultsRecord.metadata)
    );
  }
}
