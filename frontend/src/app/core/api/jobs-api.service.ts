// jobs-api.service.ts: Wrapper que encapsula el cliente generado de OpenAPI.
// Este servicio actua como fachada estable: protege al resto del frontend de cambios en
// el cliente generado y centraliza la logica de despacho, polling y streaming de progreso.

import { Injectable, inject } from '@angular/core';
import { Observable, filter, interval, map, shareReplay, switchMap, take } from 'rxjs';
import { API_BASE_URL, JOBS_WEBSOCKET_URL } from '../shared/constants';
import {
  CalculatorJobCreateRequest,
  CalculatorJobResponse,
  CalculatorOperationEnum,
  CalculatorService,
  JobControlActionResponse,
  JobCreateRequest,
  JobLogList,
  JobProgressSnapshot,
  JobsService,
  ScientificJob,
} from './generated';

/**
 * Parámetros de entrada para crear un job de calculadora.
 *
 * - `op`: operación a ejecutar. 'factorial' usa solo `a` e ignora `b`.
 * - `a`: primer operando (base en pow, único en factorial).
 * - `b`: segundo operando; obligatorio para add/sub/mul/div/pow; omitir en factorial.
 *
 * Ejemplos:
 *   `{ op: 'add', a: 5, b: 3 }`       → suma: 5 + 3
 *   `{ op: 'pow', a: 2, b: 10 }`      → potencia: 2^10
 *   `{ op: 'factorial', a: 7 }`        → factorial: 7!
 */
export interface CalculatorParams {
  op: CalculatorOperationEnum;
  a: number;
  b?: number;
}

/** Estados válidos para filtrado de jobs en listados globales */
export type JobListStatusFilter = 'pending' | 'running' | 'paused' | 'completed' | 'failed';

/** Filtros opcionales para consultar jobs en el monitor */
export interface JobListFilters {
  pluginName?: string;
  status?: JobListStatusFilter;
}

/** Parámetros genéricos para despachar jobs de cualquier app científica */
export interface ScientificJobDispatchParams {
  pluginName: string;
  version?: string;
  parameters: Record<string, unknown>;
}

/** Severidad de eventos de log por job emitidos por backend */
export type JobLogLevel = 'debug' | 'info' | 'warning' | 'error';

/** Evento de log normalizado para consumo de componentes/facades */
export interface JobLogEntryView {
  jobId: string;
  eventIndex: number;
  level: JobLogLevel;
  source: string;
  message: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

/** Parámetros de consulta para historial de logs por job */
export interface JobLogsQuery {
  afterEventIndex?: number;
  limit?: number;
}

/** Página de historial de logs normalizada */
export interface JobLogsPageView {
  jobId: string;
  count: number;
  nextAfterEventIndex: number;
  results: JobLogEntryView[];
}

/** Resultado normalizado de acciones de control de ejecución (pause/resume) */
export interface JobControlActionResult {
  detail: string;
  job: ScientificJob;
}

export interface JobsRealtimeQuery {
  jobId?: string;
  pluginName?: string;
  includeLogs?: boolean;
  includeSnapshot?: boolean;
  activeOnly?: boolean;
}

export interface JobsSnapshotRealtimeEvent {
  event: 'jobs.snapshot';
  data: {
    items: ScientificJob[];
  };
}

export interface JobUpdatedRealtimeEvent {
  event: 'job.updated';
  data: ScientificJob;
}

export interface JobProgressRealtimeEvent {
  event: 'job.progress';
  data: JobProgressSnapshot;
}

export interface JobLogRealtimeEvent {
  event: 'job.log';
  data: JobLogEntryView;
}

export type JobsRealtimeEvent =
  | JobsSnapshotRealtimeEvent
  | JobUpdatedRealtimeEvent
  | JobProgressRealtimeEvent
  | JobLogRealtimeEvent;

@Injectable({
  providedIn: 'root',
})
export class JobsApiService {
  private readonly calculatorClient = inject(CalculatorService);
  private readonly jobsClient = inject(JobsService);

  private normalizeScientificJob(rawJob: ScientificJob): ScientificJob {
    return rawJob as ScientificJob;
  }

  private normalizeControlActionResult(
    rawResponse: JobControlActionResponse,
  ): JobControlActionResult {
    return {
      detail: rawResponse.detail,
      job: rawResponse.job as ScientificJob,
    };
  }

  private normalizeLogEntry(rawEvent: {
    job_id: string;
    event_index: number;
    level: string;
    source: string;
    message: string;
    payload: unknown;
    created_at: string;
  }): JobLogEntryView {
    const normalizedPayload: Record<string, unknown> =
      rawEvent.payload !== null &&
      typeof rawEvent.payload === 'object' &&
      !Array.isArray(rawEvent.payload)
        ? (rawEvent.payload as Record<string, unknown>)
        : {};

    const normalizedLevel: JobLogLevel =
      rawEvent.level === 'debug' || rawEvent.level === 'warning' || rawEvent.level === 'error'
        ? rawEvent.level
        : 'info';

    return {
      jobId: rawEvent.job_id,
      eventIndex: rawEvent.event_index,
      level: normalizedLevel,
      source: rawEvent.source,
      message: rawEvent.message,
      payload: normalizedPayload,
      createdAt: rawEvent.created_at,
    };
  }

  private buildJobsRealtimeUrl(query: JobsRealtimeQuery = {}): string {
    const url: URL = new URL(JOBS_WEBSOCKET_URL);

    if (query.jobId !== undefined) {
      url.searchParams.set('job_id', query.jobId);
    }

    if (query.pluginName !== undefined) {
      url.searchParams.set('plugin_name', query.pluginName);
    }

    if (query.includeLogs !== undefined) {
      url.searchParams.set('include_logs', String(query.includeLogs));
    }

    if (query.includeSnapshot !== undefined) {
      url.searchParams.set('include_snapshot', String(query.includeSnapshot));
    }

    if (query.activeOnly !== undefined) {
      url.searchParams.set('active_only', String(query.activeOnly));
    }

    return url.toString();
  }

  private normalizeRealtimeEvent(rawEvent: unknown): JobsRealtimeEvent | null {
    if (rawEvent === null || typeof rawEvent !== 'object' || Array.isArray(rawEvent)) {
      return null;
    }

    const candidateEvent: Record<string, unknown> = rawEvent as Record<string, unknown>;
    const rawEventName: unknown = candidateEvent['event'];
    const rawData: unknown = candidateEvent['data'];

    if (typeof rawEventName !== 'string' || rawData === null || rawData === undefined) {
      return null;
    }

    if (rawEventName === 'jobs.snapshot') {
      const snapshotContainer: Record<string, unknown> | null =
        typeof rawData === 'object' && !Array.isArray(rawData)
          ? (rawData as Record<string, unknown>)
          : null;
      const rawItems: unknown[] = Array.isArray(snapshotContainer?.['items'])
        ? (snapshotContainer?.['items'] as unknown[])
        : [];

      return {
        event: 'jobs.snapshot',
        data: {
          items: rawItems.map((rawItem: unknown) =>
            this.normalizeScientificJob(rawItem as ScientificJob),
          ),
        },
      };
    }

    if (rawEventName === 'job.updated') {
      return {
        event: 'job.updated',
        data: this.normalizeScientificJob(rawData as ScientificJob),
      };
    }

    if (rawEventName === 'job.progress') {
      return {
        event: 'job.progress',
        data: rawData as JobProgressSnapshot,
      };
    }

    if (rawEventName === 'job.log') {
      return {
        event: 'job.log',
        data: this.normalizeLogEntry(
          rawData as {
            job_id: string;
            event_index: number;
            level: string;
            source: string;
            message: string;
            payload: unknown;
            created_at: string;
          },
        ),
      };
    }

    return null;
  }

  /**
   * Lista jobs globales del sistema con filtros opcionales por plugin y estado.
   * Se usa en el monitor para visualizar activos, completados y fallidos.
   */
  listJobs(filters: JobListFilters = {}): Observable<ScientificJob[]> {
    return this.jobsClient.jobsList(filters.pluginName, filters.status).pipe(shareReplay(1));
  }

  /**
   * Despacha un job científico genérico vía el endpoint core /api/jobs/.
   * Se usa para nuevas apps sin acoplar componentes al código generado.
   */
  dispatchScientificJob(params: ScientificJobDispatchParams): Observable<ScientificJob> {
    const payload: JobCreateRequest = {
      plugin_name: params.pluginName,
      version: params.version ?? '1.0.0',
      parameters: params.parameters,
    };
    return this.jobsClient.jobsCreate(payload).pipe(shareReplay(1));
  }

  /** Consulta un job científico genérico por id mediante /api/jobs/{id}/ */
  getScientificJobStatus(jobId: string): Observable<ScientificJob> {
    return this.jobsClient.jobsRetrieve(jobId);
  }

  /** Consulta historial de logs por job con cursor incremental */
  getJobLogs(jobId: string, query: JobLogsQuery = {}): Observable<JobLogsPageView> {
    return this.jobsClient.jobsLogsRetrieve(jobId, query.afterEventIndex, query.limit).pipe(
      map(
        (rawPage: JobLogList): JobLogsPageView => ({
          jobId: rawPage.job_id,
          count: rawPage.count,
          nextAfterEventIndex: rawPage.next_after_event_index,
          results: rawPage.results.map((rawEvent) => this.normalizeLogEntry(rawEvent)),
        }),
      ),
      shareReplay(1),
    );
  }

  /** Solicita pausa cooperativa de un job cuando su plugin lo permite */
  pauseJob(jobId: string): Observable<JobControlActionResult> {
    return this.jobsClient.jobsPauseCreate(jobId).pipe(
      map((rawResponse: JobControlActionResponse) =>
        this.normalizeControlActionResult(rawResponse),
      ),
      shareReplay(1),
    );
  }

  /** Reanuda un job pausado y dispara su reencolado */
  resumeJob(jobId: string): Observable<JobControlActionResult> {
    return this.jobsClient.jobsResumeCreate(jobId).pipe(
      map((rawResponse: JobControlActionResponse) =>
        this.normalizeControlActionResult(rawResponse),
      ),
      shareReplay(1),
    );
  }

  /**
   * Despacha un job de calculadora al backend.
   * Si existe caché (job_hash conocido), el backend retorna resultado inmediato con status 'completed'.
   * En caso contrario el job queda 'pending' hasta que el worker Celery lo procese.
   *
   * Para monitorear el progreso usar `streamJobEvents()` o `pollJobUntilCompleted()`.
   */
  dispatchCalculatorJob(
    params: CalculatorParams,
    version: string = '1.0.0',
  ): Observable<CalculatorJobResponse> {
    const payload: CalculatorJobCreateRequest = {
      version,
      op: params.op,
      a: params.a,
      // Omitir b completamente cuando no aplica (factorial)
      ...(params.b !== undefined ? { b: params.b } : {}),
    };
    return this.calculatorClient.calculatorJobsCreate(payload).pipe(shareReplay(1));
  }

  /**
   * Consulta el estado completo y resultados de un job de calculadora.
   * Usar tras confirmar status 'completed' para obtener el CalculatorResult con tipos estrictos.
   */
  getJobStatus(jobId: string): Observable<CalculatorJobResponse> {
    return this.calculatorClient.calculatorJobsRetrieve(jobId);
  }

  /**
   * Obtiene un snapshot puntual del progreso del job: porcentaje, etapa y mensaje legible.
   * Util para polling manual o para sincronizar estado tras reconexion de stream SSE.
   *
   * Ejemplo: `getJobProgress('uuid').subscribe(s => console.log(s.progress_percentage))`.
   */
  getJobProgress(jobId: string): Observable<JobProgressSnapshot> {
    return this.jobsClient.jobsProgressRetrieve(jobId);
  }

  /**
   * Abre un stream SSE (Server-Sent Events) para recibir actualizaciones de progreso
   * en tiempo real. Emite `JobProgressSnapshot` en cada evento `job.progress` del backend.
   * El Observable completa automáticamente al recibir status 'completed' o 'failed'.
   * Si la conexión falla, emite error para que el consumidor active el fallback de polling.
   *
   * Usa la API nativa `EventSource` del navegador (compatible con todos los navegadores modernos).
   * El cliente generado por OpenAPI no es apto para SSE porque cierra la conexión al recibir
   * el primer chunk; por eso este método usa EventSource directamente.
   *
   * Ejemplo de uso en componente:
   * ```typescript
   * this.jobsApi.streamJobEvents(jobId).subscribe({
   *   next: snap  => this.progress.set(snap),
   *   complete: () => this.fetchFinalResult(jobId),
   *   error:    () => this.startPollingFallback(jobId),
   * });
   * ```
   */
  streamJobEvents(jobId: string): Observable<JobProgressSnapshot> {
    return new Observable<JobProgressSnapshot>((observer) => {
      const url = `${API_BASE_URL}/api/jobs/${jobId}/events/`;
      const source = new EventSource(url);

      source.addEventListener('job.progress', (rawEvent: Event) => {
        const messageEvent = rawEvent as MessageEvent<string>;
        try {
          const snapshot = JSON.parse(messageEvent.data) as JobProgressSnapshot;
          observer.next(snapshot);
          // El stream termina cuando el job llega a estado terminal
          if (
            snapshot.status === 'completed' ||
            snapshot.status === 'failed' ||
            snapshot.status === 'paused'
          ) {
            source.close();
            observer.complete();
          }
        } catch {
          // Ignorar eventos malformados; el stream continúa con el siguiente evento
        }
      });

      source.onerror = () => {
        source.close();
        observer.error(new Error('SSE connection error'));
      };

      // Teardown: el EventSource se cierra al cancelar la suscripcion (ngOnDestroy, etc.)
      return () => source.close();
    });
  }

  /** Abre stream SSE de logs en tiempo real para un job específico */
  streamJobLogEvents(jobId: string): Observable<JobLogEntryView> {
    return new Observable<JobLogEntryView>((observer) => {
      const url = `${API_BASE_URL}/api/jobs/${jobId}/logs/events/`;
      const source = new EventSource(url);

      source.addEventListener('job.log', (rawEvent: Event) => {
        const messageEvent = rawEvent as MessageEvent<string>;
        try {
          const parsedEvent = JSON.parse(messageEvent.data) as {
            job_id: string;
            event_index: number;
            level: string;
            source: string;
            message: string;
            payload: unknown;
            created_at: string;
          };
          observer.next(this.normalizeLogEntry(parsedEvent));
        } catch {
          // Ignorar eventos malformados y continuar escuchando.
        }
      });

      source.onerror = () => {
        source.close();
        observer.error(new Error('SSE logs connection error'));
      };

      return () => source.close();
    });
  }

  /** Abre stream WebSocket global o filtrado para jobs, progreso y logs. */
  streamJobsRealtime(query: JobsRealtimeQuery = {}): Observable<JobsRealtimeEvent> {
    return new Observable<JobsRealtimeEvent>((observer) => {
      const socket = new WebSocket(this.buildJobsRealtimeUrl(query));

      socket.onmessage = (messageEvent: MessageEvent<string>) => {
        try {
          const parsedPayload: unknown = JSON.parse(messageEvent.data);
          const normalizedEvent: JobsRealtimeEvent | null =
            this.normalizeRealtimeEvent(parsedPayload);
          if (normalizedEvent !== null) {
            observer.next(normalizedEvent);
          }
        } catch {
          // Ignorar frames malformados y continuar escuchando.
        }
      };

      socket.onerror = () => {
        observer.error(new Error('WebSocket jobs stream connection error'));
      };

      socket.onclose = () => {
        observer.complete();
      };

      return () => {
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close();
        }
      };
    });
  }

  /**
   * Polling de progreso mediante snapshots periódicos hasta estado terminal.
   * Retorna el `JobProgressSnapshot` final (completed o failed).
   * Alternativa robusta cuando SSE no está disponible o hay problemas de red.
   *
   * Ejemplo: `pollJobUntilCompleted('uuid', 1000).subscribe(snap => ...)`.
   */
  pollJobUntilCompleted(jobId: string, intervalMs: number = 1000): Observable<JobProgressSnapshot> {
    return interval(intervalMs).pipe(
      switchMap(() => this.getJobProgress(jobId)),
      filter((snap) => snap.status === 'completed' || snap.status === 'failed'),
      take(1),
    );
  }
}
