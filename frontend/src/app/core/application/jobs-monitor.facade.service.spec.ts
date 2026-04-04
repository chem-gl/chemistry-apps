// jobs-monitor.facade.service.spec.ts: Pruebas unitarias del facade del monitor de jobs.

import { TestBed } from '@angular/core/testing';
import { Observable, Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { JobsApiService, ScientificJobView } from '../api/jobs-api.service';
import { JobsMonitorFacadeService } from './jobs-monitor.facade.service';

function makeScientificJob(overrides: Partial<ScientificJobView> = {}): ScientificJobView {
  return {
    id: 'job-1',
    job_hash: 'hash-1',
    plugin_name: 'calculator',
    algorithm_version: '1.0.0',
    status: 'pending',
    cache_hit: false,
    cache_miss: true,
    progress_percentage: 0,
    progress_stage: 'pending',
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
  };
}

describe('JobsMonitorFacadeService', () => {
  let facadeService: JobsMonitorFacadeService;
  let jobsApiServiceMock: {
    listJobs: ReturnType<typeof vi.fn>;
    getScientificJobStatus: ReturnType<typeof vi.fn>;
    getJobLogs: ReturnType<typeof vi.fn>;
    streamJobEvents: ReturnType<typeof vi.fn>;
    streamJobLogEvents: ReturnType<typeof vi.fn>;
    pauseJob: ReturnType<typeof vi.fn>;
    resumeJob: ReturnType<typeof vi.fn>;
    cancelJob: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    jobsApiServiceMock = {
      listJobs: vi.fn((): Observable<ScientificJobView[]> => of([])),
      getScientificJobStatus: vi.fn(
        (jobId: string): Observable<ScientificJobView> =>
          of(makeScientificJob({ id: jobId, status: 'completed' })),
      ),
      getJobLogs: vi.fn(() =>
        of({
          jobId: 'job-1',
          count: 1,
          nextAfterEventIndex: 1,
          results: [
            {
              jobId: 'job-1',
              eventIndex: 1,
              level: 'info',
              source: 'tests.monitor',
              message: 'Evento de prueba',
              payload: {},
              createdAt: new Date().toISOString(),
            },
          ],
        }),
      ),
      streamJobEvents: vi.fn(() => of()),
      streamJobLogEvents: vi.fn(() => of()),
      pauseJob: vi.fn((jobId: string) =>
        of({
          detail: 'Pausa solicitada',
          job: makeScientificJob({ id: jobId, status: 'paused', progress_stage: 'paused' }),
        }),
      ),
      resumeJob: vi.fn((jobId: string) =>
        of({
          detail: 'Reanudación solicitada',
          job: makeScientificJob({ id: jobId, status: 'pending', progress_stage: 'queued' }),
        }),
      ),
      cancelJob: vi.fn((jobId: string) =>
        of({
          detail: 'Cancelación solicitada',
          job: makeScientificJob({ id: jobId, status: 'cancelled', progress_stage: 'cancelled' }),
        }),
      ),
    };

    TestBed.configureTestingModule({
      providers: [
        JobsMonitorFacadeService,
        {
          provide: JobsApiService,
          useValue: jobsApiServiceMock,
        },
      ],
    });

    facadeService = TestBed.inject(JobsMonitorFacadeService);
  });

  it('loads and classifies active, completed and failed jobs', () => {
    jobsApiServiceMock.listJobs.mockReturnValue(
      of([
        makeScientificJob({ id: 'pending-1', status: 'pending' }),
        makeScientificJob({ id: 'running-1', status: 'running' }),
        makeScientificJob({ id: 'completed-1', status: 'completed' }),
        makeScientificJob({ id: 'failed-1', status: 'failed' }),
      ]),
    );

    facadeService.loadJobs();

    expect(facadeService.activeJobs().length).toBe(2);
    expect(facadeService.completedJobs().length).toBe(1);
    expect(facadeService.failedJobs().length).toBe(1);
    expect(facadeService.finishedJobs().length).toBe(2);
    expect(facadeService.isLoading()).toBe(false);
  });

  it('sends status filter when selecting a specific status', () => {
    jobsApiServiceMock.listJobs.mockReturnValue(of([]));

    facadeService.setStatusFilter('completed');

    expect(jobsApiServiceMock.listJobs).toHaveBeenCalledWith({
      status: 'completed',
      pluginName: undefined,
    });
  });

  it('sends plugin filter when selecting a specific plugin', () => {
    jobsApiServiceMock.listJobs.mockReturnValue(of([]));

    facadeService.setPluginFilter('calculator');

    expect(jobsApiServiceMock.listJobs).toHaveBeenCalledWith({
      status: undefined,
      pluginName: 'calculator',
    });
  });

  it('builds sorted unique plugin options from loaded jobs', () => {
    jobsApiServiceMock.listJobs.mockReturnValue(
      of([
        makeScientificJob({ plugin_name: 'calculator' }),
        makeScientificJob({ plugin_name: 'thermo', id: 'job-2' }),
        makeScientificJob({ plugin_name: 'calculator', id: 'job-3' }),
      ]),
    );

    facadeService.loadJobs();

    expect(facadeService.pluginOptions()).toEqual(['all', 'calculator', 'thermo']);
  });

  it('loads selected job details and logs', () => {
    facadeService.openJobDetails('job-1');

    expect(facadeService.isDetailsLoading()).toBe(false);
    expect(facadeService.selectedJobId()).toBe('job-1');
    expect(facadeService.selectedJob()?.id).toBe('job-1');
    expect(facadeService.selectedJobLogs().length).toBe(1);
    expect(facadeService.selectedJobLogs()[0].source).toBe('tests.monitor');
  });

  it('starts SSE streams when opening details for an active job', () => {
    jobsApiServiceMock.getScientificJobStatus.mockReturnValue(
      of(makeScientificJob({ id: 'job-running', status: 'running' })),
    );

    facadeService.openJobDetails('job-running');

    expect(jobsApiServiceMock.streamJobEvents).toHaveBeenCalledWith('job-running');
    expect(jobsApiServiceMock.streamJobLogEvents).toHaveBeenCalledWith('job-running');
  });

  it('requests pause and updates selected job state', () => {
    facadeService.openJobDetails('job-1');
    facadeService.pauseJob('job-1');

    expect(jobsApiServiceMock.pauseJob).toHaveBeenCalledWith('job-1');
    expect(facadeService.selectedJob()?.status).toBe('paused');
  });

  it('requests resume and updates selected job state', () => {
    jobsApiServiceMock.getScientificJobStatus
      .mockReturnValueOnce(
        of(makeScientificJob({ id: 'job-1', status: 'paused', progress_stage: 'paused' })),
      )
      .mockReturnValueOnce(
        of(makeScientificJob({ id: 'job-1', status: 'pending', progress_stage: 'queued' })),
      );

    facadeService.openJobDetails('job-1');
    facadeService.resumeJob('job-1');

    expect(jobsApiServiceMock.resumeJob).toHaveBeenCalledWith('job-1');
    expect(facadeService.selectedJob()?.status).toBe('pending');
  });

  it('cancels selected job and updates state in monitor detail panel', () => {
    facadeService.openJobDetails('job-1');
    facadeService.cancelJob('job-1');

    expect(jobsApiServiceMock.cancelJob).toHaveBeenCalledWith('job-1');
    expect(facadeService.selectedJob()?.status).toBe('cancelled');
  });

  it('exposes control running state while pause request is in flight', () => {
    const pauseSubject = new Subject<{
      detail: string;
      job: ScientificJobView;
    }>();
    jobsApiServiceMock.pauseJob.mockReturnValueOnce(pauseSubject.asObservable());

    facadeService.pauseJob('job-control-1');
    expect(facadeService.isControlActionRunning('job-control-1')).toBe(true);

    pauseSubject.next({
      detail: 'ok',
      job: makeScientificJob({ id: 'job-control-1', status: 'paused' }),
    });
    pauseSubject.complete();

    expect(facadeService.isControlActionRunning('job-control-1')).toBe(false);
  });

  it('stores control error messages for pause, resume and cancel failures', () => {
    jobsApiServiceMock.pauseJob.mockReturnValueOnce(
      throwError(() => new Error('pause denied by backend')),
    );
    facadeService.pauseJob('job-err-1');
    expect(facadeService.controlErrorMessage()).toContain('pause denied by backend');

    jobsApiServiceMock.resumeJob.mockReturnValueOnce(
      throwError(() => new Error('resume denied by backend')),
    );
    facadeService.resumeJob('job-err-1');
    expect(facadeService.controlErrorMessage()).toContain('resume denied by backend');

    jobsApiServiceMock.cancelJob.mockReturnValueOnce(
      throwError(() => new Error('cancel denied by backend')),
    );
    facadeService.cancelJob('job-err-1');
    expect(facadeService.controlErrorMessage()).toContain('cancel denied by backend');
  });

  it('stores monitor loading error when listJobs fails in non-silent mode', () => {
    jobsApiServiceMock.listJobs.mockReturnValueOnce(
      throwError(() => new Error('monitor unavailable')),
    );

    facadeService.loadJobs();

    expect(facadeService.errorMessage()).toContain('monitor unavailable');
    expect(facadeService.isLoading()).toBe(false);
  });

  it('keeps silent refresh errors hidden from UI state', () => {
    jobsApiServiceMock.listJobs.mockReturnValueOnce(throwError(() => new Error('silent failure')));

    facadeService.loadJobs({ silent: true });

    expect(facadeService.errorMessage()).toBeNull();
    expect(facadeService.isLoading()).toBe(false);
  });

  it('closes detail view and clears selected state', () => {
    facadeService.openJobDetails('job-1');
    facadeService.closeJobDetails();

    expect(facadeService.selectedJobId()).toBeNull();
    expect(facadeService.selectedJob()).toBeNull();
    expect(facadeService.selectedJobLogs()).toEqual([]);
  });

  it('sets detail error when opening job details fails', () => {
    jobsApiServiceMock.getScientificJobStatus.mockReturnValueOnce(
      throwError(() => new Error('detail timeout')),
    );

    facadeService.openJobDetails('job-broken-detail');

    expect(facadeService.detailsErrorMessage()).toContain('detail timeout');
    expect(facadeService.isDetailsLoading()).toBe(false);
  });

  it('refreshes selected job from progress stream completion for active details', () => {
    const progress$ = new Subject<{
      job_id: string;
      status: ScientificJobView['status'];
      progress_percentage: number;
      progress_stage: string;
      progress_message: string;
      progress_event_index: number;
      updated_at: string;
    }>();
    const logs$ = new Subject<{
      jobId: string;
      eventIndex: number;
      level: 'debug' | 'info' | 'warning' | 'error';
      source: string;
      message: string;
      payload: object;
      createdAt: string;
    }>();

    jobsApiServiceMock.getScientificJobStatus
      .mockReturnValueOnce(of(makeScientificJob({ id: 'job-stream-1', status: 'running' })))
      .mockReturnValueOnce(of(makeScientificJob({ id: 'job-stream-1', status: 'completed' })));
    jobsApiServiceMock.streamJobEvents.mockReturnValue(progress$.asObservable());
    jobsApiServiceMock.streamJobLogEvents.mockReturnValue(logs$.asObservable());

    facadeService.openJobDetails('job-stream-1');

    progress$.next({
      job_id: 'job-stream-1',
      status: 'running',
      progress_percentage: 72,
      progress_stage: 'running',
      progress_message: 'processing',
      progress_event_index: 44,
      updated_at: '2026-03-31T12:00:00.000Z',
    });
    logs$.next({
      jobId: 'job-stream-1',
      eventIndex: 2,
      level: 'info',
      source: 'tests',
      message: 'streamed log',
      payload: {},
      createdAt: '2026-03-31T12:00:00.000Z',
    });

    expect(facadeService.selectedJob()?.progress_percentage).toBe(72);

    progress$.complete();

    expect(facadeService.selectedJob()?.status).toBe('completed');
    expect(facadeService.selectedJobLogs().some((entry) => entry.eventIndex === 2)).toBe(true);
  });

  it('keeps detail modal stable when progress stream errors', () => {
    jobsApiServiceMock.getScientificJobStatus.mockReturnValueOnce(
      of(makeScientificJob({ id: 'job-stream-error', status: 'running' })),
    );
    jobsApiServiceMock.streamJobEvents.mockReturnValueOnce(
      throwError(() => new Error('sse failed')),
    );

    facadeService.openJobDetails('job-stream-error');

    expect(facadeService.selectedJobId()).toBe('job-stream-error');
    expect(facadeService.detailsErrorMessage()).toBeNull();
  });

  it('toggles auto-refresh off and on without losing state', () => {
    expect(facadeService.autoRefreshEnabled()).toBe(true);

    facadeService.toggleAutoRefresh();
    expect(facadeService.autoRefreshEnabled()).toBe(false);

    facadeService.toggleAutoRefresh();
    expect(facadeService.autoRefreshEnabled()).toBe(true);
  });

  it('runs ngOnDestroy without throwing and stops subscriptions', () => {
    expect(() => facadeService.ngOnDestroy()).not.toThrow();
  });

  it('keeps lastUpdatedAt unchanged on silent refresh when jobs did not change', () => {
    const fixedJobs: ScientificJobView[] = [
      makeScientificJob({
        id: 'stable-job-1',
        status: 'completed',
        updated_at: '2026-03-11T12:00:00Z',
      }),
    ];

    jobsApiServiceMock.listJobs.mockReturnValue(of(fixedJobs));

    facadeService.loadJobs();
    const firstUpdatedAt: Date | null = facadeService.lastUpdatedAt();

    facadeService.loadJobs({ silent: true, updateOnlyOnChange: true });
    const secondUpdatedAt: Date | null = facadeService.lastUpdatedAt();

    expect(firstUpdatedAt).not.toBeNull();
    expect(secondUpdatedAt).not.toBeNull();
    expect(secondUpdatedAt?.getTime()).toBe(firstUpdatedAt?.getTime());
  });

  it('updates lastUpdatedAt on silent refresh when jobs changed', () => {
    jobsApiServiceMock.listJobs
      .mockReturnValueOnce(
        of([
          makeScientificJob({
            id: 'job-delta-1',
            status: 'running',
            updated_at: '2026-03-11T12:00:00Z',
          }),
        ]),
      )
      .mockReturnValueOnce(
        of([
          makeScientificJob({
            id: 'job-delta-1',
            status: 'completed',
            updated_at: '2026-03-11T12:00:05Z',
          }),
        ]),
      );

    facadeService.loadJobs();
    const firstUpdatedAt: Date | null = facadeService.lastUpdatedAt();

    facadeService.loadJobs({ silent: true, updateOnlyOnChange: true });
    const secondUpdatedAt: Date | null = facadeService.lastUpdatedAt();

    expect(firstUpdatedAt).not.toBeNull();
    expect(secondUpdatedAt).not.toBeNull();
    expect(secondUpdatedAt).not.toBe(firstUpdatedAt);
    expect(facadeService.jobs()[0].status).toBe('completed');
  });
});
