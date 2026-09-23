// cadma-py-workflow.service.spec.ts: Pruebas unitarias del workflow CADMA Py e historial recuperable.

import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { NEVER, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CadmaPyApiService, CadmaPyResultView } from '../api/cadma-py-api.service';
import { JobLogsPageView, JobsApiService, ScientificJobView } from '../api/jobs-api.service';
import { CadmaPyWorkflowService } from './cadma-py-workflow.service';
import { JobAccessModeService } from '../auth/job-access-mode.service';
import { LocalResultsStore } from '../shared/local-results.store';

function makeCadmaResult(): CadmaPyResultView {
  return {
    library_name: 'Neuro reference family',
    disease_name: 'Neuro disease',
    reference_count: 12,
    candidate_count: 2,
    reference_stats: [],
    ranking: [],
    score_chart: { categories: [], values: [], reference_line: 0 },
    metric_charts: [],
    score_config: {
      adme_intervals: {},
      weights: { adme: 0.5, toxicity: 0.3, sa: 0.2 },
      reference_values: { LD50: 0, M: 0, DT: 0, SA: 0 },
      adme_reference_hits: 0,
    },
    methodology_note: 'Test payload',
  };
}

describe('CadmaPyWorkflowService', () => {
  let workflowService: CadmaPyWorkflowService;
  let jobsApiMock: {
    getScientificJobStatus: ReturnType<typeof vi.fn>;
    listJobs: ReturnType<typeof vi.fn>;
    getJobLogs: ReturnType<typeof vi.fn>;
    deleteJob: ReturnType<typeof vi.fn>;
    streamJobEvents: ReturnType<typeof vi.fn>;
    streamJobLogEvents: ReturnType<typeof vi.fn>;
    pollJobUntilCompleted: ReturnType<typeof vi.fn>;
  };
  let cadmaApiMock: { createComparisonJob: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    globalThis.localStorage?.clear();

    const emptyLogs: JobLogsPageView = {
      jobId: 'cadma-history-1',
      count: 0,
      nextAfterEventIndex: 0,
      results: [],
    };

    jobsApiMock = {
      getScientificJobStatus: vi.fn(),
      listJobs: vi.fn(() => of([])),
      getJobLogs: vi.fn(() => of(emptyLogs)),
      deleteJob: vi.fn(() => of({ detail: 'deleted', jobId: 'cadma-history-1' })),
      streamJobEvents: vi.fn(() => NEVER),
      streamJobLogEvents: vi.fn(() => NEVER),
      pollJobUntilCompleted: vi.fn(() => of()),
    };
    cadmaApiMock = { createComparisonJob: vi.fn() };

    const injector: Injector = Injector.create({
      providers: [
        { provide: JobAccessModeService, useValue: { isOpenMode: () => false, mode: () => 'account' } },
        { provide: LocalResultsStore, useValue: { list: () => [], save: () => undefined, remove: () => undefined, clear: () => undefined } },
        CadmaPyWorkflowService,
        { provide: JobsApiService, useValue: jobsApiMock as unknown as JobsApiService },
        {
          provide: CadmaPyApiService,
          useValue: cadmaApiMock as unknown as CadmaPyApiService,
        },
      ],
    });

    workflowService = runInInjectionContext(injector, () => injector.get(CadmaPyWorkflowService));
  });

  it('saves and resumes a paused candidate draft from the upload step', () => {
    const savedDraft = workflowService.savePausedDraft({
      referenceLibraryId: 'family-7',
      referenceLibraryName: 'Neuro draft family',
      projectLabel: 'Draft neuro batch',
      combinedCsvText: '',
      smilesCsvText: 'smiles,name\nCCO,Candidate A',
      toxicityCsvText: '',
      saCsvText: '',
      sourceConfigsJson: JSON.stringify([
        {
          filename: 'main-guide.csv',
          content_text: 'smiles,name\nCCO,Candidate A',
          file_format: 'csv',
          delimiter: ',',
          has_header: true,
          skip_lines: 0,
          smiles_column: 'smiles',
          name_column: 'name',
        },
      ]),
      scoreConfigJson: JSON.stringify({
        adme_intervals: {},
        weights: { adme: 0.5, toxicity: 0.3, sa: 0.2 },
        reference_values: { LD50: 0, M: 0, DT: 0, SA: 0 },
        adme_reference_hits: 0,
      }),
      filenames: ['main-guide.csv'],
      totalFiles: 1,
      totalUsableRows: 1,
    });

    workflowService.selectedReferenceLibraryId.set('');
    workflowService.projectLabel.set('');
    workflowService.clearCandidateInputs();

    const resumedDraft = workflowService.resumePausedDraft(savedDraft.id);

    expect(resumedDraft?.projectLabel).toBe('Draft neuro batch');
    expect(workflowService.selectedReferenceLibraryId()).toBe('family-7');
    expect(workflowService.projectLabel()).toBe('Draft neuro batch');
    expect(workflowService.smilesCsvText()).toContain('Candidate A');
    expect(workflowService.sourceConfigsJson()).toContain('main-guide.csv');
    expect(workflowService.pausedDrafts()).toHaveLength(1);
  });

  it('rehydrates the selected family and uploaded candidate sources from a historical CADMA job', () => {
    const historicalJob = {
      id: 'cadma-history-1',
      status: 'completed',
      results: makeCadmaResult(),
      parameters: {
        reference_library_id: 'family-42',
        project_label: 'Recovered neuro run',
        combined_csv_text: 'name,smiles\nCompound A,CCO',
        smiles_csv_text: 'smiles\nCCO',
        toxicity_csv_text: 'name,DT\nCompound A,2.1',
        sa_csv_text: 'name,SA\nCompound A,3.2',
        source_configs_json: JSON.stringify([
          {
            fileName: 'candidate-bundle.csv',
            columns: ['name', 'smiles', 'DT', 'SA'],
          },
        ]),
      },
      updated_at: new Date().toISOString(),
    } as unknown as ScientificJobView;

    jobsApiMock.getScientificJobStatus.mockReturnValue(of(historicalJob));

    workflowService.selectedReferenceLibraryId.set('stale-family');
    workflowService.projectLabel.set('stale project');
    workflowService.combinedCsvText.set('');
    workflowService.smilesCsvText.set('');
    workflowService.toxicityCsvText.set('');
    workflowService.saCsvText.set('');
    workflowService.sourceConfigsJson.set('');

    workflowService.openHistoricalJob('cadma-history-1');

    expect(workflowService.selectedReferenceLibraryId()).toBe('family-42');
    expect(workflowService.projectLabel()).toBe('Recovered neuro run');
    expect(workflowService.combinedCsvText()).toContain('Compound A');
    expect(workflowService.smilesCsvText()).toContain('CCO');
    expect(workflowService.toxicityCsvText()).toContain('2.1');
    expect(workflowService.saCsvText()).toContain('3.2');
    expect(workflowService.sourceConfigsJson()).toContain('candidate-bundle.csv');
    expect(workflowService.activeSection()).toBe('result');
  });

  it('valida familia, etiqueta y candidatos antes de despachar', () => {
    workflowService.dispatch();
    expect(workflowService.errorMessage()).toContain('reference family');

    workflowService.selectedReferenceLibraryId.set('family-1');
    workflowService.dispatch();
    expect(workflowService.errorMessage()).toContain('Project label');

    workflowService.projectLabel.set('Batch');
    workflowService.dispatch();
    expect(workflowService.errorMessage()).toContain('candidate CSV');
    expect(jobsApiMock.getScientificJobStatus).not.toHaveBeenCalled();
  });

  it('despacha un job válido y maneja errores de creación', () => {
    workflowService.selectedReferenceLibraryId.set('family-1');
    workflowService.projectLabel.set('Batch');
    workflowService.smilesCsvText.set('smiles\nCCO');
    cadmaApiMock.createComparisonJob.mockReturnValueOnce(
      of({ id: 'job-1', status: 'pending', results: null }),
    );

    workflowService.dispatch();
    expect(cadmaApiMock.createComparisonJob).toHaveBeenCalledWith(
      expect.objectContaining({ reference_library_id: 'family-1', project_label: 'Batch' }),
    );

    cadmaApiMock.createComparisonJob.mockReturnValueOnce(throwError(() => new Error('network')));
    workflowService.dispatch();
    expect(workflowService.errorMessage()).toContain('network');
  });

  it('devuelve null al reanudar un borrador inexistente y tolera storage inválido', () => {
    localStorage.setItem('chemistry-apps.cadma-py.paused-drafts.v1', '{invalid');
    const injector: Injector = Injector.create({
      providers: [
        { provide: JobAccessModeService, useValue: { isOpenMode: () => false, mode: () => 'account' } },
        { provide: LocalResultsStore, useValue: { list: () => [], save: () => undefined, remove: () => undefined, clear: () => undefined } },
        CadmaPyWorkflowService,
        { provide: JobsApiService, useValue: jobsApiMock as unknown as JobsApiService },
        {
          provide: CadmaPyApiService,
          useValue: { createComparisonJob: vi.fn() } as unknown as CadmaPyApiService,
        },
      ],
    });
    const freshService = runInInjectionContext(injector, () =>
      injector.get(CadmaPyWorkflowService),
    );

    expect(freshService.pausedDrafts()).toEqual([]);
    expect(freshService.resumePausedDraft('missing')).toBeNull();
  });

  it('reports historical job retrieval failures without leaving a stale result', () => {
    jobsApiMock.getScientificJobStatus.mockReturnValue(
      throwError(() => new Error('history unavailable')),
    );

    workflowService.openHistoricalJob('cadma-history-error');

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('history unavailable');
    expect(workflowService.resultData()).toBeNull();
  });

  it('rehydrates fallback historical source configs when none were persisted', () => {
    jobsApiMock.getScientificJobStatus.mockReturnValue(
      of({
        id: 'cadma-fallback-sources',
        status: 'paused',
        parameters: {
          reference_library_id: 'family-9',
          project_label: 'Paused batch',
          combined_csv_text: 'name,smiles\nA,CCO',
          smiles_csv_text: '',
          toxicity_csv_text: '',
          sa_csv_text: '',
          source_configs_json: '',
          score_config_json: '',
        },
        results: null,
      } as unknown as ScientificJobView),
    );

    workflowService.openHistoricalJob('cadma-fallback-sources');

    expect(workflowService.activeSection()).toBe('idle');
    expect(workflowService.sourceConfigsJson()).toContain('historical-combined.csv');
    expect(jobsApiMock.getJobLogs).toHaveBeenCalledWith('cadma-fallback-sources', { limit: 250 });
  });

  it('rejects completed historical payloads without ranking, charts, or score chart', () => {
    jobsApiMock.getScientificJobStatus.mockReturnValue(
      of({
        id: 'cadma-invalid-result',
        status: 'completed',
        parameters: {},
        results: { ranking: [], metric_charts: [] },
      } as unknown as ScientificJobView),
    );

    workflowService.openHistoricalJob('cadma-invalid-result');

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toBe('Result payload is invalid.');
  });

  it('deletes persisted UUID drafts locally and remotely, including remote errors', () => {
    const draft = workflowService.savePausedDraft({
      referenceLibraryId: 'family-1',
      referenceLibraryName: 'Family',
      projectLabel: 'Persisted batch',
      combinedCsvText: '',
      smilesCsvText: 'smiles\nCCO',
      toxicityCsvText: '',
      saCsvText: '',
      sourceConfigsJson: '',
      scoreConfigJson: '',
      filenames: [],
      totalFiles: 0,
      totalUsableRows: 1,
    }, ['123e4567', 'e89b', '12d3', 'a456', '426614174000'].join('-'));
    jobsApiMock.deleteJob.mockReturnValueOnce(of({ detail: 'deleted', jobId: draft.id }));

    workflowService.deletePausedDraft(draft.id);

    expect(workflowService.pausedDrafts()).toEqual([]);
    expect(jobsApiMock.deleteJob).toHaveBeenCalledWith(draft.id);
    expect(jobsApiMock.listJobs).toHaveBeenCalled();

    const secondDraft = workflowService.savePausedDraft({
      referenceLibraryId: draft.referenceLibraryId,
      referenceLibraryName: draft.referenceLibraryName,
      projectLabel: draft.projectLabel,
      combinedCsvText: draft.combinedCsvText,
      smilesCsvText: draft.smilesCsvText,
      toxicityCsvText: draft.toxicityCsvText,
      saCsvText: draft.saCsvText,
      sourceConfigsJson: draft.sourceConfigsJson,
      scoreConfigJson: draft.scoreConfigJson,
      filenames: draft.filenames,
      totalFiles: draft.totalFiles,
      totalUsableRows: draft.totalUsableRows,
    }, ['123e4567', 'e89b', '12d3', 'a456', '426614174001'].join('-'));
    jobsApiMock.deleteJob.mockReturnValueOnce(throwError(() => new Error('remote unavailable')));
    workflowService.deletePausedDraft(secondDraft.id);
    expect(workflowService.pausedDrafts()).toEqual([]);
  });

  it('normalizes persisted drafts and falls back for invalid field types', () => {
    localStorage.setItem(
      'chemistry-apps.cadma-py.paused-drafts.v1',
      JSON.stringify([
        {
          id: 'normalized',
          referenceLibraryId: 42,
          projectLabel: '  Label  ',
          filenames: ['candidate.csv', 7],
          totalFiles: 'invalid',
          totalUsableRows: Number.POSITIVE_INFINITY,
          persistedInJobsMonitor: 'yes',
        },
        'not-a-draft',
      ]),
    );
    const injector: Injector = Injector.create({
      providers: [
        { provide: JobAccessModeService, useValue: { isOpenMode: () => false, mode: () => 'account' } },
        { provide: LocalResultsStore, useValue: { list: () => [], save: () => undefined, remove: () => undefined, clear: () => undefined } },
        CadmaPyWorkflowService,
        { provide: JobsApiService, useValue: jobsApiMock as unknown as JobsApiService },
        { provide: CadmaPyApiService, useValue: cadmaApiMock as unknown as CadmaPyApiService },
      ],
    });
    const freshService = runInInjectionContext(injector, () => injector.get(CadmaPyWorkflowService));

    expect(freshService.pausedDrafts()).toEqual([
      expect.objectContaining({
        id: 'normalized',
        referenceLibraryId: '',
        projectLabel: 'Label',
        filenames: ['candidate.csv'],
        totalFiles: 1,
        totalUsableRows: 0,
        persistedInJobsMonitor: false,
      }),
    ]);
  });
});
