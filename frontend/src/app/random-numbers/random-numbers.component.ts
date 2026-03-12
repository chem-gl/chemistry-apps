// random-numbers.component.ts: Random numbers screen backed by async workflow service.

import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { ScientificJob } from '../core/api/generated';
import { JobLogEntryView } from '../core/api/jobs-api.service';
import { RandomNumbersWorkflowService } from '../core/application/random-numbers-workflow.service';

@Component({
  selector: 'app-random-numbers',
  imports: [CommonModule, FormsModule],
  providers: [RandomNumbersWorkflowService],
  templateUrl: './random-numbers.component.html',
  styleUrl: './random-numbers.component.scss',
})
export class RandomNumbersComponent implements OnInit, OnDestroy {
  readonly workflow = inject(RandomNumbersWorkflowService);
  private readonly route = inject(ActivatedRoute);
  private routeSubscription: Subscription | null = null;

  ngOnInit(): void {
    this.workflow.loadHistory();

    this.routeSubscription = this.route.queryParamMap.subscribe((paramsMap) => {
      const jobId: string | null = paramsMap.get('jobId');
      if (jobId !== null && jobId.trim() !== '') {
        this.workflow.openHistoricalJob(jobId);
      }
    });
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

  historicalActionLabel(job: ScientificJob): string {
    return this.hasFinalHistoricalResult(job) ? 'Open result' : 'View summary';
  }

  historicalStatusClass(jobStatus: ScientificJob['status']): string {
    return `history-status history-${jobStatus}`;
  }

  historicalNumbersCount(job: ScientificJob): number {
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

  private hasFinalHistoricalResult(job: ScientificJob): boolean {
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

  hasPayload(logEntry: JobLogEntryView): boolean {
    return Object.keys(logEntry.payload).length > 0;
  }

  logLevelClass(logLevel: JobLogEntryView['level']): string {
    return `log-level log-level-${logLevel}`;
  }
}
