// calculator.component.ts: Scientific calculator screen wired to async workflow service.

import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { Subscription } from 'rxjs';
import { ScientificJobView } from '../core/api/jobs-api.service';
import { CalculatorWorkflowService } from '../core/application/calculator-workflow.service';
import { JobLogsPanelComponent } from '../core/shared/components/job-logs-panel/job-logs-panel.component';
import { JobProgressCardComponent } from '../core/shared/components/job-progress-card/job-progress-card.component';

@Component({
  selector: 'app-calculator',
  imports: [
    CommonModule,
    FormsModule,
    TranslocoPipe,
    JobProgressCardComponent,
    JobLogsPanelComponent,
  ],
  providers: [CalculatorWorkflowService],
  templateUrl: './calculator.component.html',
  styleUrl: './calculator.component.scss',
})
export class CalculatorComponent implements OnInit, OnDestroy {
  private readonly workflowService = inject(CalculatorWorkflowService);
  private readonly route = inject(ActivatedRoute);
  private routeSubscription: Subscription | null = null;

  readonly operations = this.workflowService.operations;
  readonly stageSteps = this.workflowService.stageSteps;
  readonly selectedOperation = this.workflowService.selectedOperation;
  readonly firstOperand = this.workflowService.firstOperand;
  readonly secondOperand = this.workflowService.secondOperand;
  readonly activeSection = this.workflowService.activeSection;
  readonly currentJobId = this.workflowService.currentJobId;
  readonly progressSnapshot = this.workflowService.progressSnapshot;
  readonly lastResult = this.workflowService.lastResult;
  readonly errorMessage = this.workflowService.errorMessage;
  readonly requiresSecondOperand = this.workflowService.requiresSecondOperand;
  readonly isProcessing = this.workflowService.isProcessing;
  readonly progressPercentage = this.workflowService.progressPercentage;
  readonly progressMessage = this.workflowService.progressMessage;
  readonly currentStage = this.workflowService.currentStage;
  readonly jobLogs = this.workflowService.jobLogs;
  readonly historyJobs = this.workflowService.historyJobs;
  readonly isHistoryLoading = this.workflowService.isHistoryLoading;

  ngOnInit(): void {
    this.workflowService.loadHistory();

    this.routeSubscription = this.route.queryParamMap.subscribe((paramsMap) => {
      const jobId: string | null = paramsMap.get('jobId');
      if (jobId !== null && jobId.trim() !== '') {
        this.workflowService.openHistoricalJob(jobId);
      }
    });
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
  }

  stageLabel(stageName: string): string {
    return this.workflowService.stageLabel(stageName);
  }

  isStepDone(stepName: string): boolean {
    return this.workflowService.isStepDone(stepName);
  }

  isStepActive(stepName: string): boolean {
    return this.workflowService.isStepActive(stepName);
  }

  dispatch(): void {
    this.workflowService.dispatch();
  }

  reset(): void {
    this.workflowService.reset();
  }

  loadHistory(): void {
    this.workflowService.loadHistory();
  }

  openHistoricalJob(jobId: string): void {
    this.workflowService.openHistoricalJob(jobId);
  }

  historicalStatusClass(jobStatus: ScientificJobView['status']): string {
    return `history-status history-${jobStatus}`;
  }

  historicalOperationLabel(job: ScientificJobView): string {
    const rawResults: unknown = job.results;
    if (rawResults === null || typeof rawResults !== 'object' || Array.isArray(rawResults)) {
      return '-';
    }

    const resultsRecord: { metadata?: unknown } = rawResults as { metadata?: unknown };
    const rawMetadata: unknown = resultsRecord.metadata;
    if (rawMetadata === null || typeof rawMetadata !== 'object' || Array.isArray(rawMetadata)) {
      return '-';
    }

    const metadataRecord: { operation_used?: unknown } = rawMetadata as {
      operation_used?: unknown;
    };
    const operationUsed: unknown = metadataRecord.operation_used;
    return typeof operationUsed === 'string' ? operationUsed : '-';
  }
}
