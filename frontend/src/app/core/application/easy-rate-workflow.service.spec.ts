// easy-rate-workflow.service.spec.ts: Pruebas unitarias del workflow Easy-rate con inspección previa de Gaussian.

import { TestBed } from '@angular/core/testing';
import { Observable, Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import {
  DownloadedReportFile,
  EasyRateFileInspectionView,
  EasyRateInputFieldName,
  EasyRateJobResponseView,
  JobLogsPageView,
  JobsApiService,
  ScientificJobView,
} from '../api/jobs-api.service';
import { EasyRateWorkflowService } from './easy-rate-workflow.service';

function createGaussianFile(filename: string): File {
  return new File(['gaussian-log'], filename, { type: 'text/plain' });
}

function makeInspection(
  fieldName: EasyRateInputFieldName,
  overrides: Partial<EasyRateFileInspectionView> = {},
): EasyRateFileInspectionView {
  return {
    sourceField: fieldName,
    originalFilename: `${fieldName}.log`,
    parseErrors: [],
    executionCount: 1,
    defaultExecutionIndex: 0,
    executions: [
      {
        sourceField: fieldName,
        originalFilename: `${fieldName}.log`,
        executionIndex: 0,
        jobTitle: `Execution for ${fieldName}`,
        checkpointFile: `${fieldName}.chk`,
        charge: 0,
        multiplicity: 1,
        freeEnergy: -100,
        thermalEnthalpy: -99.9,
        zeroPointEnergy: -99.8,
        scfEnergy: -100.2,
        temperature: 298.15,
        negativeFrequencies: fieldName === 'transition_state_file' ? 1 : 0,
        imaginaryFrequency: fieldName === 'transition_state_file' ? 625 : 0,
        normalTermination: true,
        isOptFreq: true,
        isValidForRole: true,
        validationErrors: [],
      },
    ],
    ...overrides,
  };
}

function makeEasyRateJob(
  overrides: Partial<EasyRateJobResponseView> = {},
): EasyRateJobResponseView {
  return {
    id: 'easy-rate-job-1',
    job_hash: 'hash-1',
    plugin_name: 'easy-rate',
    algorithm_version: '2.0.0',
    status: 'completed',
    cache_hit: false,
    cache_miss: true,
    progress_percentage: 100,
    progress_stage: 'completed',
    progress_message: 'Completed',
    progress_event_index: 8,
    supports_pause_resume: false,
    pause_requested: false,
    runtime_state: {},
    paused_at: null,
    resumed_at: null,
    parameters: {
      title: 'Easy-rate test',
      reaction_path_degeneracy: 1,
      cage_effects: false,
      diffusion: false,
      solvent: 'Gas phase (Air)',
      custom_viscosity: null,
      radius_reactant_1: null,
      radius_reactant_2: null,
      reaction_distance: null,
      print_data_input: false,
      file_descriptors: [
        {
          field_name: 'reactant_1_file',
          original_filename: 'reactant-1.log',
          stored_filename: 'stored-reactant-1.log',
          sha256: 'abc',
          size_bytes: 128,
          content_type: 'text/plain',
        },
      ],
    },
    results: {
      title: 'Easy-rate test',
      rate_constant: 1.23e8,
      rate_constant_tst: 1.1e8,
      rate_constant_diffusion_corrected: null,
      k_diff: null,
      gibbs_reaction_kcal_mol: -2.5,
      gibbs_activation_kcal_mol: 14.2,
      enthalpy_reaction_kcal_mol: -1.2,
      enthalpy_activation_kcal_mol: 16.3,
      zpe_reaction_kcal_mol: -0.8,
      zpe_activation_kcal_mol: 13.1,
      tunnel_u: 0.4,
      tunnel_alpha_1: 1.2,
      tunnel_alpha_2: 0.9,
      tunnel_g: 0.6,
      kappa_tst: 1.05,
      temperature_k: 298.15,
      imaginary_frequency_cm1: 625,
      reaction_path_degeneracy: 1,
      warn_negative_activation: false,
      cage_effects_applied: false,
      diffusion_applied: false,
      solvent_used: 'Gas phase (Air)',
      viscosity_pa_s: null,
      structures: {
        reactant_1_file: {
          source_field: 'reactant_1_file',
          original_filename: 'reactant-1.log',
          free_energy: -100,
          thermal_enthalpy: -99.9,
          zero_point_energy: -99.8,
          scf_energy: -100.2,
          temperature: 298.15,
          negative_frequencies: 0,
          imaginary_frequency: 0,
        },
        reactant_2_file: {
          source_field: 'reactant_2_file',
          original_filename: 'reactant-2.log',
          free_energy: -100,
          thermal_enthalpy: -99.9,
          zero_point_energy: -99.8,
          scf_energy: -100.2,
          temperature: 298.15,
          negative_frequencies: 0,
          imaginary_frequency: 0,
        },
        transition_state_file: {
          source_field: 'transition_state_file',
          original_filename: 'transition-state.log',
          free_energy: -99,
          thermal_enthalpy: -98.9,
          zero_point_energy: -98.8,
          scf_energy: -99.2,
          temperature: 298.15,
          negative_frequencies: 1,
          imaginary_frequency: 625,
        },
        product_1_file: {
          source_field: 'product_1_file',
          original_filename: 'product-1.log',
          free_energy: -101,
          thermal_enthalpy: -100.9,
          zero_point_energy: -100.8,
          scf_energy: -101.2,
          temperature: 298.15,
          negative_frequencies: 0,
          imaginary_frequency: 0,
        },
        product_2_file: {
          source_field: 'product_2_file',
          original_filename: null,
          free_energy: 0,
          thermal_enthalpy: 0,
          zero_point_energy: 0,
          scf_energy: 0,
          temperature: 0,
          negative_frequencies: 0,
          imaginary_frequency: 0,
        },
      },
      metadata: {
        title: 'Easy-rate test',
        solvent: 'Gas phase (Air)',
        viscosity_pa_s: null,
        diffusion: false,
        cage_effects: false,
        reaction_path_degeneracy: 1,
        artifact_count: 4,
      },
    },
    error_trace: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as EasyRateJobResponseView;
}

describe('EasyRateWorkflowService', () => {
  let workflowService: EasyRateWorkflowService;
  const emptyLogsPage: JobLogsPageView = {
    jobId: 'easy-rate-job-1',
    count: 0,
    nextAfterEventIndex: 0,
    results: [],
  };

  let jobsApiServiceMock: {
    inspectEasyRateInput: ReturnType<typeof vi.fn>;
    dispatchEasyRateJob: ReturnType<typeof vi.fn>;
    streamJobEvents: ReturnType<typeof vi.fn>;
    streamJobLogEvents: ReturnType<typeof vi.fn>;
    pollJobUntilCompleted: ReturnType<typeof vi.fn>;
    getEasyRateJobStatus: ReturnType<typeof vi.fn>;
    getJobLogs: ReturnType<typeof vi.fn>;
    listJobs: ReturnType<typeof vi.fn>;
    downloadEasyRateCsvReport: ReturnType<typeof vi.fn>;
    downloadEasyRateLogReport: ReturnType<typeof vi.fn>;
    downloadEasyRateErrorReport: ReturnType<typeof vi.fn>;
    downloadEasyRateInputsZip: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    const inspectionMap: Record<EasyRateInputFieldName, EasyRateFileInspectionView> = {
      reactant_1_file: makeInspection('reactant_1_file', {
        executionCount: 2,
        defaultExecutionIndex: 1,
        executions: [
          {
            ...makeInspection('reactant_1_file').executions[0],
            executionIndex: 0,
            jobTitle: 'Reactant 1 - first',
          },
          {
            ...makeInspection('reactant_1_file').executions[0],
            executionIndex: 1,
            jobTitle: 'Reactant 1 - second',
          },
        ],
      }),
      reactant_2_file: makeInspection('reactant_2_file'),
      transition_state_file: makeInspection('transition_state_file'),
      product_1_file: makeInspection('product_1_file'),
      product_2_file: makeInspection('product_2_file'),
    };

    jobsApiServiceMock = {
      inspectEasyRateInput: vi.fn(
        (fieldName: EasyRateInputFieldName): Observable<EasyRateFileInspectionView> =>
          of(inspectionMap[fieldName]),
      ),
      dispatchEasyRateJob: vi.fn((): Observable<EasyRateJobResponseView> => of(makeEasyRateJob())),
      streamJobEvents: vi.fn(),
      streamJobLogEvents: vi.fn(),
      pollJobUntilCompleted: vi.fn(),
      getEasyRateJobStatus: vi.fn(),
      getJobLogs: vi.fn((): Observable<JobLogsPageView> => of(emptyLogsPage)),
      listJobs: vi.fn((): Observable<ScientificJobView[]> => of([])),
      downloadEasyRateCsvReport: vi.fn(),
      downloadEasyRateLogReport: vi.fn(),
      downloadEasyRateErrorReport: vi.fn(),
      downloadEasyRateInputsZip: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        EasyRateWorkflowService,
        {
          provide: JobsApiService,
          useValue: jobsApiServiceMock,
        },
      ],
    });

    workflowService = TestBed.inject(EasyRateWorkflowService);
  });

  it('inspects files and dispatches selected execution indices to backend', () => {
    workflowService.updateInputFile('reactant_1_file', createGaussianFile('reactant-1.log'));
    workflowService.updateInputFile('reactant_2_file', createGaussianFile('reactant-2.log'));
    workflowService.updateInputFile(
      'transition_state_file',
      createGaussianFile('transition-state.log'),
    );
    workflowService.updateInputFile('product_1_file', createGaussianFile('product-1.log'));
    workflowService.updateSelectedExecutionIndex('reactant_1_file', 0);

    workflowService.dispatch();

    expect(jobsApiServiceMock.inspectEasyRateInput).toHaveBeenCalledTimes(4);
    expect(jobsApiServiceMock.dispatchEasyRateJob).toHaveBeenCalledWith(
      expect.objectContaining({
        reactant1ExecutionIndex: 0,
        reactant2ExecutionIndex: 0,
        transitionStateExecutionIndex: 0,
        product1ExecutionIndex: 0,
      }),
    );
    expect(workflowService.activeSection()).toBe('result');
    expect(workflowService.resultData()?.rateConstant).toBe(1.23e8);
  });

  it('blocks dispatch when selected execution is invalid for its Easy-rate role', () => {
    jobsApiServiceMock.inspectEasyRateInput.mockImplementation(
      (fieldName: EasyRateInputFieldName): Observable<EasyRateFileInspectionView> => {
        if (fieldName === 'transition_state_file') {
          return of(
            makeInspection('transition_state_file', {
              executions: [
                {
                  ...makeInspection('transition_state_file').executions[0],
                  isValidForRole: false,
                  negativeFrequencies: 0,
                  imaginaryFrequency: 0,
                  validationErrors: ['Transition state must have exactly one imaginary frequency.'],
                },
              ],
            }),
          );
        }
        return of(makeInspection(fieldName));
      },
    );

    workflowService.updateInputFile('reactant_1_file', createGaussianFile('reactant-1.log'));
    workflowService.updateInputFile('reactant_2_file', createGaussianFile('reactant-2.log'));
    workflowService.updateInputFile(
      'transition_state_file',
      createGaussianFile('transition-state.log'),
    );
    workflowService.updateInputFile('product_1_file', createGaussianFile('product-1.log'));

    workflowService.dispatch();

    expect(jobsApiServiceMock.dispatchEasyRateJob).not.toHaveBeenCalled();
    expect(workflowService.errorMessage()).toContain(
      'Transition state must have exactly one imaginary frequency.',
    );
    expect(workflowService.canDispatch()).toBe(false);
  });

  it('clears diffusion-dependent fields when diffusion is disabled', () => {
    workflowService.updateDiffusion(true);
    workflowService.updateRadiusReactant1(1.4);
    workflowService.updateRadiusReactant2(1.8);
    workflowService.updateReactionDistance(2.3);

    workflowService.updateDiffusion(false);

    expect(workflowService.diffusion()).toBe(false);
    expect(workflowService.radiusReactant1()).toBeNull();
    expect(workflowService.radiusReactant2()).toBeNull();
    expect(workflowService.reactionDistance()).toBeNull();
  });

  it('clears custom viscosity when solvent changes from Other to a predefined option', () => {
    workflowService.updateSolvent('Other');
    workflowService.updateCustomViscosity(0.0023);

    workflowService.updateSolvent('Water');

    expect(workflowService.solvent()).toBe('Water');
    expect(workflowService.customViscosity()).toBeNull();
  });

  it('blocks dispatch when required files are missing and exposes actionable validation error', () => {
    workflowService.dispatch();

    expect(workflowService.activeSection()).toBe('idle');
    expect(workflowService.errorMessage()).toBe('Reactant 1 file is required.');
    expect(jobsApiServiceMock.dispatchEasyRateJob).not.toHaveBeenCalled();
  });

  it('opens failed historical job and exposes backend trace while loading logs', () => {
    jobsApiServiceMock.getEasyRateJobStatus.mockReturnValue(
      of(
        makeEasyRateJob({
          id: 'easy-rate-failed-1',
          status: 'failed',
          error_trace: 'gaussian parser crashed',
        }),
      ),
    );

    workflowService.openHistoricalJob('easy-rate-failed-1');

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('gaussian parser crashed');
    expect(jobsApiServiceMock.getJobLogs).toHaveBeenCalledWith('easy-rate-failed-1', {
      limit: 250,
    });
  });

  it('loads history ordered by updated_at descending', () => {
    jobsApiServiceMock.listJobs.mockReturnValue(
      of([
        makeEasyRateJob({ id: 'older-job', updated_at: '2026-03-30T08:00:00.000Z' }),
        makeEasyRateJob({ id: 'newer-job', updated_at: '2026-03-30T09:00:00.000Z' }),
      ]),
    );

    workflowService.loadHistory();

    expect(workflowService.historyJobs()[0]?.id).toBe('newer-job');
    expect(workflowService.historyJobs()[1]?.id).toBe('older-job');
    expect(workflowService.isHistoryLoading()).toBe(false);
  });

  it('stores export error and restores exporting flag when CSV download fails', () => {
    jobsApiServiceMock.downloadEasyRateCsvReport.mockReturnValue(
      throwError(() => new Error('forbidden export')),
    );
    workflowService.currentJobId.set('easy-rate-export-1');

    workflowService.downloadCsvReport().subscribe({
      error: () => {
        expect(workflowService.exportErrorMessage()).toContain('forbidden export');
        expect(workflowService.isExporting()).toBe(false);
      },
    });
  });

  it('throws when requesting report download without selected job', () => {
    expect(() => workflowService.downloadCsvReport()).toThrow('No job selected for download.');
  });

  it('downloads inputs zip through the same guarded export pipeline', () => {
    const zipFile: DownloadedReportFile = {
      filename: 'easy_rate_inputs.zip',
      blob: new Blob(['zip-content'], { type: 'application/zip' }),
    };
    jobsApiServiceMock.downloadEasyRateInputsZip.mockReturnValue(of(zipFile));
    workflowService.currentJobId.set('easy-rate-export-zip-1');

    workflowService.downloadInputsZip().subscribe((downloadedFile: DownloadedReportFile) => {
      expect(downloadedFile.filename).toBe('easy_rate_inputs.zip');
    });

    expect(jobsApiServiceMock.downloadEasyRateInputsZip).toHaveBeenCalledWith(
      'easy-rate-export-zip-1',
    );
  });

  it('rebuilds a historical summary when an Easy-rate job has no final payload yet', () => {
    jobsApiServiceMock.getEasyRateJobStatus.mockReturnValue(
      of(
        makeEasyRateJob({
          id: 'easy-rate-running-1',
          status: 'running',
          results: null,
        }),
      ),
    );

    workflowService.openHistoricalJob('easy-rate-running-1');

    expect(workflowService.activeSection()).toBe('result');
    expect(workflowService.resultData()?.isHistoricalSummary).toBe(true);
    expect(workflowService.resultData()?.summaryMessage).toBe(
      'Historical summary: this job is still running.',
    );
  });

  it('falls back to polling, de-duplicates logs and resolves the final Easy-rate result', () => {
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

    jobsApiServiceMock.dispatchEasyRateJob.mockReturnValue(
      of(
        makeEasyRateJob({
          id: 'easy-rate-progress-1',
          status: 'running',
          results: null,
        }),
      ),
    );
    jobsApiServiceMock.streamJobEvents.mockReturnValue(progressEvents$.asObservable());
    jobsApiServiceMock.streamJobLogEvents.mockReturnValue(logEvents$.asObservable());
    jobsApiServiceMock.pollJobUntilCompleted.mockReturnValue(
      of({
        progress_percentage: 100,
        progress_message: 'Completed by polling',
        progress_stage: 'completed',
        status: 'completed',
      }),
    );
    jobsApiServiceMock.getEasyRateJobStatus.mockReturnValue(
      of(makeEasyRateJob({ id: 'easy-rate-progress-1' })),
    );

    workflowService.updateInputFile('reactant_1_file', createGaussianFile('reactant-1.log'));
    workflowService.updateInputFile('reactant_2_file', createGaussianFile('reactant-2.log'));
    workflowService.updateInputFile(
      'transition_state_file',
      createGaussianFile('transition-state.log'),
    );
    workflowService.updateInputFile('product_1_file', createGaussianFile('product-1.log'));

    workflowService.dispatch();

    logEvents$.next({
      eventIndex: 2,
      level: 'info',
      message: 'second log',
      createdAt: new Date().toISOString(),
    });
    logEvents$.next({
      eventIndex: 1,
      level: 'debug',
      message: 'first log',
      createdAt: new Date().toISOString(),
    });
    logEvents$.next({
      eventIndex: 2,
      level: 'info',
      message: 'duplicate second log',
      createdAt: new Date().toISOString(),
    });

    expect(workflowService.jobLogs().map((entry) => entry.eventIndex)).toEqual([1, 2]);

    progressEvents$.error(new Error('sse offline'));

    expect(jobsApiServiceMock.pollJobUntilCompleted).toHaveBeenCalledWith('easy-rate-progress-1', 1000);
    expect(jobsApiServiceMock.getEasyRateJobStatus).toHaveBeenCalledWith('easy-rate-progress-1');
    expect(workflowService.activeSection()).toBe('result');
    expect(workflowService.resultData()?.rateConstant).toBe(1.23e8);
    expect(workflowService.progressPercentage()).toBe(100);
  });

  it('surfaces final result retrieval errors after the Easy-rate progress stream completes', () => {
    const progressEvents$ = new Subject<{
      progress_percentage: number;
      progress_message: string;
    }>();

    jobsApiServiceMock.dispatchEasyRateJob.mockReturnValue(
      of(
        makeEasyRateJob({
          id: 'easy-rate-invalid-final-1',
          status: 'running',
          results: null,
        }),
      ),
    );
    jobsApiServiceMock.streamJobEvents.mockReturnValue(progressEvents$.asObservable());
    jobsApiServiceMock.streamJobLogEvents.mockReturnValue(of());
    jobsApiServiceMock.getEasyRateJobStatus.mockReturnValue(
      throwError(() => new Error('gateway timeout')),
    );

    workflowService.updateInputFile('reactant_1_file', createGaussianFile('reactant-1.log'));
    workflowService.updateInputFile('reactant_2_file', createGaussianFile('reactant-2.log'));
    workflowService.updateInputFile(
      'transition_state_file',
      createGaussianFile('transition-state.log'),
    );
    workflowService.updateInputFile('product_1_file', createGaussianFile('product-1.log'));

    workflowService.dispatch();
    progressEvents$.complete();

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toBe(
      'Unable to get Easy-rate final result: gateway timeout',
    );
  });

  it('stores inspection errors and clears them when the input file is removed', () => {
    jobsApiServiceMock.inspectEasyRateInput.mockReturnValueOnce(
      throwError(() => new Error('invalid gaussian content')),
    );

    workflowService.updateInputFile('reactant_1_file', createGaussianFile('bad-reactant.log'));

    expect(workflowService.getInspectionError('reactant_1_file')).toBe(
      'Unable to inspect Gaussian file: invalid gaussian content',
    );
    expect(workflowService.getInspection('reactant_1_file')).toBeNull();

    workflowService.updateInputFile('reactant_1_file', null);

    expect(workflowService.getInspectionError('reactant_1_file')).toBeNull();
    expect(workflowService.getSelectedExecutionIndex('reactant_1_file')).toBeNull();
  });

  it('updates and reads files through field-specific wrapper methods', () => {
    const reactant1File = createGaussianFile('wrapper-r1.log');
    const reactant2File = createGaussianFile('wrapper-r2.log');
    const tsFile = createGaussianFile('wrapper-ts.log');
    const product1File = createGaussianFile('wrapper-p1.log');
    const product2File = createGaussianFile('wrapper-p2.log');

    workflowService.updateReactant1File(reactant1File);
    workflowService.updateReactant2File(reactant2File);
    workflowService.updateTransitionStateFile(tsFile);
    workflowService.updateProduct1File(product1File);
    workflowService.updateProduct2File(product2File);

    expect(workflowService.getInputFile('reactant_1_file')).toBe(reactant1File);
    expect(workflowService.getInputFile('reactant_2_file')).toBe(reactant2File);
    expect(workflowService.getInputFile('transition_state_file')).toBe(tsFile);
    expect(workflowService.getInputFile('product_1_file')).toBe(product1File);
    expect(workflowService.getInputFile('product_2_file')).toBe(product2File);
  });

  it('covers validation branches for missing files and uninspected inputs', () => {
    workflowService.updateReactant1File(createGaussianFile('r1.log'));
    workflowService.dispatch();
    expect(workflowService.errorMessage()).toBe('Reactant 2 file is required.');

    workflowService.updateReactant2File(createGaussianFile('r2.log'));
    workflowService.dispatch();
    expect(workflowService.errorMessage()).toBe('Transition state file is required.');

    workflowService.updateTransitionStateFile(createGaussianFile('ts.log'));
    workflowService.dispatch();
    expect(workflowService.errorMessage()).toBe('At least one product file is required.');

    workflowService.reactant1File.set(createGaussianFile('direct-r1.log'));
    workflowService.reactant2File.set(createGaussianFile('direct-r2.log'));
    workflowService.transitionStateFile.set(createGaussianFile('direct-ts.log'));
    workflowService.product1File.set(createGaussianFile('direct-p1.log'));
    workflowService.dispatch();
    expect(workflowService.errorMessage()).toContain('Product 1 has not been inspected yet.');
  });

  it('blocks dispatch when an inspection is pending or selected execution is invalid', () => {
    const pendingInspection$ = new Subject<EasyRateFileInspectionView>();
    jobsApiServiceMock.inspectEasyRateInput.mockImplementationOnce(() =>
      pendingInspection$.asObservable(),
    );

    workflowService.updateReactant1File(createGaussianFile('pending-r1.log'));
    workflowService.updateReactant2File(createGaussianFile('r2.log'));
    workflowService.updateTransitionStateFile(createGaussianFile('ts.log'));
    workflowService.updateProduct1File(createGaussianFile('p1.log'));
    workflowService.dispatch();

    expect(workflowService.errorMessage()).toContain('Reactant 1 is still being analyzed.');

    pendingInspection$.next(makeInspection('reactant_1_file'));
    pendingInspection$.complete();
    workflowService.updateSelectedExecutionIndex('reactant_1_file', null);
    workflowService.dispatch();
    expect(workflowService.errorMessage()).toContain('Select a parsed execution for Reactant 1.');

    workflowService.updateSelectedExecutionIndex('reactant_1_file', 999);
    workflowService.dispatch();
    expect(workflowService.errorMessage()).toContain(
      'Selected execution is no longer available for Reactant 1.',
    );
  });

  it('downloads log and error reports with guarded export pipeline', () => {
    jobsApiServiceMock.downloadEasyRateLogReport.mockReturnValue(
      of({ filename: 'easy-rate.log', blob: new Blob(['log']) }),
    );
    jobsApiServiceMock.downloadEasyRateErrorReport.mockReturnValue(
      of({ filename: 'easy-rate.err', blob: new Blob(['err']) }),
    );
    workflowService.currentJobId.set('easy-rate-export-multi-1');

    workflowService.downloadLogReport().subscribe((downloadedFile: DownloadedReportFile) => {
      expect(downloadedFile.filename).toBe('easy-rate.log');
    });
    workflowService.downloadErrorReport().subscribe((downloadedFile: DownloadedReportFile) => {
      expect(downloadedFile.filename).toBe('easy-rate.err');
    });

    expect(jobsApiServiceMock.downloadEasyRateLogReport).toHaveBeenCalledWith(
      'easy-rate-export-multi-1',
    );
    expect(jobsApiServiceMock.downloadEasyRateErrorReport).toHaveBeenCalledWith(
      'easy-rate-export-multi-1',
    );
    expect(workflowService.exportErrorMessage()).toBeNull();
  });

  it('resets volatile state and clears all selected files', () => {
    workflowService.updateReactant1File(createGaussianFile('r1.log'));
    workflowService.updateReactant2File(createGaussianFile('r2.log'));
    workflowService.updateTransitionStateFile(createGaussianFile('ts.log'));
    workflowService.updateProduct1File(createGaussianFile('p1.log'));
    workflowService.currentJobId.set('easy-rate-reset-1');
    workflowService.activeSection.set('progress');
    workflowService.errorMessage.set('temp error');

    workflowService.reset();
    expect(workflowService.activeSection()).toBe('idle');
    expect(workflowService.currentJobId()).toBeNull();
    expect(workflowService.errorMessage()).toBeNull();

    workflowService.clearFiles();
    expect(workflowService.reactant1File()).toBeNull();
    expect(workflowService.reactant2File()).toBeNull();
    expect(workflowService.transitionStateFile()).toBeNull();
    expect(workflowService.product1File()).toBeNull();
    expect(workflowService.product2File()).toBeNull();
    expect(workflowService.getSelectedExecutionIndex('reactant_1_file')).toBeNull();
  });

  it('shows progress tracking error when polling fallback also fails', () => {
    jobsApiServiceMock.dispatchEasyRateJob.mockReturnValue(
      of(
        makeEasyRateJob({
          id: 'easy-rate-poll-fail-1',
          status: 'running',
          results: null,
        }),
      ),
    );
    jobsApiServiceMock.streamJobEvents.mockReturnValue(throwError(() => new Error('sse failed')));
    jobsApiServiceMock.streamJobLogEvents.mockReturnValue(of());
    jobsApiServiceMock.pollJobUntilCompleted.mockReturnValue(
      throwError(() => new Error('polling failed')),
    );

    workflowService.updateReactant1File(createGaussianFile('r1.log'));
    workflowService.updateReactant2File(createGaussianFile('r2.log'));
    workflowService.updateTransitionStateFile(createGaussianFile('ts.log'));
    workflowService.updateProduct1File(createGaussianFile('p1.log'));
    workflowService.dispatch();

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('Unable to track progress');
  });

  it('handles failed final payload and builds paused/default historical summaries', () => {
    const progressEvents$ = new Subject<{
      progress_percentage: number;
      progress_message: string;
    }>();

    jobsApiServiceMock.dispatchEasyRateJob.mockReturnValue(
      of(
        makeEasyRateJob({
          id: 'easy-rate-failed-final-1',
          status: 'running',
          results: null,
        }),
      ),
    );
    jobsApiServiceMock.streamJobEvents.mockReturnValue(progressEvents$.asObservable());
    jobsApiServiceMock.streamJobLogEvents.mockReturnValue(of());
    jobsApiServiceMock.getEasyRateJobStatus.mockReturnValueOnce(
      of(
        makeEasyRateJob({
          id: 'easy-rate-failed-final-1',
          status: 'failed',
          error_trace: 'backend failed result',
          results: null,
        }),
      ),
    );

    workflowService.updateReactant1File(createGaussianFile('r1.log'));
    workflowService.updateReactant2File(createGaussianFile('r2.log'));
    workflowService.updateTransitionStateFile(createGaussianFile('ts.log'));
    workflowService.updateProduct1File(createGaussianFile('p1.log'));
    workflowService.dispatch();
    progressEvents$.complete();

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('backend failed result');

    jobsApiServiceMock.getEasyRateJobStatus.mockReturnValueOnce(
      of(makeEasyRateJob({ id: 'easy-rate-paused-1', status: 'paused', results: null })),
    );
    workflowService.openHistoricalJob('easy-rate-paused-1');
    expect(workflowService.resultData()?.summaryMessage).toBe(
      'Historical summary: this job is paused.',
    );

    jobsApiServiceMock.getEasyRateJobStatus.mockReturnValueOnce(
      of(makeEasyRateJob({ id: 'easy-rate-cancelled-1', status: 'cancelled', results: null })),
    );
    workflowService.openHistoricalJob('easy-rate-cancelled-1');
    expect(workflowService.resultData()?.summaryMessage).toBe(
      'Historical summary: no final result payload was available.',
    );
  });

  it('runs ngOnDestroy and unsubscribes active inspection subscriptions', () => {
    const pendingInspection$ = new Subject<EasyRateFileInspectionView>();
    jobsApiServiceMock.inspectEasyRateInput.mockReturnValueOnce(pendingInspection$.asObservable());

    workflowService.updateReactant1File(createGaussianFile('destroy-r1.log'));
    expect(pendingInspection$.observed).toBe(true);

    workflowService.ngOnDestroy();
    expect(pendingInspection$.observed).toBe(false);
  });
});
