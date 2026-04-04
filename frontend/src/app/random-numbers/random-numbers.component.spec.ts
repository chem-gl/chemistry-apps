// random-numbers.component.spec.ts: Pruebas unitarias del componente Random Numbers.
// Cubre delegaciones al workflow, métodos de clasificación y lógica de conteo de números.

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { ScientificJobView } from '../core/api/jobs-api.service';
import { RandomNumbersWorkflowService } from '../core/application/random-numbers-workflow.service';
import { RandomNumbersComponent } from './random-numbers.component';

function makeJob(overrides: Partial<ScientificJobView> = {}): ScientificJobView {
  return {
    id: 'rnd-1',
    job_hash: 'hash-1',
    plugin_name: 'random-numbers',
    algorithm_version: '1.0.0',
    status: 'completed',
    cache_hit: false,
    cache_miss: true,
    progress_percentage: 100,
    progress_stage: 'completed',
    progress_message: 'Done',
    progress_event_index: 3,
    supports_pause_resume: true,
    pause_requested: false,
    runtime_state: {},
    paused_at: null,
    resumed_at: null,
    parameters: {},
    results: null,
    error_trace: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('RandomNumbersComponent', () => {
  const workflowMock = {
    seedUrl: signal<string>('https://example.com/seed.txt'),
    numbersPerBatch: signal<number>(5),
    intervalSeconds: signal<number>(120),
    totalNumbers: signal<number>(55),
    activeSection: signal<string>('idle'),
    currentJobId: signal<string | null>(null),
    progressSnapshot: signal<unknown>(null),
    jobLogs: signal<unknown[]>([]),
    resultData: signal<unknown>(null),
    errorMessage: signal<string | null>(null),
    historyJobs: signal<unknown[]>([]),
    isHistoryLoading: signal<boolean>(false),
    isControlActionLoading: signal<boolean>(false),
    isProcessing: signal<boolean>(false),
    isPaused: signal<boolean>(false),
    canResumeFromResult: signal<boolean>(false),
    progressPercentage: signal<number>(0),
    progressMessage: signal<string>('Preparing...'),
    loadHistory: vi.fn(),
    dispatch: vi.fn(),
    pauseCurrentJob: vi.fn(),
    resumeCurrentJob: vi.fn(),
    reset: vi.fn(),
    openHistoricalJob: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    workflowMock.activeSection.set('idle');
    workflowMock.currentJobId.set(null);
    workflowMock.historyJobs.set([]);
    workflowMock.isHistoryLoading.set(false);
    workflowMock.isProcessing.set(false);

    TestBed.configureTestingModule({
      imports: [RandomNumbersComponent],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { queryParamMap: of(convertToParamMap({})) },
        },
      ],
    });

    TestBed.overrideComponent(RandomNumbersComponent, {
      set: {
        providers: [
          { provide: RandomNumbersWorkflowService, useValue: workflowMock },
          {
            provide: ActivatedRoute,
            useValue: { queryParamMap: of(convertToParamMap({})) },
          },
        ],
      },
    });
  });

  it('llama loadHistory al inicializar', () => {
    const fixture = TestBed.createComponent(RandomNumbersComponent);
    fixture.detectChanges();
    expect(workflowMock.loadHistory).toHaveBeenCalled();
  });

  it('abre job histórico cuando llega jobId por queryParams', () => {
    TestBed.overrideComponent(RandomNumbersComponent, {
      set: {
        providers: [
          { provide: RandomNumbersWorkflowService, useValue: workflowMock },
          {
            provide: ActivatedRoute,
            useValue: { queryParamMap: of(convertToParamMap({ jobId: 'rnd-job-99' })) },
          },
        ],
      },
    });
    const fixture = TestBed.createComponent(RandomNumbersComponent);
    fixture.detectChanges();
    expect(workflowMock.openHistoricalJob).toHaveBeenCalledWith('rnd-job-99');
  });

  it('delega dispatch, pauseCurrentJob, resumeCurrentJob, reset y openHistoricalJob al workflow', () => {
    const fixture = TestBed.createComponent(RandomNumbersComponent);
    const component = fixture.componentInstance;

    component.dispatch();
    component.pauseCurrentJob();
    component.resumeCurrentJob();
    component.reset();
    component.openHistoricalJob('rnd-42');

    expect(workflowMock.dispatch).toHaveBeenCalled();
    expect(workflowMock.pauseCurrentJob).toHaveBeenCalled();
    expect(workflowMock.resumeCurrentJob).toHaveBeenCalled();
    expect(workflowMock.reset).toHaveBeenCalled();
    expect(workflowMock.openHistoricalJob).toHaveBeenCalledWith('rnd-42');
  });

  it('retorna clase CSS de estado histórico', () => {
    const fixture = TestBed.createComponent(RandomNumbersComponent);
    const component = fixture.componentInstance;
    expect(component.historicalStatusClass('completed')).toBe('history-status history-completed');
    expect(component.historicalStatusClass('failed')).toBe('history-status history-failed');
  });

  it('retorna label de acción histórica según si hay resultados finales', () => {
    const fixture = TestBed.createComponent(RandomNumbersComponent);
    const component = fixture.componentInstance;

    const jobWithResult = makeJob({
      results: {
        generated_numbers: [1, 2, 3],
        metadata: {
          seed_url: 'x',
          seed_digest: 'y',
          numbers_per_batch: 5,
          interval_seconds: 120,
          total_numbers: 3,
        },
      },
    });
    const jobWithoutResult = makeJob({ results: null });
    const jobWithPartialResult = makeJob({
      results: { generated_numbers: [1, 2], metadata: null },
    });

    expect(component.historicalActionLabel(jobWithResult)).toBe('Open result');
    expect(component.historicalActionLabel(jobWithoutResult)).toBe('View summary');
    expect(component.historicalActionLabel(jobWithPartialResult)).toBe('View summary');
  });

  it('cuenta números generados desde resultados finales del job', () => {
    const fixture = TestBed.createComponent(RandomNumbersComponent);
    const component = fixture.componentInstance;

    const jobWithFinalNumbers = makeJob({
      results: {
        generated_numbers: [10, 20, 30, 40],
        metadata: {},
      },
    });
    expect(component.historicalNumbersCount(jobWithFinalNumbers)).toBe(4);
  });

  it('cuenta números desde runtime_state cuando results no tiene la lista', () => {
    const fixture = TestBed.createComponent(RandomNumbersComponent);
    const component = fixture.componentInstance;

    const jobWithRuntimeNumbers = makeJob({
      results: null,
      runtime_state: { generated_numbers: [1, 2, 3, 4, 5] },
    });
    expect(component.historicalNumbersCount(jobWithRuntimeNumbers)).toBe(5);
  });

  it('retorna 0 cuando no hay números en results ni en runtime_state', () => {
    const fixture = TestBed.createComponent(RandomNumbersComponent);
    const component = fixture.componentInstance;

    const jobEmpty = makeJob({ results: null, runtime_state: null });
    const jobNoNumbers = makeJob({ results: {}, runtime_state: {} });

    expect(component.historicalNumbersCount(jobEmpty)).toBe(0);
    expect(component.historicalNumbersCount(jobNoNumbers)).toBe(0);
  });

  it('desuscribe la ruta al destruir el componente', () => {
    const fixture = TestBed.createComponent(RandomNumbersComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const unsubSpy = vi.spyOn(
      (component as unknown as { routeSubscription: { unsubscribe: () => void } })
        .routeSubscription!,
      'unsubscribe',
    );
    fixture.destroy();
    expect(unsubSpy).toHaveBeenCalled();
  });
});
