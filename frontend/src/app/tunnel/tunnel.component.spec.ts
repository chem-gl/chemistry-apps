// tunnel.component.spec.ts: Pruebas unitarias del componente Tunnel Effect.
// Cubre delegaciones al workflow, formateo de resultados y verificación de valores de salida.

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import {
  TunnelResultData,
  TunnelWorkflowService,
} from '../core/application/tunnel-workflow.service';
import { TunnelComponent } from './tunnel.component';

describe('TunnelComponent', () => {
  const workflowMock = {
    reactionBarrierZpe: signal<number>(3.5),
    imaginaryFrequency: signal<number>(625),
    reactionEnergyZpe: signal<number>(-8.2),
    temperature: signal<number>(298.15),
    inputChangeEvents: signal<unknown[]>([]),
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
    progressPercentage: signal<number>(0),
    progressMessage: signal<string>('Preparing tunnel effect calculation...'),
    loadHistory: vi.fn(),
    dispatch: vi.fn(),
    reset: vi.fn(),
    clearInputHistory: vi.fn(),
    openHistoricalJob: vi.fn(),
    downloadCsvReport: vi.fn(() =>
      of({ filename: 'tunnel.csv', blob: new Blob(['data'], { type: 'text/csv' }) }),
    ),
    downloadLogReport: vi.fn(() =>
      of({ filename: 'tunnel.log', blob: new Blob(['log'], { type: 'text/plain' }) }),
    ),
  };

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
      imports: [TunnelComponent],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { queryParamMap: of(convertToParamMap({})) },
        },
      ],
    });

    TestBed.overrideComponent(TunnelComponent, {
      set: {
        providers: [
          { provide: TunnelWorkflowService, useValue: workflowMock },
          {
            provide: ActivatedRoute,
            useValue: { queryParamMap: of(convertToParamMap({})) },
          },
        ],
      },
    });
  });

  it('llama loadHistory al inicializar', () => {
    const fixture = TestBed.createComponent(TunnelComponent);
    fixture.detectChanges();
    expect(workflowMock.loadHistory).toHaveBeenCalled();
  });

  it('abre job histórico cuando llega jobId por queryParams', () => {
    TestBed.overrideComponent(TunnelComponent, {
      set: {
        providers: [
          { provide: TunnelWorkflowService, useValue: workflowMock },
          {
            provide: ActivatedRoute,
            useValue: { queryParamMap: of(convertToParamMap({ jobId: 'tunnel-77' })) },
          },
        ],
      },
    });
    const fixture = TestBed.createComponent(TunnelComponent);
    fixture.detectChanges();
    expect(workflowMock.openHistoricalJob).toHaveBeenCalledWith('tunnel-77');
  });

  it('delega dispatch, reset, clearInputHistory y openHistoricalJob al workflow', () => {
    const fixture = TestBed.createComponent(TunnelComponent);
    const component = fixture.componentInstance;

    component.dispatch();
    component.reset();
    component.clearInputHistory();
    component.openHistoricalJob('tunnel-3');

    expect(workflowMock.dispatch).toHaveBeenCalled();
    expect(workflowMock.reset).toHaveBeenCalled();
    expect(workflowMock.clearInputHistory).toHaveBeenCalled();
    expect(workflowMock.openHistoricalJob).toHaveBeenCalledWith('tunnel-3');
  });

  it('retorna clase CSS de estado histórico', () => {
    const fixture = TestBed.createComponent(TunnelComponent);
    const component = fixture.componentInstance;
    expect(component.historicalStatusClass('running')).toBe('history-status history-running');
  });

  it('canExportRows retorna false cuando no hay jobId actual', () => {
    const fixture = TestBed.createComponent(TunnelComponent);
    const component = fixture.componentInstance;
    workflowMock.currentJobId.set(null);
    expect(component.canExportRows()).toBe(false);
  });

  it('canExportRows retorna true cuando hay jobId y no está exportando', () => {
    const fixture = TestBed.createComponent(TunnelComponent);
    const component = fixture.componentInstance;
    workflowMock.currentJobId.set('tunnel-001');
    workflowMock.isExporting.set(false);
    expect(component.canExportRows()).toBe(true);
  });

  it('formatOutputValue retorna -- para null y notación exponencial para números', () => {
    const fixture = TestBed.createComponent(TunnelComponent);
    const component = fixture.componentInstance;
    expect(component.formatOutputValue(null)).toBe('--');
    expect(component.formatOutputValue(1.23456e-5)).toBe(
      (1.23456e-5).toExponential(6).toUpperCase(),
    );
  });

  it('hasResultValues retorna true cuando todos los campos de resultado no son null', () => {
    const fixture = TestBed.createComponent(TunnelComponent);
    const component = fixture.componentInstance;

    const full: TunnelResultData = {
      reactionBarrierZpe: 3.5,
      imaginaryFrequency: 625,
      reactionEnergyZpe: -8.2,
      temperature: 298.15,
      u: 0.12,
      alpha1: 1.1,
      alpha2: 1.2,
      g: 0.9,
      kappaTst: 1.5,
      modelName: 'wigner',
      sourceLibrary: 'tunnel',
      inputEventCount: 0,
      isHistoricalSummary: false,
      summaryMessage: null,
    };

    const partial: TunnelResultData = { ...full, u: null };

    expect(component.hasResultValues(full)).toBe(true);
    expect(component.hasResultValues(partial)).toBe(false);
  });

  it('exportCsv llama downloadCsvReport y activa la descarga', () => {
    const fixture = TestBed.createComponent(TunnelComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const createSpy = vi.spyOn(document, 'createElement').mockReturnValue({
      href: '',
      download: '',
      click: vi.fn(),
    } as unknown as HTMLAnchorElement);

    component.exportCsv();

    expect(workflowMock.downloadCsvReport).toHaveBeenCalled();
    createSpy.mockRestore();
  });

  it('exportLog llama downloadLogReport y activa la descarga', () => {
    const fixture = TestBed.createComponent(TunnelComponent);
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
