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
    close: () => void;
    onmessage: ((event: MessageEvent<string>) => void) | null;
    onerror: (() => void) | null;
    onclose: (() => void) | null;
  };

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    capturedWebSocketUrls = [];
    type SocketState = {
      readyState: number;
      close: () => void;
      onmessage: ((event: MessageEvent<string>) => void) | null;
      onerror: (() => void) | null;
      onclose: (() => void) | null;
    };
    let latestSocketInstance: {
      readyState: number;
      close: () => void;
      onmessage: ((event: MessageEvent<string>) => void) | null;
      onerror: (() => void) | null;
      onclose: (() => void) | null;
    } | null = null;
    mockSocketInstance = {
      readyState: 1,
      close: vi.fn(),
      onmessage: null,
      onerror: null,
      onclose: null,
    };
    class MockWebSocket {
      readyState: number = 1;
      close: () => void = vi.fn();
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;

      constructor(url: string) {
        capturedWebSocketUrls.push(url);
        const currentSocketState: SocketState = {
          readyState: 1,
          close: this.close,
          onmessage: this.onmessage,
          onerror: this.onerror,
          onclose: this.onclose,
        };

        Object.defineProperty(this, 'readyState', {
          get: () => currentSocketState.readyState,
          set: (nextValue: number) => {
            currentSocketState.readyState = nextValue;
          },
          configurable: true,
        });
        Object.defineProperty(this, 'onmessage', {
          get: () => currentSocketState.onmessage,
          set: (nextHandler: ((event: MessageEvent<string>) => void) | null) => {
            currentSocketState.onmessage = nextHandler;
          },
          configurable: true,
        });
        Object.defineProperty(this, 'onerror', {
          get: () => currentSocketState.onerror,
          set: (nextHandler: (() => void) | null) => {
            currentSocketState.onerror = nextHandler;
          },
          configurable: true,
        });
        Object.defineProperty(this, 'onclose', {
          get: () => currentSocketState.onclose,
          set: (nextHandler: (() => void) | null) => {
            currentSocketState.onclose = nextHandler;
          },
          configurable: true,
        });

        latestSocketInstance = currentSocketState;
      }
    }

    mockSocketInstance = {
      get readyState(): number {
        return latestSocketInstance?.readyState ?? 1;
      },
      close: vi.fn(() => {
        if (latestSocketInstance !== null) {
          latestSocketInstance.close();
        }
      }),
      get onmessage(): ((event: MessageEvent<string>) => void) | null {
        return latestSocketInstance?.onmessage ?? null;
      },
      set onmessage(nextHandler: ((event: MessageEvent<string>) => void) | null) {
        if (latestSocketInstance !== null) {
          latestSocketInstance.onmessage = nextHandler;
        }
      },
      get onerror(): (() => void) | null {
        return latestSocketInstance?.onerror ?? null;
      },
      set onerror(nextHandler: (() => void) | null) {
        if (latestSocketInstance !== null) {
          latestSocketInstance.onerror = nextHandler;
        }
      },
      get onclose(): (() => void) | null {
        return latestSocketInstance?.onclose ?? null;
      },
      set onclose(nextHandler: (() => void) | null) {
        if (latestSocketInstance !== null) {
          latestSocketInstance.onclose = nextHandler;
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

  it('should map pause/resume/cancel control actions to normalized wrapper result', () => {
    // Verifica el caso de uso de control cooperativo de jobs con respuesta normalizada.
    const controlledJob = makeScientificJob({ id: 'ctrl-job-1', status: StatusEnum.Paused });

    service.pauseJob('ctrl-job-1').subscribe((result) => {
      expect(result.detail).toContain('pause');
      expect(result.job.id).toBe('ctrl-job-1');
    });

    const pauseReq = httpMock.expectOne(`${JOBS_LIST_URL}ctrl-job-1/pause/`);
    expect(pauseReq.request.method).toBe('POST');
    pauseReq.flush({ detail: 'pause requested', job: controlledJob });

    service.resumeJob('ctrl-job-1').subscribe((result) => {
      expect(result.detail).toContain('resume');
      expect(result.job.id).toBe('ctrl-job-1');
    });

    const resumeReq = httpMock.expectOne(`${JOBS_LIST_URL}ctrl-job-1/resume/`);
    expect(resumeReq.request.method).toBe('POST');
    resumeReq.flush({ detail: 'resume requested', job: controlledJob });

    service.cancelJob('ctrl-job-1').subscribe((result) => {
      expect(result.detail).toContain('cancel');
      expect(result.job.id).toBe('ctrl-job-1');
    });

    const cancelReq = httpMock.expectOne(`${JOBS_LIST_URL}ctrl-job-1/cancel/`);
    expect(cancelReq.request.method).toBe('POST');
    cancelReq.flush({ detail: 'cancel requested', job: controlledJob });
  });

  it('should validate molar fractions params and throw for invalid pKa or missing range data', () => {
    // Verifica reglas de dominio mínimas antes de construir payload desacoplado.
    expect(() =>
      service.dispatchMolarFractionsJob({
        pkaValues: [],
        phMode: 'single',
        phValue: 7,
      }),
    ).toThrow('molar-fractions requiere entre 1 y 6 valores pKa.');

    expect(() =>
      service.dispatchMolarFractionsJob({
        pkaValues: [4.5, 8.1],
        phMode: 'range',
      }),
    ).toThrow('phMin, phMax y phStep son obligatorios cuando phMode=range.');

    expect(() =>
      service.dispatchMolarFractionsJob({
        pkaValues: [4.5],
        phMode: 'single',
      }),
    ).toThrow('phValue es obligatorio cuando phMode=single.');
  });

  it('should validate tunnel params and throw for non-positive physical values', () => {
    // Verifica que el wrapper corta temprano entradas físicamente inválidas.
    expect(() =>
      service.dispatchTunnelJob({
        reactionBarrierZpe: 0,
        imaginaryFrequency: 1000,
        reactionEnergyZpe: -2,
        temperature: 300,
        inputChangeEvents: [],
      }),
    ).toThrow('reactionBarrierZpe must be greater than zero.');

    expect(() =>
      service.dispatchTunnelJob({
        reactionBarrierZpe: 2,
        imaginaryFrequency: 0,
        reactionEnergyZpe: -2,
        temperature: 300,
        inputChangeEvents: [],
      }),
    ).toThrow('imaginaryFrequency must be greater than zero.');

    expect(() =>
      service.dispatchTunnelJob({
        reactionBarrierZpe: 2,
        imaginaryFrequency: 1000,
        reactionEnergyZpe: -2,
        temperature: 0,
        inputChangeEvents: [],
      }),
    ).toThrow('temperature must be greater than zero.');
  });

  it('should dispatch SA score and toxicity jobs with default version fallback', () => {
    // Verifica payload de contratos OpenAPI para dos plugins críticos del frontend.
    service
      .dispatchSaScoreJob({
        smiles: ['CCO', 'N#N'],
        methods: ['rdkit'],
      })
      .subscribe();

    const saReq = httpMock.expectOne((request) => request.url.includes('/api/sa-score/jobs/'));
    expect(saReq.request.method).toBe('POST');
    expect(saReq.request.body['version']).toBe('1.0.0');
    expect(saReq.request.body['smiles']).toEqual(['CCO', 'N#N']);
    saReq.flush({ id: 'sa-job-1' });

    service
      .dispatchToxicityPropertiesJob({
        smiles: ['CCO'],
      })
      .subscribe();

    const toxReq = httpMock.expectOne((request) =>
      request.url.includes('/api/toxicity-properties/jobs/'),
    );
    expect(toxReq.request.method).toBe('POST');
    expect(toxReq.request.body['version']).toBe('1.0.0');
    expect(toxReq.request.body['smiles']).toEqual(['CCO']);
    toxReq.flush({ id: 'tox-job-1' });
  });

  it('should request tunnel and toxicity report files through generated endpoints', () => {
    // Verifica integración de descargas binarias y nombres de archivo por convención del dominio.
    service.downloadTunnelCsvReport('tun-1').subscribe((file) => {
      expect(file.filename).toBe('tunnel_backend.csv');
    });

    const tunnelCsvReq = httpMock.expectOne((request) =>
      request.url.includes('/api/tunnel/jobs/tun-1/report-csv/'),
    );
    expect(tunnelCsvReq.request.method).toBe('GET');
    tunnelCsvReq.flush(new Blob(['a,b'], { type: 'text/csv' }), {
      headers: {
        'content-disposition': 'attachment; filename="tunnel_backend.csv"',
      },
    });

    service.downloadTunnelErrorReport('tun-1').subscribe((file) => {
      expect(file.filename).toBe('tunnel_error.txt');
    });

    const tunnelErrReq = httpMock.expectOne((request) =>
      request.url.includes('/api/tunnel/jobs/tun-1/report-error/'),
    );
    expect(tunnelErrReq.request.method).toBe('GET');
    tunnelErrReq.flush(new Blob(['error'], { type: 'text/plain' }), {
      headers: {
        'content-disposition': 'attachment; filename="tunnel_error.txt"',
      },
    });

    service.downloadToxicityPropertiesCsvReport('tox-1').subscribe((file) => {
      expect(file.filename).toBe('toxicity_backend.csv');
    });

    const toxCsvReq = httpMock.expectOne((request) =>
      request.url.includes('/api/toxicity-properties/jobs/tox-1/report-csv/'),
    );
    expect(toxCsvReq.request.method).toBe('GET');
    toxCsvReq.flush(new Blob(['smiles,ld50'], { type: 'text/csv' }), {
      headers: {
        'content-disposition': 'attachment; filename="toxicity_backend.csv"',
      },
    });
  });

  it('should dispatch and retrieve marcus jobs through generated endpoints', () => {
    const reactant1File = new File(['r1'], 'reactant-1.log', { type: 'text/plain' });
    const reactant2File = new File(['r2'], 'reactant-2.log', { type: 'text/plain' });
    const product1AdiabaticFile = new File(['p1a'], 'product-1-adiabatic.log', {
      type: 'text/plain',
    });
    const product2AdiabaticFile = new File(['p2a'], 'product-2-adiabatic.log', {
      type: 'text/plain',
    });
    const product1VerticalFile = new File(['p1v'], 'product-1-vertical.log', {
      type: 'text/plain',
    });
    const product2VerticalFile = new File(['p2v'], 'product-2-vertical.log', {
      type: 'text/plain',
    });

    service
      .dispatchMarcusJob({
        reactant1File,
        reactant2File,
        product1AdiabaticFile,
        product2AdiabaticFile,
        product1VerticalFile,
        product2VerticalFile,
        title: 'Marcus flow',
        diffusion: false,
      })
      .subscribe((job) => {
        expect(job.plugin_name).toBe('marcus');
      });

    const dispatchReq = httpMock.expectOne((request) => request.url.includes('/api/marcus/jobs/'));
    expect(dispatchReq.request.method).toBe('POST');
    expect(dispatchReq.request.body instanceof FormData).toBe(true);
    dispatchReq.flush({
      id: 'marcus-job-1',
      plugin_name: 'marcus',
      status: 'pending',
      parameters: {},
      results: null,
    });

    service.getMarcusJobStatus('marcus-job-1').subscribe((job) => {
      expect(job.id).toBe('marcus-job-1');
    });

    const statusReq = httpMock.expectOne((request) =>
      request.url.includes('/api/marcus/jobs/marcus-job-1/'),
    );
    expect(statusReq.request.method).toBe('GET');
    statusReq.flush({ id: 'marcus-job-1', plugin_name: 'marcus', status: 'completed' });
  });

  it('should download easy-rate and marcus report artifacts with domain filenames', () => {
    service.downloadEasyRateLogReport('easy-1').subscribe((file) => {
      expect(file.filename).toBe('easy_rate_backend.log');
    });
    const easyLogReq = httpMock.expectOne((request) =>
      request.url.includes('/api/easy-rate/jobs/easy-1/report-log/'),
    );
    expect(easyLogReq.request.method).toBe('GET');
    easyLogReq.flush(new Blob(['log'], { type: 'text/plain' }), {
      headers: {
        'content-disposition': 'attachment; filename="easy_rate_backend.log"',
      },
    });

    service.downloadEasyRateErrorReport('easy-1').subscribe((file) => {
      expect(file.filename).toBe('easy_rate_backend_error.txt');
    });
    const easyErrorReq = httpMock.expectOne((request) =>
      request.url.includes('/api/easy-rate/jobs/easy-1/report-error/'),
    );
    expect(easyErrorReq.request.method).toBe('GET');
    easyErrorReq.flush(new Blob(['error'], { type: 'text/plain' }), {
      headers: {
        'content-disposition': 'attachment; filename="easy_rate_backend_error.txt"',
      },
    });

    service.downloadEasyRateInputsZip('easy-1').subscribe((file) => {
      expect(file.filename).toBe('easy_rate_inputs.zip');
    });
    const easyInputsReq = httpMock.expectOne((request) =>
      request.url.includes('/api/easy-rate/jobs/easy-1/report-inputs/'),
    );
    expect(easyInputsReq.request.method).toBe('GET');
    easyInputsReq.flush(new Blob(['zip'], { type: 'application/zip' }), {
      headers: {
        'content-disposition': 'attachment; filename="easy_rate_inputs.zip"',
      },
    });

    service.downloadMarcusLogReport('marcus-1').subscribe((file) => {
      expect(file.filename).toBe('marcus_backend.log');
    });
    const marcusLogReq = httpMock.expectOne((request) =>
      request.url.includes('/api/marcus/jobs/marcus-1/report-log/'),
    );
    expect(marcusLogReq.request.method).toBe('GET');
    marcusLogReq.flush(new Blob(['log'], { type: 'text/plain' }), {
      headers: {
        'content-disposition': 'attachment; filename="marcus_backend.log"',
      },
    });

    service.downloadMarcusErrorReport('marcus-1').subscribe((file) => {
      expect(file.filename).toBe('marcus_backend_error.txt');
    });
    const marcusErrorReq = httpMock.expectOne((request) =>
      request.url.includes('/api/marcus/jobs/marcus-1/report-error/'),
    );
    expect(marcusErrorReq.request.method).toBe('GET');
    marcusErrorReq.flush(new Blob(['error'], { type: 'text/plain' }), {
      headers: {
        'content-disposition': 'attachment; filename="marcus_backend_error.txt"',
      },
    });

    service.downloadMarcusInputsZip('marcus-1').subscribe((file) => {
      expect(file.filename).toBe('marcus_inputs.zip');
    });
    const marcusInputsReq = httpMock.expectOne((request) =>
      request.url.includes('/api/marcus/jobs/marcus-1/report-inputs/'),
    );
    expect(marcusInputsReq.request.method).toBe('GET');
    marcusInputsReq.flush(new Blob(['zip'], { type: 'application/zip' }), {
      headers: {
        'content-disposition': 'attachment; filename="marcus_inputs.zip"',
      },
    });
  });
});
