// tunnel-workflow.service.spec.ts: Pruebas unitarias del flujo Tunnel.
// Verifica despacho inmediato, sincronización de parámetros y fallback sin historial ni logs.

import { TestBed } from '@angular/core/testing';
import { Observable, Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  JobLogsPageView,
  JobProgressSnapshotView,
  JobsApiService,
  ScientificJobView,
} from '../api/jobs-api.service';
import { TunnelWorkflowService } from './tunnel-workflow.service';

function makeScientificJob(overrides: Partial<ScientificJobView> = {}): ScientificJobView {
  return {
    id: 'tunnel-job-1',
    job_hash: 'hash-1',
    plugin_name: 'tunnel-effect',
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
      reaction_barrier_zpe: 3.5,
      imaginary_frequency: 625,
      reaction_energy_zpe: -8.2,
      temperature: 298.15,
    },
    results: {
      u: 0.4,
      alpha_1: 1.2,
      alpha_2: 0.9,
      g: 0.6,
      kappa_tst: 1.05,
      metadata: {
        model_name: 'Asymmetric Eckart',
        source_library: 'legacy-fortran',
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
    job_id: 'tunnel-job-1',
    status: 'running',
    progress_percentage: 60,
    progress_stage: 'running',
    progress_message: 'Running tunnel calculation',
    progress_event_index: 3,
    updated_at: '2026-03-31T00:00:30.000Z',
    ...overrides,
  } as JobProgressSnapshotView;
}

describe('TunnelWorkflowService', () => {
  let workflowService: TunnelWorkflowService;
  let jobsApiServiceMock: {
    dispatchTunnelJob: ReturnType<typeof vi.fn>;
    streamJobEvents: ReturnType<typeof vi.fn>;
    streamJobLogEvents: ReturnType<typeof vi.fn>;
    pollJobUntilCompleted: ReturnType<typeof vi.fn>;
    getScientificJobStatus: ReturnType<typeof vi.fn>;
    getJobLogs: ReturnType<typeof vi.fn>;
  };

  const emptyLogsPage: JobLogsPageView = {
    jobId: 'tunnel-job-1',
    count: 0,
    nextAfterEventIndex: 0,
    results: [],
  };

  beforeEach(() => {
    jobsApiServiceMock = {
      dispatchTunnelJob: vi.fn((): Observable<ScientificJobView> => of(makeScientificJob())),
      streamJobEvents: vi.fn((): Observable<JobProgressSnapshotView> => of(makeProgressSnapshot())),
      streamJobLogEvents: vi.fn(),
      pollJobUntilCompleted: vi.fn(
        (): Observable<JobProgressSnapshotView> => of(makeProgressSnapshot()),
      ),
      getScientificJobStatus: vi.fn((): Observable<ScientificJobView> => of(makeScientificJob())),
      getJobLogs: vi.fn((): Observable<JobLogsPageView> => of(emptyLogsPage)),
    };

    TestBed.configureTestingModule({
      providers: [
        TunnelWorkflowService,
        {
          provide: JobsApiService,
          useValue: jobsApiServiceMock,
        },
      ],
    });

    workflowService = TestBed.inject(TunnelWorkflowService);
  });

  it('dispatches completed job and stores result data immediately', () => {
    workflowService.dispatch();

    expect(jobsApiServiceMock.dispatchTunnelJob).toHaveBeenCalledWith({
      reactionBarrierZpe: 3.5,
      imaginaryFrequency: 625,
      reactionEnergyZpe: -8.2,
      temperature: 298.15,
    });
    expect(workflowService.activeSection()).toBe('result');
    expect(workflowService.resultData()?.u).toBe(0.4);
    expect(workflowService.historyJobs()).toEqual([]);
    expect(jobsApiServiceMock.getJobLogs).not.toHaveBeenCalled();
  });

  it('falls back to polling when the progress stream fails', () => {
    jobsApiServiceMock.dispatchTunnelJob.mockReturnValue(
      of(makeScientificJob({ id: 'tunnel-poll-1', status: 'running', results: null })),
    );
    jobsApiServiceMock.streamJobEvents.mockReturnValue(throwError(() => new Error('sse down')));
    jobsApiServiceMock.pollJobUntilCompleted.mockReturnValue(
      of(makeProgressSnapshot({ job_id: 'tunnel-poll-1', progress_percentage: 100 })),
    );
    jobsApiServiceMock.getScientificJobStatus.mockReturnValue(
      of(makeScientificJob({ id: 'tunnel-poll-1', status: 'completed' })),
    );

    workflowService.dispatch();

    expect(jobsApiServiceMock.pollJobUntilCompleted).toHaveBeenCalledWith('tunnel-poll-1', 1000);
    expect(workflowService.activeSection()).toBe('result');
    expect(jobsApiServiceMock.getJobLogs).not.toHaveBeenCalled();
  });

  it('actualiza inputs numéricos sin registrar trazabilidad', () => {
    workflowService.imaginaryFrequency.set(200);
    workflowService.updateImaginaryFrequency(350);

    workflowService.reactionEnergyZpe.set(0.5);
    workflowService.updateReactionEnergyZpe(1.2);

    expect(workflowService.imaginaryFrequency()).toBe(350);
    expect(workflowService.reactionEnergyZpe()).toBe(1.2);
  });

  it('sets error section when tunnel dispatch request fails', () => {
    jobsApiServiceMock.dispatchTunnelJob.mockReturnValue(
      throwError(() => new Error('connection refused')),
    );

    workflowService.dispatch();

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('Unable to create tunnel job');
    expect(workflowService.errorMessage()).toContain('connection refused');
  });

  it('sets error when fetchFinalResult fails after progress completes', () => {
    const progressEvents$ = new Subject<JobProgressSnapshotView>();

    jobsApiServiceMock.dispatchTunnelJob.mockReturnValue(
      of(makeScientificJob({ id: 'tunnel-final-err-1', status: 'running', results: null })),
    );
    jobsApiServiceMock.streamJobEvents.mockReturnValue(progressEvents$.asObservable());
    jobsApiServiceMock.getScientificJobStatus.mockReturnValue(
      throwError(() => new Error('internal server error')),
    );

    workflowService.dispatch();
    progressEvents$.complete();

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('Unable to get tunnel final result');
    expect(workflowService.errorMessage()).toContain('internal server error');
  });
});
