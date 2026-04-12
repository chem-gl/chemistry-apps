// jobs-streaming-api.service.spec.ts: Pruebas unitarias del sub-servicio de streaming en tiempo real.
// Verifica normalización de logs, streams SSE/WebSocket y fallback de polling terminal.

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, Observable } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_BASE_URL, JOBS_WEBSOCKET_URL } from '../shared/constants';
import {
  JobLogList,
  JobProgressSnapshot,
  ProgressStageEnum,
  provideApi,
  ScientificJob,
  StatusEnum,
} from './generated';
import { JobsStreamingApiService } from './jobs-streaming-api.service';

interface MockSseEvent {
  data: string;
}

type EventListener = (event: Event) => void;

class MockEventSource {
  static readonly instances: MockEventSource[] = [];

  readonly url: string;
  readonly close = vi.fn();
  onerror: (() => void) | null = null;
  private readonly listeners = new Map<string, EventListener[]>();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(eventName: string, listener: EventListener): void {
    const currentListeners: EventListener[] = this.listeners.get(eventName) ?? [];
    this.listeners.set(eventName, [...currentListeners, listener]);
  }

  emitJson(eventName: string, payload: unknown): void {
    this.emitRaw(eventName, JSON.stringify(payload));
  }

  emitRaw(eventName: string, rawData: string): void {
    const listeners: EventListener[] = this.listeners.get(eventName) ?? [];
    const mockEvent: MockSseEvent = { data: rawData };
    listeners.forEach((listener: EventListener) => listener(mockEvent as unknown as Event));
  }

  emitError(): void {
    this.onerror?.();
  }
}

/** Crea un snapshot de progreso reutilizable para escenarios de stream/polling. */
function makeProgressSnapshot(overrides: Partial<JobProgressSnapshot> = {}): JobProgressSnapshot {
  return {
    job_id: 'job-1',
    status: StatusEnum.Running,
    progress_percentage: 25,
    progress_stage: ProgressStageEnum.Running,
    progress_message: 'Running',
    progress_event_index: 3,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

/** Crea respuesta de logs cruda para validar normalización de payload/level. */
function makeLogList(overrides: Partial<JobLogList> = {}): JobLogList {
  return {
    job_id: 'job-1',
    count: 1,
    next_after_event_index: 10,
    results: [
      {
        job_id: 'job-1',
        event_index: 9,
        level: 'info',
        source: 'plugin.test',
        message: 'Line',
        payload: ['invalid-payload-shape'],
        created_at: new Date().toISOString(),
      },
    ],
    ...overrides,
  };
}

/** Crea un job científico mínimo para eventos WebSocket tipados. */
function makeScientificJob(overrides: Partial<ScientificJob> = {}): ScientificJob {
  return {
    id: 'job-1',
    job_hash: 'hash-1',
    plugin_name: 'random-numbers',
    algorithm_version: '1.0.0',
    status: StatusEnum.Pending,
    cache_hit: false,
    cache_miss: true,
    progress_percentage: 0,
    progress_stage: ProgressStageEnum.Pending,
    progress_message: 'Pending',
    progress_event_index: 1,
    supports_pause_resume: false,
    pause_requested: false,
    runtime_state: {},
    paused_at: null,
    resumed_at: null,
    parameters: null,
    results: null,
    error_trace: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as ScientificJob;
}

describe('JobsStreamingApiService', () => {
  let service: JobsStreamingApiService;
  let httpMock: HttpTestingController;
  let originalEventSource: typeof EventSource | undefined;
  let originalWebSocket: typeof WebSocket | undefined;
  let mockSocketInstance: {
    readyState: number;
    close: ReturnType<typeof vi.fn>;
    onmessage: ((event: MessageEvent<string>) => void) | null;
    onerror: (() => void) | null;
    onclose: (() => void) | null;
  };
  let capturedWebSocketUrl: string | null;

  beforeEach(() => {
    originalEventSource = globalThis.EventSource;
    originalWebSocket = globalThis.WebSocket;
    MockEventSource.instances.length = 0;

    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;

    capturedWebSocketUrl = null;
    mockSocketInstance = {
      readyState: 1,
      close: vi.fn(),
      onmessage: null,
      onerror: null,
      onclose: null,
    };

    function MockWebSocket(this: unknown, url: string): object {
      capturedWebSocketUrl = url;
      return mockSocketInstance;
    }

    (MockWebSocket as unknown as { OPEN: number; CONNECTING: number }).OPEN = 1;
    (MockWebSocket as unknown as { OPEN: number; CONNECTING: number }).CONNECTING = 0;

    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideApi(API_BASE_URL),
        JobsStreamingApiService,
      ],
    });

    service = TestBed.inject(JobsStreamingApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    globalThis.EventSource = originalEventSource ?? globalThis.EventSource;
    globalThis.WebSocket = originalWebSocket ?? globalThis.WebSocket;
    vi.useRealTimers();
  });

  it('normaliza logs de getJobLogs aplicando fallback de payload', async () => {
    // Verifica que payload no-objeto se normaliza a {} manteniendo el nivel válido recibido.
    const logsPromise: Promise<unknown> = firstValueFrom(
      service.getJobLogs('job-1', { limit: 50 }),
    );

    const request = httpMock.expectOne(`${API_BASE_URL}/api/jobs/job-1/logs/?limit=50`);
    request.flush(makeLogList());

    const logsPage = (await logsPromise) as {
      jobId: string;
      results: Array<{ level: string; payload: Record<string, unknown> }>;
    };

    expect(logsPage.jobId).toBe('job-1');
    expect(logsPage.results[0].level).toBe('info');
    expect(logsPage.results[0].payload).toEqual({});
  });

  it('emite progreso SSE y completa al recibir estado terminal', () => {
    // Verifica cierre y complete cuando el backend reporta completed.
    const nextSpy = vi.fn();
    const completeSpy = vi.fn();

    service.streamJobEvents('job-1').subscribe({
      next: nextSpy,
      complete: completeSpy,
    });

    const source = MockEventSource.instances[0];
    expect(source.url).toBe(`${API_BASE_URL}/api/jobs/job-1/events/`);

    source.emitJson('job.progress', makeProgressSnapshot());
    source.emitJson('job.progress', makeProgressSnapshot({ status: StatusEnum.Completed }));

    expect(nextSpy).toHaveBeenCalledTimes(2);
    expect(completeSpy).toHaveBeenCalledTimes(1);
    expect(source.close).toHaveBeenCalled();
  });

  it('ignora eventos SSE malformados y sigue procesando el stream', () => {
    // Verifica robustez ante JSON corrupto sin romper el Observable.
    const nextSpy = vi.fn();

    service.streamJobEvents('job-1').subscribe({
      next: nextSpy,
    });

    const source = MockEventSource.instances[0];
    source.emitRaw('job.progress', '{invalid-json');
    source.emitJson('job.progress', makeProgressSnapshot());

    expect(nextSpy).toHaveBeenCalledTimes(1);
  });

  it('propaga error cuando falla la conexión SSE de progreso', () => {
    // Verifica error controlado en caída del stream de progreso.
    const errorSpy = vi.fn();

    service.streamJobEvents('job-1').subscribe({
      error: errorSpy,
    });

    const source = MockEventSource.instances[0];
    source.emitError();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect((errorSpy.mock.calls[0]?.[0] as Error).message).toContain('SSE connection error');
  });

  it('normaliza eventos SSE de logs y acepta payload vacío en formato seguro', () => {
    // Verifica mapeo de job.log con fallback a payload objeto vacío.
    const nextSpy = vi.fn();

    service.streamJobLogEvents('job-1').subscribe({
      next: nextSpy,
    });

    const source = MockEventSource.instances[0];
    source.emitJson('job.log', {
      job_id: 'job-1',
      event_index: 11,
      level: 'mystery-level',
      source: 'plugin.test',
      message: 'event',
      payload: null,
      created_at: new Date().toISOString(),
    });

    const firstEvent = nextSpy.mock.calls[0]?.[0] as {
      level: string;
      payload: Record<string, unknown>;
    };
    expect(firstEvent.level).toBe('info');
    expect(firstEvent.payload).toEqual({});
  });

  it('normaliza frames WebSocket para snapshot, progress, update y log', () => {
    // Verifica traducción de frames WS a eventos tipados consumibles por facades/workflows.
    const receivedEvents: unknown[] = [];
    const subscription = service
      .streamJobsRealtime({ pluginName: 'smileit', includeLogs: true, activeOnly: true })
      .subscribe((event) => receivedEvents.push(event));

    expect(capturedWebSocketUrl).not.toBeNull();
    if (capturedWebSocketUrl === null) {
      throw new Error('Expected websocket URL to be captured in test setup.');
    }
    expect(capturedWebSocketUrl).toContain(JOBS_WEBSOCKET_URL.split('?')[0]);
    expect(capturedWebSocketUrl).toContain('plugin_name=smileit');
    expect(capturedWebSocketUrl).toContain('include_logs=true');
    expect(capturedWebSocketUrl).toContain('active_only=true');

    const job = makeScientificJob();

    mockSocketInstance.onmessage?.({
      data: JSON.stringify({ event: 'jobs.snapshot', data: { items: [job] } }),
    } as MessageEvent<string>);

    mockSocketInstance.onmessage?.({
      data: JSON.stringify({ event: 'job.updated', data: job }),
    } as MessageEvent<string>);

    mockSocketInstance.onmessage?.({
      data: JSON.stringify({ event: 'job.progress', data: makeProgressSnapshot() }),
    } as MessageEvent<string>);

    mockSocketInstance.onmessage?.({
      data: JSON.stringify({
        event: 'job.log',
        data: {
          job_id: 'job-1',
          event_index: 12,
          level: 'warning',
          source: 'plugin',
          message: 'warn',
          payload: { reason: 'slow' },
          created_at: new Date().toISOString(),
        },
      }),
    } as MessageEvent<string>);

    expect(receivedEvents).toHaveLength(4);
    subscription.unsubscribe();
    expect(mockSocketInstance.close).toHaveBeenCalled();
  });

  it('hace polling hasta estado terminal y emite solo el snapshot final', async () => {
    // Verifica fallback de polling cuando SSE no está disponible.
    vi.useFakeTimers();

    const getProgressSpy = vi
      .spyOn(service, 'getJobProgress')
      .mockReturnValueOnce(new Observable((observer) => observer.next(makeProgressSnapshot())))
      .mockReturnValueOnce(
        new Observable((observer) =>
          observer.next(makeProgressSnapshot({ status: StatusEnum.Completed })),
        ),
      );

    const resultPromise = firstValueFrom(service.pollJobUntilCompleted('job-1', 10));

    vi.advanceTimersByTime(25);

    const finalSnapshot = await resultPromise;
    expect(finalSnapshot.status).toBe(StatusEnum.Completed);
    expect(getProgressSpy).toHaveBeenCalledTimes(2);
  });
});
