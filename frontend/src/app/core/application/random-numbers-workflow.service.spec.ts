// random-numbers-workflow.service.spec.ts: Pruebas unitarias del flujo random numbers.

import { TestBed } from '@angular/core/testing';
import { Observable, of } from 'rxjs';
import { vi } from 'vitest';
import { JobLogsPageView, JobsApiService, ScientificJobView } from '../api/jobs-api.service';
import { RandomNumbersWorkflowService } from './random-numbers-workflow.service';

function makeScientificJob(overrides: Partial<ScientificJobView> = {}): ScientificJobView {
  return {
    id: 'random-job-1',
    job_hash: 'hash-1',
    plugin_name: 'random-numbers',
    algorithm_version: '1.0.0',
    status: 'completed',
    cache_hit: false,
    cache_miss: true,
    progress_percentage: 100,
    progress_stage: 'completed',
    progress_message: 'Completado',
    progress_event_index: 3,
    supports_pause_resume: true,
    pause_requested: false,
    runtime_state: {},
    paused_at: null,
    resumed_at: null,
    parameters: {
      seed_url: 'https://example.com/seed.txt',
      numbers_per_batch: 5,
      interval_seconds: 120,
      total_numbers: 55,
    },
    results: {
      generated_numbers: [10, 20, 30],
      metadata: {
        seed_url: 'https://example.com/seed.txt',
        seed_digest: 'abc123',
        numbers_per_batch: 5,
        interval_seconds: 120,
        total_numbers: 55,
      },
    },
    error_trace: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('RandomNumbersWorkflowService', () => {
  let workflowService: RandomNumbersWorkflowService;
  const emptyLogsPage: JobLogsPageView = {
    jobId: 'random-job-1',
    count: 0,
    nextAfterEventIndex: 0,
    results: [],
  };

  let jobsApiServiceMock: {
    dispatchScientificJob: ReturnType<typeof vi.fn>;
    streamJobEvents: ReturnType<typeof vi.fn>;
    streamJobLogEvents: ReturnType<typeof vi.fn>;
    pollJobUntilCompleted: ReturnType<typeof vi.fn>;
    getScientificJobStatus: ReturnType<typeof vi.fn>;
    getJobLogs: ReturnType<typeof vi.fn>;
    listJobs: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    jobsApiServiceMock = {
      dispatchScientificJob: vi.fn((): Observable<ScientificJobView> => of(makeScientificJob())),
      streamJobEvents: vi.fn(),
      streamJobLogEvents: vi.fn(),
      pollJobUntilCompleted: vi.fn(),
      getScientificJobStatus: vi.fn(),
      getJobLogs: vi.fn((): Observable<JobLogsPageView> => of(emptyLogsPage)),
      listJobs: vi.fn((): Observable<ScientificJobView[]> => of([])),
    };

    TestBed.configureTestingModule({
      providers: [
        RandomNumbersWorkflowService,
        {
          provide: JobsApiService,
          useValue: jobsApiServiceMock,
        },
      ],
    });

    workflowService = TestBed.inject(RandomNumbersWorkflowService);
  });

  it('dispatches random numbers job and resolves result when backend responds completed', () => {
    workflowService.seedUrl.set('https://example.com/seed.txt');
    workflowService.numbersPerBatch.set(5);
    workflowService.intervalSeconds.set(120);
    workflowService.totalNumbers.set(55);

    workflowService.dispatch();

    expect(jobsApiServiceMock.dispatchScientificJob).toHaveBeenCalledWith({
      pluginName: 'random-numbers',
      parameters: {
        seed_url: 'https://example.com/seed.txt',
        numbers_per_batch: 5,
        interval_seconds: 120,
        total_numbers: 55,
      },
    });

    expect(workflowService.activeSection()).toBe('result');
    expect(workflowService.resultData()?.generatedNumbers.length).toBe(3);
  });

  it('opens paused historical job as summary when final results are unavailable', () => {
    jobsApiServiceMock.getScientificJobStatus.mockReturnValue(
      of(
        makeScientificJob({
          id: 'paused-job-1',
          status: 'paused',
          results: null,
          runtime_state: {
            generated_numbers: [101, 202, 303],
            generated_count: 3,
            total_numbers: 10,
          },
          parameters: {
            seed_url: 'https://example.com/seed.txt',
            numbers_per_batch: 5,
            interval_seconds: 120,
            total_numbers: 10,
          },
        }),
      ),
    );

    workflowService.openHistoricalJob('paused-job-1');

    expect(workflowService.activeSection()).toBe('result');
    expect(workflowService.resultData()?.isHistoricalSummary).toBe(true);
    expect(workflowService.resultData()?.generatedNumbers).toEqual([101, 202, 303]);
    expect(workflowService.errorMessage()).toBeNull();
  });

  it('keeps error section when historical job has neither results nor summary data', () => {
    jobsApiServiceMock.getScientificJobStatus.mockReturnValue(
      of(
        makeScientificJob({
          id: 'broken-job-1',
          status: 'paused',
          results: null,
          runtime_state: null,
          parameters: null,
        }),
      ),
    );

    workflowService.openHistoricalJob('broken-job-1');

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain(
      'Unable to reconstruct result or historical summary for this job.',
    );
  });
});
