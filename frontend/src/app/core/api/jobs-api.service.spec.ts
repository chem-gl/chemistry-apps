// jobs-api.service.spec.ts: Tests unitarios del wrapper desacoplado

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideApi, ScientificJob } from './generated';
import { JobsApiService } from './jobs-api.service';

describe('JobsApiService', () => {
  let service: JobsApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideApi('http://localhost:8000'),
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

  it('should dispatch calculator job', () => {
    const mockResponse: ScientificJob = {
      id: '12345',
      job_hash: 'abc123',
      plugin_name: 'calculator',
      algorithm_version: '1.0.0',
      status: 'pending',
      cache_hit: false,
      cache_miss: true,
      error_trace: null,
      parameters: { op: 'add', a: 2, b: 3 },
      results: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    service.dispatchCalculatorJob({ op: 'add', a: 2, b: 3 }).subscribe((job) => {
      expect(job.id).toBe('12345');
      expect(job.plugin_name).toBe('calculator');
    });

    const req = httpMock.expectOne('http://localhost:8000/api/jobs/');
    expect(req.request.method).toBe('POST');
    req.flush(mockResponse);
  });

  it('should retrieve job status', () => {
    const mockJob: ScientificJob = {
      id: 'test-id',
      job_hash: 'hash',
      plugin_name: 'calculator',
      algorithm_version: '1.0.0',
      status: 'completed',
      cache_hit: false,
      cache_miss: true,
      error_trace: null,
      parameters: {},
      results: { final_result: 42 },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    service.getJobStatus('test-id').subscribe((job) => {
      expect(job.status).toBe('completed');
      expect(job.results?.['final_result']).toBe(42);
    });

    const req = httpMock.expectOne('http://localhost:8000/api/jobs/test-id/');
    expect(req.request.method).toBe('GET');
    req.flush(mockJob);
  });
});
