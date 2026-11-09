// jobs-streaming-api.service.spec.ts: Pruebas unitarias del sub-servicio de streaming en tiempo real.
// Verifica normalización de logs, streams SSE y fallback de polling terminal.

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, Observable } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_BASE_URL } from '../shared/constants';
import { IdentitySessionService } from '../auth/identity-session.service';
import {
  JobLogList,
  JobProgressSnapshot,
  ProgressStageEnum,
  provideApi,
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

describe('JobsStreamingApiService', () => {
  let service: JobsStreamingApiService;
  const sessionTokenStub = { accessToken: vi.fn<() => string | null>(() => null) };
  let httpMock: HttpTestingController;
  let originalEventSource: typeof EventSource | undefined;

  beforeEach(() => {
    originalEventSource = globalThis.EventSource;
    MockEventSource.instances.length = 0;

    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideApi(API_BASE_URL),
        JobsStreamingApiService,
        {
          provide: IdentitySessionService,
          useValue: sessionTokenStub,
        },
      ],
    });

    sessionTokenStub.accessToken.mockReturnValue(null);
    service = TestBed.inject(JobsStreamingApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    globalThis.EventSource = originalEventSource ?? globalThis.EventSource;
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

  it('adjunta el access token a SSE para autenticar el streaming', () => {
    // EventSource no permite cabeceras: el token viaja como ?token=.
    sessionTokenStub.accessToken.mockReturnValue('jwt-test-token');

    service.streamJobEvents('job-9').subscribe();
    const progressSource = MockEventSource.instances[0];
    expect(progressSource.url).toBe(
      `${API_BASE_URL}/api/jobs/job-9/events/?token=jwt-test-token`,
    );

    service.streamJobLogEvents('job-9').subscribe();
    const logsSource = MockEventSource.instances[1];
    expect(logsSource.url).toBe(
      `${API_BASE_URL}/api/jobs/job-9/logs/events/?token=jwt-test-token`,
    );
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
