// tunnel.component.spec.ts: Pruebas unitarias del componente Tunnel Effect.
// Verifica delegación básica, formato de resultados y export CSV local sin historial ni trazabilidad.

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    activeSection: signal<string>('idle'),
    resultData: signal<TunnelResultData | null>(null),
    errorMessage: signal<string | null>(null),
    isProcessing: signal<boolean>(false),
    progressMessage: signal<string>('Preparing tunnel effect calculation...'),
    dispatch: vi.fn(),
    reset: vi.fn(),
    updateReactionBarrierZpe: vi.fn(),
    updateImaginaryFrequency: vi.fn(),
    updateReactionEnergyZpe: vi.fn(),
    updateTemperature: vi.fn(),
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
      imports: [TunnelComponent],
    });

    TestBed.overrideComponent(TunnelComponent, {
      set: {
        providers: [{ provide: TunnelWorkflowService, useValue: workflowMock }],
      },
    });
  });

  it('crea el componente sin historial ni trazabilidad', () => {
    const fixture = TestBed.createComponent(TunnelComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('delega dispatch y reset al workflow', () => {
    const fixture = TestBed.createComponent(TunnelComponent);
    const component = fixture.componentInstance;

    component.dispatch();
    component.reset();

    expect(workflowMock.dispatch).toHaveBeenCalled();
    expect(workflowMock.reset).toHaveBeenCalled();
  });

  it('formatOutputValue retorna -- para null y notación exponencial para números', () => {
    const fixture = TestBed.createComponent(TunnelComponent);
    const component = fixture.componentInstance;
    expect(component.formatOutputValue(null)).toBe('--');
    expect(component.formatOutputValue(1.23456e-5)).toBe(
      (1.23456e-5).toExponential(6).toUpperCase(),
    );
  });

  it('hasResultValues retorna true cuando todos los campos no son null', () => {
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
    };

    const partial: TunnelResultData = { ...full, u: null };

    expect(component.hasResultValues(full)).toBe(true);
    expect(component.hasResultValues(partial)).toBe(false);
  });

  it('exporta CSV local a partir del resultado actual', () => {
    const fixture = TestBed.createComponent(TunnelComponent);
    const component = fixture.componentInstance;
    workflowMock.resultData.set({
      reactionBarrierZpe: 3.5,
      imaginaryFrequency: 625,
      reactionEnergyZpe: -8.2,
      temperature: 298.15,
      u: 0.4,
      alpha1: 1.2,
      alpha2: 0.9,
      g: 0.6,
      kappaTst: 1.05,
      modelName: 'Asymmetric Eckart',
      sourceLibrary: 'legacy-fortran',
    });

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
