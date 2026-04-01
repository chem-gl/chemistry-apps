// marcus-workflow.service.spec.ts: Pruebas unitarias del workflow Marcus.
// Cubre validaciones de archivos, despacho, fallback de progreso, historial y descargas.

import { TestBed } from '@angular/core/testing';
import { Observable, Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import {
  DownloadedReportFile,
  JobLogEntryView,
  JobLogsPageView,
  JobProgressSnapshotView,
  JobsApiService,
  MarcusJobResponseView,
  ScientificJobView,
} from '../api/jobs-api.service';
import { MarcusWorkflowService } from './marcus-workflow.service';

function createGaussianFile(filename: string): File {
  return new File(['gaussian-log'], filename, { type: 'text/plain' });
}

function makeScientificJob(overrides: Partial<ScientificJobView> = {}): ScientificJobView {
  return {
    id: 'marcus-history-1',
    job_hash: 'hash-1',
    plugin_name: 'marcus',
    algorithm_version: '1.0.0',
    status: 'completed',
    cache_hit: false,
    cache_miss: true,
    progress_percentage: 100,
    progress_stage: 'completed',
    progress_message: 'Completed',
    progress_event_index: 10,
    supports_pause_resume: false,
    pause_requested: false,
    runtime_state: {},
    paused_at: null,
    resumed_at: null,
    parameters: {
      title: 'Marcus Test',
      diffusion: false,
      radius_reactant1: null,
      radius_reactant2: null,
      reaction_distance: null,
      file_descriptors: [],
    },
    results: null,
    error_trace: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeMarcusJobResponse(
  overrides: Partial<MarcusJobResponseView> = {},
): MarcusJobResponseView {
  return {
    id: 'marcus-job-1',
    status: 'completed',
    progress_percentage: 100,
    progress_stage: 'completed',
    progress_message: 'Completed',
    parameters: {
      title: 'Marcus Test',
      diffusion: false,
      radius_reactant1: null,
      radius_reactant2: null,
      reaction_distance: null,
      file_descriptors: [
        {
          field_name: 'reactant1_file',
          original_filename: 'reactant-1.log',
          size_bytes: 123,
          sha256: 'abc',
          content_type: 'text/plain',
        },
      ],
    },
    results: {
      title: 'Marcus Test',
      adiabatic_energy_kcal_mol: 5,
      adiabatic_energy_corrected_kcal_mol: 5.1,
      vertical_energy_kcal_mol: 6,
      reorganization_energy_kcal_mol: 2,
      barrier_kcal_mol: 1.2,
      rate_constant_tst: 7,
      rate_constant: 8,
      k_diff: null,
      diffusion_applied: false,
      temperature_k: 298.15,
      viscosity_pa_s: null,
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as MarcusJobResponseView;
}

describe('MarcusWorkflowService', () => {
  let workflowService: MarcusWorkflowService;

  const emptyLogsPage: JobLogsPageView = {
    jobId: 'marcus-job-1',
    count: 0,
    nextAfterEventIndex: 0,
    results: [],
  };

  let jobsApiServiceMock: {
    dispatchMarcusJob: ReturnType<typeof vi.fn>;
    streamJobEvents: ReturnType<typeof vi.fn>;
    streamJobLogEvents: ReturnType<typeof vi.fn>;
    pollJobUntilCompleted: ReturnType<typeof vi.fn>;
    getMarcusJobStatus: ReturnType<typeof vi.fn>;
    getJobLogs: ReturnType<typeof vi.fn>;
    listJobs: ReturnType<typeof vi.fn>;
    downloadMarcusCsvReport: ReturnType<typeof vi.fn>;
    downloadMarcusLogReport: ReturnType<typeof vi.fn>;
    downloadMarcusErrorReport: ReturnType<typeof vi.fn>;
    downloadMarcusInputsZip: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    jobsApiServiceMock = {
      dispatchMarcusJob: vi.fn(
        (): Observable<MarcusJobResponseView> => of(makeMarcusJobResponse()),
      ),
      streamJobEvents: vi.fn(),
      streamJobLogEvents: vi.fn(),
      pollJobUntilCompleted: vi.fn(),
      getMarcusJobStatus: vi.fn(
        (): Observable<MarcusJobResponseView> => of(makeMarcusJobResponse()),
      ),
      getJobLogs: vi.fn((): Observable<JobLogsPageView> => of(emptyLogsPage)),
      listJobs: vi.fn((): Observable<ScientificJobView[]> => of([makeScientificJob()])),
      downloadMarcusCsvReport: vi.fn(),
      downloadMarcusLogReport: vi.fn(),
      downloadMarcusErrorReport: vi.fn(),
      downloadMarcusInputsZip: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        MarcusWorkflowService,
        {
          provide: JobsApiService,
          useValue: jobsApiServiceMock,
        },
      ],
    });

    workflowService = TestBed.inject(MarcusWorkflowService);
  });

  it('blocks dispatch when any required file is missing', () => {
    workflowService.dispatch();

    expect(jobsApiServiceMock.dispatchMarcusJob).not.toHaveBeenCalled();
    expect(workflowService.activeSection()).toBe('idle');
    expect(workflowService.errorMessage()).toContain('All six Gaussian files are required');
  });

  it('clears diffusion numeric inputs when diffusion gets disabled', () => {
    workflowService.updateDiffusion(true);
    workflowService.updateRadiusReactant1(1.4);
    workflowService.updateRadiusReactant2(1.5);
    workflowService.updateReactionDistance(3);

    workflowService.updateDiffusion(false);

    expect(workflowService.showDiffusionFields()).toBe(false);
    expect(workflowService.radiusReactant1()).toBeNull();
    expect(workflowService.radiusReactant2()).toBeNull();
    expect(workflowService.reactionDistance()).toBeNull();
  });

  it('dispatches job and resolves immediate completed result', () => {
    workflowService.updateReactant1File(createGaussianFile('r1.log'));
    workflowService.updateReactant2File(createGaussianFile('r2.log'));
    workflowService.updateProduct1AdiabaticFile(createGaussianFile('p1a.log'));
    workflowService.updateProduct2AdiabaticFile(createGaussianFile('p2a.log'));
    workflowService.updateProduct1VerticalFile(createGaussianFile('p1v.log'));
    workflowService.updateProduct2VerticalFile(createGaussianFile('p2v.log'));

    workflowService.dispatch();

    expect(jobsApiServiceMock.dispatchMarcusJob).toHaveBeenCalledTimes(1);
    expect(workflowService.activeSection()).toBe('result');
    expect(workflowService.resultData()?.title).toBe('Marcus Test');
    expect(workflowService.currentJobId()).toBe('marcus-job-1');
  });

  it('falls back to polling when progress stream fails', () => {
    const pollingResult$ = new Subject<JobProgressSnapshotView>();
    const logs$ = new Subject<JobLogEntryView>();

    jobsApiServiceMock.dispatchMarcusJob.mockReturnValue(
      of(
        makeMarcusJobResponse({
          id: 'marcus-job-running',
          status: 'running',
          results: undefined,
        }),
      ),
    );
    jobsApiServiceMock.streamJobEvents.mockReturnValue(
      throwError(() => new Error('sse unavailable')),
    );
    jobsApiServiceMock.streamJobLogEvents.mockReturnValue(logs$.asObservable());
    jobsApiServiceMock.pollJobUntilCompleted.mockReturnValue(pollingResult$.asObservable());

    workflowService.updateReactant1File(createGaussianFile('r1.log'));
    workflowService.updateReactant2File(createGaussianFile('r2.log'));
    workflowService.updateProduct1AdiabaticFile(createGaussianFile('p1a.log'));
    workflowService.updateProduct2AdiabaticFile(createGaussianFile('p2a.log'));
    workflowService.updateProduct1VerticalFile(createGaussianFile('p1v.log'));
    workflowService.updateProduct2VerticalFile(createGaussianFile('p2v.log'));
    workflowService.dispatch();

    pollingResult$.next({
      job_id: 'marcus-job-running',
      status: 'completed',
      progress_percentage: 100,
      progress_stage: 'completed',
      progress_message: 'done',
      progress_event_index: 9,
      updated_at: new Date().toISOString(),
    });

    expect(jobsApiServiceMock.pollJobUntilCompleted).toHaveBeenCalledWith(
      'marcus-job-running',
      1000,
    );
    expect(jobsApiServiceMock.getMarcusJobStatus).toHaveBeenCalledWith('marcus-job-running');
    expect(workflowService.activeSection()).toBe('result');
  });

  it('de-duplicates log entries by eventIndex when streaming logs', () => {
    const progress$ = new Subject<JobProgressSnapshotView>();
    const logs$ = new Subject<JobLogEntryView>();

    jobsApiServiceMock.dispatchMarcusJob.mockReturnValue(
      of(
        makeMarcusJobResponse({
          id: 'marcus-job-logs',
          status: 'running',
          results: undefined,
        }),
      ),
    );
    jobsApiServiceMock.streamJobEvents.mockReturnValue(progress$.asObservable());
    jobsApiServiceMock.streamJobLogEvents.mockReturnValue(logs$.asObservable());

    workflowService.updateReactant1File(createGaussianFile('r1.log'));
    workflowService.updateReactant2File(createGaussianFile('r2.log'));
    workflowService.updateProduct1AdiabaticFile(createGaussianFile('p1a.log'));
    workflowService.updateProduct2AdiabaticFile(createGaussianFile('p2a.log'));
    workflowService.updateProduct1VerticalFile(createGaussianFile('p1v.log'));
    workflowService.updateProduct2VerticalFile(createGaussianFile('p2v.log'));
    workflowService.dispatch();

    logs$.next({
      jobId: 'marcus-job-logs',
      eventIndex: 1,
      level: 'info',
      message: 'one',
      source: 'runtime',
      payload: {},
      createdAt: new Date().toISOString(),
    });
    logs$.next({
      jobId: 'marcus-job-logs',
      eventIndex: 1,
      level: 'info',
      message: 'one-dup',
      source: 'runtime',
      payload: {},
      createdAt: new Date().toISOString(),
    });

    expect(workflowService.jobLogs().length).toBe(1);
    expect(workflowService.jobLogs()[0]?.message).toBe('one');
  });

  it('opens failed historical job and surfaces persisted error trace', () => {
    jobsApiServiceMock.getMarcusJobStatus.mockReturnValue(
      of(
        makeMarcusJobResponse({
          id: 'failed-job',
          status: 'failed',
          error_trace: 'trace detail',
          results: undefined,
        }),
      ),
    );

    workflowService.openHistoricalJob('failed-job');

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('trace detail');
  });

  it('sorts history jobs by updated_at descending', () => {
    jobsApiServiceMock.listJobs.mockReturnValue(
      of([
        makeScientificJob({ id: 'older', updated_at: '2026-03-01T10:00:00.000Z' }),
        makeScientificJob({ id: 'newer', updated_at: '2026-03-02T10:00:00.000Z' }),
      ]),
    );

    workflowService.loadHistory();

    expect(workflowService.historyJobs()[0]?.id).toBe('newer');
    expect(workflowService.historyJobs()[1]?.id).toBe('older');
  });

  it('throws when requesting download without current job id', () => {
    expect(() => workflowService.downloadCsvReport()).toThrowError('No job selected for download.');
  });

  it('stores export error when download endpoint fails', () => {
    jobsApiServiceMock.downloadMarcusCsvReport.mockReturnValue(
      throwError(() => new Error('forbidden export')),
    );
    workflowService.currentJobId.set('marcus-export-1');

    workflowService.downloadCsvReport().subscribe({
      error: () => {
        expect(workflowService.exportErrorMessage()).toContain('Unable to download CSV');
        expect(workflowService.exportErrorMessage()).toContain('forbidden export');
        expect(workflowService.isExporting()).toBe(false);
      },
    });
  });

  it('resets volatile state without clearing selected files', () => {
    workflowService.updateReactant1File(createGaussianFile('r1.log'));
    workflowService.activeSection.set('progress');
    workflowService.currentJobId.set('job-x');
    workflowService.errorMessage.set('old error');

    workflowService.reset();

    expect(workflowService.activeSection()).toBe('idle');
    expect(workflowService.currentJobId()).toBeNull();
    expect(workflowService.errorMessage()).toBeNull();
    expect(workflowService.reactant1File()).not.toBeNull();
  });

  it('clears every input file when clearFiles is requested', () => {
    workflowService.updateReactant1File(createGaussianFile('r1.log'));
    workflowService.updateReactant2File(createGaussianFile('r2.log'));
    workflowService.updateProduct1AdiabaticFile(createGaussianFile('p1a.log'));
    workflowService.updateProduct2AdiabaticFile(createGaussianFile('p2a.log'));
    workflowService.updateProduct1VerticalFile(createGaussianFile('p1v.log'));
    workflowService.updateProduct2VerticalFile(createGaussianFile('p2v.log'));

    workflowService.clearFiles();

    expect(workflowService.reactant1File()).toBeNull();
    expect(workflowService.reactant2File()).toBeNull();
    expect(workflowService.product1AdiabaticFile()).toBeNull();
    expect(workflowService.product2AdiabaticFile()).toBeNull();
    expect(workflowService.product1VerticalFile()).toBeNull();
    expect(workflowService.product2VerticalFile()).toBeNull();
  });

  it('downloads CSV report for selected job', () => {
    const csvFile: DownloadedReportFile = {
      filename: 'marcus-report.csv',
      blob: new Blob(['a,b'], { type: 'text/csv' }),
    };
    jobsApiServiceMock.downloadMarcusCsvReport.mockReturnValue(of(csvFile));
    workflowService.currentJobId.set('marcus-job-1');

    workflowService.downloadCsvReport().subscribe((downloadedFile: DownloadedReportFile) => {
      expect(downloadedFile.filename).toBe('marcus-report.csv');
    });

    expect(jobsApiServiceMock.downloadMarcusCsvReport).toHaveBeenCalledWith('marcus-job-1');
  });

  it('downloads log, error and inputs zip reports for selected job', () => {
    jobsApiServiceMock.downloadMarcusLogReport.mockReturnValue(
      of({ filename: 'marcus.log', blob: new Blob(['log']) }),
    );
    jobsApiServiceMock.downloadMarcusErrorReport.mockReturnValue(
      of({ filename: 'marcus.err', blob: new Blob(['err']) }),
    );
    jobsApiServiceMock.downloadMarcusInputsZip.mockReturnValue(
      of({ filename: 'marcus-inputs.zip', blob: new Blob(['zip']) }),
    );
    workflowService.currentJobId.set('marcus-job-downloads-1');

    workflowService.downloadLogReport().subscribe((downloadedFile: DownloadedReportFile) => {
      expect(downloadedFile.filename).toBe('marcus.log');
    });
    workflowService.downloadErrorReport().subscribe((downloadedFile: DownloadedReportFile) => {
      expect(downloadedFile.filename).toBe('marcus.err');
    });
    workflowService.downloadInputsZip().subscribe((downloadedFile: DownloadedReportFile) => {
      expect(downloadedFile.filename).toBe('marcus-inputs.zip');
    });

    expect(jobsApiServiceMock.downloadMarcusLogReport).toHaveBeenCalledWith(
      'marcus-job-downloads-1',
    );
    expect(jobsApiServiceMock.downloadMarcusErrorReport).toHaveBeenCalledWith(
      'marcus-job-downloads-1',
    );
    expect(jobsApiServiceMock.downloadMarcusInputsZip).toHaveBeenCalledWith(
      'marcus-job-downloads-1',
    );
  });

  it('shows dispatch error when backend cannot create Marcus job', () => {
    jobsApiServiceMock.dispatchMarcusJob.mockReturnValueOnce(
      throwError(() => new Error('dispatch blocked')),
    );

    workflowService.updateReactant1File(createGaussianFile('r1.log'));
    workflowService.updateReactant2File(createGaussianFile('r2.log'));
    workflowService.updateProduct1AdiabaticFile(createGaussianFile('p1a.log'));
    workflowService.updateProduct2AdiabaticFile(createGaussianFile('p2a.log'));
    workflowService.updateProduct1VerticalFile(createGaussianFile('p1v.log'));
    workflowService.updateProduct2VerticalFile(createGaussianFile('p2v.log'));
    workflowService.dispatch();

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('dispatch blocked');
  });

  it('shows polling fallback error when Marcus progress cannot be tracked', () => {
    jobsApiServiceMock.dispatchMarcusJob.mockReturnValueOnce(
      of(
        makeMarcusJobResponse({
          id: 'marcus-poll-fail-1',
          status: 'running',
          results: undefined,
        }),
      ),
    );
    jobsApiServiceMock.streamJobEvents.mockReturnValueOnce(
      throwError(() => new Error('sse unavailable')),
    );
    jobsApiServiceMock.streamJobLogEvents.mockReturnValueOnce(of());
    jobsApiServiceMock.pollJobUntilCompleted.mockReturnValueOnce(
      throwError(() => new Error('polling unavailable')),
    );

    workflowService.updateReactant1File(createGaussianFile('r1.log'));
    workflowService.updateReactant2File(createGaussianFile('r2.log'));
    workflowService.updateProduct1AdiabaticFile(createGaussianFile('p1a.log'));
    workflowService.updateProduct2AdiabaticFile(createGaussianFile('p2a.log'));
    workflowService.updateProduct1VerticalFile(createGaussianFile('p1v.log'));
    workflowService.updateProduct2VerticalFile(createGaussianFile('p2v.log'));
    workflowService.dispatch();

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('Unable to track Marcus job progress');
  });

  it('handles historical paused and cancelled summaries plus recover error', () => {
    jobsApiServiceMock.getMarcusJobStatus.mockReturnValueOnce(
      of(
        makeMarcusJobResponse({
          id: 'marcus-paused-1',
          status: 'paused',
          results: undefined,
        }),
      ),
    );
    workflowService.openHistoricalJob('marcus-paused-1');
    expect(workflowService.resultData()?.summaryMessage).toBe(
      'Historical summary: this job is paused.',
    );

    jobsApiServiceMock.getMarcusJobStatus.mockReturnValueOnce(
      of(
        makeMarcusJobResponse({
          id: 'marcus-cancelled-1',
          status: 'cancelled',
          results: undefined,
        }),
      ),
    );
    workflowService.openHistoricalJob('marcus-cancelled-1');
    expect(workflowService.resultData()?.summaryMessage).toBe(
      'Historical summary: no final result payload was available.',
    );

    jobsApiServiceMock.getMarcusJobStatus.mockReturnValueOnce(
      throwError(() => new Error('historical timeout')),
    );
    workflowService.openHistoricalJob('marcus-recover-error-1');
    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('historical timeout');
  });

  it('keeps history loading flag consistent when list request fails', () => {
    jobsApiServiceMock.listJobs.mockReturnValueOnce(throwError(() => new Error('history down')));

    workflowService.loadHistory();

    expect(workflowService.isHistoryLoading()).toBe(false);
  });

  it('applies simple field updaters and lifecycle cleanup', () => {
    workflowService.updateTitle('Marcus From Spec');
    workflowService.updateDiffusion(true);
    workflowService.updateRadiusReactant1(1.1);
    workflowService.updateRadiusReactant2(1.2);
    workflowService.updateReactionDistance(2.1);

    expect(workflowService.title()).toBe('Marcus From Spec');
    expect(workflowService.showDiffusionFields()).toBe(true);
    expect(workflowService.radiusReactant1()).toBe(1.1);
    expect(workflowService.radiusReactant2()).toBe(1.2);
    expect(workflowService.reactionDistance()).toBe(2.1);
    expect(() => workflowService.ngOnDestroy()).not.toThrow();
  });

  it('computes canDispatch, isProcessing and progress message snapshots', () => {
    expect(workflowService.canDispatch()).toBe(false);

    workflowService.updateReactant1File(createGaussianFile('r1.log'));
    workflowService.updateReactant2File(createGaussianFile('r2.log'));
    workflowService.updateProduct1AdiabaticFile(createGaussianFile('p1a.log'));
    workflowService.updateProduct2AdiabaticFile(createGaussianFile('p2a.log'));
    workflowService.updateProduct1VerticalFile(createGaussianFile('p1v.log'));
    workflowService.updateProduct2VerticalFile(createGaussianFile('p2v.log'));

    expect(workflowService.canDispatch()).toBe(true);
    expect(workflowService.progressMessage()).toBe('Preparing Marcus job...');

    workflowService.activeSection.set('progress');
    workflowService.progressSnapshot.set({
      job_id: 'marcus-snapshot-1',
      status: 'running',
      progress_percentage: 55,
      progress_stage: 'running',
      progress_message: 'processing',
      progress_event_index: 5,
      updated_at: new Date().toISOString(),
    });

    expect(workflowService.isProcessing()).toBe(true);
    expect(workflowService.canDispatch()).toBe(false);
    expect(workflowService.progressPercentage()).toBe(55);
    expect(workflowService.progressMessage()).toBe('processing');
  });

  it('updates progress snapshots from SSE and resolves final result on completion', () => {
    const progress$ = new Subject<JobProgressSnapshotView>();

    jobsApiServiceMock.dispatchMarcusJob.mockReturnValueOnce(
      of(
        makeMarcusJobResponse({
          id: 'marcus-progress-complete-1',
          status: 'running',
          results: undefined,
        }),
      ),
    );
    jobsApiServiceMock.streamJobEvents.mockReturnValueOnce(progress$.asObservable());
    jobsApiServiceMock.streamJobLogEvents.mockReturnValueOnce(of());
    jobsApiServiceMock.getMarcusJobStatus.mockReturnValueOnce(
      of(makeMarcusJobResponse({ id: 'marcus-progress-complete-1', status: 'completed' })),
    );

    workflowService.updateReactant1File(createGaussianFile('r1.log'));
    workflowService.updateReactant2File(createGaussianFile('r2.log'));
    workflowService.updateProduct1AdiabaticFile(createGaussianFile('p1a.log'));
    workflowService.updateProduct2AdiabaticFile(createGaussianFile('p2a.log'));
    workflowService.updateProduct1VerticalFile(createGaussianFile('p1v.log'));
    workflowService.updateProduct2VerticalFile(createGaussianFile('p2v.log'));
    workflowService.dispatch();

    progress$.next({
      job_id: 'marcus-progress-complete-1',
      status: 'running',
      progress_percentage: 88,
      progress_stage: 'running',
      progress_message: 'almost done',
      progress_event_index: 8,
      updated_at: new Date().toISOString(),
    });
    expect(workflowService.progressPercentage()).toBe(88);

    progress$.complete();

    expect(workflowService.activeSection()).toBe('result');
    expect(workflowService.resultData()?.title).toBe('Marcus Test');
  });

  it('handles failed and unreachable final status retrieval branches', () => {
    const failedProgress$ = new Subject<JobProgressSnapshotView>();

    jobsApiServiceMock.dispatchMarcusJob.mockReturnValueOnce(
      of(
        makeMarcusJobResponse({
          id: 'marcus-final-failed-1',
          status: 'running',
          results: undefined,
        }),
      ),
    );
    jobsApiServiceMock.streamJobEvents.mockReturnValueOnce(failedProgress$.asObservable());
    jobsApiServiceMock.streamJobLogEvents.mockReturnValueOnce(of());
    jobsApiServiceMock.getMarcusJobStatus.mockReturnValueOnce(
      of(
        makeMarcusJobResponse({
          id: 'marcus-final-failed-1',
          status: 'failed',
          error_trace: 'final backend failure',
          results: undefined,
        }),
      ),
    );

    workflowService.updateReactant1File(createGaussianFile('r1.log'));
    workflowService.updateReactant2File(createGaussianFile('r2.log'));
    workflowService.updateProduct1AdiabaticFile(createGaussianFile('p1a.log'));
    workflowService.updateProduct2AdiabaticFile(createGaussianFile('p2a.log'));
    workflowService.updateProduct1VerticalFile(createGaussianFile('p1v.log'));
    workflowService.updateProduct2VerticalFile(createGaussianFile('p2v.log'));
    workflowService.dispatch();
    failedProgress$.complete();

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('final backend failure');

    const erroredProgress$ = new Subject<JobProgressSnapshotView>();
    jobsApiServiceMock.dispatchMarcusJob.mockReturnValueOnce(
      of(
        makeMarcusJobResponse({
          id: 'marcus-final-error-1',
          status: 'running',
          results: undefined,
        }),
      ),
    );
    jobsApiServiceMock.streamJobEvents.mockReturnValueOnce(erroredProgress$.asObservable());
    jobsApiServiceMock.streamJobLogEvents.mockReturnValueOnce(of());
    jobsApiServiceMock.getMarcusJobStatus.mockReturnValueOnce(
      throwError(() => new Error('final status timeout')),
    );

    workflowService.dispatch();
    erroredProgress$.complete();

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('Unable to get Marcus final result');
  });
});
