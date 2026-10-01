// server-calc.component.spec.ts: Pruebas unitarias del componente Server Calc.
// Verifica delegación básica, badge de ejecución y export CSV local.

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ServerCalcResultData,
  ServerCalcWorkflowService,
} from '../core/application/server-calc-workflow.service';
import { ServerCalcComponent } from './server-calc.component';
import { JobAccessModeService } from '../core/auth/job-access-mode.service';

describe('ServerCalcComponent', () => {
  const workflowMock = {
    a: signal<number>(7),
    b: signal<number>(6),
    op: signal<string>('*'),
    jobLogs: signal<never[]>([]),
    activeSection: signal<string>('idle'),
    resultData: signal<ServerCalcResultData | null>(null),
    errorMessage: signal<string | null>(null),
    isProcessing: signal<boolean>(false),
    progressMessage: signal<string>('Preparing remote addition...'),
    dispatch: vi.fn(),
    reset: vi.fn(),
    updateA: vi.fn(),
    updateOp: vi.fn(),
    updateB: vi.fn(),
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
      imports: [ServerCalcComponent],
      providers: [{ provide: JobAccessModeService, useValue: { isOpenMode: signal(false) } }],
    });

    TestBed.overrideComponent(ServerCalcComponent, {
      set: {
        providers: [{ provide: ServerCalcWorkflowService, useValue: workflowMock }],
      },
    });
  });

  it('crea el componente', () => {
    const fixture = TestBed.createComponent(ServerCalcComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('delega dispatch y reset al workflow', () => {
    const fixture = TestBed.createComponent(ServerCalcComponent);
    const component = fixture.componentInstance;

    component.dispatch();
    component.reset();

    expect(workflowMock.dispatch).toHaveBeenCalled();
    expect(workflowMock.reset).toHaveBeenCalled();
  });

  it('formatExpression muestra "a op b = result"', () => {
    const fixture = TestBed.createComponent(ServerCalcComponent);
    const component = fixture.componentInstance;

    expect(
      component.formatExpression({
        a: 7,
        op: '*',
        b: 6,
        result: 42,
        fileName: 'calc_x.txt',
        filePath: '/home/chemistry-apps/server-apps/results/calc_x.txt',
        executedOn: 'qta',
        remoteHost: '192.168.1.20',
      }),
    ).toBe('7 * 6 = 42');
  });

  it('hasResultValues retorna true solo con resultado numérico', () => {
    const fixture = TestBed.createComponent(ServerCalcComponent);
    const component = fixture.componentInstance;

    const full: ServerCalcResultData = {
      a: 7,
      op: '*',
      b: 6,
      result: 42,
      fileName: 'calc_x.txt',
      filePath: '/home/chemistry-apps/server-apps/results/calc_x.txt',
      executedOn: 'qta',
      remoteHost: '192.168.1.20',
    };
    const empty: ServerCalcResultData = { ...full, result: null };

    expect(component.hasResultValues(full)).toBe(true);
    expect(component.hasResultValues(empty)).toBe(false);
  });

  it('exporta CSV local a partir del resultado actual', () => {
    const fixture = TestBed.createComponent(ServerCalcComponent);
    const component = fixture.componentInstance;
    workflowMock.resultData.set({
      a: 7,
      op: '*',
      b: 6,
      result: 42,
      fileName: 'calc_x.txt',
      filePath: '/home/chemistry-apps/server-apps/results/calc_x.txt',
      executedOn: 'qta',
      remoteHost: '192.168.1.20',
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
