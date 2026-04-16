// cadma-py-workflow.service.spec.ts: Pruebas unitarias del workflow CADMA Py e historial recuperable.

import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CadmaPyApiService, CadmaPyResultView } from '../api/cadma-py-api.service';
import { JobLogsPageView, JobsApiService, ScientificJobView } from '../api/jobs-api.service';
import { CadmaPyWorkflowService } from './cadma-py-workflow.service';

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
  };

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
    };

    const injector: Injector = Injector.create({
      providers: [
        CadmaPyWorkflowService,
        { provide: JobsApiService, useValue: jobsApiMock as unknown as JobsApiService },
        {
          provide: CadmaPyApiService,
          useValue: { createComparisonJob: vi.fn() } as unknown as CadmaPyApiService,
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
});
