// molar-fractions.component.spec.ts: Pruebas unitarias del componente Molar Fractions.
// Cubre delegaciones al workflow, formateo de resultados y export de reportes.

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, vi } from 'vitest';
import {
  JobLogEntryView,
  JobProgressSnapshotView,
  ScientificJobView,
} from '../core/api/jobs-api.service';
import {
  MolarFractionsResultData,
  MolarFractionsResultRow,
  MolarFractionsWorkflowService,
} from '../core/application/molar-fractions-workflow.service';
import { MolarFractionsComponent } from './molar-fractions.component';

describe('MolarFractionsComponent', () => {
  const workflowMock = {
    pkaCount: signal<number>(3),
    pkaValues: signal<number[]>([2.2, 7.2, 12.3, 0, 0, 0]),
    phMode: signal<string>('range'),
    phValue: signal<number>(7),
    phMin: signal<number>(0),
    phMax: signal<number>(14),
    phStep: signal<number>(1),
    activeSection: signal<string>('idle'),
    currentJobId: signal<string | null>(null),
    progressSnapshot: signal<JobProgressSnapshotView | null>(null),
    jobLogs: signal<JobLogEntryView[]>([]),
    resultData: signal<MolarFractionsResultData | null>(null),
    errorMessage: signal<string | null>(null),
    exportErrorMessage: signal<string | null>(null),
    isExporting: signal<boolean>(false),
    historyJobs: signal<ScientificJobView[]>([]),
    isHistoryLoading: signal<boolean>(false),
    isProcessing: signal<boolean>(false),
    progressPercentage: signal<number>(0),
    progressMessage: signal<string>('Preparing...'),
    pkaInputSlots: signal<number[]>([0, 1, 2]),
    loadHistory: vi.fn(),
    dispatch: vi.fn(),
    reset: vi.fn(),
    openHistoricalJob: vi.fn(),
    setPkaCount: vi.fn(),
    downloadCsvReport: vi.fn(() =>
      of({ filename: 'molar_fractions.csv', blob: new Blob(['header'], { type: 'text/csv' }) }),
    ),
    downloadLogReport: vi.fn(() =>
      of({ filename: 'molar_fractions.log', blob: new Blob(['log line'], { type: 'text/plain' }) }),
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
    workflowMock.activeSection.set('idle');

    TestBed.configureTestingModule({
      imports: [MolarFractionsComponent],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { queryParamMap: of(convertToParamMap({})) },
        },
      ],
    });

    TestBed.overrideComponent(MolarFractionsComponent, {
      set: {
        providers: [
          { provide: MolarFractionsWorkflowService, useValue: workflowMock },
          {
            provide: ActivatedRoute,
            useValue: { queryParamMap: of(convertToParamMap({})) },
          },
        ],
      },
    });
  });

  it('llama loadHistory al inicializar', () => {
    const fixture = TestBed.createComponent(MolarFractionsComponent);
    fixture.detectChanges();
    expect(workflowMock.loadHistory).toHaveBeenCalled();
  });

  it('abre job histórico cuando llega jobId por queryParams', () => {
    TestBed.overrideComponent(MolarFractionsComponent, {
      set: {
        providers: [
          { provide: MolarFractionsWorkflowService, useValue: workflowMock },
          {
            provide: ActivatedRoute,
            useValue: { queryParamMap: of(convertToParamMap({ jobId: 'mf-job-5' })) },
          },
        ],
      },
    });
    const fixture = TestBed.createComponent(MolarFractionsComponent);
    fixture.detectChanges();
    expect(workflowMock.openHistoricalJob).toHaveBeenCalledWith('mf-job-5');
  });

  it('delega dispatch, reset y openHistoricalJob al workflow', () => {
    const fixture = TestBed.createComponent(MolarFractionsComponent);
    const component = fixture.componentInstance;

    component.dispatch();
    component.reset();
    component.openHistoricalJob('mf-99');

    expect(workflowMock.dispatch).toHaveBeenCalled();
    expect(workflowMock.reset).toHaveBeenCalled();
    expect(workflowMock.openHistoricalJob).toHaveBeenCalledWith('mf-99');
  });

  it('convierte rawValue y delega setPkaCount al workflow', () => {
    const fixture = TestBed.createComponent(MolarFractionsComponent);
    const component = fixture.componentInstance;
    component.onPkaCountChange('4');
    expect(workflowMock.setPkaCount).toHaveBeenCalledWith(4);
  });

  it('formatea pH con dos decimales', () => {
    const fixture = TestBed.createComponent(MolarFractionsComponent);
    const component = fixture.componentInstance;
    const row: MolarFractionsResultRow = { ph: 7.123, fractions: [], sumFraction: 1 };
    expect(component.formatPh(row)).toBe('7.12');
  });

  it('formatea fracción con notación exponencial en mayúsculas', () => {
    const fixture = TestBed.createComponent(MolarFractionsComponent);
    const component = fixture.componentInstance;
    expect(component.formatFractionValue(0.00123)).toBe('1.230E-3');
  });

  it('retorna clase CSS de estado histórico', () => {
    const fixture = TestBed.createComponent(MolarFractionsComponent);
    const component = fixture.componentInstance;
    expect(component.historicalStatusClass('completed')).toBe('history-status history-completed');
  });

  it('retorna ph_mode del job o guión si no está disponible', () => {
    const fixture = TestBed.createComponent(MolarFractionsComponent);
    const component = fixture.componentInstance;

    const jobWithMode = {
      parameters: { ph_mode: 'single' },
    } as unknown as ScientificJobView;

    const jobNoMode = {
      parameters: { other: true },
    } as unknown as ScientificJobView;

    const jobNullParams = {
      parameters: null,
    } as unknown as ScientificJobView;

    expect(component.historicalModeLabel(jobWithMode)).toBe('single');
    expect(component.historicalModeLabel(jobNoMode)).toBe('-');
    expect(component.historicalModeLabel(jobNullParams)).toBe('-');
  });

  it('canExportRows retorna false cuando no hay jobId actual', () => {
    const fixture = TestBed.createComponent(MolarFractionsComponent);
    const component = fixture.componentInstance;
    workflowMock.currentJobId.set(null);
    expect(component.canExportRows()).toBe(false);
  });

  it('canExportRows retorna true cuando hay jobId y no está exportando', () => {
    const fixture = TestBed.createComponent(MolarFractionsComponent);
    const component = fixture.componentInstance;
    workflowMock.currentJobId.set('mf-001');
    workflowMock.isExporting.set(false);
    expect(component.canExportRows()).toBe(true);
  });

  it('exportCsv llama downloadCsvReport y dispara la descarga', () => {
    const fixture = TestBed.createComponent(MolarFractionsComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const appendSpy = vi
      .spyOn(document.body, 'appendChild')
      .mockImplementation(() => document.body);
    const createSpy = vi.spyOn(document, 'createElement').mockReturnValue({
      href: '',
      download: '',
      click: vi.fn(),
    } as unknown as HTMLAnchorElement);

    component.exportCsv();

    expect(workflowMock.downloadCsvReport).toHaveBeenCalled();
    appendSpy.mockRestore();
    createSpy.mockRestore();
  });

  it('exportLog llama downloadLogReport y dispara la descarga', () => {
    const fixture = TestBed.createComponent(MolarFractionsComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const createSpy = vi.spyOn(document, 'createElement').mockReturnValue({
      href: '',
      download: '',
      click: vi.fn(),
    } as unknown as HTMLAnchorElement);

    component.exportLog();

    expect(workflowMock.downloadLogReport).toHaveBeenCalled();
    createSpy.mockRestore();
  });
});
