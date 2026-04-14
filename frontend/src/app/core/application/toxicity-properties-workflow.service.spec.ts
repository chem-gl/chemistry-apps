// toxicity-properties-workflow.service.spec.ts: Pruebas unitarias del workflow de Toxicity Properties.

import { TestBed } from '@angular/core/testing';
import { Observable, Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import {
  DownloadedReportFile,
  JobLogsPageView,
  JobsApiService,
  ScientificJobView,
  SmilesCompatibilityResultView,
  ToxicityJobResponseView,
} from '../api/jobs-api.service';
import { ToxicityPropertiesWorkflowService } from './toxicity-properties-workflow.service';

function makeScientificJob(overrides: Partial<ScientificJobView> = {}): ScientificJobView {
  return {
    id: 'tox-history-job-1',
    job_hash: 'hash-1',
    plugin_name: 'toxicity-properties',
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
      molecules: [{ name: 'CCO', smiles: 'CCO' }],
    },
    results: {
      molecules: [
        {
          name: 'CCO',
          smiles: 'CCO',
          LD50_mgkg: 430.2,
          mutagenicity: 'Negative',
          ames_score: 0.21,
          DevTox: 'Positive',
          devtox_score: 0.78,
          error_message: null,
        },
      ],
      total: 1,
      scientific_references: ['Ref A'],
    },
    error_trace: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as ScientificJobView;
}

function makeToxicityJobResponse(
  overrides: Partial<ToxicityJobResponseView> = {},
): ToxicityJobResponseView {
  return {
    id: 'tox-job-1',
    status: 'completed',
    progress_percentage: 100,
    progress_stage: 'completed',
    progress_message: 'Completed',
    parameters: {
      molecules: [{ name: 'CCO', smiles: 'CCO' }],
    },
    results: {
      molecules: [
        {
          name: 'CCO',
          smiles: 'CCO',
          LD50_mgkg: 430.2,
          mutagenicity: 'Negative',
          ames_score: 0.21,
          DevTox: 'Positive',
          devtox_score: 0.78,
          error_message: null,
        },
      ],
      total: 1,
      scientific_references: ['Ref A'],
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeRunningToxicityJobResponse(jobId: string): ToxicityJobResponseView {
  return makeToxicityJobResponse({
    id: jobId,
    status: 'running',
    results: undefined,
  });
}

describe('ToxicityPropertiesWorkflowService', () => {
  let workflowService: ToxicityPropertiesWorkflowService;
  const emptyLogsPage: JobLogsPageView = {
    jobId: 'tox-job-1',
    count: 0,
    nextAfterEventIndex: 0,
    results: [],
  };

  let jobsApiServiceMock: {
    dispatchToxicityPropertiesJob: ReturnType<typeof vi.fn>;
    streamJobEvents: ReturnType<typeof vi.fn>;
    streamJobLogEvents: ReturnType<typeof vi.fn>;
    pollJobUntilCompleted: ReturnType<typeof vi.fn>;
    getToxicityPropertiesJobStatus: ReturnType<typeof vi.fn>;
    getJobLogs: ReturnType<typeof vi.fn>;
    listJobs: ReturnType<typeof vi.fn>;
    downloadToxicityPropertiesCsvReport: ReturnType<typeof vi.fn>;
    validateSmilesCompatibility: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    jobsApiServiceMock = {
      dispatchToxicityPropertiesJob: vi.fn(
        (): Observable<ToxicityJobResponseView> => of(makeToxicityJobResponse()),
      ),
      streamJobEvents: vi.fn(),
      streamJobLogEvents: vi.fn(),
      pollJobUntilCompleted: vi.fn(),
      getToxicityPropertiesJobStatus: vi.fn(
        (): Observable<ToxicityJobResponseView> => of(makeToxicityJobResponse()),
      ),
      getJobLogs: vi.fn((): Observable<JobLogsPageView> => of(emptyLogsPage)),
      listJobs: vi.fn((): Observable<ScientificJobView[]> => of([makeScientificJob()])),
      downloadToxicityPropertiesCsvReport: vi.fn(),
      validateSmilesCompatibility: vi.fn(
        (): Observable<SmilesCompatibilityResultView> => of({ compatible: true, issues: [] }),
      ),
    };

    TestBed.configureTestingModule({
      providers: [
        ToxicityPropertiesWorkflowService,
        {
          provide: JobsApiService,
          useValue: jobsApiServiceMock,
        },
      ],
    });

    workflowService = TestBed.inject(ToxicityPropertiesWorkflowService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('dispatches toxicity job and stores completed result', () => {
    workflowService.setBatchInputText('CCO');
    workflowService.jobNameInput.set('Lote toxicidad');
    vi.runAllTimers();

    workflowService.dispatch();

    expect(jobsApiServiceMock.validateSmilesCompatibility).toHaveBeenCalledWith(['CCO']);
    expect(jobsApiServiceMock.dispatchToxicityPropertiesJob).toHaveBeenCalledWith({
      molecules: [{ name: 'CCO', smiles: 'CCO' }],
      version: '1.0.0',
    });
    expect(workflowService.activeSection()).toBe('result');
    expect(workflowService.resultData()?.total).toBe(1);
    expect(workflowService.resultData()?.molecules[0]?.smiles).toBe('CCO');
    expect(workflowService.currentJobDisplayName()).toBe('Lote toxicidad');
  });

  it('keeps error section when smiles input is empty', () => {
    workflowService.setBatchInputText('\n   \n\t');
    vi.runAllTimers();

    workflowService.dispatch();

    expect(jobsApiServiceMock.dispatchToxicityPropertiesJob).not.toHaveBeenCalled();
    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('At least one SMILES is required.');
  });

  it('opens historical failed job and exposes error state', () => {
    jobsApiServiceMock.getToxicityPropertiesJobStatus.mockReturnValue(
      of(
        makeToxicityJobResponse({
          id: 'tox-failed-1',
          status: 'failed',
        }),
      ),
    );

    workflowService.openHistoricalJob('tox-failed-1');

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('Job ended with error.');
  });

  it('loads and sorts history by updated_at desc', () => {
    jobsApiServiceMock.listJobs.mockReturnValue(
      of([
        makeScientificJob({
          id: 'tox-old',
          updated_at: '2026-03-01T10:00:00.000Z',
        }),
        makeScientificJob({
          id: 'tox-new',
          updated_at: '2026-03-02T10:00:00.000Z',
        }),
      ]),
    );

    workflowService.loadHistory();

    const orderedHistory = workflowService.historyJobs();
    expect(orderedHistory[0]?.id).toBe('tox-new');
    expect(orderedHistory[1]?.id).toBe('tox-old');
  });

  it('requests csv export for selected job', () => {
    const csvFile: DownloadedReportFile = {
      filename: 'toxicity_properties_job-report.csv',
      blob: new Blob(['smiles,LD50_mgkg'], { type: 'text/csv' }),
    };
    jobsApiServiceMock.downloadToxicityPropertiesCsvReport.mockReturnValue(of(csvFile));
    workflowService.currentJobId.set('tox-export-1');

    workflowService.downloadCsvReport().subscribe((downloadedFile: DownloadedReportFile) => {
      expect(downloadedFile.filename).toBe('toxicity_properties_job-report.csv');
    });

    expect(jobsApiServiceMock.downloadToxicityPropertiesCsvReport).toHaveBeenCalledWith(
      'tox-export-1',
    );
  });

  it('blocks dispatch when some smiles are incompatible', () => {
    jobsApiServiceMock.validateSmilesCompatibility.mockReturnValue(
      of({
        compatible: false,
        issues: [{ smiles: 'not_a_smiles', reason: 'Unsupported SMILES' }],
      }),
    );
    workflowService.setBatchInputText('CCO\nnot_a_smiles');
    vi.runAllTimers();

    workflowService.dispatch();

    expect(jobsApiServiceMock.dispatchToxicityPropertiesJob).not.toHaveBeenCalled();
    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('not_a_smiles');
  });

  it('surfaces validation transport errors', () => {
    jobsApiServiceMock.validateSmilesCompatibility.mockReturnValue(
      throwError(() => new Error('validator unavailable')),
    );
    workflowService.setBatchInputText('CCO');
    vi.runAllTimers();

    workflowService.dispatch();

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('validator unavailable');
  });

  it('prevalidates smiles input and blocks dispatch before job creation when invalid', () => {
    jobsApiServiceMock.validateSmilesCompatibility.mockReturnValue(
      of({
        compatible: false,
        issues: [{ smiles: 'bad_smiles', reason: 'Unsupported SMILES' }],
      }),
    );

    workflowService.setBatchInputText('bad_smiles');
    vi.runAllTimers();

    expect(workflowService.hasInvalidSmiles()).toBe(true);
    expect(workflowService.inputValidationMessage()).toContain('bad_smiles');

    workflowService.dispatch();

    expect(jobsApiServiceMock.dispatchToxicityPropertiesJob).not.toHaveBeenCalled();
    expect(workflowService.errorMessage()).toContain('bad_smiles');
  });

  it('keeps error section when historical payload cannot be reconstructed', () => {
    jobsApiServiceMock.getToxicityPropertiesJobStatus.mockReturnValue(
      of(
        makeToxicityJobResponse({
          id: 'tox-broken-1',
          results: undefined,
        }),
      ),
    );

    workflowService.openHistoricalJob('tox-broken-1');

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('Result payload is invalid.');
  });

  it('stores export error when CSV download fails', () => {
    jobsApiServiceMock.downloadToxicityPropertiesCsvReport.mockReturnValue(
      throwError(() => new Error('csv forbidden')),
    );
    workflowService.currentJobId.set('tox-export-2');

    workflowService.downloadCsvReport().subscribe({
      error: () => {
        expect(workflowService.exportErrorMessage()).toContain('csv forbidden');
        expect(workflowService.isExporting()).toBe(false);
      },
    });
  });

  it('throws when exporting without selected job', () => {
    expect(() => workflowService.downloadCsvReport()).toThrow('No job selected for download.');
  });

  it('falls back to polling, de-duplicates logs and resolves the final toxicity result', () => {
    const progressEvents$ = new Subject<{
      progress_percentage: number;
      progress_message: string;
    }>();
    const logEvents$ = new Subject<{
      eventIndex: number;
      level: 'info' | 'warning' | 'error' | 'debug';
      message: string;
      createdAt: string;
    }>();

    jobsApiServiceMock.dispatchToxicityPropertiesJob.mockReturnValue(
      of(makeRunningToxicityJobResponse('tox-progress-1')),
    );
    jobsApiServiceMock.streamJobEvents.mockReturnValue(progressEvents$.asObservable());
    jobsApiServiceMock.streamJobLogEvents.mockReturnValue(logEvents$.asObservable());
    jobsApiServiceMock.pollJobUntilCompleted.mockReturnValue(of({ progress_percentage: 100 }));
    jobsApiServiceMock.getToxicityPropertiesJobStatus.mockReturnValue(
      of(makeToxicityJobResponse({ id: 'tox-progress-1' })),
    );
    workflowService.setBatchInputText('CCO');
    vi.runAllTimers();

    workflowService.dispatch();

    logEvents$.next({
      eventIndex: 2,
      level: 'info',
      message: 'second',
      createdAt: new Date().toISOString(),
    });
    logEvents$.next({
      eventIndex: 1,
      level: 'debug',
      message: 'first',
      createdAt: new Date().toISOString(),
    });
    logEvents$.next({
      eventIndex: 2,
      level: 'info',
      message: 'duplicate',
      createdAt: new Date().toISOString(),
    });
    expect(workflowService.jobLogs().map((entry) => entry.eventIndex)).toEqual([1, 2]);

    progressEvents$.error(new Error('sse offline'));

    expect(jobsApiServiceMock.pollJobUntilCompleted).toHaveBeenCalledWith('tox-progress-1', 1000);
    expect(workflowService.activeSection()).toBe('result');
    expect(workflowService.resultData()?.total).toBe(1);
  });

  it('surfaces final toxicity retrieval errors after progress completes', () => {
    const progressEvents$ = new Subject<{
      progress_percentage: number;
      progress_message: string;
    }>();

    jobsApiServiceMock.dispatchToxicityPropertiesJob.mockReturnValue(
      of(makeRunningToxicityJobResponse('tox-progress-error-1')),
    );
    jobsApiServiceMock.streamJobEvents.mockReturnValue(progressEvents$.asObservable());
    jobsApiServiceMock.streamJobLogEvents.mockReturnValue(of());
    jobsApiServiceMock.getToxicityPropertiesJobStatus.mockReturnValue(
      throwError(() => new Error('gateway timeout')),
    );
    workflowService.setBatchInputText('CCO');
    vi.runAllTimers();

    workflowService.dispatch();
    progressEvents$.complete();

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toBe(
      'Unable to retrieve final toxicity result: gateway timeout',
    );
  });
});
