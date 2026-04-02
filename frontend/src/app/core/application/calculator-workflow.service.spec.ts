// calculator-workflow.service.spec.ts: Pruebas unitarias del flujo de calculadora.
// Cubre despacho, fallback SSE->polling, recuperación histórica y manejo de estado/UI.

import { TestBed } from '@angular/core/testing';
import { Observable, Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CalculatorJobResponseView,
  JobLogEntryView,
  JobLogsPageView,
  JobProgressSnapshotView,
  JobsApiService,
  ScientificJobView,
} from '../api/jobs-api.service';
import { CalculatorWorkflowService } from './calculator-workflow.service';

function makeCalculatorJob(
  overrides: Partial<CalculatorJobResponseView> = {},
): CalculatorJobResponseView {
  return {
    id: 'calc-job-1',
    job_hash: 'hash-1',
    plugin_name: 'calculator',
    algorithm_version: '1.0.0',
    status: 'completed',
    cache_hit: false,
    cache_miss: true,
    progress_percentage: 100,
    progress_stage: 'completed',
    progress_message: 'Completed',
    progress_event_index: 4,
    supports_pause_resume: false,
    pause_requested: false,
    runtime_state: {},
    paused_at: null,
    resumed_at: null,
    parameters: {
      op: 'add',
      a: 2,
      b: 3,
    },
    results: {
      final_result: 5,
      metadata: {
        operation_used: 'add',
        operand_a: 2,
        operand_b: 3,
      },
    },
    error_trace: '',
    created_at: '2026-03-31T00:00:00.000Z',
    updated_at: '2026-03-31T00:01:00.000Z',
    ...overrides,
  } as CalculatorJobResponseView;
}

function makeScientificJob(overrides: Partial<ScientificJobView> = {}): ScientificJobView {
  return {
    id: 'history-1',
    job_hash: 'history-hash-1',
    plugin_name: 'calculator',
    algorithm_version: '1.0.0',
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
      op: 'mul',
      a: 4,
      b: 5,
    },
    results: {
      final_result: 20,
      metadata: {
        operation_used: 'mul',
        operand_a: 4,
        operand_b: 5,
      },
    },
    error_trace: '',
    created_at: '2026-03-30T10:00:00.000Z',
    updated_at: '2026-03-30T10:00:00.000Z',
    ...overrides,
  } as ScientificJobView;
}

function makeProgressSnapshot(
  overrides: Partial<JobProgressSnapshotView> = {},
): JobProgressSnapshotView {
  return {
    job_id: 'calc-job-1',
    status: 'running',
    progress_percentage: 50,
    progress_stage: 'running',
    progress_message: 'Running',
    progress_event_index: 2,
    updated_at: '2026-03-31T00:00:30.000Z',
    ...overrides,
  } as JobProgressSnapshotView;
}

function makeLogEntry(overrides: Partial<JobLogEntryView> = {}): JobLogEntryView {
  return {
    jobId: 'calc-job-1',
    eventIndex: 1,
    level: 'info',
    source: 'calculator',
    message: 'step-1',
    payload: {},
    createdAt: '2026-03-31T00:00:10.000Z',
    ...overrides,
  };
}

describe('CalculatorWorkflowService', () => {
  let workflowService: CalculatorWorkflowService;
  let jobsApiServiceMock: {
    dispatchCalculatorJob: ReturnType<typeof vi.fn>;
    streamJobEvents: ReturnType<typeof vi.fn>;
    streamJobLogEvents: ReturnType<typeof vi.fn>;
    pollJobUntilCompleted: ReturnType<typeof vi.fn>;
    getJobStatus: ReturnType<typeof vi.fn>;
    getJobLogs: ReturnType<typeof vi.fn>;
    listJobs: ReturnType<typeof vi.fn>;
  };

  const emptyLogsPage: JobLogsPageView = {
    jobId: 'calc-job-1',
    count: 0,
    nextAfterEventIndex: 0,
    results: [],
  };

  beforeEach(() => {
    jobsApiServiceMock = {
      dispatchCalculatorJob: vi.fn(
        (): Observable<CalculatorJobResponseView> => of(makeCalculatorJob()),
      ),
      streamJobEvents: vi.fn((): Observable<JobProgressSnapshotView> => of(makeProgressSnapshot())),
      streamJobLogEvents: vi.fn((): Observable<JobLogEntryView> => of(makeLogEntry())),
      pollJobUntilCompleted: vi.fn(
        (): Observable<JobProgressSnapshotView> => of(makeProgressSnapshot()),
      ),
      getJobStatus: vi.fn((): Observable<CalculatorJobResponseView> => of(makeCalculatorJob())),
      getJobLogs: vi.fn((): Observable<JobLogsPageView> => of(emptyLogsPage)),
      listJobs: vi.fn((): Observable<ScientificJobView[]> => of([])),
    };

    TestBed.configureTestingModule({
      providers: [
        CalculatorWorkflowService,
        {
          provide: JobsApiService,
          useValue: jobsApiServiceMock,
        },
      ],
    });

    workflowService = TestBed.inject(CalculatorWorkflowService);
  });

  it('dispatches completed job and loads ordered history', () => {
    jobsApiServiceMock.dispatchCalculatorJob.mockReturnValue(
      of(makeCalculatorJob({ id: 'calc-completed-1', status: 'completed' })),
    );
    jobsApiServiceMock.getJobLogs.mockReturnValue(
      of({
        ...emptyLogsPage,
        results: [makeLogEntry({ eventIndex: 9, message: 'done' })],
      }),
    );
    jobsApiServiceMock.listJobs.mockReturnValue(
      of([
        makeScientificJob({ id: 'old', updated_at: '2026-03-30T08:00:00.000Z' }),
        makeScientificJob({ id: 'new', updated_at: '2026-03-30T09:00:00.000Z' }),
      ]),
    );

    workflowService.dispatch();

    expect(workflowService.activeSection()).toBe('result');
    expect(workflowService.lastResult()?.id).toBe('calc-completed-1');
    expect(workflowService.historyJobs()[0]?.id).toBe('new');
    expect(workflowService.historyJobs()[1]?.id).toBe('old');
    expect(workflowService.jobLogs()[0]?.eventIndex).toBe(9);
  });

  it('handles dispatch errors and sets error section', () => {
    jobsApiServiceMock.dispatchCalculatorJob.mockReturnValue(
      throwError(() => new Error('network down')),
    );

    workflowService.dispatch();

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('Unable to dispatch job: network down');
  });

  it('streams progress and deduplicates logs by event index', () => {
    const progressEvents$: Subject<JobProgressSnapshotView> =
      new Subject<JobProgressSnapshotView>();
    const logEvents$: Subject<JobLogEntryView> = new Subject<JobLogEntryView>();

    jobsApiServiceMock.dispatchCalculatorJob.mockReturnValue(
      of(makeCalculatorJob({ id: 'calc-stream-1', status: 'running' })),
    );
    jobsApiServiceMock.streamJobEvents.mockReturnValue(progressEvents$.asObservable());
    jobsApiServiceMock.streamJobLogEvents.mockReturnValue(logEvents$.asObservable());
    jobsApiServiceMock.getJobStatus.mockReturnValue(
      of(makeCalculatorJob({ id: 'calc-stream-1', status: 'completed' })),
    );
    jobsApiServiceMock.getJobLogs.mockReturnValue(
      of({
        ...emptyLogsPage,
        results: [
          makeLogEntry({ eventIndex: 1, message: 'first' }),
          makeLogEntry({ eventIndex: 2, message: 'second' }),
        ],
      }),
    );

    workflowService.dispatch();

    logEvents$.next(makeLogEntry({ eventIndex: 2, message: 'second' }));
    logEvents$.next(makeLogEntry({ eventIndex: 1, message: 'first' }));
    logEvents$.next(makeLogEntry({ eventIndex: 2, message: 'duplicate second' }));
    progressEvents$.next(
      makeProgressSnapshot({ progress_percentage: 88, progress_stage: 'running' }),
    );
    progressEvents$.complete();

    expect(workflowService.progressPercentage()).toBe(88);
    expect(workflowService.jobLogs().map((item) => item.eventIndex)).toEqual([1, 2]);
    expect(workflowService.activeSection()).toBe('result');
    expect(jobsApiServiceMock.getJobStatus).toHaveBeenCalledWith('calc-stream-1');
  });

  it('falls back to polling when stream fails', () => {
    jobsApiServiceMock.dispatchCalculatorJob.mockReturnValue(
      of(makeCalculatorJob({ id: 'calc-poll-1', status: 'running' })),
    );
    jobsApiServiceMock.streamJobEvents.mockReturnValue(
      throwError(() => new Error('sse unavailable')),
    );
    jobsApiServiceMock.pollJobUntilCompleted.mockReturnValue(
      of(makeProgressSnapshot({ job_id: 'calc-poll-1', progress_percentage: 100 })),
    );
    jobsApiServiceMock.getJobStatus.mockReturnValue(
      of(makeCalculatorJob({ id: 'calc-poll-1', status: 'completed' })),
    );

    workflowService.dispatch();

    expect(jobsApiServiceMock.pollJobUntilCompleted).toHaveBeenCalledWith('calc-poll-1', 1000);
    expect(workflowService.activeSection()).toBe('result');
  });

  it('opens historical failed job and exposes backend error', () => {
    jobsApiServiceMock.getJobStatus.mockReturnValue(
      of(
        makeCalculatorJob({
          id: 'calc-failed-1',
          status: 'failed',
          error_trace: 'division by zero',
        }),
      ),
    );

    workflowService.openHistoricalJob('calc-failed-1');

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('division by zero');
    expect(jobsApiServiceMock.getJobLogs).toHaveBeenCalledWith('calc-failed-1', { limit: 250 });
  });

  it('resets transient state and current job context', () => {
    workflowService.activeSection.set('error');
    workflowService.currentJobId.set('calc-reset-1');
    workflowService.errorMessage.set('something failed');
    workflowService.progressSnapshot.set(makeProgressSnapshot());
    workflowService.jobLogs.set([makeLogEntry()]);
    workflowService.lastResult.set(makeCalculatorJob());

    workflowService.reset();

    expect(workflowService.activeSection()).toBe('idle');
    expect(workflowService.currentJobId()).toBeNull();
    expect(workflowService.errorMessage()).toBeNull();
    expect(workflowService.progressSnapshot()).toBeNull();
    expect(workflowService.jobLogs()).toEqual([]);
    expect(workflowService.lastResult()).toBeNull();
  });
});
