// sa-score-workflow.service.spec.ts: Pruebas unitarias del workflow SA Score.

import { TestBed } from '@angular/core/testing';
import { Observable, of } from 'rxjs';
import { vi } from 'vitest';
import {
  JobLogsPageView,
  JobsApiService,
  SaScoreJobResponseView,
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
    error_trace: null,
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
});
