// toxicity-properties-workflow.service.ts: Orquesta entrada, ejecucion async,
// progreso, resultados y export CSV para Toxicity Properties Table.

import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { Observable, Subscription, catchError, finalize, throwError } from 'rxjs';
import {
  DownloadedReportFile,
  JobLogEntryView,
  JobLogsPageView,
  JobProgressSnapshotView,
  JobsApiService,
  ScientificJobView,
  ToxicityJobResponseView,
  ToxicityMoleculeResultView,
} from '../api/jobs-api.service';

type ToxicityPropertiesSection = 'idle' | 'dispatching' | 'progress' | 'result' | 'error';

export interface ToxicityPropertiesResultData {
  molecules: ToxicityMoleculeResultView[];
  total: number;
  scientificReferences: string[];
}

@Injectable()
export class ToxicityPropertiesWorkflowService implements OnDestroy {
  private readonly jobsApiService = inject(JobsApiService);
  private progressSubscription: Subscription | null = null;
  private logsSubscription: Subscription | null = null;

  readonly smilesInput = signal<string>('CCO\nCC(=O)O\nc1ccccc1');

  readonly activeSection = signal<ToxicityPropertiesSection>('idle');
  readonly currentJobId = signal<string | null>(null);
  readonly progressSnapshot = signal<JobProgressSnapshotView | null>(null);
  readonly jobLogs = signal<JobLogEntryView[]>([]);
  readonly resultData = signal<ToxicityPropertiesResultData | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly exportErrorMessage = signal<string | null>(null);
  readonly isExporting = signal<boolean>(false);
  readonly historyJobs = signal<ScientificJobView[]>([]);
  readonly isHistoryLoading = signal<boolean>(false);

  readonly isProcessing = computed(
    () => this.activeSection() === 'dispatching' || this.activeSection() === 'progress',
  );
  readonly progressPercentage = computed(() => this.progressSnapshot()?.progress_percentage ?? 0);
  readonly progressMessage = computed(
    () => this.progressSnapshot()?.progress_message ?? 'Preparing toxicity prediction...',
  );

  dispatch(): void {
    this.progressSubscription?.unsubscribe();
    this.logsSubscription?.unsubscribe();

    this.activeSection.set('dispatching');
    this.errorMessage.set(null);
    this.exportErrorMessage.set(null);
    this.resultData.set(null);
    this.progressSnapshot.set(null);
    this.jobLogs.set([]);
    this.currentJobId.set(null);

    const normalizedSmiles: string[] = this.parseSmilesInput(this.smilesInput());
    if (normalizedSmiles.length === 0) {
      this.activeSection.set('error');
      this.errorMessage.set('At least one SMILES is required.');
      return;
    }

    this.jobsApiService
      .dispatchToxicityPropertiesJob({
        smiles: normalizedSmiles,
        version: '1.0.0',
      })
      .subscribe({
        next: (jobResponse: ToxicityJobResponseView) => {
          this.currentJobId.set(jobResponse.id);

          if (jobResponse.status === 'completed') {
            const immediateResultData: ToxicityPropertiesResultData | null =
              this.extractResultData(jobResponse);
            if (immediateResultData === null) {
              this.activeSection.set('error');
              this.errorMessage.set(
                'The completed job payload is invalid for toxicity properties.',
              );
              return;
            }

            this.resultData.set(immediateResultData);
            this.loadHistoricalLogs(jobResponse.id);
            this.activeSection.set('result');
            this.loadHistory();
            return;
          }

          this.activeSection.set('progress');
          this.startProgressStream(jobResponse.id);
        },
        error: (dispatchError: Error) => {
          this.activeSection.set('error');
          this.errorMessage.set(
            `Unable to create toxicity properties job: ${dispatchError.message}`,
          );
        },
      });
  }

  reset(): void {
    this.progressSubscription?.unsubscribe();
    this.logsSubscription?.unsubscribe();

    this.activeSection.set('idle');
    this.currentJobId.set(null);
    this.progressSnapshot.set(null);
    this.jobLogs.set([]);
    this.resultData.set(null);
    this.errorMessage.set(null);
    this.exportErrorMessage.set(null);
  }

  loadHistory(): void {
    this.isHistoryLoading.set(true);

    this.jobsApiService.listJobs({ pluginName: 'toxicity-properties' }).subscribe({
      next: (jobItems: ScientificJobView[]) => {
        const orderedJobs: ScientificJobView[] = [...jobItems].sort(
          (leftJob: ScientificJobView, rightJob: ScientificJobView) =>
            new Date(rightJob.updated_at).getTime() - new Date(leftJob.updated_at).getTime(),
        );
        this.historyJobs.set(orderedJobs);
        this.isHistoryLoading.set(false);
      },
      error: () => {
        this.isHistoryLoading.set(false);
      },
    });
  }

  openHistoricalJob(jobId: string): void {
    this.progressSubscription?.unsubscribe();
    this.logsSubscription?.unsubscribe();

    this.activeSection.set('dispatching');
    this.errorMessage.set(null);
    this.exportErrorMessage.set(null);
    this.currentJobId.set(jobId);
    this.jobLogs.set([]);

    this.jobsApiService.getToxicityPropertiesJobStatus(jobId).subscribe({
      next: (jobResponse: ToxicityJobResponseView) => {
        if (jobResponse.status === 'failed') {
          this.loadHistoricalLogs(jobId);
          this.activeSection.set('error');
          this.errorMessage.set('Historical job ended with error.');
          return;
        }

        const historicalData: ToxicityPropertiesResultData | null =
          this.extractResultData(jobResponse);
        if (historicalData === null) {
          this.activeSection.set('error');
          this.errorMessage.set('Unable to reconstruct historical toxicity result.');
          return;
        }

        this.resultData.set(historicalData);
        this.loadHistoricalLogs(jobId);
        this.activeSection.set('result');
      },
      error: (statusError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to recover historical job: ${statusError.message}`);
      },
    });
  }

  downloadCsvReport(): Observable<DownloadedReportFile> {
    const selectedJobId: string | null = this.currentJobId();
    if (selectedJobId === null || selectedJobId.trim() === '') {
      throw new Error('No job selected for CSV export.');
    }

    this.exportErrorMessage.set(null);
    this.isExporting.set(true);

    return this.jobsApiService.downloadToxicityPropertiesCsvReport(selectedJobId).pipe(
      finalize(() => this.isExporting.set(false)),
      catchError((requestError: unknown) => {
        const normalizedErrorMessage: string =
          requestError instanceof Error
            ? requestError.message
            : 'Unknown error while downloading CSV report.';
        this.exportErrorMessage.set(`Unable to download CSV report: ${normalizedErrorMessage}`);
        return throwError(() => requestError);
      }),
    );
  }

  ngOnDestroy(): void {
    this.progressSubscription?.unsubscribe();
    this.logsSubscription?.unsubscribe();
  }

  private parseSmilesInput(rawInput: string): string[] {
    return rawInput
      .split(/\r?\n/)
      .map((smilesItem: string) => smilesItem.trim())
      .filter((smilesItem: string) => smilesItem.length > 0);
  }

  private startProgressStream(jobId: string): void {
    this.progressSubscription?.unsubscribe();
    this.startLogsStream(jobId);

    this.progressSubscription = this.jobsApiService.streamJobEvents(jobId).subscribe({
      next: (snapshot: JobProgressSnapshotView) => this.progressSnapshot.set(snapshot),
      complete: () => this.fetchFinalResult(jobId),
      error: () => this.startPollingFallback(jobId),
    });
  }

  private startLogsStream(jobId: string): void {
    this.logsSubscription?.unsubscribe();
    this.logsSubscription = this.jobsApiService.streamJobLogEvents(jobId).subscribe({
      next: (logEntry: JobLogEntryView) => {
        this.jobLogs.update((currentLogs: JobLogEntryView[]) => {
          if (
            currentLogs.some(
              (existingLog: JobLogEntryView) => existingLog.eventIndex === logEntry.eventIndex,
            )
          ) {
            return currentLogs;
          }
          return [...currentLogs, logEntry].sort(
            (left, right) => left.eventIndex - right.eventIndex,
          );
        });
      },
      error: () => {
        this.loadHistoricalLogs(jobId);
      },
    });
  }

  private startPollingFallback(jobId: string): void {
    this.jobsApiService.pollJobUntilCompleted(jobId).subscribe({
      next: (snapshot: JobProgressSnapshotView) => this.progressSnapshot.set(snapshot),
      complete: () => this.fetchFinalResult(jobId),
      error: (pollingError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(
          `Unable to track toxicity properties job progress: ${pollingError.message}`,
        );
      },
    });
  }

  private fetchFinalResult(jobId: string): void {
    this.jobsApiService.getToxicityPropertiesJobStatus(jobId).subscribe({
      next: (jobResponse: ToxicityJobResponseView) => {
        const finalResultData: ToxicityPropertiesResultData | null =
          this.extractResultData(jobResponse);
        if (finalResultData === null) {
          this.activeSection.set('error');
          this.errorMessage.set('The final toxicity payload is invalid.');
          return;
        }

        this.resultData.set(finalResultData);
        this.activeSection.set('result');
        this.loadHistory();
      },
      error: (statusError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to retrieve final toxicity result: ${statusError.message}`);
      },
    });
  }

  private extractResultData(
    jobResponse: ToxicityJobResponseView,
  ): ToxicityPropertiesResultData | null {
    const resultsPayload = jobResponse.results;
    if (
      !Array.isArray(resultsPayload?.molecules) ||
      !Array.isArray(resultsPayload?.scientific_references)
    ) {
      return null;
    }
    return {
      molecules: resultsPayload.molecules,
      total: resultsPayload.total,
      scientificReferences: resultsPayload.scientific_references.filter(
        (referenceItem: string) => referenceItem.trim() !== '',
      ),
    };
  }

  private loadHistoricalLogs(jobId: string): void {
    this.jobsApiService.getJobLogs(jobId, { limit: 300 }).subscribe({
      next: (logsPage: JobLogsPageView) => {
        const sortedLogs: JobLogEntryView[] = [...logsPage.results].sort(
          (leftLog: JobLogEntryView, rightLog: JobLogEntryView) =>
            leftLog.eventIndex - rightLog.eventIndex,
        );
        this.jobLogs.set(sortedLogs);
      },
      error: () => {
        this.jobLogs.set([]);
      },
    });
  }
}
