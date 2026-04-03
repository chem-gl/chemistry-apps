// easy-rate.component.spec.ts: Pruebas unitarias del componente Easy-Rate.
// Cubre delegaciones al workflow, formateo de valores y export de reportes.

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, vi } from 'vitest';
import { EasyRateInputFieldName } from '../core/api/jobs-api.service';
import { EasyRateWorkflowService } from '../core/application/easy-rate-workflow.service';
import { EasyRateComponent } from './easy-rate.component';

describe('EasyRateComponent', () => {
  const workflowMock = {
    activeSection: signal<string>('idle'),
    currentJobId: signal<string | null>(null),
    progressSnapshot: signal<unknown>(null),
    jobLogs: signal<unknown[]>([]),
    resultData: signal<unknown>(null),
    errorMessage: signal<string | null>(null),
    exportErrorMessage: signal<string | null>(null),
    isExporting: signal<boolean>(false),
    historyJobs: signal<unknown[]>([]),
    isHistoryLoading: signal<boolean>(false),
    isProcessing: signal<boolean>(false),
    canDispatch: signal<boolean>(false),
    progressPercentage: signal<number>(0),
    progressMessage: signal<string>('Preparing...'),
    title: signal<string>(''),
    reactionPathDegeneracy: signal<number>(1),
    diffusion: signal<boolean>(false),
    cageEffects: signal<boolean>(false),
    printDataInput: signal<boolean>(false),
    solvent: signal<string>('Gas phase (Air)'),
    showCustomViscosity: signal<boolean>(false),
    customViscosity: signal<number | null>(null),
    showDiffusionFields: signal<boolean>(false),
    radiusReactant1: signal<number | null>(null),
    radiusReactant2: signal<number | null>(null),
    reactionDistance: signal<number | null>(null),
    loadHistory: vi.fn(),
    dispatch: vi.fn(),
    reset: vi.fn(),
    clearFiles: vi.fn(),
    openHistoricalJob: vi.fn(),
    updateInputFile: vi.fn(),
    updateSelectedExecutionIndex: vi.fn(),
    updateTitle: vi.fn(),
    updateReactionPathDegeneracy: vi.fn(),
    updateSolvent: vi.fn(),
    updateCustomViscosity: vi.fn(),
    updateDiffusion: vi.fn(),
    updateCageEffects: vi.fn(),
    updatePrintDataInput: vi.fn(),
    updateRadiusReactant1: vi.fn(),
    updateRadiusReactant2: vi.fn(),
    updateReactionDistance: vi.fn(),
    getInputFile: vi.fn(() => null),
    getInspection: vi.fn(() => null),
    getSelectedInspectionExecution: vi.fn(() => null),
    getSelectedExecutionIndex: vi.fn(() => null),
    isInspectionPending: vi.fn(() => false),
    getInspectionError: vi.fn(() => null),
    downloadCsvReport: vi.fn(() =>
      of({ filename: 'easy_rate.csv', blob: new Blob(['data'], { type: 'text/csv' }) }),
    ),
    downloadLogReport: vi.fn(() =>
      of({ filename: 'easy_rate.log', blob: new Blob(['log'], { type: 'text/plain' }) }),
    ),
    downloadErrorReport: vi.fn(() =>
      of({ filename: 'easy_rate_error.txt', blob: new Blob(['err'], { type: 'text/plain' }) }),
    ),
    downloadInputsZip: vi.fn(() =>
      of({
        filename: 'easy_rate_inputs.zip',
        blob: new Blob(['zip'], { type: 'application/zip' }),
      }),
    ),
  };

  afterEach(() => vi.unstubAllGlobals());

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:mock-url'),
      revokeObjectURL: vi.fn(),
    });

    workflowMock.currentJobId.set(null);
    workflowMock.isExporting.set(false);

    TestBed.configureTestingModule({
      imports: [EasyRateComponent],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { queryParamMap: of(convertToParamMap({})) },
        },
      ],
    });

    TestBed.overrideComponent(EasyRateComponent, {
      set: {
        providers: [
          { provide: EasyRateWorkflowService, useValue: workflowMock },
          {
            provide: ActivatedRoute,
            useValue: { queryParamMap: of(convertToParamMap({})) },
          },
        ],
      },
    });
  });

  it('llama loadHistory al inicializar', () => {
    const fixture = TestBed.createComponent(EasyRateComponent);
    fixture.detectChanges();
    expect(workflowMock.loadHistory).toHaveBeenCalled();
  });

  it('abre job histórico cuando llega jobId por queryParams', () => {
    TestBed.overrideComponent(EasyRateComponent, {
      set: {
        providers: [
          { provide: EasyRateWorkflowService, useValue: workflowMock },
          {
            provide: ActivatedRoute,
            useValue: { queryParamMap: of(convertToParamMap({ jobId: 'er-job-42' })) },
          },
        ],
      },
    });
    const fixture = TestBed.createComponent(EasyRateComponent);
    fixture.detectChanges();
    expect(workflowMock.openHistoricalJob).toHaveBeenCalledWith('er-job-42');
  });

  it('delega dispatch, reset, clearFiles y openHistoricalJob al workflow', () => {
    const fixture = TestBed.createComponent(EasyRateComponent);
    const component = fixture.componentInstance;

    component.dispatch();
    component.reset();
    component.clearFiles();
    component.openHistoricalJob('er-77');

    expect(workflowMock.dispatch).toHaveBeenCalled();
    expect(workflowMock.reset).toHaveBeenCalled();
    expect(workflowMock.clearFiles).toHaveBeenCalled();
    expect(workflowMock.openHistoricalJob).toHaveBeenCalledWith('er-77');
  });

  it('propaga cambio de archivo al workflow con el campo correcto', () => {
    const fixture = TestBed.createComponent(EasyRateComponent);
    const component = fixture.componentInstance;
    const file = new File(['content'], 'ts.log');
    const event = {
      target: { files: [file] } as unknown as HTMLInputElement,
    } as unknown as Event;

    component.onInputFileChange('transition_state_file', event);

    expect(workflowMock.updateInputFile).toHaveBeenCalledWith('transition_state_file', file);
  });

  it('propaga selección de ejecución con índice numérico', () => {
    const fixture = TestBed.createComponent(EasyRateComponent);
    const component = fixture.componentInstance;
    const event = { target: { value: '2' } } as unknown as Event;

    component.onExecutionSelectionChange('reactant_1_file' as EasyRateInputFieldName, event);

    expect(workflowMock.updateSelectedExecutionIndex).toHaveBeenCalledWith('reactant_1_file', 2);
  });

  it('propaga selección vacía como null al workflow', () => {
    const fixture = TestBed.createComponent(EasyRateComponent);
    const component = fixture.componentInstance;
    const event = { target: { value: '  ' } } as unknown as Event;

    component.onExecutionSelectionChange('reactant_1_file' as EasyRateInputFieldName, event);

    expect(workflowMock.updateSelectedExecutionIndex).toHaveBeenCalledWith('reactant_1_file', null);
  });

  it('propaga cambios de diffusion, cageEffects y printDataInput', () => {
    const fixture = TestBed.createComponent(EasyRateComponent);
    const component = fixture.componentInstance;

    component.onDiffusionChange({ target: { checked: true } } as unknown as Event);
    component.onCageEffectsChange({ target: { checked: false } } as unknown as Event);
    component.onPrintDataInputChange({ target: { checked: true } } as unknown as Event);

    expect(workflowMock.updateDiffusion).toHaveBeenCalledWith(true);
    expect(workflowMock.updateCageEffects).toHaveBeenCalledWith(false);
    expect(workflowMock.updatePrintDataInput).toHaveBeenCalledWith(true);
  });

  it('delega getters de inspección al workflow', () => {
    const fixture = TestBed.createComponent(EasyRateComponent);
    const component = fixture.componentInstance;
    const field = 'product_1_file' as EasyRateInputFieldName;

    component.getSelectedFile(field);
    component.getInspection(field);
    component.getSelectedExecution(field);
    component.getSelectedExecutionIndex(field);
    component.isInspectionPending(field);
    component.getInspectionError(field);

    expect(workflowMock.getInputFile).toHaveBeenCalledWith(field);
    expect(workflowMock.getInspection).toHaveBeenCalledWith(field);
    expect(workflowMock.getSelectedInspectionExecution).toHaveBeenCalledWith(field);
    expect(workflowMock.getSelectedExecutionIndex).toHaveBeenCalledWith(field);
    expect(workflowMock.isInspectionPending).toHaveBeenCalledWith(field);
    expect(workflowMock.getInspectionError).toHaveBeenCalledWith(field);
  });

  it('canExport retorna true cuando hay jobId y no está exportando', () => {
    const fixture = TestBed.createComponent(EasyRateComponent);
    const component = fixture.componentInstance;
    workflowMock.currentJobId.set('er-001');
    workflowMock.isExporting.set(false);
    expect(component.canExport()).toBe(true);
  });

  it('canExport retorna false cuando no hay jobId', () => {
    const fixture = TestBed.createComponent(EasyRateComponent);
    const component = fixture.componentInstance;
    workflowMock.currentJobId.set(null);
    expect(component.canExport()).toBe(false);
  });

  it('formatRateConstant retorna -- para null y exponencial mayúscula para número', () => {
    const fixture = TestBed.createComponent(EasyRateComponent);
    const component = fixture.componentInstance;
    expect(component.formatRateConstant(null)).toBe('--');
    expect(component.formatRateConstant(3.5e7)).toBe((3.5e7).toExponential(4).toUpperCase());
  });

  it('formatKcalMol retorna cuatro decimales', () => {
    const fixture = TestBed.createComponent(EasyRateComponent);
    const component = fixture.componentInstance;
    expect(component.formatKcalMol(12.3456789)).toBe('12.3457');
  });

  it('formatNullableNumber retorna -- para null y número con dígitos específicos', () => {
    const fixture = TestBed.createComponent(EasyRateComponent);
    const component = fixture.componentInstance;
    expect(component.formatNullableNumber(null)).toBe('--');
    expect(component.formatNullableNumber(1.123456789, 3)).toBe('1.123');
  });

  it('formatBytes formatea correctamente en B, KB y MB', () => {
    const fixture = TestBed.createComponent(EasyRateComponent);
    const component = fixture.componentInstance;
    expect(component.formatBytes(256)).toBe('256 B');
    expect(component.formatBytes(4096)).toBe('4.0 KB');
    expect(component.formatBytes(2097152)).toBe('2.00 MB');
  });

  it('buildExecutionOptionLabel compone el label con título y métricas', () => {
    const fixture = TestBed.createComponent(EasyRateComponent);
    const component = fixture.componentInstance;

    const executionWithTitle = {
      executionIndex: 0,
      jobTitle: 'TS Result',
      multiplicity: 1,
      negativeFrequencies: -500,
    } as unknown as Parameters<typeof component.buildExecutionOptionLabel>[0];

    const executionWithoutTitle = {
      executionIndex: 2,
      jobTitle: null,
      multiplicity: 2,
      negativeFrequencies: -300,
    } as unknown as Parameters<typeof component.buildExecutionOptionLabel>[0];

    expect(component.buildExecutionOptionLabel(executionWithTitle)).toBe(
      'TS Result · mult 1 · neg freq -500',
    );
    expect(component.buildExecutionOptionLabel(executionWithoutTitle)).toBe(
      'Execution 3 · mult 2 · neg freq -300',
    );
  });

  it('joinMessages concatena mensajes con espacio', () => {
    const fixture = TestBed.createComponent(EasyRateComponent);
    const component = fixture.componentInstance;
    expect(component.joinMessages(['Hello', 'world'])).toBe('Hello world');
  });

  it('exportCsv llama downloadCsvReport', () => {
    const fixture = TestBed.createComponent(EasyRateComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const anchor = {
      href: '',
      download: '',
      style: { display: '' },
      click: vi.fn(),
      remove: vi.fn(),
    };
    const createSpy = vi
      .spyOn(document, 'createElement')
      .mockReturnValue(anchor as unknown as HTMLAnchorElement);
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => document.body);

    component.exportCsv();
    expect(workflowMock.downloadCsvReport).toHaveBeenCalled();
    createSpy.mockRestore();
  });

  it('exportLog llama downloadLogReport', () => {
    const fixture = TestBed.createComponent(EasyRateComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const anchor = {
      href: '',
      download: '',
      style: { display: '' },
      click: vi.fn(),
      remove: vi.fn(),
    };
    const createSpy = vi
      .spyOn(document, 'createElement')
      .mockReturnValue(anchor as unknown as HTMLAnchorElement);
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => document.body);

    component.exportLog();
    expect(workflowMock.downloadLogReport).toHaveBeenCalled();
    createSpy.mockRestore();
  });

  it('exportError llama downloadErrorReport', () => {
    const fixture = TestBed.createComponent(EasyRateComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const anchor = {
      href: '',
      download: '',
      style: { display: '' },
      click: vi.fn(),
      remove: vi.fn(),
    };
    const createSpy = vi
      .spyOn(document, 'createElement')
      .mockReturnValue(anchor as unknown as HTMLAnchorElement);
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => document.body);

    component.exportError();
    expect(workflowMock.downloadErrorReport).toHaveBeenCalled();
    createSpy.mockRestore();
  });

  it('exportInputsZip llama downloadInputsZip', () => {
    const fixture = TestBed.createComponent(EasyRateComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const anchor = {
      href: '',
      download: '',
      style: { display: '' },
      click: vi.fn(),
      remove: vi.fn(),
    };
    const createSpy = vi
      .spyOn(document, 'createElement')
      .mockReturnValue(anchor as unknown as HTMLAnchorElement);
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => document.body);

    component.exportInputsZip();
    expect(workflowMock.downloadInputsZip).toHaveBeenCalled();
    createSpy.mockRestore();
  });

  it('trackInputSlot retorna el fieldName del slot', () => {
    const fixture = TestBed.createComponent(EasyRateComponent);
    const component = fixture.componentInstance;
    const result = component.trackInputSlot(0, {
      fieldName: 'product_2_file' as EasyRateInputFieldName,
      label: 'Product 2',
      required: false,
      note: null,
    });
    expect(result).toBe('product_2_file');
  });
});
