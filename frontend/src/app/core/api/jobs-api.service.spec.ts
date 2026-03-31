// jobs-api.service.spec.ts: Tests unitarios del wrapper desacoplado JobsApiService.
// Verifica que el wrapper mapea correctamente parámetros, URLs y respuestas del cliente generado.

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { API_BASE_URL } from '../shared/constants';
import {
  CalculatorJobResponse,
  EasyRateJobResponse,
  JobLogList,
  JobProgressSnapshot,
  ProgressStageEnum,
  ScientificJob,
  StatusEnum,
  provideApi,
} from './generated';
import { JobsApiService } from './jobs-api.service';

const CALC_JOBS_URL: string = `${API_BASE_URL}/api/calculator/jobs/`;
const JOBS_PROGRESS_URL = (id: string): string => `${API_BASE_URL}/api/jobs/${id}/progress/`;
const JOBS_LIST_URL: string = `${API_BASE_URL}/api/jobs/`;
const JOBS_LOGS_URL = (id: string): string => `${API_BASE_URL}/api/jobs/${id}/logs/`;
const MOLAR_REPORT_CSV_URL = (id: string): string =>
  `${API_BASE_URL}/api/molar-fractions/jobs/${id}/report-csv/`;
const MOLAR_REPORT_LOG_URL = (id: string): string =>
  `${API_BASE_URL}/api/molar-fractions/jobs/${id}/report-log/`;
const EASY_RATE_JOBS_URL: string = `${API_BASE_URL}/api/easy-rate/jobs/`;

/** Respuesta base reutilizable en tests de calculadora */
function makeCalcResponse(overrides: Partial<CalculatorJobResponse> = {}): CalculatorJobResponse {
  return {
    id: 'test-uuid',
    job_hash: 'abc123',
    plugin_name: 'calculator',
    algorithm_version: '1.0.0',
    status: StatusEnum.Completed,
    cache_hit: false,
    cache_miss: true,
    error_trace: '',
    parameters: { op: 'add', a: 2, b: 3 },
    results: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

/** Snapshot de progreso base reutilizable */
function makeProgressSnapshot(overrides: Partial<JobProgressSnapshot> = {}): JobProgressSnapshot {
  return {
    job_id: 'test-uuid',
    status: StatusEnum.Running,
    progress_percentage: 50,
    progress_stage: ProgressStageEnum.Running,
    progress_message: 'Ejecutando cálculo...',
    progress_event_index: 1,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

/** Job global base para tests de monitor/listado */
function makeScientificJob(overrides: Partial<ScientificJob> = {}): ScientificJob {
  return {
    id: 'job-id-1',
    job_hash: 'hash-value',
    plugin_name: 'calculator',
    algorithm_version: '1.0.0',
    status: StatusEnum.Pending,
    cache_hit: false,
    cache_miss: true,
    progress_percentage: 0,
    progress_stage: 'pending',
    progress_message: 'Pendiente',
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
  };
}

function makeJobLogsResponse(overrides: Partial<JobLogList> = {}): JobLogList {
  return {
    job_id: 'job-id-1',
    count: 2,
    next_after_event_index: 8,
    results: [
      {
        job_id: 'job-id-1',
        event_index: 7,
        level: 'info',
        source: 'calculator.plugin',
        message: 'Iniciando operación de calculadora.',
        payload: { operation: 'add' },
        created_at: new Date().toISOString(),
      },
      {
        job_id: 'job-id-1',
        event_index: 8,
        level: 'info',
        source: 'calculator.plugin',
        message: 'Operación de calculadora completada.',
        payload: { result: 7 },
        created_at: new Date().toISOString(),
      },
    ],
    ...overrides,
  };
}

function makeEasyRateResponse(overrides: Partial<EasyRateJobResponse> = {}): EasyRateJobResponse {
  return {
    id: 'easy-rate-job-1',
    job_hash: 'easy-rate-hash',
    plugin_name: 'easy-rate',
    algorithm_version: '2.0.0',
    status: StatusEnum.Pending,
    cache_hit: false,
    cache_miss: true,
    progress_percentage: 0,
    progress_stage: ProgressStageEnum.Pending,
    progress_message: 'Pendiente',
    progress_event_index: 1,
    parameters: {
      title: 'Easy-rate Test',
      reaction_path_degeneracy: 1,
      cage_effects: false,
      diffusion: false,
      solvent: 'Water',
      custom_viscosity: null,
      radius_reactant_1: null,
      radius_reactant_2: null,
      reaction_distance: null,
      print_data_input: false,
      reactant_1_execution_index: null,
      reactant_2_execution_index: null,
      transition_state_execution_index: null,
      product_1_execution_index: null,
      product_2_execution_index: null,
      file_descriptors: [],
    },
    results: null,
    error_trace: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('JobsApiService', () => {
  let service: JobsApiService;
  let httpMock: HttpTestingController;
  let capturedWebSocketUrls: string[];
  let originalWebSocket: typeof WebSocket | undefined;
  let mockSocketInstance: {
    readyState: number;
    close: ReturnType<typeof vi.fn>;
    onmessage: ((event: MessageEvent<string>) => void) | null;
    onerror: (() => void) | null;
    onclose: (() => void) | null;
  };

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    capturedWebSocketUrls = [];
    mockSocketInstance = {
      readyState: 1,
      close: vi.fn(),
      onmessage: null,
      onerror: null,
      onclose: null,
    };
    class MockWebSocket {
      public static latestInstance: MockWebSocket | null = null;

      readyState: number = 1;
      close = vi.fn();
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;

      constructor(url: string) {
        capturedWebSocketUrls.push(url);
        MockWebSocket.latestInstance = this;
      }
    }

    mockSocketInstance = {
      get readyState(): number {
        return MockWebSocket.latestInstance?.readyState ?? 1;
      },
      close: vi.fn(() => {
        MockWebSocket.latestInstance?.close();
      }),
      get onmessage(): ((event: MessageEvent<string>) => void) | null {
        return MockWebSocket.latestInstance?.onmessage ?? null;
      },
      set onmessage(nextHandler: ((event: MessageEvent<string>) => void) | null) {
        if (MockWebSocket.latestInstance !== null) {
          MockWebSocket.latestInstance.onmessage = nextHandler;
        }
      },
      get onerror(): (() => void) | null {
        return MockWebSocket.latestInstance?.onerror ?? null;
      },
      set onerror(nextHandler: (() => void) | null) {
        if (MockWebSocket.latestInstance !== null) {
          MockWebSocket.latestInstance.onerror = nextHandler;
        }
      },
      get onclose(): (() => void) | null {
        return MockWebSocket.latestInstance?.onclose ?? null;
      },
      set onclose(nextHandler: (() => void) | null) {
        if (MockWebSocket.latestInstance !== null) {
          MockWebSocket.latestInstance.onclose = nextHandler;
        }
      },
    };

    Object.defineProperty(globalThis, 'WebSocket', {
      value: MockWebSocket,
      writable: true,
      configurable: true,
    });

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideApi(API_BASE_URL),
        JobsApiService,
      ],
    });
    service = TestBed.inject(JobsApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    Object.defineProperty(globalThis, 'WebSocket', {
      value: originalWebSocket,
      writable: true,
      configurable: true,
    });
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should dispatch job for binary operation (add)', () => {
    const mockResponse = makeCalcResponse({ parameters: { op: 'add', a: 2, b: 3 } });

    service.dispatchCalculatorJob({ op: 'add', a: 2, b: 3 }).subscribe((job) => {
      expect(job.id).toBe('test-uuid');
      expect(job.plugin_name).toBe('calculator');
    });

    const req = httpMock.expectOne(CALC_JOBS_URL);
    expect(req.request.method).toBe('POST');
    // Debe enviar b para operaciones binarias
    expect(req.request.body['b']).toBe(3);
    req.flush(mockResponse);
  });

  it('should dispatch job for pow operation with b', () => {
    const mockResponse = makeCalcResponse({ parameters: { op: 'pow', a: 2, b: 10 } });

    service.dispatchCalculatorJob({ op: 'pow', a: 2, b: 10 }).subscribe((job) => {
      expect(job.parameters?.op).toBe('pow');
    });

    const req = httpMock.expectOne(CALC_JOBS_URL);
    expect(req.request.body['op']).toBe('pow');
    expect(req.request.body['b']).toBe(10);
    req.flush(mockResponse);
  });

  it('should dispatch factorial job WITHOUT b field', () => {
    const mockResponse = makeCalcResponse({
      parameters: { op: 'factorial', a: 7 },
      results: {
        final_result: 5040,
        metadata: { operation_used: 'factorial', operand_a: 7, operand_b: null },
      },
    });

    service.dispatchCalculatorJob({ op: 'factorial', a: 7 }).subscribe((job) => {
      expect(job.results?.final_result).toBe(5040);
    });

    const req = httpMock.expectOne(CALC_JOBS_URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.body['op']).toBe('factorial');
    // El campo b NO debe existir en el payload (no solo ser null)
    expect('b' in req.request.body).toBe(false);
    req.flush(mockResponse);
  });

  it('should retrieve job status', () => {
    const mockJob = makeCalcResponse({
      id: 'status-test-id',
      status: StatusEnum.Completed,
      results: {
        final_result: 42,
        metadata: { operation_used: 'add', operand_a: 20, operand_b: 22 },
      },
    });

    service.getJobStatus('status-test-id').subscribe((job) => {
      expect(job.status).toBe('completed');
      expect(job.results?.final_result).toBe(42);
    });

    const req = httpMock.expectOne(`${CALC_JOBS_URL}status-test-id/`);
    expect(req.request.method).toBe('GET');
    req.flush(mockJob);
  });

  it('should get job progress snapshot', () => {
    const jobId = 'progress-test-id';
    const snapshot = makeProgressSnapshot({ job_id: jobId, progress_percentage: 75 });

    service.getJobProgress(jobId).subscribe((snap) => {
      expect(snap.job_id).toBe(jobId);
      expect(snap.progress_percentage).toBe(75);
      expect(snap.progress_stage).toBe('running');
    });

    const req = httpMock.expectOne(JOBS_PROGRESS_URL(jobId));
    expect(req.request.method).toBe('GET');
    req.flush(snapshot);
  });

  it('should complete pollJobUntilCompleted when status is completed', () => {
    vi.useFakeTimers();
    try {
      const jobId = 'poll-test-id';
      const completedSnapshot = makeProgressSnapshot({
        job_id: jobId,
        status: StatusEnum.Completed,
        progress_percentage: 100,
        progress_stage: ProgressStageEnum.Completed,
      });

      let resolvedSnap: JobProgressSnapshot | undefined;
      service.pollJobUntilCompleted(jobId, 50).subscribe({
        next: (snap) => {
          resolvedSnap = snap;
        },
      });

      // Avanzar el temporizador para que el interval emita el primer valor
      vi.advanceTimersByTime(50);
      const req = httpMock.expectOne(JOBS_PROGRESS_URL(jobId));
      req.flush(completedSnapshot);

      expect(resolvedSnap!.status).toBe('completed');
      expect(resolvedSnap!.progress_percentage).toBe(100);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should list jobs without filters', () => {
    const jobs = [makeScientificJob({ id: 'job-a' }), makeScientificJob({ id: 'job-b' })];

    service.listJobs().subscribe((jobItems) => {
      expect(jobItems.length).toBe(2);
      expect(jobItems[0].id).toBe('job-a');
    });

    const req = httpMock.expectOne(JOBS_LIST_URL);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.keys().length).toBe(0);
    req.flush(jobs);
  });

  it('should list jobs with status and plugin filters', () => {
    service.listJobs({ status: 'completed', pluginName: 'calculator' }).subscribe();

    const req = httpMock.expectOne(
      (request) =>
        request.url === JOBS_LIST_URL &&
        request.params.get('status') === 'completed' &&
        request.params.get('plugin_name') === 'calculator',
    );
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('should dispatch a generic scientific job', () => {
    const scientificJob = makeScientificJob({ id: 'random-job-1', plugin_name: 'random-numbers' });

    service
      .dispatchScientificJob({
        pluginName: 'random-numbers',
        version: '1.0.0',
        parameters: {
          seed_url: 'https://example.com/seed.txt',
          numbers_per_batch: 5,
          interval_seconds: 120,
          total_numbers: 55,
        },
      })
      .subscribe((job) => {
        expect(job.plugin_name).toBe('random-numbers');
      });

    const req = httpMock.expectOne(JOBS_LIST_URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.body['plugin_name']).toBe('random-numbers');
    req.flush(scientificJob);
  });

  it('should dispatch easy-rate job using multipart form-data with strict required files', () => {
    const transitionStateFile = new File(['ts'], 'transition-state.log', { type: 'text/plain' });
    const reactant1File = new File(['r1'], 'reactant-1.log', { type: 'text/plain' });
    const reactant2File = new File(['r2'], 'reactant-2.log', { type: 'text/plain' });
    const product1File = new File(['p1'], 'product-1.log', { type: 'text/plain' });

    service
      .dispatchEasyRateJob({
        transitionStateFile,
        reactant1File,
        reactant2File,
        product1File,
        solvent: 'Water',
        diffusion: false,
      })
      .subscribe((job) => {
        expect(job.plugin_name).toBe('easy-rate');
      });

    const req = httpMock.expectOne(EASY_RATE_JOBS_URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.body instanceof FormData).toBe(true);

    const payload = req.request.body as FormData;
    expect(payload.get('solvent')).not.toBeNull();
    expect((payload.get('reactant_1_file') as File).name).toBe('reactant-1.log');
    expect((payload.get('reactant_2_file') as File).name).toBe('reactant-2.log');
    expect((payload.get('transition_state_file') as File).name).toBe('transition-state.log');
    expect((payload.get('product_1_file') as File).name).toBe('product-1.log');

    req.flush(makeEasyRateResponse());
  });

  it('should get generic scientific job status', () => {
    const scientificJob = makeScientificJob({ id: 'random-job-2', plugin_name: 'random-numbers' });

    service.getScientificJobStatus('random-job-2').subscribe((job) => {
      expect(job.id).toBe('random-job-2');
      expect(job.plugin_name).toBe('random-numbers');
    });

    const req = httpMock.expectOne(`${JOBS_LIST_URL}random-job-2/`);
    expect(req.request.method).toBe('GET');
    req.flush(scientificJob);
  });

  it('should list job logs and map payload to wrapper contract', () => {
    const logsResponse = makeJobLogsResponse();

    service.getJobLogs('job-id-1', { afterEventIndex: 6, limit: 10 }).subscribe((logsPage) => {
      expect(logsPage.jobId).toBe('job-id-1');
      expect(logsPage.count).toBe(2);
      expect(logsPage.results[0].eventIndex).toBe(7);
      expect(logsPage.results[0].source).toBe('calculator.plugin');
      expect(logsPage.results[0].payload['operation']).toBe('add');
    });

    const req = httpMock.expectOne(
      (request) =>
        request.url === JOBS_LOGS_URL('job-id-1') &&
        request.params.get('after_event_index') === '6' &&
        request.params.get('limit') === '10',
    );
    expect(req.request.method).toBe('GET');
    req.flush(logsResponse);
  });

  it('should open jobs realtime websocket and map snapshot and updates', () => {
    const receivedEvents: Array<string> = [];

    service.streamJobsRealtime({ pluginName: 'calculator', includeLogs: false }).subscribe({
      next: (event) => {
        receivedEvents.push(event.event);
      },
    });

    expect(capturedWebSocketUrls.length).toBe(1);
    expect(capturedWebSocketUrls[0]).toContain('plugin_name=calculator');
    expect(capturedWebSocketUrls[0]).toContain('include_logs=false');

    mockSocketInstance.onmessage?.(
      new MessageEvent('message', {
        data: JSON.stringify({
          event: 'jobs.snapshot',
          data: {
            items: [makeScientificJob({ id: 'socket-job-1' })],
          },
        }),
      }),
    );

    mockSocketInstance.onmessage?.(
      new MessageEvent('message', {
        data: JSON.stringify({
          event: 'job.updated',
          data: makeScientificJob({ id: 'socket-job-2', status: 'running' }),
        }),
      }),
    );

    expect(receivedEvents).toEqual(['jobs.snapshot', 'job.updated']);
  });

  it('should download molar fractions CSV report from backend endpoint', () => {
    const reportJobId: string = 'molar-report-csv-id';

    service.downloadMolarFractionsCsvReport(reportJobId).subscribe((reportFile) => {
      expect(reportFile.filename).toBe('molar_fractions_backend_report.csv');
      expect(reportFile.blob.size).toBeGreaterThan(0);
    });

    const req = httpMock.expectOne(MOLAR_REPORT_CSV_URL(reportJobId));
    expect(req.request.method).toBe('GET');
    expect(req.request.responseType).toBe('blob');

    req.flush(new Blob(['ph,f0,sum_fraction\n7.0,0.1,1.0'], { type: 'text/csv' }), {
      headers: {
        'content-disposition': 'attachment; filename="molar_fractions_backend_report.csv"',
      },
    });
  });

  it('should download molar fractions LOG report from backend endpoint', () => {
    const reportJobId: string = 'molar-report-log-id';

    service.downloadMolarFractionsLogReport(reportJobId).subscribe((reportFile) => {
      expect(reportFile.filename).toBe('molar_fractions_backend_report.log');
      expect(reportFile.blob.size).toBeGreaterThan(0);
    });

    const req = httpMock.expectOne(MOLAR_REPORT_LOG_URL(reportJobId));
    expect(req.request.method).toBe('GET');
    expect(req.request.responseType).toBe('blob');

    req.flush(new Blob(['=== JOB REPORT ==='], { type: 'text/plain' }), {
      headers: {
        'content-disposition': 'attachment; filename="molar_fractions_backend_report.log"',
      },
    });
  });
});
