// jobs-streaming-api.service.ts: Sub-servicio para streaming en tiempo real de jobs.
// Concentra SSE, polling y consulta de logs para todas las apps científicas.

import { Injectable, inject } from '@angular/core';
import { Observable, filter, interval, map, shareReplay, switchMap, take } from 'rxjs';
import { IdentitySessionService } from '../auth/identity-session.service';
import { API_BASE_URL } from '../shared/constants';
import { JobLogList, JobProgressSnapshot, JobsService } from './generated';
import type {
  JobLogEntryView,
  JobLogLevel,
  JobLogsPageView,
  JobLogsQuery,
} from './types';

@Injectable({
  providedIn: 'root',
})
export class JobsStreamingApiService {
  private readonly jobsClient = inject(JobsService);
  private readonly identitySession = inject(IdentitySessionService);

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
      const url = `${API_BASE_URL}/api/jobs/${jobId}/events/${this.buildStreamingTokenQuery()}`;
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
      const url = `${API_BASE_URL}/api/jobs/${jobId}/logs/events/${this.buildStreamingTokenQuery()}`;
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

  /**
   * Resuelve el access token para streaming.
   *
   * `EventSource` no permite adjuntar cabeceras HTTP, así que el backend acepta
   * `?token=<jwt>` como fallback en estas rutas. El token de acceso vive 30
   * minutos, lo que acota la ventana de exposición.
   */
  private resolveStreamingAccessToken(): string | null {
    const accessToken: string | null = this.identitySession.accessToken();
    if (accessToken === null || accessToken.trim() === '') {
      return null;
    }

    return accessToken;
  }

  /** Query string (`?token=...`) para los endpoints SSE del backend. */
  private buildStreamingTokenQuery(): string {
    const accessToken = this.resolveStreamingAccessToken();
    return accessToken === null ? '' : `?token=${encodeURIComponent(accessToken)}`;
  }
}
