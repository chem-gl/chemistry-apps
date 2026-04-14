// molar-fractions-workflow.service.spec.ts: Pruebas unitarias del workflow de Molar Fractions.
// Verifica despacho inmediato, fallback de progreso y ausencia de logs/historial persistido.

import { TestBed } from '@angular/core/testing';
import { Observable, Subject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../test-setup';
import { JobLogsPageView, JobsApiService, ScientificJobView } from '../api/jobs-api.service';
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
    progress_message: 'Completed',
    progress_event_index: 4,
    supports_pause_resume: false,
    pause_requested: false,
    runtime_state: {},
    paused_at: null,
    resumed_at: null,
    parameters: {
      pka_values: [2.2, 7.2, 12.3],
      initial_charge: 'q',
      label: 'sdf',
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
  } as ScientificJobView;
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

  afterEach(() => {
    TestBed.resetTestingModule();
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
    expect(workflowService.resultData()?.speciesLabels).toEqual([
      'H₃sdfq',
      'H₂sdfq⁻¹',
      'Hsdfq⁻²',
      'sdfq⁻³',
    ]);
    expect(workflowService.historyJobs()).toEqual([]);
    expect(jobsApiServiceMock.getJobLogs).not.toHaveBeenCalled();
  });

  it('preserves backend species labels when they are already descriptive', () => {
    jobsApiServiceMock.dispatchMolarFractionsJob.mockReturnValue(
      of(
        makeScientificJob({
          results: {
            species_labels: ['H₃EDA²⁺', 'H₂EDA⁺', 'HEDA', 'EDA⁻'],
            rows: [
              {
                ph: 7,
                fractions: [0.1, 0.2, 0.3, 0.4],
                sum_fraction: 1,
              },
            ],
            metadata: {
              pka_values: [2.2, 7.2, 12.3],
              initial_charge: 2,
              label: 'EDA',
              ph_mode: 'range',
              ph_min: 0,
              ph_max: 14,
              ph_step: 1,
              total_species: 4,
              total_points: 15,
            },
          },
        }),
      ),
    );

    workflowService.dispatch();

    expect(workflowService.resultData()?.speciesLabels).toEqual([
      'H₃EDA²⁺',
      'H₂EDA⁺',
      'HEDA',
      'EDA⁻',
    ]);
  });

  it('falls back to polling and resolves the final result without logs', () => {
    const progressEvents$ = new Subject<{
      progress_percentage: number;
      progress_message: string;
    }>();

    jobsApiServiceMock.dispatchMolarFractionsJob.mockReturnValue(
      of(makeScientificJob({ id: 'molar-progress-1', status: 'running', results: null })),
    );
    jobsApiServiceMock.streamJobEvents.mockReturnValue(progressEvents$.asObservable());
    jobsApiServiceMock.pollJobUntilCompleted.mockReturnValue(
      of({ progress_percentage: 100, progress_message: 'Completed by polling' }),
    );
    jobsApiServiceMock.getScientificJobStatus.mockReturnValue(
      of(makeScientificJob({ id: 'molar-progress-1' })),
    );

    workflowService.dispatch();
    progressEvents$.error(new Error('sse offline'));

    expect(jobsApiServiceMock.pollJobUntilCompleted).toHaveBeenCalledWith('molar-progress-1', 1000);
    expect(workflowService.activeSection()).toBe('result');
    expect(workflowService.resultData()?.rows).toHaveLength(1);
    expect(workflowService.progressPercentage()).toBe(100);
    expect(jobsApiServiceMock.getJobLogs).not.toHaveBeenCalled();
  });

  it('surfaces final result retrieval errors after progress completes', () => {
    const progressEvents$ = new Subject<{
      progress_percentage: number;
      progress_message: string;
    }>();

    jobsApiServiceMock.dispatchMolarFractionsJob.mockReturnValue(
      of(makeScientificJob({ id: 'molar-progress-error-1', status: 'running', results: null })),
    );
    jobsApiServiceMock.streamJobEvents.mockReturnValue(progressEvents$.asObservable());
    jobsApiServiceMock.getScientificJobStatus.mockReturnValue(
      throwError(() => new Error('gateway timeout')),
    );

    workflowService.dispatch();
    progressEvents$.complete();

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toBe('Unable to get final result: gateway timeout');
  });

  it('sets error section when dispatch request fails', () => {
    jobsApiServiceMock.dispatchMolarFractionsJob.mockReturnValue(
      throwError(() => new Error('service unavailable')),
    );

    workflowService.dispatch();

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('Unable to create molar fractions job');
    expect(workflowService.errorMessage()).toContain('service unavailable');
  });

  it('dispatches single pH mode job with phValue instead of range', () => {
    workflowService.phMode.set('single');
    workflowService.phValue.set(7.4);
    workflowService.setPkaCount(2);
    workflowService.updatePkaValue(0, 4.5);
    workflowService.updatePkaValue(1, 8.5);

    workflowService.dispatch();

    expect(jobsApiServiceMock.dispatchMolarFractionsJob).toHaveBeenCalledWith({
      pkaValues: [4.5, 8.5],
      phMode: 'single',
      phValue: 7.4,
    });
  });

  it('clamps pkaCount between 1 and 6 and pkaInputSlots has correct length', () => {
    workflowService.setPkaCount(0);
    expect(workflowService.pkaCount()).toBe(1);
    expect(workflowService.pkaInputSlots()).toHaveLength(1);

    workflowService.setPkaCount(10);
    expect(workflowService.pkaCount()).toBe(6);
    expect(workflowService.pkaInputSlots()).toHaveLength(6);

    workflowService.setPkaCount(3);
    expect(workflowService.pkaCount()).toBe(3);
    expect(workflowService.activePkaValues()).toHaveLength(3);
  });
});
