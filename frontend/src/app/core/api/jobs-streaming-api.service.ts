// jobs-streaming-api.service.ts: Sub-servicio para streaming en tiempo real de jobs.
// Concentra SSE, WebSocket, polling y consulta de logs para todas las apps científicas.

import { Injectable, inject } from '@angular/core';
import {
    Observable,
    filter,
    interval,
    map,
    shareReplay,
    switchMap,
    take,
} from 'rxjs';
import { API_BASE_URL, JOBS_WEBSOCKET_URL } from '../shared/constants';
import {
    JobLogList,
    JobProgressSnapshot,
    JobsService,
    ScientificJob,
} from './generated';
import type {
    JobLogEntryView,
    JobLogLevel,
    JobLogsPageView,
    JobLogsQuery,
    JobsRealtimeEvent,
    JobsRealtimeQuery,
} from './types';

@Injectable({
  providedIn: 'root',
})
export class JobsStreamingApiService {
  private readonly jobsClient = inject(JobsService);

  /**
   * Obtiene un snapshot puntual del progreso del job: porcentaje, etapa y mensaje legible.
   * Util para polling manual o para sincronizar estado tras reconexion de stream SSE.
   */
  getJobProgress(jobId: string): Observable<JobProgressSnapshot> {
    return this.jobsClient.jobsProgressRetrieve(jobId);
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

  /**
   * Abre un stream SSE para recibir actualizaciones de progreso en tiempo real.
   * Emite JobProgressSnapshot en cada evento 'job.progress' del backend.
   * El Observable completa al recibir status terminal (completed/failed/paused).
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
   * Alternativa robusta cuando SSE no está disponible o hay problemas de red.
   */
  pollJobUntilCompleted(jobId: string, intervalMs: number = 1000): Observable<JobProgressSnapshot> {
    return interval(intervalMs).pipe(
      switchMap(() => this.getJobProgress(jobId)),
      filter((snap) => snap.status === 'completed' || snap.status === 'failed'),
      take(1),
    );
  }

  // ---------------------------------------------------------------------------
  // Helpers privados
  // ---------------------------------------------------------------------------

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

  private normalizeScientificJob(rawJob: ScientificJob): ScientificJob {
    return rawJob as ScientificJob;
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
}
