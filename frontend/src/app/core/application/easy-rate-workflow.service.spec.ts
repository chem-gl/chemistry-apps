// easy-rate-workflow.service.spec.ts: Pruebas unitarias del workflow Easy-rate con inspección previa de Gaussian.

import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
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
});
