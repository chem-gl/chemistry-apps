// random-numbers-workflow.service.spec.ts: Pruebas unitarias del flujo random numbers.
// Cubre despacho, fallback SSE->polling, pausa/reanudación y recuperación histórica.

import { TestBed } from '@angular/core/testing';
import { Observable, Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import {
  JobControlActionResult,
  JobLogEntryView,
  JobLogsPageView,
  JobProgressSnapshotView,
  JobsApiService,
  ScientificJobView,
} from '../api/jobs-api.service';
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

function makeProgressSnapshot(
  overrides: Partial<JobProgressSnapshotView> = {},
): JobProgressSnapshotView {
  return {
    job_id: 'random-job-1',
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
    jobId: 'random-job-1',
    eventIndex: 1,
    level: 'info',
    source: 'random-numbers',
    message: 'step-1',
    payload: {},
    createdAt: '2026-03-31T00:00:10.000Z',
    ...overrides,
  };
}

function makeControlResult(
  overrides: Partial<JobControlActionResult> = {},
): JobControlActionResult {
  return {
    detail: 'ok',
    job: makeScientificJob({
      id: 'random-job-1',
      status: 'paused',
      progress_stage: 'paused',
      progress_message: 'Paused by user',
      progress_percentage: 65,
    }),
    ...overrides,
  } as JobControlActionResult;
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
    pauseJob: ReturnType<typeof vi.fn>;
    resumeJob: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    jobsApiServiceMock = {
      dispatchScientificJob: vi.fn((): Observable<ScientificJobView> => of(makeScientificJob())),
      streamJobEvents: vi.fn((): Observable<JobProgressSnapshotView> => of(makeProgressSnapshot())),
      streamJobLogEvents: vi.fn((): Observable<JobLogEntryView> => of(makeLogEntry())),
      pollJobUntilCompleted: vi.fn(
        (): Observable<JobProgressSnapshotView> => of(makeProgressSnapshot()),
      ),
      getScientificJobStatus: vi.fn((): Observable<ScientificJobView> => of(makeScientificJob())),
      getJobLogs: vi.fn((): Observable<JobLogsPageView> => of(emptyLogsPage)),
      listJobs: vi.fn((): Observable<ScientificJobView[]> => of([])),
      pauseJob: vi.fn((): Observable<JobControlActionResult> => of(makeControlResult())),
      resumeJob: vi.fn(
        (): Observable<JobControlActionResult> =>
          of(
            makeControlResult({
              job: makeScientificJob({
                status: 'running',
                progress_stage: 'running',
                progress_message: 'Resumed',
                progress_percentage: 66,
              }),
            }),
          ),
      ),
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

  it('handles dispatch errors and exposes backend message', () => {
    jobsApiServiceMock.dispatchScientificJob.mockReturnValue(
      throwError(() => new Error('network down')),
    );

    workflowService.dispatch();

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('Unable to create random numbers job');
    expect(workflowService.errorMessage()).toContain('network down');
  });

  it('streams progress, deduplicates logs and resolves final result on completion', () => {
    const progressEvents$: Subject<JobProgressSnapshotView> =
      new Subject<JobProgressSnapshotView>();
    const logEvents$: Subject<JobLogEntryView> = new Subject<JobLogEntryView>();

    jobsApiServiceMock.dispatchScientificJob.mockReturnValue(
      of(makeScientificJob({ id: 'random-stream-1', status: 'running' })),
    );
    jobsApiServiceMock.streamJobEvents.mockReturnValue(progressEvents$.asObservable());
    jobsApiServiceMock.streamJobLogEvents.mockReturnValue(logEvents$.asObservable());
    jobsApiServiceMock.getScientificJobStatus.mockReturnValue(
      of(makeScientificJob({ id: 'random-stream-1', status: 'completed' })),
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
    logEvents$.next(makeLogEntry({ eventIndex: 2, message: 'duplicated second' }));
    progressEvents$.next(
      makeProgressSnapshot({
        job_id: 'random-stream-1',
        progress_percentage: 88,
        progress_stage: 'running',
      }),
    );
    progressEvents$.complete();

    expect(workflowService.progressPercentage()).toBe(88);
    expect(workflowService.jobLogs().map((item) => item.eventIndex)).toEqual([1, 2]);
    expect(workflowService.activeSection()).toBe('result');
    expect(jobsApiServiceMock.getScientificJobStatus).toHaveBeenCalledWith('random-stream-1');
  });

  it('falls back to polling when the progress stream fails', () => {
    jobsApiServiceMock.dispatchScientificJob.mockReturnValue(
      of(makeScientificJob({ id: 'random-poll-1', status: 'running' })),
    );
    jobsApiServiceMock.streamJobEvents.mockReturnValue(
      throwError(() => new Error('sse unavailable')),
    );
    jobsApiServiceMock.pollJobUntilCompleted.mockReturnValue(
      of(makeProgressSnapshot({ job_id: 'random-poll-1', progress_percentage: 100 })),
    );
    jobsApiServiceMock.getScientificJobStatus.mockReturnValue(
      of(makeScientificJob({ id: 'random-poll-1', status: 'completed' })),
    );

    workflowService.dispatch();

    expect(jobsApiServiceMock.pollJobUntilCompleted).toHaveBeenCalledWith('random-poll-1', 1000);
    expect(workflowService.activeSection()).toBe('result');
  });

  it('pauses current job and keeps fallback progress stage when backend sends an unknown one', () => {
    workflowService.currentJobId.set('random-pause-1');
    workflowService.progressSnapshot.set(
      makeProgressSnapshot({
        job_id: 'random-pause-1',
        progress_stage: 'running',
        progress_percentage: 40,
      }),
    );
    jobsApiServiceMock.pauseJob.mockReturnValue(
      of(
        makeControlResult({
          job: makeScientificJob({
            id: 'random-pause-1',
            status: 'paused',
            progress_stage: 'unexpected-stage',
            progress_message: 'Paused remotely',
            progress_percentage: 41,
          }),
        }),
      ),
    );

    workflowService.pauseCurrentJob();

    expect(jobsApiServiceMock.pauseJob).toHaveBeenCalledWith('random-pause-1');
    expect(workflowService.progressSnapshot()?.status).toBe('paused');
    expect(workflowService.progressSnapshot()?.progress_stage).toBe('running');
    expect(workflowService.progressSnapshot()?.progress_percentage).toBe(41);
    expect(workflowService.isControlActionLoading()).toBe(false);
  });

  it('stores pause error message when backend rejects the pause request', () => {
    workflowService.currentJobId.set('random-pause-error-1');
    jobsApiServiceMock.pauseJob.mockReturnValue(throwError(() => new Error('pause rejected')));

    workflowService.pauseCurrentJob();

    expect(workflowService.errorMessage()).toContain('Unable to pause job: pause rejected');
    expect(workflowService.isControlActionLoading()).toBe(false);
  });

  it('resumes paused historical summary and restarts progress tracking', () => {
    const resumedProgressEvents$: Subject<JobProgressSnapshotView> =
      new Subject<JobProgressSnapshotView>();

    workflowService.activeSection.set('result');
    workflowService.currentJobId.set('random-resume-1');
    workflowService.resultData.set({
      generatedNumbers: [1, 2],
      seedUrl: 'https://example.com/seed.txt',
      seedDigest: 'Not available yet (job not completed)',
      numbersPerBatch: 5,
      intervalSeconds: 120,
      totalNumbers: 10,
      isHistoricalSummary: true,
      summaryMessage: 'Partial summary',
    });
    workflowService.progressSnapshot.set(
      makeProgressSnapshot({
        job_id: 'random-resume-1',
        status: 'paused',
        progress_stage: 'paused',
        progress_percentage: 20,
      }),
    );
    jobsApiServiceMock.resumeJob.mockReturnValue(
      of(
        makeControlResult({
          job: makeScientificJob({
            id: 'random-resume-1',
            status: 'running',
            progress_stage: 'running',
            progress_message: 'Resumed',
            progress_percentage: 21,
          }),
        }),
      ),
    );
    jobsApiServiceMock.streamJobEvents.mockReturnValue(resumedProgressEvents$.asObservable());
    jobsApiServiceMock.streamJobLogEvents.mockReturnValue(of(makeLogEntry()));

    expect(workflowService.canResumeFromResult()).toBe(true);

    workflowService.resumeCurrentJob();

    resumedProgressEvents$.next(
      makeProgressSnapshot({
        job_id: 'random-resume-1',
        status: 'running',
        progress_stage: 'running',
        progress_percentage: 67,
      }),
    );

    expect(jobsApiServiceMock.resumeJob).toHaveBeenCalledWith('random-resume-1');
    expect(workflowService.activeSection()).toBe('progress');
    expect(workflowService.progressSnapshot()?.progress_percentage).toBe(67);
    expect(workflowService.canResumeFromResult()).toBe(false);
  });

  it('stores resume error message when backend rejects the resume request', () => {
    workflowService.currentJobId.set('random-resume-error-1');
    jobsApiServiceMock.resumeJob.mockReturnValue(throwError(() => new Error('resume rejected')));

    workflowService.resumeCurrentJob();

    expect(workflowService.errorMessage()).toContain('Unable to resume job: resume rejected');
    expect(workflowService.isControlActionLoading()).toBe(false);
  });

  it('does not fetch final result when progress stream completes in paused state', () => {
    const progressEvents$: Subject<JobProgressSnapshotView> =
      new Subject<JobProgressSnapshotView>();

    jobsApiServiceMock.dispatchScientificJob.mockReturnValue(
      of(makeScientificJob({ id: 'random-paused-stream-1', status: 'running' })),
    );
    jobsApiServiceMock.streamJobEvents.mockReturnValue(progressEvents$.asObservable());
    jobsApiServiceMock.streamJobLogEvents.mockReturnValue(of(makeLogEntry()));

    workflowService.dispatch();

    progressEvents$.next(
      makeProgressSnapshot({
        job_id: 'random-paused-stream-1',
        status: 'paused',
        progress_stage: 'paused',
        progress_percentage: 54,
      }),
    );
    progressEvents$.complete();

    expect(jobsApiServiceMock.getScientificJobStatus).not.toHaveBeenCalledWith(
      'random-paused-stream-1',
    );
    expect(workflowService.progressSnapshot()?.status).toBe('paused');
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

  it('opens failed historical job and exposes backend trace', () => {
    jobsApiServiceMock.getScientificJobStatus.mockReturnValue(
      of(
        makeScientificJob({
          id: 'failed-job-1',
          status: 'failed',
          error_trace: 'worker crashed',
        }),
      ),
    );

    workflowService.openHistoricalJob('failed-job-1');

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('worker crashed');
    expect(jobsApiServiceMock.getJobLogs).toHaveBeenCalledWith('failed-job-1', { limit: 250 });
  });

  it('keeps error section when historical status retrieval fails', () => {
    jobsApiServiceMock.getScientificJobStatus.mockReturnValue(
      throwError(() => new Error('history unavailable')),
    );

    workflowService.openHistoricalJob('broken-history-1');

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain(
      'Unable to recover historical job: history unavailable',
    );
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
    expect(workflowService.errorMessage()).toContain('Result payload is invalid.');
  });

  it('loads history ordered by updated_at descending', () => {
    jobsApiServiceMock.listJobs.mockReturnValue(
      of([
        makeScientificJob({ id: 'old', updated_at: '2026-03-30T08:00:00.000Z' }),
        makeScientificJob({ id: 'new', updated_at: '2026-03-30T09:00:00.000Z' }),
      ]),
    );

    workflowService.loadHistory();

    expect(workflowService.historyJobs()[0]?.id).toBe('new');
    expect(workflowService.historyJobs()[1]?.id).toBe('old');
    expect(workflowService.isHistoryLoading()).toBe(false);
  });

  it('keeps error section when polling fallback also fails', () => {
    jobsApiServiceMock.dispatchScientificJob.mockReturnValue(
      of(makeScientificJob({ id: 'random-poll-error-1', status: 'running' })),
    );
    jobsApiServiceMock.streamJobEvents.mockReturnValue(
      throwError(() => new Error('sse unavailable')),
    );
    jobsApiServiceMock.pollJobUntilCompleted.mockReturnValue(
      throwError(() => new Error('polling unavailable')),
    );

    workflowService.dispatch();

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain(
      'Unable to track progress: polling unavailable',
    );
  });

  it('keeps error section when immediate completed payload is invalid', () => {
    jobsApiServiceMock.dispatchScientificJob.mockReturnValue(
      of(
        makeScientificJob({
          id: 'random-invalid-completed-1',
          status: 'completed',
          results: { generated_numbers: [1, 2], metadata: null },
        }),
      ),
    );

    workflowService.dispatch();

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain(
      'The completed job payload is invalid for random numbers.',
    );
  });

  it('resets transient state and clears current job context', () => {
    workflowService.activeSection.set('error');
    workflowService.currentJobId.set('random-reset-1');
    workflowService.errorMessage.set('something failed');
    workflowService.progressSnapshot.set(makeProgressSnapshot());
    workflowService.jobLogs.set([makeLogEntry()]);
    workflowService.resultData.set({
      generatedNumbers: [10],
      seedUrl: 'https://example.com/seed.txt',
      seedDigest: 'abc123',
      numbersPerBatch: 5,
      intervalSeconds: 120,
      totalNumbers: 55,
      isHistoricalSummary: false,
      summaryMessage: null,
    });

    workflowService.reset();

    expect(workflowService.activeSection()).toBe('idle');
    expect(workflowService.currentJobId()).toBeNull();
    expect(workflowService.errorMessage()).toBeNull();
    expect(workflowService.progressSnapshot()).toBeNull();
    expect(workflowService.jobLogs()).toEqual([]);
    expect(workflowService.resultData()).toBeNull();
  });

  it('sets error section when random numbers dispatch request fails', () => {
    jobsApiServiceMock.dispatchScientificJob.mockReturnValue(
      throwError(() => new Error('rate limited')),
    );

    workflowService.dispatch();

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('Unable to create random numbers job');
    expect(workflowService.errorMessage()).toContain('rate limited');
  });

  it('evaluates isPaused computed and resets isControlActionLoading on reset', () => {
    workflowService.progressSnapshot.set(makeProgressSnapshot({ status: 'paused' }));
    expect(workflowService.isPaused()).toBe(true);

    workflowService.progressSnapshot.set(makeProgressSnapshot({ status: 'running' }));
    expect(workflowService.isPaused()).toBe(false);

    workflowService.isControlActionLoading.set(true);
    workflowService.reset();
    expect(workflowService.isControlActionLoading()).toBe(false);
  });

  it('pauses current job and updates progress snapshot status on success', () => {
    workflowService.currentJobId.set('rnd-pause-1');
    workflowService.progressSnapshot.set(
      makeProgressSnapshot({ status: 'running', progress_percentage: 40 }),
    );

    const pauseResult = makeControlResult({
      job: makeScientificJob({
        id: 'rnd-pause-1',
        status: 'paused',
        progress_percentage: 40,
        progress_stage: 'running',
        progress_message: 'Paused',
      }),
    });
    jobsApiServiceMock.pauseJob.mockReturnValue(of(pauseResult));

    workflowService.pauseCurrentJob();

    expect(workflowService.progressSnapshot()?.status).toBe('paused');
    expect(workflowService.isControlActionLoading()).toBe(false);
  });

  it('sets error when pause request fails', () => {
    workflowService.currentJobId.set('rnd-pause-err-1');
    jobsApiServiceMock.pauseJob.mockReturnValue(throwError(() => new Error('pause conflict')));

    workflowService.pauseCurrentJob();

    expect(workflowService.errorMessage()).toContain('Unable to pause job');
    expect(workflowService.isControlActionLoading()).toBe(false);
  });

  it('resumes current job and starts progress stream on success', () => {
    workflowService.currentJobId.set('rnd-resume-1');

    const resumeResult = makeControlResult({
      job: makeScientificJob({
        id: 'rnd-resume-1',
        status: 'running',
        progress_percentage: 50,
        progress_stage: 'running',
        progress_message: 'Resumed',
      }),
    });
    jobsApiServiceMock.resumeJob.mockReturnValue(of(resumeResult));
    jobsApiServiceMock.streamJobEvents.mockReturnValue(of());
    jobsApiServiceMock.streamJobLogEvents.mockReturnValue(of());
    jobsApiServiceMock.getScientificJobStatus.mockReturnValue(
      of(makeScientificJob({ id: 'rnd-resume-1', status: 'completed' })),
    );

    workflowService.resumeCurrentJob();

    expect(workflowService.activeSection()).toBe('result');
    expect(workflowService.isControlActionLoading()).toBe(false);
  });

  it('sets error when resume request fails', () => {
    workflowService.currentJobId.set('rnd-resume-err-1');
    jobsApiServiceMock.resumeJob.mockReturnValue(throwError(() => new Error('already running')));

    workflowService.resumeCurrentJob();

    expect(workflowService.errorMessage()).toContain('Unable to resume job');
    expect(workflowService.isControlActionLoading()).toBe(false);
  });

  it('sets error when openHistoricalJob status request fails', () => {
    jobsApiServiceMock.getScientificJobStatus.mockReturnValue(
      throwError(() => new Error('not found')),
    );

    workflowService.openHistoricalJob('rnd-historical-err-1');

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('Unable to recover historical job');
    expect(workflowService.errorMessage()).toContain('not found');
  });

  it('sets error when fetchFinalResult fails after stream completes', () => {
    const progressEvents$ = new Subject<JobProgressSnapshotView>();

    jobsApiServiceMock.dispatchScientificJob.mockReturnValue(
      of(makeScientificJob({ id: 'rnd-final-err-1', status: 'running', results: null })),
    );
    jobsApiServiceMock.streamJobEvents.mockReturnValue(progressEvents$.asObservable());
    jobsApiServiceMock.streamJobLogEvents.mockReturnValue(of());
    jobsApiServiceMock.getScientificJobStatus.mockReturnValue(
      throwError(() => new Error('fetch timeout')),
    );

    workflowService.dispatch();
    progressEvents$.complete();

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('Unable to recover final result');
    expect(workflowService.errorMessage()).toContain('fetch timeout');
  });
});
