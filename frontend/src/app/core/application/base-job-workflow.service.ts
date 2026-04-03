// base-job-workflow.service.ts: Clase base para todos los workflow services de apps científicas.
// Centraliza señales de estado, streaming SSE, historial y gestión de descargas comunes.
// Las subclases implementan dispatch(), loadHistory() y fetchFinalResult() con lógica específica.
// handleJobOutcome() provee el patrón común para procesar respuestas de job en todos los servicios.

import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { Observable, Subscription, catchError, finalize, throwError } from 'rxjs';
import {
  DownloadedReportFile,
  JobLogEntryView,
  JobLogsPageView,
  JobProgressSnapshotView,
  JobsApiService,
  ScientificJobView,
} from '../api/jobs-api.service';
import { mergeLogEntry } from './log-entry-utils';

/** Secciones de pantalla disponibles en todos los workflow services de apps científicas */
export type JobWorkflowSection = 'idle' | 'dispatching' | 'progress' | 'result' | 'error';

/**
 * Clase base para workflow services.
 * Implementa el ciclo de vida común: SSE de progreso y logs, polling de fallback,
 * historial de jobs, descargas y gestión del estado de sección.
 *
 * Uso: extender esta clase en cada workflow service e implementar los métodos abstractos.
 */
@Injectable()
export abstract class BaseJobWorkflowService<TResultData> implements OnDestroy {
  protected readonly jobsApiService = inject(JobsApiService);
  protected progressSubscription: Subscription | null = null;
  protected logsSubscription: Subscription | null = null;

  // ── Señales de estado del ciclo de vida ───────────────────────────
  readonly activeSection = signal<JobWorkflowSection>('idle');
  readonly currentJobId = signal<string | null>(null);
  readonly progressSnapshot = signal<JobProgressSnapshotView | null>(null);
  readonly jobLogs = signal<JobLogEntryView[]>([]);
  readonly resultData = signal<TResultData | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly exportErrorMessage = signal<string | null>(null);
  readonly isExporting = signal<boolean>(false);
  readonly historyJobs = signal<ScientificJobView[]>([]);
  readonly isHistoryLoading = signal<boolean>(false);

  // ── Señales derivadas comunes ──────────────────────────────────────
  readonly isProcessing = computed(
    () => this.activeSection() === 'dispatching' || this.activeSection() === 'progress',
  );
  readonly progressPercentage = computed(() => this.progressSnapshot()?.progress_percentage ?? 0);
  readonly progressMessage = computed(
    () => this.progressSnapshot()?.progress_message ?? this.defaultProgressMessage,
  );

  // ── Contrato que deben implementar las subclases ───────────────────

  /** Mensaje de progreso mostrado mientras el snapshot todavía no tiene mensaje del backend. */
  protected abstract get defaultProgressMessage(): string;

  /** Despacha el job al backend con los parámetros del formulario actual. */
  abstract dispatch(): void;

  /** Recarga el historial de jobs de la app para el panel lateral. */
  abstract loadHistory(): void;

  /** Obtiene y procesa el resultado final del job una vez completado. */
  protected abstract fetchFinalResult(jobId: string): void;

  // ── Ciclo de vida ──────────────────────────────────────────────────

  ngOnDestroy(): void {
    this.progressSubscription?.unsubscribe();
    this.logsSubscription?.unsubscribe();
  }

  /** Resetea el flujo de ejecución al estado inicial sin limpiar el formulario. */
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

  // ── Streaming SSE y polling ────────────────────────────────────────

  /** Inicia el stream de eventos de progreso SSE y el stream de logs en paralelo. */
  protected startProgressStream(jobId: string): void {
    this.startLogsStream(jobId);
    this.progressSubscription = this.jobsApiService.streamJobEvents(jobId).subscribe({
      next: (snapshot: JobProgressSnapshotView) => this.progressSnapshot.set(snapshot),
      complete: () => this.fetchFinalResult(jobId),
      error: () => this.startPollingFallback(jobId),
    });
  }

  /** Inicia el stream SSE de logs del job, deduplicando por eventIndex. */
  protected startLogsStream(jobId: string): void {
    this.logsSubscription?.unsubscribe();
    this.logsSubscription = this.jobsApiService.streamJobLogEvents(jobId).subscribe({
      next: (logEntry: JobLogEntryView) => {
        this.jobLogs.update((current) => mergeLogEntry(current, logEntry));
      },
      error: () => {
        // Mantener UI funcional aunque el stream SSE de logs falle.
      },
    });
  }

  /** Carga logs históricos paginados para jobs completados o fallidos. */
  protected loadHistoricalLogs(jobId: string): void {
    this.jobsApiService.getJobLogs(jobId, { limit: 250 }).subscribe({
      next: (logsPage: JobLogsPageView) => this.jobLogs.set(logsPage.results),
      error: () => {
        // La vista histórica sigue disponible si falla la carga de logs.
      },
    });
  }

  /** Inicia polling como fallback si el stream SSE de progreso falla. */
  protected startPollingFallback(jobId: string): void {
    this.progressSubscription = this.jobsApiService.pollJobUntilCompleted(jobId, 1000).subscribe({
      next: (snapshot: JobProgressSnapshotView) => {
        this.progressSnapshot.set(snapshot);
        this.fetchFinalResult(jobId);
      },
      error: (pollingError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to track progress: ${pollingError.message}`);
      },
    });
  }

  // ── Descargas ──────────────────────────────────────────────────────

  /** Envuelve una descarga con manejo de estado isExporting y error. */
  protected buildDownloadStream(
    source: Observable<DownloadedReportFile>,
    label: string,
  ): Observable<DownloadedReportFile> {
    if (this.currentJobId() === null) {
      throw new Error('No job selected for download.');
    }
    this.exportErrorMessage.set(null);
    this.isExporting.set(true);
    return source.pipe(
      finalize(() => this.isExporting.set(false)),
      catchError((requestError: unknown) => {
        const msg: string = requestError instanceof Error ? requestError.message : 'Unknown error.';
        this.exportErrorMessage.set(`Unable to download ${label}: ${msg}`);
        return throwError(() => requestError);
      }),
    );
  }

  // ── Historial ──────────────────────────────────────────────────────

  /** Ordena jobs por updated_at descendente (más reciente primero). */
  protected sortJobsByUpdatedAt(jobs: ScientificJobView[]): ScientificJobView[] {
    return [...jobs].sort(
      (a: ScientificJobView, b: ScientificJobView) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );
  }

  /** Carga historial de jobs de una app específica por plugin name. */
  protected loadHistoryForPlugin(pluginName: string): void {
    this.isHistoryLoading.set(true);
    this.jobsApiService.listJobs({ pluginName }).subscribe({
      next: (jobItems: ScientificJobView[]) => {
        this.historyJobs.set(this.sortJobsByUpdatedAt(jobItems));
        this.isHistoryLoading.set(false);
      },
      error: () => {
        this.isHistoryLoading.set(false);
      },
    });
  }

  // ── Resúmenes históricos ───────────────────────────────────────────

  /** Construye el mensaje de resumen para jobs en estados no terminales. */
  protected buildHistoricalSummaryMessage(status: string): string {
    if (status === 'pending') return 'Historical summary: this job is still pending execution.';
    if (status === 'running') return 'Historical summary: this job is still running.';
    if (status === 'paused') return 'Historical summary: this job is paused.';
    return 'Historical summary: no final result payload was available.';
  }

  // ── Helpers de inicialización de dispatch ─────────────────────────

  /**
   * Prepara el estado interno antes de despachar un nuevo job.
   * Cancela subscripciones activas y limpia resultados anteriores.
   */
  protected prepareForDispatch(): void {
    this.progressSubscription?.unsubscribe();
    this.logsSubscription?.unsubscribe();
    this.activeSection.set('dispatching');
    this.errorMessage.set(null);
    this.exportErrorMessage.set(null);
    this.resultData.set(null);
    this.progressSnapshot.set(null);
    this.jobLogs.set([]);
    this.currentJobId.set(null);
  }

  // ── Helpers de manejo de respuestas ───────────────────────────────

  /**
   * Patrón común para procesar la respuesta de un job (fetchFinalResult u openHistoricalJob).
   * Maneja el caso de job fallido, payload inválido y resultado exitoso.
   *
   * @param jobId         UUID del job para cargar logs históricos
   * @param jobResponse   Respuesta del backend (debe tener status y opcionalmente error_trace)
   * @param extract       Función que extrae TResultData desde la respuesta (null = payload inválido)
   * @param opts.checkFailed      Verifica status='failed' antes de extraer (default: true)
   * @param opts.loadLogs         Carga logs históricos al finalizar (default: true)
   * @param opts.loadHistoryAfter Llama loadHistory() si el resultado es exitoso (default: true)
   */
  protected handleJobOutcome<T extends { status?: string; error_trace?: string | null }>(
    jobId: string,
    jobResponse: T,
    extract: (job: T) => TResultData | null,
    opts: { checkFailed?: boolean; loadLogs?: boolean; loadHistoryAfter?: boolean } = {},
  ): void {
    const checkFailed = opts.checkFailed !== false;
    const loadLogs = opts.loadLogs !== false;
    const loadHistoryAfter = opts.loadHistoryAfter !== false;

    if (checkFailed && jobResponse.status === 'failed') {
      if (loadLogs) this.loadHistoricalLogs(jobId);
      this.activeSection.set('error');
      this.errorMessage.set(jobResponse.error_trace ?? 'Job ended with error.');
      return;
    }

    const result = extract(jobResponse);
    if (result === null) {
      this.activeSection.set('error');
      this.errorMessage.set('Result payload is invalid.');
      return;
    }

    this.resultData.set(result);
    if (loadLogs) this.loadHistoricalLogs(jobId);
    this.activeSection.set('result');
    if (loadHistoryAfter) this.loadHistory();
  }

  /**
   * Patrón común para manejar la respuesta inmediata del dispatch de un job.
   * Si el job ya está completado, extrae el resultado directamente.
   * Si no, inicia el stream de progreso SSE.
   *
   * @param jobResponse Respuesta del API de creación del job
   * @param extract     Función que extrae TResultData del jobResponse (null = payload inválido)
   * @param errorLabel  Etiqueta para el mensaje de error si el payload es inválido
   */
  protected handleDispatchJobResponse<T extends { id: string; status?: string }>(
    jobResponse: T,
    extract: (job: T) => TResultData | null,
    errorLabel: string,
  ): void {
    this.currentJobId.set(jobResponse.id);

    if (jobResponse.status === 'completed') {
      const immediateResult = extract(jobResponse);
      if (immediateResult === null) {
        this.activeSection.set('error');
        this.errorMessage.set(`The completed job payload is invalid for ${errorLabel}.`);
        return;
      }
      this.resultData.set(immediateResult);
      this.loadHistoricalLogs(jobResponse.id);
      this.activeSection.set('result');
      this.loadHistory();
      return;
    }

    this.activeSection.set('progress');
    this.startProgressStream(jobResponse.id);
  }
}
