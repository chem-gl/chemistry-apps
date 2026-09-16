// cadma-py.component.spec.ts: Pruebas de la interfaz principal de CADMA Py.

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CadmaPyApiService,
  CadmaPyResultView,
  CadmaReferenceLibraryView,
  CadmaReferenceSampleView,
} from '../core/api/cadma-py-api.service';
import { CadmaPyQuickFillService } from '../core/application/cadma-py-quick-fill.service';
import { CadmaPyWorkflowService } from '../core/application/cadma-py-workflow.service';
import { JobProgressSnapshotView, JobsApiService } from '../core/api/jobs-api.service';
import { CadmaPyComponent } from './cadma-py.component';

function makeLibrary(id = 'family-1'): CadmaReferenceLibraryView {
  return {
    id, name: 'Neuro family', disease_name: 'Neuro disease', description: 'Description',
    source_reference: 'local-lab', group_id: null, created_by_id: 1, created_by_name: 'User',
    editable: true, deletable: true, forkable: true, row_count: 1, rows: [], source_file_count: 0,
    source_files: [], paper_reference: 'Paper', paper_url: '', created_at: '', updated_at: '',
  };
}

function makeSample(): CadmaReferenceSampleView {
  return { key: 'neuro', name: 'Neuro sample', disease_name: 'Neuro disease', description: 'Seed', row_count: 2, source_note: 'Seed data' };
}

function makeResult(): CadmaPyResultView {
  return {
    library_name: 'Neuro family', disease_name: 'Neuro disease', reference_count: 1,
    candidate_count: 1, methodology_note: 'method',
    ranking: [{
      name: 'candidate-1', smiles: 'CCO', selection_score: 0.91, adme_alignment: 0.8,
      toxicity_alignment: 0.7, sa_alignment: 0.6, adme_hits_in_band: 7, MW: 46,
      logP: 1.2, MR: 10, AtX: 3, HBLA: 1, HBLD: 1, RB: 0, PSA: 20, DT: 0.2,
      M: 0.1, LD50: 450, SA: 84, metrics_in_band: ['MW'], best_fit_summary: 'Best fit',
    }],
    score_chart: { categories: ['candidate-1'], values: [0.91], reference_line: 0.5 },
    metric_charts: [{
      metric: 'MW', label: 'Molecular Weight', categories: ['candidate-1'], values: [46],
      reference_mean: 45, reference_low: 40, reference_high: 50, better_direction: 'balanced',
    }],
    reference_stats: [],
    score_config: {
      adme_intervals: {}, weights: { adme: 0.4, toxicity: 0.4, sa: 0.2 },
      reference_values: { LD50: 450, M: 0.12, DT: 0.2, SA: 84 }, adme_reference_hits: 8,
    },
  };
}

describe('CadmaPyComponent', () => {
  const workflowMock = {
    selectedReferenceLibraryId: signal(''), projectLabel: signal(''), sourceConfigsJson: signal(''),
    smilesCsvText: signal(''), combinedCsvText: signal(''), toxicityCsvText: signal(''), saCsvText: signal(''),
    combinedFile: signal<File | null>(null), smilesFile: signal<File | null>(null), toxicityFile: signal<File | null>(null), saFile: signal<File | null>(null),
    scoreConfigJson: signal(''), resultData: signal<CadmaPyResultView | null>(null),
    activeSection: signal<'idle' | 'dispatching' | 'progress' | 'result' | 'error'>('idle'),
    currentJobId: signal<string | null>(null), progressSnapshot: signal<JobProgressSnapshotView | null>(null),
    errorMessage: signal<string | null>(null), isProcessing: signal(false), progressPercentage: signal(0),
    resumedDraftId: signal(''),
    dispatch: vi.fn(), clearCandidateInputs: vi.fn(), loadHistory: vi.fn(), openHistoricalJob: vi.fn(),
    savePausedDraft: vi.fn(), deletePausedDraft: vi.fn(), resumePausedDraft: vi.fn(),
  };
  const apiMock = {
    listReferenceLibraries: vi.fn(() => of<CadmaReferenceLibraryView[]>([])),
    listReferenceSamples: vi.fn(() => of<CadmaReferenceSampleView[]>([])),
    previewReferenceSampleDetail: vi.fn(() => of(makeLibrary('sample-neuro'))),
    inspectSmileitStructure: vi.fn(() => of({ svg: '<svg />' })),
  };
  const quickFillMock = { loadSourceJobs: vi.fn(() => of({ smileitJobs: [], toxicityJobs: [], saScoreJobs: [] })) };
  const jobsApiMock = { inspectSmileitStructure: vi.fn(() => of({ svg: '<svg />' })) };
  const translocoMock = { translate: vi.fn((key: string) => key) };

  beforeEach(() => {
    vi.clearAllMocks();
    workflowMock.selectedReferenceLibraryId.set('');
    workflowMock.projectLabel.set('');
    workflowMock.sourceConfigsJson.set('');
    workflowMock.smilesCsvText.set('');
    workflowMock.combinedCsvText.set('');
    workflowMock.scoreConfigJson.set('');
    workflowMock.resultData.set(null);
    workflowMock.activeSection.set('idle');
    workflowMock.currentJobId.set(null);
    workflowMock.progressSnapshot.set(null);
    workflowMock.errorMessage.set(null);
    workflowMock.isProcessing.set(false);
    workflowMock.progressPercentage.set(0);
    TestBed.configureTestingModule({ imports: [CadmaPyComponent] });
    TestBed.overrideComponent(CadmaPyComponent, {
      set: {
        template: '',
        providers: [
          { provide: CadmaPyWorkflowService, useValue: workflowMock },
          { provide: CadmaPyApiService, useValue: apiMock },
          { provide: CadmaPyQuickFillService, useValue: quickFillMock },
          { provide: JobsApiService, useValue: jobsApiMock },
          { provide: ActivatedRoute, useValue: {} },
          { provide: TranslocoService, useValue: translocoMock },
        ],
      },
    });
  });

  it('carga familias, muestras y jobs rápidos al crear el componente', () => {
    const fixture = TestBed.createComponent(CadmaPyComponent);
    const component = fixture.componentInstance;
    const library = makeLibrary();
    const sample = makeSample();
    apiMock.listReferenceLibraries.mockReturnValueOnce(of([library]));
    apiMock.listReferenceSamples.mockReturnValueOnce(of([sample]));
    // La carga se ejecuta en el constructor; las señales iniciales documentan el contrato.
    component.refreshLibraries();
    component.refreshSamples();

    expect(apiMock.listReferenceLibraries).toHaveBeenCalled();
    expect(apiMock.listReferenceSamples).toHaveBeenCalled();
    expect(quickFillMock.loadSourceJobs).toHaveBeenCalled();
  });

  it('combina familias guardadas y muestras, y formatea métricas', () => {
    const component = TestBed.createComponent(CadmaPyComponent).componentInstance;
    component.libraries.set([makeLibrary()]);
    component.samples.set([makeSample()]);

    expect(component.combinedFamilies().map((family) => family.id)).toEqual(['sample-neuro', 'family-1']);
    expect(component.combinedFamilies()[0]?.isSeed).toBe(true);
    expect(component.formatPreviewMetric(null)).toBe('—');
    expect(component.formatPreviewMetric(1, true)).toBe('True');
    expect(component.formatPreviewMetric(0, true)).toBe('False');
    expect(component.formatPreviewMetric(1.234)).toBe('1.23');
  });

  it('selecciona una familia y calcula los pasos iniciales del flujo', () => {
    const component = TestBed.createComponent(CadmaPyComponent).componentInstance;
    component.libraries.set([makeLibrary()]);
    component.selectLibrary('family-1');
    workflowMock.projectLabel.set('Candidate batch');
    workflowMock.smilesCsvText.set('smiles\nCCO');

    expect(workflowMock.selectedReferenceLibraryId()).toBe('family-1');
    expect(component.selectedLibrary()?.name).toBe('Neuro family');
    expect(component.canAdvanceToFormulaStep()).toBe(true);
    expect(component.activeStep()).toBe(2);
  });

  it('rechaza ejecutar sin familia o etiqueta y despacha con datos válidos', () => {
    const component = TestBed.createComponent(CadmaPyComponent).componentInstance;
    component.runComparison();
    expect(component.libraryErrorMessage()).toContain('Select a reference family');
    expect(workflowMock.dispatch).not.toHaveBeenCalled();

    workflowMock.selectedReferenceLibraryId.set('family-1');
    component.runComparison();
    expect(component.candidateDraftMessage()).toContain('Project label is required');

    workflowMock.projectLabel.set('Batch one');
    workflowMock.smilesCsvText.set('smiles\nCCO');
    component.runComparison();
    expect(workflowMock.dispatch).toHaveBeenCalled();
    expect(component.candidateReviewStep()).toBe(4);
  });

  it('maneja el error de carga de familias sin lanzar', () => {
    apiMock.listReferenceLibraries.mockReturnValueOnce(throwError(() => new Error('API down')));
    const component = TestBed.createComponent(CadmaPyComponent).componentInstance;
    component.refreshLibraries();
    expect(component.libraryErrorMessage()).toBe('Unable to load reference families: API down');
  });

  it('actualiza entradas importadas y limpia los CSV previos', () => {
    const component = TestBed.createComponent(CadmaPyComponent).componentInstance;
    workflowMock.combinedCsvText.set('old csv');
    component.onCandidateImportChanged({
      sourceConfigsJson: '[{"filename":"guide.csv"}]', totalFiles: 1,
      totalUsableRows: 3, filenames: ['guide.csv'],
    });

    expect(workflowMock.sourceConfigsJson()).toContain('guide.csv');
    expect(workflowMock.combinedCsvText()).toBe('');
    expect(component.candidateImportedTotalUsableRows()).toBe(3);
    expect(component.candidateImportedFilenames()).toEqual(['guide.csv']);
  });

  it('cubre las transiciones del workflow y sus computeds de procesamiento y progreso', () => {
    const component = TestBed.createComponent(CadmaPyComponent).componentInstance;
    const states: Array<'idle' | 'dispatching' | 'progress' | 'result' | 'error'> = [
      'idle', 'dispatching', 'progress', 'result', 'error',
    ];

    for (const state of states) {
      workflowMock.activeSection.set(state);
      workflowMock.isProcessing.set(state === 'dispatching' || state === 'progress');
      expect(workflowMock.activeSection()).toBe(state);
      expect(workflowMock.isProcessing()).toBe(state === 'dispatching' || state === 'progress');
    }

    workflowMock.progressSnapshot.set({
      job_id: 'job-1', status: 'running', progress_percentage: 42, progress_event_index: 1,
      updated_at: '2026-01-01T00:00:00Z',
      progress_stage: 'running', progress_message: 'Scoring candidates',
    });
    workflowMock.progressPercentage.set(42);
    expect(workflowMock.progressSnapshot()?.progress_stage).toBe('running');
    expect(workflowMock.progressPercentage()).toBe(42);
  });

  it('selecciona neuro y rett, y alterna sus previews expandibles', () => {
    const component = TestBed.createComponent(CadmaPyComponent).componentInstance;
    const rett = { ...makeSample(), key: 'rett', name: 'Rett sample' };
    component.samples.set([makeSample(), rett]);
    const event = { stopPropagation: vi.fn() } as unknown as Event;

    component.toggleSamplePreview('neuro', event);
    expect(component.browsingSampleKey()).toBe('neuro');
    component.toggleSamplePreview('neuro', event);
    expect(component.browsingSampleKey()).toBe('');
    component.toggleSamplePreview('rett', event);
    expect(component.browsingSampleKey()).toBe('rett');
    expect(event.stopPropagation).toHaveBeenCalledTimes(3);
  });

  it('soporta las vías Smile-it, jobs previos y CSV manual', () => {
    const component = TestBed.createComponent(CadmaPyComponent).componentInstance;
    component.candidatePathway.set('generate');
    expect(component.candidatePathway()).toBe('generate');
    component.candidatePathway.set('reuse');
    component.quickFillSmileitJobId.set('smile-job');
    workflowMock.projectLabel.set('Reuse batch');
    component.updateQuickFillSaMethod('rdkit');
    expect(component.candidatePathway()).toBe('reuse');
    expect(component.canApplyQuickFill()).toBe(true);

    component.candidatePathway.set('manual');
    component.onCandidateImportChanged({
      sourceConfigsJson: '[{"filename":"candidates.csv"}]', totalFiles: 1,
      totalUsableRows: 2, filenames: ['candidates.csv'],
    });
    expect(component.candidatePathway()).toBe('manual');
    expect(component.hasCandidateInput()).toBe(true);
    expect(component.step2Summary()).toContain('2 candidates');
  });

  it('actualiza pesos, referencias e intervalos, y puede restaurar la fórmula', () => {
    const component = TestBed.createComponent(CadmaPyComponent).componentInstance;
    component.updateFormulaWeight('adme', '-1');
    component.updateFormulaWeight('sa', '0.35');
    component.updateFormulaReference('LD50', 'not-a-number');
    component.updateFormulaInterval('MW', 'min', '250');

    expect(component.formulaWeights().adme).toBe(0);
    expect(component.formulaWeights().sa).toBe(0.35);
    expect(component.formulaReferences().LD50).toBe(450);
    expect(component.scoreIntervals().MW.min).toBe(250);
    expect(JSON.parse(workflowMock.scoreConfigJson()).weights.sa).toBe(0.35);

    component.resetScoreConfig();
    expect(component.scoreWeightTotal()).toBe(1);
    expect(component.scoreIntervals().MW.min).toBe(200);
  });

  it('despacha correctamente y conserva el error de dispatch', () => {
    const component = TestBed.createComponent(CadmaPyComponent).componentInstance;
    workflowMock.selectedReferenceLibraryId.set('family-1');
    workflowMock.projectLabel.set('Batch one');
    workflowMock.smilesCsvText.set('smiles\nCCO');
    workflowMock.dispatch.mockImplementationOnce(() => {
      workflowMock.activeSection.set('dispatching');
      workflowMock.isProcessing.set(true);
    });
    component.runComparison();
    expect(workflowMock.dispatch).toHaveBeenCalledOnce();
    expect(component.activeStep()).toBe(3);
    expect(workflowMock.activeSection()).toBe('dispatching');

    workflowMock.dispatch.mockImplementationOnce(() => {
      workflowMock.activeSection.set('error');
      workflowMock.errorMessage.set('Unable to create CADMA Py job: backend down');
      workflowMock.isProcessing.set(false);
    });
    component.runComparison();
    expect(workflowMock.activeSection()).toBe('error');
    expect(workflowMock.errorMessage()).toContain('backend down');
  });

  it('expone resultados, gráficas y selección de un compuesto', () => {
    const component = TestBed.createComponent(CadmaPyComponent).componentInstance;
    const result = makeResult();
    workflowMock.selectedReferenceLibraryId.set('family-1');
    workflowMock.projectLabel.set('Result batch');
    workflowMock.smilesCsvText.set('smiles\nCCO');
    workflowMock.resultData.set(result);
    workflowMock.activeSection.set('result');
    component.candidateReviewStep.set(4);

    expect(component.activeStep()).toBe(4);
    expect(component.topCandidate()?.smiles).toBe('CCO');
    expect(component.metricOptions()).toEqual(['MW']);
    expect(component.activeMetricChart()?.metric).toBe('MW');
    expect(component.scoreChartOptions()).not.toBeNull();
    expect(component.metricChartOptions()).not.toBeNull();

    component.onScoreChartClick({ seriesType: 'scatter', data: { smiles: 'CCO' } });
    expect(component.chartCompound()?.name).toBe('candidate-1');
    expect(component.chartCompoundBusy()).toBe(false);
    component.closeChartCompound();
    expect(component.chartCompound()).toBeNull();
  });

  it('acepta candidatos, vuelve a fórmula y limpia la selección', () => {
    const component = TestBed.createComponent(CadmaPyComponent).componentInstance;
    workflowMock.selectedReferenceLibraryId.set('family-1');
    workflowMock.projectLabel.set('Batch one');
    workflowMock.smilesCsvText.set('smiles\nCCO');
    component.acceptCandidateInputs();
    expect(component.candidateReviewStep()).toBe(3);
    expect(component.activeStep()).toBe(3);
    component.returnToFormulaStep();
    expect(component.candidateDraftMessage()).toContain('Back to formula');
    component.clearReferenceSelection();
    expect(workflowMock.selectedReferenceLibraryId()).toBe('');
    expect(component.activeStep()).toBe(1);
  });
});
