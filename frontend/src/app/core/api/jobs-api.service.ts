// jobs-api.service.ts: Wrapper que encapsula el cliente generado de OpenAPI.
// Este servicio actua como fachada estable: protege al resto del frontend de cambios en
// el cliente generado y centraliza la logica de despacho, polling y streaming de progreso.

import { Injectable, inject } from '@angular/core';
import { Observable, filter, interval, shareReplay, switchMap, take } from 'rxjs';
import { API_BASE_URL } from '../shared/constants';
import {
  CalculatorJobCreate,
  CalculatorJobResponse,
  CalculatorOperationEnum,
  CalculatorService,
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
export type JobListStatusFilter = 'pending' | 'running' | 'completed' | 'failed';

/** Filtros opcionales para consultar jobs en el monitor */
export interface JobListFilters {
  pluginName?: string;
  status?: JobListStatusFilter;
}

@Injectable({
  providedIn: 'root',
})
export class JobsApiService {
  private readonly calculatorClient = inject(CalculatorService);
  private readonly jobsClient = inject(JobsService);

  /**
   * Lista jobs globales del sistema con filtros opcionales por plugin y estado.
   * Se usa en el monitor para visualizar activos, completados y fallidos.
   */
  listJobs(filters: JobListFilters = {}): Observable<ScientificJob[]> {
    return this.jobsClient.jobsList(filters.pluginName, filters.status).pipe(shareReplay(1));
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
    const payload: CalculatorJobCreate = {
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
          if (snapshot.status === 'completed' || snapshot.status === 'failed') {
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
