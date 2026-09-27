import '@angular/compiler';
import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injector, runInInjectionContext, signal, WritableSignal } from '@angular/core';
import { Subject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  JobLogsPageView,
  JobsApiService,
  SmilesCompatibilityResultView,
} from '../api/jobs-api.service';
import { NamedSmilesInputRow } from '../shared/scientific-app-ui.utils';
import { SmilesJobWorkflowService } from './smiles-job-workflow.service';
import { IdentitySessionService } from '../auth/identity-session.service';
import { JobAccessModeService } from '../auth/job-access-mode.service';
import { LocalResultsStore } from '../shared/local-results.store';

class TestSmilesWorkflowService extends SmilesJobWorkflowService<string> {
  constructor(initialInput: string) {
    super(initialInput);
  }

  protected override get defaultProgressMessage(): string {
    return 'Preparing';
  }

  protected override get workflowPluginName(): string {
    return 'test-smiles';
  }

  dispatch(): void {}
  loadHistory(): void {}

  protected fetchFinalResult(): void {}

  parse(rawInput: string): string[] {
    return this.parseSmilesInput(rawInput);
  }

  namedRows(): NamedSmilesInputRow[] {
    return this.buildNamedInputRows();
  }

  validationError(): string | null {
    return this.getPreDispatchSmilesValidationError();
  }

  compatibility(result: SmilesCompatibilityResultView): string {
    return this.buildSmilesCompatibilityErrorMessage(result);
  }

  remember(jobId: string): void {
    this.rememberDispatchedJobDisplayName(jobId);
  }

  hydrate(jobId: string, parameters: unknown): void {
    this.hydrateCurrentJobDisplayName(jobId, parameters);
  }

  historicalLogsForTest(jobId: string): void {
    this.loadHistoricalLogs(jobId);
  }
}

describe('SmilesJobWorkflowService', () => {
  let service: TestSmilesWorkflowService;
  let validateSmilesCompatibility: ReturnType<typeof vi.fn>;
  let getJobLogs: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    validateSmilesCompatibility = vi.fn(() => of({ compatible: true, issues: [] }));
    getJobLogs = vi.fn(() =>
      of({
        jobId: 'job-1',
        count: 2,
        nextAfterEventIndex: 2,
        results: [
          { eventIndex: 2, level: 'info', message: 'second', createdAt: '2026-01-01' },
          { eventIndex: 1, level: 'info', message: 'first', createdAt: '2026-01-01' },
        ],
      } as JobLogsPageView),
    );
    const injector = Injector.create({
      providers: [
        { provide: JobAccessModeService, useValue: { isOpenMode: () => false, mode: () => 'account' } },
        { provide: LocalResultsStore, useValue: { list: () => [], save: () => undefined, remove: () => undefined, clear: () => undefined } },
        {
          provide: JobsApiService,
          useValue: {
            validateSmilesCompatibility,
            getJobLogs,
            streamJobEvents: vi.fn(),
            streamJobLogEvents: vi.fn(),
            pollJobUntilCompleted: vi.fn(),
          } as unknown as JobsApiService,
        },
      ],
    });
    service = runInInjectionContext(
      injector,
      () => new TestSmilesWorkflowService(' ethanol\nCCO, Named CCO\n\n'),
    );
  });

  afterEach(() => {
    service.ngOnDestroy();
    vi.useRealTimers();
  });

  it('parses named and unnamed rows and normalizes rows before dispatch', () => {
    expect(service.parse(' CCO\n\n ethanol, Ethanol ')).toEqual(['CCO', 'Ethanol']);
    service.setInputRows(
      [
        { name: '  First  ', smiles: ' CCO ' },
        { name: '', smiles: '  ' },
      ],
      true,
    );
    expect(service.namedRows()).toEqual([{ name: 'First', smiles: 'CCO' }]);
    expect(service.customNamesEnabled()).toBe(true);
    expect(service.smilesInput()).toContain('CCO');
  });

  it('clears validation state for empty input and reports pending validation', () => {
    service.setInputRows([]);
    expect(service.isInputValidationPending()).toBe(false);
    expect(service.invalidSmilesIssues()).toEqual([]);

    service.setBatchInputText('CCO');
    expect(service.validationError()).toBe('Wait until SMILES validation finishes.');
    vi.runAllTimers();
    expect(service.validationError()).toBeNull();
  });

  it('stores compatibility issues, formats overflow, and recovers from validator errors', () => {
    validateSmilesCompatibility.mockReturnValue(
      of({
        compatible: false,
        issues: [
          { smiles: 'A', reason: 'bad A' },
          { smiles: 'B', reason: 'bad B' },
          { smiles: 'C', reason: 'bad C' },
          { smiles: 'D', reason: 'bad D' },
        ],
      }),
    );
    service.setBatchInputText('A\nB\nC\nD');
    vi.runAllTimers();
    expect(service.hasInvalidSmiles()).toBe(true);
    expect(service.inputValidationMessage()).toContain('+1 more.');
    expect(service.compatibility({ compatible: false, issues: [] })).toContain('were not sent: .');

    validateSmilesCompatibility.mockReturnValue(throwError(() => new Error('validator down')));
    service.setBatchInputText('CCN');
    vi.runAllTimers();
    expect(service.isInputValidationPending()).toBe(false);
    expect(service.invalidSmilesIssues()).toEqual([]);
  });

  it('ignores stale validation responses and sorts historical logs', () => {
    const firstValidation$ = new Subject<SmilesCompatibilityResultView>();
    validateSmilesCompatibility.mockReturnValueOnce(firstValidation$.asObservable());
    service.setBatchInputText('CCO');
    vi.runAllTimers();

    service.setBatchInputText('CCN');
    vi.runAllTimers();
    firstValidation$.next({
      compatible: false,
      issues: [{ smiles: 'CCO', reason: 'stale' }],
    });
    expect(service.invalidSmilesIssues()).toEqual([]);

    service.historicalLogsForTest('job-1');
    expect(service.jobLogs().map((entry) => entry.eventIndex)).toEqual([1, 2]);
  });

  it('no solicita logs privados en modo abierto para evitar el 401 del job anónimo', () => {
    const openGetJobLogs = vi.fn(() =>
      of({ jobId: 'job-open', count: 0, nextAfterEventIndex: 0, results: [] } as JobLogsPageView),
    );
    const openInjector = Injector.create({
      providers: [
        {
          provide: JobAccessModeService,
          useValue: { isOpenMode: () => true, mode: () => 'open' },
        },
        {
          provide: LocalResultsStore,
          useValue: { list: () => [], save: () => undefined, remove: () => undefined, clear: () => undefined },
        },
        {
          provide: JobsApiService,
          useValue: {
            getJobLogs: openGetJobLogs,
            validateSmilesCompatibility: vi.fn(() => of({ compatible: true, issues: [] })),
            streamJobEvents: vi.fn(),
            streamJobLogEvents: vi.fn(),
            pollJobUntilCompleted: vi.fn(),
          } as unknown as JobsApiService,
        },
      ],
    });
    const openService = runInInjectionContext(openInjector, () => new TestSmilesWorkflowService('CCO'));

    openService.historicalLogsForTest('job-open');

    expect(openGetJobLogs).not.toHaveBeenCalled();
    expect(openService.jobLogs()).toEqual([]);
    openService.ngOnDestroy();
  });

  it('persists and hydrates display names using input or historical parameters', () => {
    service.jobNameInput.set('Named run');
    service.remember('job-1');
    expect(service.currentJobDisplayName()).toBe('Named run');

    service.reset();
    service.hydrate('job-2', { job_name: 'Recovered run' });
    expect(service.currentJobDisplayName()).toBe('Recovered run');
  });
});

describe('SmilesJobWorkflowService (cuota del modo abierto en validacion de SMILES)', () => {
  let quotaService: TestSmilesWorkflowService;
  let sessionStatus: WritableSignal<'anonymous' | 'authenticated'>;
  let validateSmilesCompatibility: ReturnType<typeof vi.fn>;

  afterEach(() => {
    quotaService.ngOnDestroy();
    vi.useRealTimers();
  });

  function createService(): TestSmilesWorkflowService {
    const injector = Injector.create({
      providers: [
        JobAccessModeService,
        { provide: IdentitySessionService, useValue: { status: sessionStatus } },
        {
          provide: LocalResultsStore,
          useValue: {
            list: () => [],
            save: () => undefined,
            remove: () => undefined,
            clear: () => undefined,
          },
        },
        {
          provide: JobsApiService,
          useValue: {
            validateSmilesCompatibility,
            getJobLogs: vi.fn(),
            streamJobEvents: vi.fn(),
            streamJobLogEvents: vi.fn(),
            pollJobUntilCompleted: vi.fn(),
          } as unknown as JobsApiService,
        },
      ],
    });
    return runInInjectionContext(injector, () => new TestSmilesWorkflowService(''));
  }

  it('429: muestra el mensaje de cuota con Retry-After sin invalidar el SMILES ni bloquear el reintento', () => {
    vi.useFakeTimers();
    sessionStatus = signal<'anonymous' | 'authenticated'>('anonymous');
    validateSmilesCompatibility = vi.fn(() =>
      throwError(
        () => new HttpErrorResponse({ status: 429, headers: new HttpHeaders({ 'Retry-After': '30' }) }),
      ),
    );
    quotaService = createService();

    quotaService.setBatchInputText('CCO');
    vi.runAllTimers();

    expect(quotaService.isInputValidationPending()).toBe(false);
    expect(quotaService.hasInvalidSmiles()).toBe(false);
    expect(quotaService.invalidSmilesIssues()).toEqual([]);
    expect(quotaService.inputValidationMessage()).toContain('appMode.open.limits.429');
    expect(quotaService.inputValidationMessage()).toContain('Retry-After: 30');
    // El boton "Run" queda habilitado: la validacion previa no bloquea el reintento.
    expect(quotaService.validationError()).toBeNull();
  });

  it('413: muestra el mensaje traducido de payload demasiado grande', () => {
    vi.useFakeTimers();
    sessionStatus = signal<'anonymous' | 'authenticated'>('anonymous');
    validateSmilesCompatibility = vi.fn(() =>
      throwError(() => new HttpErrorResponse({ status: 413 })),
    );
    quotaService = createService();

    quotaService.setBatchInputText('CCO');
    vi.runAllTimers();

    expect(quotaService.hasInvalidSmiles()).toBe(false);
    expect(quotaService.inputValidationMessage()).toBe('appMode.open.limits.413');
    expect(quotaService.validationError()).toBeNull();
  });

  it('el reintento exitoso limpia el mensaje de cuota', () => {
    vi.useFakeTimers();
    sessionStatus = signal<'anonymous' | 'authenticated'>('anonymous');
    validateSmilesCompatibility = vi.fn(() =>
      throwError(() => new HttpErrorResponse({ status: 429 })),
    );
    quotaService = createService();

    quotaService.setBatchInputText('CCO');
    vi.runAllTimers();
    expect(quotaService.inputValidationMessage()).toBe('appMode.open.limits.429');

    validateSmilesCompatibility.mockReturnValue(of({ compatible: true, issues: [] }));
    quotaService.setBatchInputText('CCN');
    vi.runAllTimers();

    expect(quotaService.openModeValidationMessage()).toBeNull();
    expect(quotaService.inputValidationMessage()).toBeNull();
    expect(quotaService.hasInvalidSmiles()).toBe(false);
  });

  it('con sesion autenticada un 429 inesperado no genera mensaje de cuota (comportamiento intacto)', () => {
    vi.useFakeTimers();
    sessionStatus = signal<'anonymous' | 'authenticated'>('authenticated');
    validateSmilesCompatibility = vi.fn(() =>
      throwError(() => new HttpErrorResponse({ status: 429 })),
    );
    quotaService = createService();

    quotaService.setBatchInputText('CCO');
    vi.runAllTimers();

    expect(quotaService.openModeValidationMessage()).toBeNull();
    expect(quotaService.inputValidationMessage()).toBeNull();
    expect(quotaService.hasInvalidSmiles()).toBe(false);
    expect(quotaService.validationError()).toBeNull();
  });
});
