// tunnel-workflow.service.spec.ts: Pruebas unitarias del flujo Tunnel.
// Cubre trazabilidad de inputs, despacho, resumen histórico, exportes y fallback de progreso.

import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DownloadedReportFile,
  JobLogEntryView,
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
      input_change_events: [
        {
          field_name: 'temperature',
          previous_value: 300,
          new_value: 298.15,
          changed_at: '2026-03-31T00:00:00.000Z',
        },
      ],
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
        input_event_count: 1,
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

function makeLogEntry(overrides: Partial<JobLogEntryView> = {}): JobLogEntryView {
  return {
    jobId: 'tunnel-job-1',
    eventIndex: 1,
    level: 'info',
    source: 'tunnel',
    message: 'log-1',
    payload: {},
    createdAt: '2026-03-31T00:00:10.000Z',
    ...overrides,
  };
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
    listJobs: ReturnType<typeof vi.fn>;
    downloadTunnelCsvReport: ReturnType<typeof vi.fn>;
    downloadTunnelLogReport: ReturnType<typeof vi.fn>;
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
      streamJobLogEvents: vi.fn((): Observable<JobLogEntryView> => of(makeLogEntry())),
      pollJobUntilCompleted: vi.fn(
        (): Observable<JobProgressSnapshotView> => of(makeProgressSnapshot()),
      ),
      getScientificJobStatus: vi.fn((): Observable<ScientificJobView> => of(makeScientificJob())),
      getJobLogs: vi.fn((): Observable<JobLogsPageView> => of(emptyLogsPage)),
      listJobs: vi.fn((): Observable<ScientificJobView[]> => of([])),
      downloadTunnelCsvReport: vi.fn(),
      downloadTunnelLogReport: vi.fn(),
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

  it('records input changes and can clear the trace', () => {
    workflowService.updateTemperature(310);
    workflowService.updateReactionBarrierZpe(4.1);

    expect(workflowService.inputChangeEvents().length).toBe(2);
    expect(workflowService.inputChangeEvents()[0]?.fieldName).toBe('temperature');

    workflowService.clearInputHistory();

    expect(workflowService.inputChangeEvents()).toEqual([]);
  });

  it('dispatches completed job and stores result data immediately', () => {
    jobsApiServiceMock.getJobLogs.mockReturnValue(
      of({
        ...emptyLogsPage,
        results: [makeLogEntry({ eventIndex: 3, message: 'done' })],
      }),
    );
    jobsApiServiceMock.listJobs.mockReturnValue(
      of([
        makeScientificJob({ id: 'old', updated_at: '2026-03-30T08:00:00.000Z' }),
        makeScientificJob({ id: 'new', updated_at: '2026-03-30T09:00:00.000Z' }),
      ]),
    );

    workflowService.dispatch();

    expect(jobsApiServiceMock.dispatchTunnelJob).toHaveBeenCalledWith({
      reactionBarrierZpe: 3.5,
      imaginaryFrequency: 625,
      reactionEnergyZpe: -8.2,
      temperature: 298.15,
      inputChangeEvents: [],
    });
    expect(workflowService.activeSection()).toBe('result');
    expect(workflowService.resultData()?.u).toBe(0.4);
    expect(workflowService.resultData()?.isHistoricalSummary).toBe(false);
    expect(workflowService.historyJobs()[0]?.id).toBe('new');
  });

  it('builds historical summary when final results are unavailable', () => {
    jobsApiServiceMock.getScientificJobStatus.mockReturnValue(
      of(
        makeScientificJob({
          id: 'tunnel-running-1',
          status: 'running',
          results: null,
        }),
      ),
    );

    workflowService.openHistoricalJob('tunnel-running-1');

    expect(workflowService.activeSection()).toBe('result');
    expect(workflowService.resultData()?.isHistoricalSummary).toBe(true);
    expect(workflowService.resultData()?.summaryMessage).toContain('still running');
    expect(workflowService.inputChangeEvents().length).toBe(1);
  });

  it('keeps error section when historical job failed', () => {
    jobsApiServiceMock.getScientificJobStatus.mockReturnValue(
      of(
        makeScientificJob({
          id: 'tunnel-failed-1',
          status: 'failed',
          error_trace: 'calculation crashed',
        }),
      ),
    );

    workflowService.openHistoricalJob('tunnel-failed-1');

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('calculation crashed');
  });

  it('falls back to polling when the progress stream fails', () => {
    jobsApiServiceMock.dispatchTunnelJob.mockReturnValue(
      of(makeScientificJob({ id: 'tunnel-poll-1', status: 'running' })),
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
  });

  it('downloads CSV report for selected job', () => {
    const csvFile: DownloadedReportFile = {
      filename: 'tunnel-report.csv',
      blob: new Blob(['temperature,kappa_tst'], { type: 'text/csv' }),
    };
    jobsApiServiceMock.downloadTunnelCsvReport.mockReturnValue(of(csvFile));
    workflowService.currentJobId.set('tunnel-export-1');

    workflowService.downloadCsvReport().subscribe((downloadedFile: DownloadedReportFile) => {
      expect(downloadedFile.filename).toBe('tunnel-report.csv');
    });

    expect(jobsApiServiceMock.downloadTunnelCsvReport).toHaveBeenCalledWith('tunnel-export-1');
    expect(workflowService.exportErrorMessage()).toBeNull();
  });

  it('stores export error message when CSV download fails', () => {
    jobsApiServiceMock.downloadTunnelCsvReport.mockReturnValue(
      throwError(() => new Error('forbidden export')),
    );
    workflowService.currentJobId.set('tunnel-export-2');

    workflowService.downloadCsvReport().subscribe({
      error: () => {
        expect(workflowService.exportErrorMessage()).toContain('forbidden export');
        expect(workflowService.isExporting()).toBe(false);
      },
    });
  });

  it('throws when exporting without selected job', () => {
    expect(() => workflowService.downloadLogReport()).toThrow('No job selected for download.');
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
  });
});
