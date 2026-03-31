// sa-score-workflow.service.spec.ts: Pruebas unitarias del workflow SA Score.

import { TestBed } from '@angular/core/testing';
import { Observable, Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import {
  DownloadedReportFile,
  JobLogsPageView,
  JobsApiService,
  SaScoreJobResponseView,
  SaScoreMethod,
  ScientificJobView,
  SmilesCompatibilityResultView,
} from '../api/jobs-api.service';
import { SaScoreWorkflowService } from './sa-score-workflow.service';

function makeScientificJob(overrides: Partial<ScientificJobView> = {}): ScientificJobView {
  return {
    id: 'sa-history-job-1',
    job_hash: 'hash-1',
    plugin_name: 'sa-score',
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
      smiles_list: ['CCO'],
      methods: ['ambit'],
    },
    results: {
      molecules: [
        {
          smiles: 'CCO',
          ambit_sa: 92.3,
          brsa_sa: null,
          rdkit_sa: null,
          ambit_error: null,
          brsa_error: null,
          rdkit_error: null,
        },
      ],
      total: 1,
      requested_methods: ['ambit'],
    },
    error_trace: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeSaScoreJobResponse(
  overrides: Partial<SaScoreJobResponseView> = {},
): SaScoreJobResponseView {
  return {
    id: 'sa-job-1',
    status: 'completed',
    progress_percentage: 100,
    progress_stage: 'completed',
    progress_message: 'Completed',
    parameters: {
      smiles_list: ['CCO'],
      methods: ['ambit'],
    },
    results: {
      molecules: [
        {
          smiles: 'CCO',
          ambit_sa: 92.3,
          brsa_sa: null,
          rdkit_sa: null,
          ambit_error: null,
          brsa_error: null,
          rdkit_error: null,
        },
      ],
      total: 1,
      requested_methods: ['ambit'],
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeRunningSaScoreJobResponse(jobId: string): SaScoreJobResponseView {
  return makeSaScoreJobResponse({
    id: jobId,
    status: 'running',
    results: undefined,
  });
}

describe('SaScoreWorkflowService', () => {
  let workflowService: SaScoreWorkflowService;
  const emptyLogsPage: JobLogsPageView = {
    jobId: 'sa-job-1',
    count: 0,
    nextAfterEventIndex: 0,
    results: [],
  };

  let jobsApiServiceMock: {
    dispatchSaScoreJob: ReturnType<typeof vi.fn>;
    streamJobEvents: ReturnType<typeof vi.fn>;
    streamJobLogEvents: ReturnType<typeof vi.fn>;
    pollJobUntilCompleted: ReturnType<typeof vi.fn>;
    getSaScoreJobStatus: ReturnType<typeof vi.fn>;
    getJobLogs: ReturnType<typeof vi.fn>;
    listJobs: ReturnType<typeof vi.fn>;
    validateSmilesCompatibility: ReturnType<typeof vi.fn>;
    downloadSaScoreCsvReport: ReturnType<typeof vi.fn>;
    downloadSaScoreCsvMethodReport: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    jobsApiServiceMock = {
      dispatchSaScoreJob: vi.fn(
        (): Observable<SaScoreJobResponseView> => of(makeSaScoreJobResponse()),
      ),
      streamJobEvents: vi.fn(),
      streamJobLogEvents: vi.fn(),
      pollJobUntilCompleted: vi.fn(),
      getSaScoreJobStatus: vi.fn(
        (): Observable<SaScoreJobResponseView> => of(makeSaScoreJobResponse()),
      ),
      getJobLogs: vi.fn((): Observable<JobLogsPageView> => of(emptyLogsPage)),
      listJobs: vi.fn((): Observable<ScientificJobView[]> => of([makeScientificJob()])),
      validateSmilesCompatibility: vi.fn(
        (): Observable<SmilesCompatibilityResultView> => of({ compatible: true, issues: [] }),
      ),
      downloadSaScoreCsvReport: vi.fn(),
      downloadSaScoreCsvMethodReport: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        SaScoreWorkflowService,
        {
          provide: JobsApiService,
          useValue: jobsApiServiceMock,
        },
      ],
    });

    workflowService = TestBed.inject(SaScoreWorkflowService);
  });

  it('dispatches SA score job when smiles are compatible', () => {
    workflowService.smilesInput.set('CCO');
    workflowService.selectedMethods.set({ ambit: true, brsa: false, rdkit: false });

    workflowService.dispatch();

    expect(jobsApiServiceMock.validateSmilesCompatibility).toHaveBeenCalledWith(['CCO']);
    expect(jobsApiServiceMock.dispatchSaScoreJob).toHaveBeenCalledWith({
      smiles: ['CCO'],
      methods: ['ambit'],
      version: '1.0.0',
    });
    expect(workflowService.activeSection()).toBe('result');
    expect(workflowService.resultData()?.total).toBe(1);
  });

  it('blocks dispatch when a smiles is incompatible', () => {
    jobsApiServiceMock.validateSmilesCompatibility.mockReturnValue(
      of({
        compatible: false,
        issues: [{ smiles: 'not_a_smiles', reason: 'Unsupported SMILES' }],
      }),
    );
    workflowService.smilesInput.set('CCO\nnot_a_smiles');

    workflowService.dispatch();

    expect(jobsApiServiceMock.dispatchSaScoreJob).not.toHaveBeenCalled();
    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('not_a_smiles');
  });

  it('blocks dispatch when no methods are enabled', () => {
    workflowService.smilesInput.set('CCO');
    workflowService.selectedMethods.set({ ambit: false, brsa: false, rdkit: false });

    workflowService.dispatch();

    expect(jobsApiServiceMock.validateSmilesCompatibility).not.toHaveBeenCalled();
    expect(jobsApiServiceMock.dispatchSaScoreJob).not.toHaveBeenCalled();
    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('Select at least one SA method');
  });

  it('toggles methods and updates selectedMethodList', () => {
    expect(workflowService.selectedMethodList()).toEqual(['ambit', 'brsa', 'rdkit']);

    workflowService.toggleMethod('brsa');
    workflowService.toggleMethod('rdkit');

    expect(workflowService.selectedMethodList()).toEqual(['ambit']);
  });

  it('surfaces validation transport errors', () => {
    jobsApiServiceMock.validateSmilesCompatibility.mockReturnValue(
      new Observable<SmilesCompatibilityResultView>((subscriber) => {
        subscriber.error(new Error('validator unavailable'));
      }),
    );
    workflowService.smilesInput.set('CCO');

    workflowService.dispatch();

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('validator unavailable');
  });

  it('opens historical failed job and exposes generic error state', () => {
    jobsApiServiceMock.getSaScoreJobStatus.mockReturnValue(
      of(
        makeSaScoreJobResponse({
          id: 'sa-failed-1',
          status: 'failed',
        }),
      ),
    );

    workflowService.openHistoricalJob('sa-failed-1');

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('Historical job ended with error.');
  });

  it('loads history ordered by updated_at descending', () => {
    jobsApiServiceMock.listJobs.mockReturnValue(
      of([
        makeScientificJob({ id: 'old', updated_at: '2026-03-01T10:00:00.000Z' }),
        makeScientificJob({ id: 'new', updated_at: '2026-03-02T10:00:00.000Z' }),
      ]),
    );

    workflowService.loadHistory();

    expect(workflowService.historyJobs()[0]?.id).toBe('new');
    expect(workflowService.historyJobs()[1]?.id).toBe('old');
  });

  it('downloads full CSV report for selected job', () => {
    const csvFile: DownloadedReportFile = {
      filename: 'sa-score-report.csv',
      blob: new Blob(['smiles,ambit_sa'], { type: 'text/csv' }),
    };
    jobsApiServiceMock.downloadSaScoreCsvReport.mockReturnValue(of(csvFile));
    workflowService.currentJobId.set('sa-export-1');

    workflowService.downloadFullCsvReport().subscribe((downloadedFile: DownloadedReportFile) => {
      expect(downloadedFile.filename).toBe('sa-score-report.csv');
    });

    expect(jobsApiServiceMock.downloadSaScoreCsvReport).toHaveBeenCalledWith('sa-export-1');
  });

  it('downloads method CSV report for selected job', () => {
    const csvFile: DownloadedReportFile = {
      filename: 'sa-score-ambit.csv',
      blob: new Blob(['smiles,ambit_sa'], { type: 'text/csv' }),
    };
    jobsApiServiceMock.downloadSaScoreCsvMethodReport.mockReturnValue(of(csvFile));
    workflowService.currentJobId.set('sa-export-2');

    workflowService
      .downloadMethodCsvReport('ambit')
      .subscribe((downloadedFile: DownloadedReportFile) => {
        expect(downloadedFile.filename).toBe('sa-score-ambit.csv');
      });

    expect(jobsApiServiceMock.downloadSaScoreCsvMethodReport).toHaveBeenCalledWith(
      'sa-export-2',
      'ambit' satisfies SaScoreMethod,
    );
  });

  it('stores export error when method CSV download fails', () => {
    jobsApiServiceMock.downloadSaScoreCsvMethodReport.mockReturnValue(
      new Observable<DownloadedReportFile>((subscriber) => {
        subscriber.error(new Error('csv forbidden'));
      }),
    );
    workflowService.currentJobId.set('sa-export-3');

    workflowService.downloadMethodCsvReport('rdkit').subscribe({
      error: () => {
        expect(workflowService.exportErrorMessage()).toContain('RDKIT CSV report');
        expect(workflowService.exportErrorMessage()).toContain('csv forbidden');
        expect(workflowService.isExporting()).toBe(false);
      },
    });
  });

  it('keeps error section when smiles input is empty', () => {
    workflowService.smilesInput.set('  \n\t ');

    workflowService.dispatch();

    expect(jobsApiServiceMock.validateSmilesCompatibility).not.toHaveBeenCalled();
    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toBe('At least one SMILES is required.');
  });

  it('falls back to polling, de-duplicates logs and resolves the final SA score result', () => {
    const progressEvents$ = new Subject<{ progress_percentage: number; progress_message: string }>();
    const logEvents$ = new Subject<{
      eventIndex: number;
      level: 'info' | 'warning' | 'error' | 'debug';
      message: string;
      createdAt: string;
    }>();

    jobsApiServiceMock.dispatchSaScoreJob.mockReturnValue(
      of(makeRunningSaScoreJobResponse('sa-progress-1')),
    );
    jobsApiServiceMock.streamJobEvents.mockReturnValue(progressEvents$.asObservable());
    jobsApiServiceMock.streamJobLogEvents.mockReturnValue(logEvents$.asObservable());
    jobsApiServiceMock.pollJobUntilCompleted.mockReturnValue(of({ progress_percentage: 100 }));
    jobsApiServiceMock.getSaScoreJobStatus.mockReturnValue(
      of(makeSaScoreJobResponse({ id: 'sa-progress-1' })),
    );
    workflowService.smilesInput.set('CCO');
    workflowService.selectedMethods.set({ ambit: true, brsa: false, rdkit: false });

    workflowService.dispatch();

    logEvents$.next({ eventIndex: 2, level: 'info', message: 'second', createdAt: new Date().toISOString() });
    logEvents$.next({ eventIndex: 1, level: 'debug', message: 'first', createdAt: new Date().toISOString() });
    logEvents$.next({ eventIndex: 2, level: 'info', message: 'duplicate', createdAt: new Date().toISOString() });
    expect(workflowService.jobLogs().map((entry) => entry.eventIndex)).toEqual([1, 2]);

    progressEvents$.error(new Error('sse offline'));

    expect(jobsApiServiceMock.pollJobUntilCompleted).toHaveBeenCalledWith('sa-progress-1');
    expect(workflowService.activeSection()).toBe('result');
    expect(workflowService.resultData()?.total).toBe(1);
  });

  it('surfaces final SA score retrieval errors after progress completes', () => {
    const progressEvents$ = new Subject<{ progress_percentage: number; progress_message: string }>();

    jobsApiServiceMock.dispatchSaScoreJob.mockReturnValue(
      of(makeRunningSaScoreJobResponse('sa-progress-error-1')),
    );
    jobsApiServiceMock.streamJobEvents.mockReturnValue(progressEvents$.asObservable());
    jobsApiServiceMock.streamJobLogEvents.mockReturnValue(of());
    jobsApiServiceMock.getSaScoreJobStatus.mockReturnValue(
      throwError(() => new Error('gateway timeout')),
    );
    workflowService.smilesInput.set('CCO');
    workflowService.selectedMethods.set({ ambit: true, brsa: false, rdkit: false });

    workflowService.dispatch();
    progressEvents$.complete();

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toBe(
      'Unable to retrieve final SA score result: gateway timeout',
    );
  });
});
