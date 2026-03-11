// jobs-api.service.spec.ts: Tests unitarios del wrapper desacoplado JobsApiService.
// Verifica que el wrapper mapea correctamente parámetros, URLs y respuestas del cliente generado.

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { API_BASE_URL } from '../shared/constants';
import {
  CalculatorJobResponse,
  JobProgressSnapshot,
  JobProgressStageEnum,
  JobStatusEnum,
  ScientificJob,
  provideApi,
} from './generated';
import { JobsApiService } from './jobs-api.service';

const CALC_JOBS_URL: string = `${API_BASE_URL}/api/calculator/jobs/`;
const JOBS_PROGRESS_URL = (id: string): string => `${API_BASE_URL}/api/jobs/${id}/progress/`;
const JOBS_LIST_URL: string = `${API_BASE_URL}/api/jobs/`;

/** Respuesta base reutilizable en tests de calculadora */
function makeCalcResponse(overrides: Partial<CalculatorJobResponse> = {}): CalculatorJobResponse {
  return {
    id: 'test-uuid',
    job_hash: 'abc123',
    plugin_name: 'calculator',
    algorithm_version: '1.0.0',
    status: JobStatusEnum.Completed,
    cache_hit: false,
    cache_miss: true,
    error_trace: null,
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
    status: JobStatusEnum.Running,
    progress_percentage: 50,
    progress_stage: JobProgressStageEnum.Running,
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
    status: JobStatusEnum.Pending,
    cache_hit: false,
    cache_miss: true,
    progress_percentage: 0,
    progress_stage: 'pending',
    progress_message: 'Pendiente',
    progress_event_index: 1,
    parameters: null,
    results: null,
    error_trace: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('JobsApiService', () => {
  let service: JobsApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
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
      status: JobStatusEnum.Completed,
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
        status: JobStatusEnum.Completed,
        progress_percentage: 100,
        progress_stage: JobProgressStageEnum.Completed,
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
});
