import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { Subject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  JobLogsPageView,
  JobsApiService,
  SmilesCompatibilityResultView,
} from '../api/jobs-api.service';
import { NamedSmilesInputRow } from '../shared/scientific-app-ui.utils';
import { SmilesJobWorkflowService } from './smiles-job-workflow.service';
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

  it('persists and hydrates display names using input or historical parameters', () => {
    service.jobNameInput.set('Named run');
    service.remember('job-1');
    expect(service.currentJobDisplayName()).toBe('Named run');

    service.reset();
    service.hydrate('job-2', { job_name: 'Recovered run' });
    expect(service.currentJobDisplayName()).toBe('Recovered run');
  });
});
