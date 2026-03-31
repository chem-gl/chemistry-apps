// molar-fractions-workflow.service.spec.ts: Pruebas unitarias del workflow de molar fractions.

import { TestBed } from '@angular/core/testing';
import { Observable, Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import {
  DownloadedReportFile,
  JobLogsPageView,
  JobsApiService,
  ScientificJobView,
} from '../api/jobs-api.service';
import { MolarFractionsWorkflowService } from './molar-fractions-workflow.service';

function makeScientificJob(overrides: Partial<ScientificJobView> = {}): ScientificJobView {
  return {
    id: 'molar-job-1',
    job_hash: 'hash-1',
    plugin_name: 'molar-fractions',
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
      pka_values: [2.2, 7.2, 12.3],
      ph_mode: 'range',
      ph_min: 0,
      ph_max: 14,
      ph_step: 1,
    },
    results: {
      species_labels: ['f0', 'f1', 'f2', 'f3'],
      rows: [
        {
          ph: 0,
          fractions: [0.00001, 0.001, 0.9, 0.099],
          sum_fraction: 1,
        },
      ],
      metadata: {
        pka_values: [2.2, 7.2, 12.3],
        ph_mode: 'range',
        ph_min: 0,
        ph_max: 14,
        ph_step: 1,
        total_species: 4,
        total_points: 15,
      },
    },
    error_trace: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('MolarFractionsWorkflowService', () => {
  let workflowService: MolarFractionsWorkflowService;
  const emptyLogsPage: JobLogsPageView = {
    jobId: 'molar-job-1',
    count: 0,
    nextAfterEventIndex: 0,
    results: [],
  };

  let jobsApiServiceMock: {
    dispatchMolarFractionsJob: ReturnType<typeof vi.fn>;
    streamJobEvents: ReturnType<typeof vi.fn>;
    streamJobLogEvents: ReturnType<typeof vi.fn>;
    pollJobUntilCompleted: ReturnType<typeof vi.fn>;
    getScientificJobStatus: ReturnType<typeof vi.fn>;
    getJobLogs: ReturnType<typeof vi.fn>;
    listJobs: ReturnType<typeof vi.fn>;
    downloadMolarFractionsCsvReport: ReturnType<typeof vi.fn>;
    downloadMolarFractionsLogReport: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    jobsApiServiceMock = {
      dispatchMolarFractionsJob: vi.fn(
        (): Observable<ScientificJobView> => of(makeScientificJob()),
      ),
      streamJobEvents: vi.fn(),
      streamJobLogEvents: vi.fn(),
      pollJobUntilCompleted: vi.fn(),
      getScientificJobStatus: vi.fn(),
      getJobLogs: vi.fn((): Observable<JobLogsPageView> => of(emptyLogsPage)),
      listJobs: vi.fn((): Observable<ScientificJobView[]> => of([])),
      downloadMolarFractionsCsvReport: vi.fn(),
      downloadMolarFractionsLogReport: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        MolarFractionsWorkflowService,
        {
          provide: JobsApiService,
          useValue: jobsApiServiceMock,
        },
      ],
    });

    workflowService = TestBed.inject(MolarFractionsWorkflowService);
  });

  it('dispatches range job and stores completed table result', () => {
    workflowService.setPkaCount(3);
    workflowService.updatePkaValue(0, 2.2);
    workflowService.updatePkaValue(1, 7.2);
    workflowService.updatePkaValue(2, 12.3);
    workflowService.phMode.set('range');
    workflowService.phMin.set(0);
    workflowService.phMax.set(14);
    workflowService.phStep.set(1);

    workflowService.dispatch();

    expect(jobsApiServiceMock.dispatchMolarFractionsJob).toHaveBeenCalledWith({
      pkaValues: [2.2, 7.2, 12.3],
      phMode: 'range',
      phMin: 0,
      phMax: 14,
      phStep: 1,
    });

    expect(workflowService.activeSection()).toBe('result');
    expect(workflowService.resultData()?.speciesLabels).toEqual(['f0', 'f1', 'f2', 'f3']);
    expect(workflowService.resultData()?.rows.length).toBe(1);
  });

  it('opens historical running job as summary when final payload is missing', () => {
    jobsApiServiceMock.getScientificJobStatus.mockReturnValue(
      of(
        makeScientificJob({
          id: 'molar-running-1',
          status: 'running',
          results: null,
          parameters: {
            pka_values: [2.2, 7.2],
            ph_mode: 'single',
            ph_value: 7,
          },
        }),
      ),
    );

    workflowService.openHistoricalJob('molar-running-1');

    expect(workflowService.activeSection()).toBe('result');
    expect(workflowService.resultData()?.isHistoricalSummary).toBe(true);
    expect(workflowService.resultData()?.metadata.totalSpecies).toBe(3);
  });

  it('keeps error section when historical payload cannot be reconstructed', () => {
    jobsApiServiceMock.getScientificJobStatus.mockReturnValue(
      of(
        makeScientificJob({
          id: 'molar-broken-1',
          status: 'running',
          results: null,
          parameters: null,
        }),
      ),
    );

    workflowService.openHistoricalJob('molar-broken-1');

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('reconstruct');
  });

  it('requests CSV export from backend for current job', () => {
    const csvFile: DownloadedReportFile = {
      filename: 'molar_fractions_job-report.csv',
      blob: new Blob(['ph,f0,sum_fraction'], { type: 'text/csv' }),
    };
    jobsApiServiceMock.downloadMolarFractionsCsvReport.mockReturnValue(of(csvFile));

    workflowService.currentJobId.set('molar-export-csv-1');

    workflowService.downloadCsvReport().subscribe((downloadedFile: DownloadedReportFile) => {
      expect(downloadedFile.filename).toBe('molar_fractions_job-report.csv');
    });

    expect(jobsApiServiceMock.downloadMolarFractionsCsvReport).toHaveBeenCalledWith(
      'molar-export-csv-1',
    );
  });

  it('requests LOG export from backend for current job', () => {
    const logFile: DownloadedReportFile = {
      filename: 'molar_fractions_job-report.log',
      blob: new Blob(['log-content'], { type: 'text/plain' }),
    };
    jobsApiServiceMock.downloadMolarFractionsLogReport.mockReturnValue(of(logFile));

    workflowService.currentJobId.set('molar-export-log-1');

    workflowService.downloadLogReport().subscribe((downloadedFile: DownloadedReportFile) => {
      expect(downloadedFile.filename).toBe('molar_fractions_job-report.log');
    });

    expect(jobsApiServiceMock.downloadMolarFractionsLogReport).toHaveBeenCalledWith(
      'molar-export-log-1',
    );
  });

  it('falls back to polling, de-duplicates streamed logs and resolves the final molar fractions result', () => {
    const progressEvents$ = new Subject<{ progress_percentage: number; progress_message: string }>();
    const logEvents$ = new Subject<{
      eventIndex: number;
      level: 'info' | 'warning' | 'error' | 'debug';
      message: string;
      createdAt: string;
    }>();

    jobsApiServiceMock.dispatchMolarFractionsJob.mockReturnValue(
      of(makeScientificJob({ id: 'molar-progress-1', status: 'running', results: null })),
    );
    jobsApiServiceMock.streamJobEvents.mockReturnValue(progressEvents$.asObservable());
    jobsApiServiceMock.streamJobLogEvents.mockReturnValue(logEvents$.asObservable());
    jobsApiServiceMock.pollJobUntilCompleted.mockReturnValue(
      of({ progress_percentage: 100, progress_message: 'Completed by polling' }),
    );
    jobsApiServiceMock.getScientificJobStatus.mockReturnValue(
      of(makeScientificJob({ id: 'molar-progress-1' })),
    );

    workflowService.dispatch();

    logEvents$.next({ eventIndex: 2, level: 'info', message: 'second', createdAt: new Date().toISOString() });
    logEvents$.next({ eventIndex: 1, level: 'debug', message: 'first', createdAt: new Date().toISOString() });
    logEvents$.next({ eventIndex: 2, level: 'info', message: 'duplicate', createdAt: new Date().toISOString() });

    expect(workflowService.jobLogs().map((entry) => entry.eventIndex)).toEqual([1, 2]);

    progressEvents$.error(new Error('sse offline'));

    expect(jobsApiServiceMock.pollJobUntilCompleted).toHaveBeenCalledWith('molar-progress-1', 1000);
    expect(workflowService.activeSection()).toBe('result');
    expect(workflowService.resultData()?.rows).toHaveLength(1);
    expect(workflowService.progressPercentage()).toBe(100);
  });

  it('surfaces final result retrieval errors after molar fractions progress completes', () => {
    const progressEvents$ = new Subject<{ progress_percentage: number; progress_message: string }>();

    jobsApiServiceMock.dispatchMolarFractionsJob.mockReturnValue(
      of(makeScientificJob({ id: 'molar-progress-error-1', status: 'running', results: null })),
    );
    jobsApiServiceMock.streamJobEvents.mockReturnValue(progressEvents$.asObservable());
    jobsApiServiceMock.streamJobLogEvents.mockReturnValue(of());
    jobsApiServiceMock.getScientificJobStatus.mockReturnValue(
      throwError(() => new Error('gateway timeout')),
    );

    workflowService.dispatch();
    progressEvents$.complete();

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toBe('Unable to get final result: gateway timeout');
  });
});
