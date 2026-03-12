// tunnel-workflow.service.ts: Orquesta formulario, trazabilidad de entradas, progreso y resultados de Tunnel.

import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { Observable, Subscription, catchError, finalize, throwError } from 'rxjs';
import { JobProgressSnapshot, ScientificJob } from '../api/generated';
import {
  DownloadedReportFile,
  JobLogEntryView,
  JobLogsPageView,
  JobsApiService,
  TunnelInputChangeEvent,
} from '../api/jobs-api.service';

type TunnelSection = 'idle' | 'dispatching' | 'progress' | 'result' | 'error';

export interface TunnelResultData {
  reactionBarrierZpe: number;
  imaginaryFrequency: number;
  reactionEnergyZpe: number;
  temperature: number;
  u: number | null;
  alpha1: number | null;
  alpha2: number | null;
  g: number | null;
  kappaTst: number | null;
  modelName: string | null;
  sourceLibrary: string | null;
  inputEventCount: number;
  isHistoricalSummary: boolean;
  summaryMessage: string | null;
}

@Injectable()
export class TunnelWorkflowService implements OnDestroy {
  private readonly jobsApiService = inject(JobsApiService);
  private progressSubscription: Subscription | null = null;
  private logsSubscription: Subscription | null = null;

  readonly reactionBarrierZpe = signal<number>(3.5);
  readonly imaginaryFrequency = signal<number>(625.0);
  readonly reactionEnergyZpe = signal<number>(-8.2);
  readonly temperature = signal<number>(298.15);

  readonly inputChangeEvents = signal<TunnelInputChangeEvent[]>([]);

  readonly activeSection = signal<TunnelSection>('idle');
  readonly currentJobId = signal<string | null>(null);
  readonly progressSnapshot = signal<JobProgressSnapshot | null>(null);
  readonly jobLogs = signal<JobLogEntryView[]>([]);
  readonly resultData = signal<TunnelResultData | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly exportErrorMessage = signal<string | null>(null);
  readonly isExporting = signal<boolean>(false);
  readonly historyJobs = signal<ScientificJob[]>([]);
  readonly isHistoryLoading = signal<boolean>(false);

  readonly isProcessing = computed(
    () => this.activeSection() === 'dispatching' || this.activeSection() === 'progress',
  );

  readonly progressPercentage = computed(() => this.progressSnapshot()?.progress_percentage ?? 0);

  readonly progressMessage = computed(
    () => this.progressSnapshot()?.progress_message ?? 'Preparing tunnel effect calculation...',
  );

  updateReactionBarrierZpe(nextValue: number): void {
    const previousValue: number = this.reactionBarrierZpe();
    this.reactionBarrierZpe.set(Number(nextValue));
    this.recordInputChange('reaction_barrier_zpe', previousValue, Number(nextValue));
  }

  updateImaginaryFrequency(nextValue: number): void {
    const previousValue: number = this.imaginaryFrequency();
    this.imaginaryFrequency.set(Number(nextValue));
    this.recordInputChange('imaginary_frequency', previousValue, Number(nextValue));
  }

  updateReactionEnergyZpe(nextValue: number): void {
    const previousValue: number = this.reactionEnergyZpe();
    this.reactionEnergyZpe.set(Number(nextValue));
    this.recordInputChange('reaction_energy_zpe', previousValue, Number(nextValue));
  }

  updateTemperature(nextValue: number): void {
    const previousValue: number = this.temperature();
    this.temperature.set(Number(nextValue));
    this.recordInputChange('temperature', previousValue, Number(nextValue));
  }

  clearInputHistory(): void {
    this.inputChangeEvents.set([]);
  }

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

    this.jobsApiService
      .dispatchTunnelJob({
        reactionBarrierZpe: this.reactionBarrierZpe(),
        imaginaryFrequency: this.imaginaryFrequency(),
        reactionEnergyZpe: this.reactionEnergyZpe(),
        temperature: this.temperature(),
        inputChangeEvents: this.inputChangeEvents(),
      })
      .subscribe({
        next: (jobResponse: ScientificJob) => {
          this.currentJobId.set(jobResponse.id);
          this.syncInputsFromJobParameters(jobResponse);

          if (jobResponse.status === 'completed') {
            const immediateResultData: TunnelResultData | null =
              this.extractResultData(jobResponse);
            if (immediateResultData === null) {
              this.activeSection.set('error');
              this.errorMessage.set('The completed job payload is invalid for tunnel effect.');
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
          this.errorMessage.set(`Unable to create tunnel job: ${dispatchError.message}`);
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

  openHistoricalJob(jobId: string): void {
    this.progressSubscription?.unsubscribe();
    this.logsSubscription?.unsubscribe();

    this.activeSection.set('dispatching');
    this.errorMessage.set(null);
    this.exportErrorMessage.set(null);
    this.currentJobId.set(jobId);
    this.jobLogs.set([]);

    this.jobsApiService.getScientificJobStatus(jobId).subscribe({
      next: (jobResponse: ScientificJob) => {
        this.syncInputsFromJobParameters(jobResponse);

        if (jobResponse.status === 'failed') {
          this.loadHistoricalLogs(jobId);
          this.activeSection.set('error');
          this.errorMessage.set(
            jobResponse.error_trace ?? 'Historical tunnel job ended with error.',
          );
          return;
        }

        const historicalData: TunnelResultData | null =
          this.extractResultData(jobResponse) ?? this.extractSummaryData(jobResponse);
        if (historicalData === null) {
          this.activeSection.set('error');
          this.errorMessage.set('Unable to reconstruct historical tunnel job output.');
          return;
        }

        this.resultData.set(historicalData);
        this.loadHistoricalLogs(jobId);
        this.activeSection.set('result');
      },
      error: (statusError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to recover historical tunnel job: ${statusError.message}`);
      },
    });
  }

  loadHistory(): void {
    this.isHistoryLoading.set(true);

    this.jobsApiService.listJobs({ pluginName: 'tunnel-effect' }).subscribe({
      next: (jobItems: ScientificJob[]) => {
        const orderedJobs: ScientificJob[] = [...jobItems].sort(
          (leftJob: ScientificJob, rightJob: ScientificJob) =>
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

  downloadCsvReport(): Observable<DownloadedReportFile> {
    const selectedJobId: string | null = this.currentJobId();
    if (selectedJobId === null || selectedJobId.trim() === '') {
      throw new Error('No job selected for CSV export.');
    }

    this.exportErrorMessage.set(null);
    this.isExporting.set(true);

    return this.jobsApiService.downloadTunnelCsvReport(selectedJobId).pipe(
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

  downloadLogReport(): Observable<DownloadedReportFile> {
    const selectedJobId: string | null = this.currentJobId();
    if (selectedJobId === null || selectedJobId.trim() === '') {
      throw new Error('No job selected for LOG export.');
    }

    this.exportErrorMessage.set(null);
    this.isExporting.set(true);

    return this.jobsApiService.downloadTunnelLogReport(selectedJobId).pipe(
      finalize(() => this.isExporting.set(false)),
      catchError((requestError: unknown) => {
        const normalizedErrorMessage: string =
          requestError instanceof Error
            ? requestError.message
            : 'Unknown error while downloading LOG report.';
        this.exportErrorMessage.set(`Unable to download LOG report: ${normalizedErrorMessage}`);
        return throwError(() => requestError);
      }),
    );
  }

  ngOnDestroy(): void {
    this.progressSubscription?.unsubscribe();
    this.logsSubscription?.unsubscribe();
  }

  private recordInputChange(fieldName: string, previousValue: number, newValue: number): void {
    if (previousValue === newValue) {
      return;
    }

    const nextEvent: TunnelInputChangeEvent = {
      fieldName,
      previousValue,
      newValue,
      changedAt: new Date().toISOString(),
    };

    this.inputChangeEvents.update((currentEvents: TunnelInputChangeEvent[]) => {
      const nextEvents: TunnelInputChangeEvent[] = [...currentEvents, nextEvent];
      return nextEvents.length > 2000 ? nextEvents.slice(nextEvents.length - 2000) : nextEvents;
    });
  }

  private startProgressStream(jobId: string): void {
    this.startLogsStream(jobId);
    this.progressSubscription = this.jobsApiService.streamJobEvents(jobId).subscribe({
      next: (snapshot: JobProgressSnapshot) => this.progressSnapshot.set(snapshot),
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
            currentLogs.some((item: JobLogEntryView) => item.eventIndex === logEntry.eventIndex)
          ) {
            return currentLogs;
          }
          return [...currentLogs, logEntry].sort(
            (leftEntry: JobLogEntryView, rightEntry: JobLogEntryView) =>
              leftEntry.eventIndex - rightEntry.eventIndex,
          );
        });
      },
      error: () => {
        // Mantener funcional la UI aun si el stream SSE de logs falla.
      },
    });
  }

  private loadHistoricalLogs(jobId: string): void {
    this.jobsApiService.getJobLogs(jobId, { limit: 250 }).subscribe({
      next: (logsPage: JobLogsPageView) => this.jobLogs.set(logsPage.results),
      error: () => {
        // Mantener vista histórica disponible aun si falla lectura de logs.
      },
    });
  }

  private startPollingFallback(jobId: string): void {
    this.progressSubscription = this.jobsApiService.pollJobUntilCompleted(jobId, 1000).subscribe({
      next: (snapshot: JobProgressSnapshot) => {
        this.progressSnapshot.set(snapshot);
        this.fetchFinalResult(jobId);
      },
      error: (pollingError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to track tunnel job progress: ${pollingError.message}`);
      },
    });
  }

  private fetchFinalResult(jobId: string): void {
    this.jobsApiService.getScientificJobStatus(jobId).subscribe({
      next: (jobResponse: ScientificJob) => {
        this.syncInputsFromJobParameters(jobResponse);

        if (jobResponse.status === 'failed') {
          this.loadHistoricalLogs(jobId);
          this.activeSection.set('error');
          this.errorMessage.set(jobResponse.error_trace ?? 'Tunnel job failed with no details.');
          return;
        }

        const finalResultData: TunnelResultData | null = this.extractResultData(jobResponse);
        if (finalResultData === null) {
          this.activeSection.set('error');
          this.errorMessage.set('The final payload is invalid for tunnel effect.');
          return;
        }

        this.resultData.set(finalResultData);
        this.loadHistoricalLogs(jobId);
        this.activeSection.set('result');
        this.loadHistory();
      },
      error: (statusError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to get tunnel final result: ${statusError.message}`);
      },
    });
  }

  private extractResultData(jobResponse: ScientificJob): TunnelResultData | null {
    const rawResults: unknown = jobResponse.results;
    if (!this.isRecord(rawResults)) {
      return null;
    }

    const rawU: unknown = rawResults['u'];
    const rawAlpha1: unknown = rawResults['alpha_1'];
    const rawAlpha2: unknown = rawResults['alpha_2'];
    const rawG: unknown = rawResults['g'];
    const rawKappa: unknown = rawResults['kappa_tst'];
    const rawMetadata: unknown = rawResults['metadata'];

    if (
      typeof rawU !== 'number' ||
      typeof rawAlpha1 !== 'number' ||
      typeof rawAlpha2 !== 'number' ||
      typeof rawG !== 'number' ||
      typeof rawKappa !== 'number' ||
      !this.isRecord(rawMetadata)
    ) {
      return null;
    }

    const parametersData: TunnelResultData | null = this.extractSummaryData(jobResponse);
    if (parametersData === null) {
      return null;
    }

    const modelName: unknown = rawMetadata['model_name'];
    const sourceLibrary: unknown = rawMetadata['source_library'];
    const inputEventCount: unknown = rawMetadata['input_event_count'];

    return {
      ...parametersData,
      u: rawU,
      alpha1: rawAlpha1,
      alpha2: rawAlpha2,
      g: rawG,
      kappaTst: rawKappa,
      modelName: typeof modelName === 'string' ? modelName : null,
      sourceLibrary: typeof sourceLibrary === 'string' ? sourceLibrary : null,
      inputEventCount: typeof inputEventCount === 'number' ? inputEventCount : 0,
      isHistoricalSummary: false,
      summaryMessage: null,
    };
  }

  private extractSummaryData(jobResponse: ScientificJob): TunnelResultData | null {
    const rawParameters: unknown = jobResponse.parameters;
    if (!this.isRecord(rawParameters)) {
      return null;
    }

    const rawReactionBarrierZpe: unknown = rawParameters['reaction_barrier_zpe'];
    const rawImaginaryFrequency: unknown = rawParameters['imaginary_frequency'];
    const rawReactionEnergyZpe: unknown = rawParameters['reaction_energy_zpe'];
    const rawTemperature: unknown = rawParameters['temperature'];

    if (
      typeof rawReactionBarrierZpe !== 'number' ||
      typeof rawImaginaryFrequency !== 'number' ||
      typeof rawReactionEnergyZpe !== 'number' ||
      typeof rawTemperature !== 'number'
    ) {
      return null;
    }

    return {
      reactionBarrierZpe: rawReactionBarrierZpe,
      imaginaryFrequency: rawImaginaryFrequency,
      reactionEnergyZpe: rawReactionEnergyZpe,
      temperature: rawTemperature,
      u: null,
      alpha1: null,
      alpha2: null,
      g: null,
      kappaTst: null,
      modelName: null,
      sourceLibrary: null,
      inputEventCount: this.extractInputEventsFromParameters(rawParameters).length,
      isHistoricalSummary: true,
      summaryMessage: this.buildHistoricalSummaryMessage(jobResponse.status),
    };
  }

  private syncInputsFromJobParameters(jobResponse: ScientificJob): void {
    const rawParameters: unknown = jobResponse.parameters;
    if (!this.isRecord(rawParameters)) {
      return;
    }

    const rawReactionBarrierZpe: unknown = rawParameters['reaction_barrier_zpe'];
    const rawImaginaryFrequency: unknown = rawParameters['imaginary_frequency'];
    const rawReactionEnergyZpe: unknown = rawParameters['reaction_energy_zpe'];
    const rawTemperature: unknown = rawParameters['temperature'];

    if (typeof rawReactionBarrierZpe === 'number') {
      this.reactionBarrierZpe.set(rawReactionBarrierZpe);
    }

    if (typeof rawImaginaryFrequency === 'number') {
      this.imaginaryFrequency.set(rawImaginaryFrequency);
    }

    if (typeof rawReactionEnergyZpe === 'number') {
      this.reactionEnergyZpe.set(rawReactionEnergyZpe);
    }

    if (typeof rawTemperature === 'number') {
      this.temperature.set(rawTemperature);
    }

    this.inputChangeEvents.set(this.extractInputEventsFromParameters(rawParameters));
  }

  private extractInputEventsFromParameters(
    rawParameters: Record<string, unknown>,
  ): TunnelInputChangeEvent[] {
    const rawEvents: unknown = rawParameters['input_change_events'];
    if (!Array.isArray(rawEvents)) {
      return [];
    }

    const parsedEvents: TunnelInputChangeEvent[] = [];
    for (const eventCandidate of rawEvents) {
      if (!this.isRecord(eventCandidate)) {
        continue;
      }

      const rawFieldName: unknown = eventCandidate['field_name'];
      const rawPreviousValue: unknown = eventCandidate['previous_value'];
      const rawNewValue: unknown = eventCandidate['new_value'];
      const rawChangedAt: unknown = eventCandidate['changed_at'];

      if (
        typeof rawFieldName !== 'string' ||
        typeof rawPreviousValue !== 'number' ||
        typeof rawNewValue !== 'number' ||
        typeof rawChangedAt !== 'string'
      ) {
        continue;
      }

      parsedEvents.push({
        fieldName: rawFieldName,
        previousValue: rawPreviousValue,
        newValue: rawNewValue,
        changedAt: rawChangedAt,
      });
    }

    return parsedEvents;
  }

  private buildHistoricalSummaryMessage(jobStatus: ScientificJob['status']): string {
    if (jobStatus === 'pending') {
      return 'Historical summary: this tunnel job is still pending execution.';
    }
    if (jobStatus === 'running') {
      return 'Historical summary: this tunnel job is still running.';
    }
    if (jobStatus === 'paused') {
      return 'Historical summary: this tunnel job is paused.';
    }
    return 'Historical summary: no final result payload was available.';
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
