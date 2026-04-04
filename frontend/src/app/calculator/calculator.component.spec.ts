// calculator.component.spec.ts: Tests unitarios del componente Calculator y su integración con el workflow.

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { CalculatorWorkflowService } from '../core/application/calculator-workflow.service';
import { CalculatorComponent } from './calculator.component';

type QueryMapValue = ReturnType<typeof convertToParamMap>;

const buildWorkflowServiceMock = () => {
  const workflowMock = {
    operations: [
      { value: 'add', label: 'Add' },
      { value: 'mul', label: 'Multiply' },
    ],
    stageSteps: ['dispatching', 'running', 'completed'],
    selectedOperation: signal('add'),
    firstOperand: signal(0),
    secondOperand: signal<number | null>(null),
    activeSection: signal<'dispatching' | 'progress' | 'result' | 'error'>('dispatching'),
    currentJobId: signal(''),
    progressSnapshot: signal(null),
    lastResult: signal<unknown>(null),
    errorMessage: signal<string | null>(null),
    requiresSecondOperand: signal(true),
    isProcessing: signal(false),
    progressPercentage: signal(0),
    progressMessage: signal(''),
    currentStage: signal('dispatching'),
    jobLogs: signal([]),
    historyJobs: signal([]),
    isHistoryLoading: signal(false),
    loadHistory: vi.fn(),
    openHistoricalJob: vi.fn(),
    stageLabel: vi.fn((value: string) => value.toUpperCase()),
    isStepDone: vi.fn((value: string) => value === 'dispatching'),
    isStepActive: vi.fn((value: string) => value === 'running'),
    dispatch: vi.fn(),
    reset: vi.fn(),
  };

  return workflowMock;
};

describe('CalculatorComponent', () => {
  let fixture: ComponentFixture<CalculatorComponent>;
  let component: CalculatorComponent;
  let workflowMock: ReturnType<typeof buildWorkflowServiceMock>;
  let queryParamMap$: BehaviorSubject<QueryMapValue>;

  beforeEach(async () => {
    workflowMock = buildWorkflowServiceMock();
    queryParamMap$ = new BehaviorSubject<QueryMapValue>(convertToParamMap({}));

    TestBed.overrideComponent(CalculatorComponent, {
      set: {
        providers: [{ provide: CalculatorWorkflowService, useValue: workflowMock }],
      },
    });

    await TestBed.configureTestingModule({
      imports: [CalculatorComponent],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: queryParamMap$.asObservable(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CalculatorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('loads history at startup and opens job from query param', () => {
    // Valida que el componente inicializa el flujo y atiende deep-link de job.
    queryParamMap$.next(convertToParamMap({ jobId: 'job-123' }));

    expect(workflowMock.loadHistory).toHaveBeenCalled();
    expect(workflowMock.openHistoricalJob).toHaveBeenCalledWith('job-123');
  });

  it('delegates ui actions to workflow service', () => {
    // Asegura que la lógica de negocio permanece en el servicio y no en el componente.
    component.dispatch();
    component.reset();
    component.loadHistory();
    component.openHistoricalJob('job-456');

    expect(workflowMock.dispatch).toHaveBeenCalledTimes(1);
    expect(workflowMock.reset).toHaveBeenCalledTimes(1);
    expect(workflowMock.loadHistory).toHaveBeenCalledTimes(2);
    expect(workflowMock.openHistoricalJob).toHaveBeenCalledWith('job-456');
  });

  it('delegates stage helper methods to workflow service', () => {
    // Verifica helpers de presentación usados por el template.
    expect(component.stageLabel('running')).toBe('RUNNING');
    expect(component.isStepDone('dispatching')).toBe(true);
    expect(component.isStepActive('running')).toBe(true);

    expect(workflowMock.stageLabel).toHaveBeenCalledWith('running');
    expect(workflowMock.isStepDone).toHaveBeenCalledWith('dispatching');
    expect(workflowMock.isStepActive).toHaveBeenCalledWith('running');
  });

  it('builds historical status css class from status value', () => {
    // Comprueba formato CSS de estado para filas de historial.
    expect(component.historicalStatusClass('completed')).toBe('history-status history-completed');
  });

  it('extracts operation label from valid and invalid job payloads', () => {
    // Garantiza fallback robusto cuando el backend retorna estructura inesperada.
    const validOperationLabel = component.historicalOperationLabel({
      id: '1',
      job_hash: 'hash',
      plugin_name: 'calculator',
      algorithm_version: '1.0.0',
      status: 'completed',
      cache_hit: false,
      cache_miss: true,
      parameters: {},
      results: { metadata: { operation_used: 'mul' } },
      error_trace: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    } as never);

    const invalidOperationLabel = component.historicalOperationLabel({ results: null } as never);

    expect(validOperationLabel).toBe('mul');
    expect(invalidOperationLabel).toBe('-');
  });

  it('stops reading route updates after destroy', () => {
    // Evita efectos secundarios al destruir el componente.
    component.ngOnDestroy();
    workflowMock.openHistoricalJob.mockClear();

    queryParamMap$.next(convertToParamMap({ jobId: 'job-999' }));

    expect(workflowMock.openHistoricalJob).not.toHaveBeenCalled();
  });
});
