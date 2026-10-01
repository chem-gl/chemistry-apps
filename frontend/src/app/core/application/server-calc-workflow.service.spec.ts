// server-calc-workflow.service.spec.ts: Pruebas unitarias del flujo Server Calc.
// Verifica despacho inmediato, sincronización de parámetros y manejo de errores.

import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  JobLogsPageView,
  JobProgressSnapshotView,
  JobsApiService,
  ScientificJobView,
} from '../api/jobs-api.service';
import { ServerCalcWorkflowService } from './server-calc-workflow.service';

function makeScientificJob(overrides: Partial<ScientificJobView> = {}): ScientificJobView {
  return {
    id: 'server-calc-job-1',
    job_hash: 'hash-1',
    plugin_name: 'server-calc',
    algorithm_version: '1.1.0',
    status: 'completed',
    cache_hit: false,
    cache_miss: true,
    progress_percentage: 100,
    progress_stage: 'completed',
    progress_message: 'Completed',
    progress_event_index: 5,
    supports_pause_resume: false,
    pause_requested: false,
    runtime_state: {},
    paused_at: null,
    resumed_at: null,
    parameters: {
      a: 7,
      op: '*',
      b: 6,
    },
    results: {
      a: 7,
      op: '*',
      b: 6,
      result: 42,
      file_name: 'calc_x.txt',
      file_path: '/home/chemistry-apps/server-apps/results/calc_x.txt',
      metadata: {
        executed_on: 'qta',
        remote_host: '192.168.1.20',
        fallback_used: false,
      },
    },
    error_trace: '',
    created_at: '2026-03-31T00:00:00.000Z',
    updated_at: '2026-03-31T00:01:00.000Z',
    ...overrides,
  } as ScientificJobView;
}

function makeProgressSnapshot(
  overrides: Partial<JobProgressSnapshotView> = {},
): JobProgressSnapshotView {
  return {
    job_id: 'server-calc-job-1',
    status: 'running',
    progress_percentage: 60,
    progress_stage: 'running',
    progress_message: 'Running server calc',
    progress_event_index: 3,
    updated_at: '2026-03-31T00:00:30.000Z',
    ...overrides,
  } as JobProgressSnapshotView;
}

describe('ServerCalcWorkflowService', () => {
  let workflowService: ServerCalcWorkflowService;
  let jobsApiServiceMock: {
    dispatchServerCalcJob: ReturnType<typeof vi.fn>;
    streamJobEvents: ReturnType<typeof vi.fn>;
    streamJobLogEvents: ReturnType<typeof vi.fn>;
    pollJobUntilCompleted: ReturnType<typeof vi.fn>;
    getScientificJobStatus: ReturnType<typeof vi.fn>;
    getJobLogs: ReturnType<typeof vi.fn>;
  };

  const emptyLogsPage: JobLogsPageView = {
    jobId: 'server-calc-job-1',
    count: 0,
    nextAfterEventIndex: 0,
    results: [],
  };

  beforeEach(() => {
    jobsApiServiceMock = {
      dispatchServerCalcJob: vi.fn((): Observable<ScientificJobView> => of(makeScientificJob())),
      streamJobEvents: vi.fn((): Observable<JobProgressSnapshotView> => of(makeProgressSnapshot())),
      streamJobLogEvents: vi.fn(),
      pollJobUntilCompleted: vi.fn((): Observable<JobProgressSnapshotView> =>
        of(makeProgressSnapshot()),
      ),
      getScientificJobStatus: vi.fn((): Observable<ScientificJobView> => of(makeScientificJob())),
      getJobLogs: vi.fn((): Observable<JobLogsPageView> => of(emptyLogsPage)),
    };

    TestBed.configureTestingModule({
      providers: [
        ServerCalcWorkflowService,
        {
          provide: JobsApiService,
          useValue: jobsApiServiceMock,
        },
      ],
    });

    workflowService = TestBed.inject(ServerCalcWorkflowService);
  });

  it('dispatches completed job and stores result data immediately', () => {
    workflowService.dispatch();

    expect(jobsApiServiceMock.dispatchServerCalcJob).toHaveBeenCalledWith({
      a: 7,
      op: '*',
      b: 6,
    });
    expect(workflowService.activeSection()).toBe('result');
    expect(workflowService.resultData()?.result).toBe(42);
    expect(workflowService.resultData()?.fileName).toBe('calc_x.txt');
    expect(workflowService.resultData()?.executedOn).toBe('qta');
    expect(workflowService.historyJobs()).toEqual([]);
    expect(jobsApiServiceMock.getJobLogs).not.toHaveBeenCalled();
  });

  it('marks local fallback results with fallback flag', () => {
    jobsApiServiceMock.dispatchServerCalcJob.mockReturnValue(
      of(
        makeScientificJob({
          results: {
            a: 7,
            op: '*',
            b: 6,
            result: 42,
            file_name: null,
            file_path: null,
            metadata: {
              executed_on: 'local-fallback',
              remote_host: '192.168.1.20',
              fallback_used: true,
            },
          },
        }),
      ),
    );

    workflowService.dispatch();

    expect(workflowService.activeSection()).toBe('result');
    expect(workflowService.resultData()?.fallbackUsed).toBe(true);
    expect(workflowService.resultData()?.executedOn).toBe('local-fallback');
  });

  it('actualiza inputs numéricos a y b', () => {
    workflowService.a.set(10);
    workflowService.updateA(7);

    workflowService.b.set(1);
    workflowService.updateB(8);

    expect(workflowService.a()).toBe(7);
    expect(workflowService.b()).toBe(8);
  });

  it('sets error section when server calc dispatch request fails', () => {
    jobsApiServiceMock.dispatchServerCalcJob.mockReturnValue(
      throwError(() => new Error('connection refused')),
    );

    workflowService.dispatch();

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('Unable to create server calc job');
    expect(workflowService.errorMessage()).toContain('connection refused');
  });
});
