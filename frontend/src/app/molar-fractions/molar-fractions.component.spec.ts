// molar-fractions.component.spec.ts: Pruebas unitarias del componente Molar Fractions.
// Verifica delegación básica, render de gráfica y export CSV local sin historial persistido.

import '../../test-setup';

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
      initialCharge: 'q',
      label: 'A',
      phMode,
      phMin: 0,
      phMax: Math.max(0, rowCount - 1),
      phStep: 1,
      totalSpecies: 3,
      totalPoints: rowCount,
    },
  };
}

describe('MolarFractionsComponent', () => {
  const workflowMock = {
    pkaCount: signal<number>(3),
    pkaValues: signal<number[]>([2.2, 7.2, 12.3, 0, 0, 0]),
    initialCharge: signal<string>('q'),
    speciesLabel: signal<string>('A'),
    phMode: signal<'single' | 'range'>('range'),
    phValue: signal<number>(7),
    phMin: signal<number>(0),
    phMax: signal<number>(14),
    phStep: signal<number>(1),
    activeSection: signal<string>('idle'),
    resultData: signal<MolarFractionsResultData | null>(null),
    errorMessage: signal<string | null>(null),
    isProcessing: signal<boolean>(false),
    progressMessage: signal<string>('Preparing...'),
    pkaInputSlots: signal<number[]>([0, 1, 2]),
    dispatch: vi.fn(),
    reset: vi.fn(),
    setPkaCount: vi.fn(),
    updatePkaValue: vi.fn(),
  };

  afterEach(() => vi.unstubAllGlobals());

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:mock-url'),
      revokeObjectURL: vi.fn(),
    });

    workflowMock.activeSection.set('idle');
    workflowMock.resultData.set(null);

    TestBed.configureTestingModule({
      imports: [MolarFractionsComponent],
    });

    TestBed.overrideComponent(MolarFractionsComponent, {
      set: {
        providers: [{ provide: MolarFractionsWorkflowService, useValue: workflowMock }],
      },
    });
  });

  it('crea el componente sin cargar historial', () => {
    const fixture = TestBed.createComponent(MolarFractionsComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('delega dispatch y reset al workflow', () => {
    const fixture = TestBed.createComponent(MolarFractionsComponent);
    const component = fixture.componentInstance;

    component.dispatch();
    component.reset();

    expect(workflowMock.dispatch).toHaveBeenCalled();
    expect(workflowMock.reset).toHaveBeenCalled();
  });

  it('convierte rawValue y delega setPkaCount al workflow', () => {
    const fixture = TestBed.createComponent(MolarFractionsComponent);
    const component = fixture.componentInstance;
    component.onPkaCountChange('4');
    expect(workflowMock.setPkaCount).toHaveBeenCalledWith(4);
  });

  it('cambia entre modo single y batch en estado local', () => {
    const fixture = TestBed.createComponent(MolarFractionsComponent);
    const component = fixture.componentInstance;

    component.onInputModeChange('batch');
    expect(component.inputMode()).toBe('batch');

    component.onInputModeChange('single');
    expect(component.inputMode()).toBe('single');
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

  it('renderiza la carga simbólica q como superíndice en los encabezados de especies', () => {
    const fixture = TestBed.createComponent(MolarFractionsComponent);

    workflowMock.resultData.set({
      ...buildResultData({ rowCount: 2 }),
      speciesLabels: ['H₃Aq', 'H₂Aq⁻¹', 'HAq⁻²'],
    });

    fixture.detectChanges();

    const superscriptNodes = Array.from(
      fixture.nativeElement.querySelectorAll('.result-table thead th sup'),
    ) as HTMLElement[];

    expect(superscriptNodes.map((node) => node.textContent?.trim())).toEqual(['q', 'q-1', 'q-2']);
  });

  it('renderiza la especie del batch con la carga simbólica en superíndice', () => {
    const fixture = TestBed.createComponent(MolarFractionsComponent);
    const component = fixture.componentInstance;

    component.batchRows.set([
      {
        acronym: 'TEST',
        smiles: 'O',
        pkaValues: [2],
        pkaValuesText: '2',
        initialCharge: 'q',
        pH: 7.4,
        speciesIndex: 0,
        totalPkaCount: 1,
        protonCount: 1,
        species: 'HAq⁻¹',
        speciesAscii: 'HAq-1',
        charge: 'q-1',
        fraction: 0.5,
      },
    ]);
    component.onInputModeChange('batch');
    fixture.detectChanges();

    const batchSuperscript = fixture.nativeElement.querySelector(
      '.batch-result-table tbody tr td:nth-child(5) sup',
    ) as HTMLElement | null;

    expect(batchSuperscript?.textContent?.trim()).toBe('q-1');
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

  it('exporta CSV local a partir del resultado actual', () => {
    const fixture = TestBed.createComponent(MolarFractionsComponent);
    const component = fixture.componentInstance;
    workflowMock.resultData.set(buildResultData({ rowCount: 2 }));

    const clickSpy = vi.fn();
    const createSpy = vi.spyOn(document, 'createElement').mockReturnValue({
      href: '',
      download: '',
      click: clickSpy,
    } as unknown as HTMLAnchorElement);

    component.exportCsv();

    expect(createSpy).toHaveBeenCalledWith('a');
    expect(clickSpy).toHaveBeenCalled();
    createSpy.mockRestore();
  });
});
