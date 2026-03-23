// toxicity-properties-workflow.service.spec.ts: Pruebas unitarias del workflow de Toxicity Properties.

import { TestBed } from '@angular/core/testing';
import { Observable, of } from 'rxjs';
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
      smiles_list: ['CCO'],
    },
    results: {
      molecules: [
        {
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
    error_trace: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
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
      smiles_list: ['CCO'],
    },
    results: {
      molecules: [
        {
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

  it('dispatches toxicity job and stores completed result', () => {
    workflowService.smilesInput.set('CCO');

    workflowService.dispatch();

    expect(jobsApiServiceMock.validateSmilesCompatibility).toHaveBeenCalledWith(['CCO']);
    expect(jobsApiServiceMock.dispatchToxicityPropertiesJob).toHaveBeenCalledWith({
      smiles: ['CCO'],
      version: '1.0.0',
    });
    expect(workflowService.activeSection()).toBe('result');
    expect(workflowService.resultData()?.total).toBe(1);
    expect(workflowService.resultData()?.molecules[0]?.smiles).toBe('CCO');
  });

  it('keeps error section when smiles input is empty', () => {
    workflowService.smilesInput.set('\n   \n\t');

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
    expect(workflowService.errorMessage()).toContain('Historical job ended with error.');
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
    workflowService.smilesInput.set('CCO\nnot_a_smiles');

    workflowService.dispatch();

    expect(jobsApiServiceMock.dispatchToxicityPropertiesJob).not.toHaveBeenCalled();
    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('not_a_smiles');
  });
});
