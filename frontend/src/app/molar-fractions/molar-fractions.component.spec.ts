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

function buildResultData(options: {
  rowCount: number;
  phMode?: 'single' | 'range';
}): MolarFractionsResultData {
  const rowCount = options.rowCount;
  const phMode = options.phMode ?? 'range';

  return {
    speciesLabels: ['H2A', 'HA-', 'A2-'],
    rows: Array.from({ length: rowCount }, (_value, index) => ({
      ph: index,
      fractions: [0.75, 0.2, 0.05],
      sumFraction: 1,
    })),
    metadata: {
      pkaValues: [2.2, 7.2],
      phMode,
      phMin: 0,
      phMax: Math.max(0, rowCount - 1),
      phStep: 1,
      totalSpecies: 3,
      totalPoints: rowCount,
    },
    isHistoricalSummary: false,
    summaryMessage: null,
  };
}

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
    workflowMock.resultData.set(null);

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

  it('muestra gráfica cuando el resultado es range y tiene más de 5 puntos', () => {
    const fixture = TestBed.createComponent(MolarFractionsComponent);
    const component = fixture.componentInstance;

    workflowMock.resultData.set(buildResultData({ rowCount: 6 }));

    expect(component.showResultChart()).toBe(true);
  });

  it('oculta gráfica cuando el resultado tiene 5 puntos o menos', () => {
    const fixture = TestBed.createComponent(MolarFractionsComponent);
    const component = fixture.componentInstance;

    workflowMock.resultData.set(buildResultData({ rowCount: 5 }));

    expect(component.showResultChart()).toBe(false);
  });

  it('oculta gráfica cuando el modo es single aunque existan varias filas', () => {
    const fixture = TestBed.createComponent(MolarFractionsComponent);
    const component = fixture.componentInstance;

    workflowMock.resultData.set(buildResultData({ rowCount: 8, phMode: 'single' }));

    expect(component.showResultChart()).toBe(false);
  });

  it('construye una serie por cada etiqueta para la gráfica', () => {
    const fixture = TestBed.createComponent(MolarFractionsComponent);
    const component = fixture.componentInstance;

    workflowMock.resultData.set(buildResultData({ rowCount: 6 }));

    const chartOptions = component.chartOptions();
    const chartSeries = Array.isArray(chartOptions?.['series']) ? chartOptions['series'] : [];
    const speciesSeries = chartSeries.filter(
      (seriesItem) =>
        typeof seriesItem === 'object' && seriesItem !== null && seriesItem['name'] !== '__probe__',
    );

    expect(speciesSeries).toHaveLength(3);
  });

  it('usa curvas suavizadas en la gráfica', () => {
    const fixture = TestBed.createComponent(MolarFractionsComponent);
    const component = fixture.componentInstance;

    workflowMock.resultData.set(buildResultData({ rowCount: 6 }));

    const chartOptions = component.chartOptions();
    const chartSeries = Array.isArray(chartOptions?.['series']) ? chartOptions['series'] : [];

    expect(chartSeries[0]).toMatchObject({ smooth: true });
  });

  it('agrega una serie dedicada para la línea de referencia del pH', () => {
    const fixture = TestBed.createComponent(MolarFractionsComponent);
    const component = fixture.componentInstance;

    workflowMock.resultData.set(buildResultData({ rowCount: 15 }));
    component.onProbePhChange('7.4');

    const chartOptions = component.chartOptions();
    const chartSeries = Array.isArray(chartOptions?.['series']) ? chartOptions['series'] : [];
    const probeSeries = chartSeries.find(
      (seriesItem) =>
        typeof seriesItem === 'object' && seriesItem !== null && seriesItem['name'] === '__probe__',
    );

    expect(probeSeries).toMatchObject({
      type: 'line',
      silent: true,
      lineStyle: { type: 'dashed' },
      data: [
        [7.4, 0],
        [7.4, 1],
      ],
    });
  });

  it('ajusta el pH de referencia al cambiar la sonda', () => {
    const fixture = TestBed.createComponent(MolarFractionsComponent);
    const component = fixture.componentInstance;

    workflowMock.resultData.set(buildResultData({ rowCount: 15 }));
    component.onProbePhChange('7.4');

    expect(component.resolvedProbePh()).toBe(7.4);
    expect(component.probeReadings()).toHaveLength(3);
  });

  it('clampa el pH de referencia al máximo disponible', () => {
    const fixture = TestBed.createComponent(MolarFractionsComponent);
    const component = fixture.componentInstance;

    workflowMock.resultData.set(buildResultData({ rowCount: 6 }));
    component.onProbePhChange('99');

    expect(component.resolvedProbePh()).toBe(5);
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
