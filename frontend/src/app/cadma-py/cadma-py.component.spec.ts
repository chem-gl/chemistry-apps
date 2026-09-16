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
import { JobProgressSnapshotView, JobsApiService, ScientificJobView } from '../core/api/jobs-api.service';
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
    previewLibraryDeletion: vi.fn(() => of({ linked_jobs: [] })),
    deleteReferenceLibrary: vi.fn(() => of({ detail: 'deleted' })),
    createComparisonJob: vi.fn(() => of({ id: 'paused-job' })),
    createReferenceLibrary: vi.fn(() => of(makeLibrary('created-family'))),
    updateReferenceLibrary: vi.fn(() => of(makeLibrary('updated-family'))),
  };
  const quickFillMock = {
    loadSourceJobs: vi.fn(() => of({ smileitJobs: [], toxicityJobs: [], saScoreJobs: [] })),
    launchAutoFillFromSmileitJob: vi.fn(() => of({
      sourceConfigsJson: '[{"filename":"guide.csv"}]', filenames: ['guide.csv'], totalFiles: 1,
      totalUsableRows: 1, launchedToxicityJobId: 'tox-1', launchedSaScoreJobId: 'sa-1',
    })),
    launchAutoFillFromCurrentGuide: vi.fn(() => of({
      sourceConfigsJson: '[{"filename":"guide.csv"}]', filenames: ['guide.csv'], totalFiles: 1,
      totalUsableRows: 1, launchedToxicityJobId: '', launchedSaScoreJobId: '',
    })),
    buildAutoFillPayload: vi.fn(() => of({
      sourceConfigsJson: '[{"filename":"guide.csv"}]', filenames: ['guide.csv'], totalFiles: 1,
      totalUsableRows: 1,
    })),
  };
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

  it('maneja errores de jobs rápidos, muestras y previews', () => {
    quickFillMock.loadSourceJobs.mockReturnValueOnce(throwError(() => new Error('jobs down')));
    apiMock.listReferenceSamples.mockReturnValueOnce(throwError(() => new Error('samples down')));
    const component = TestBed.createComponent(CadmaPyComponent).componentInstance;
    expect(component.quickFillErrorMessage()).toBe('Unable to load previous jobs: jobs down');
    expect(component.samples()).toEqual([]);

    apiMock.previewReferenceSampleDetail.mockReturnValueOnce(throwError(() => new Error('preview down')));
    component.browseSample('neuro');
    expect(component.libraryErrorMessage()).toBe('Unable to load the full bundled reference detail.');
    component.browseSample('neuro');
    expect(component.browsingSampleKey()).toBe('');
  });

  it('protege quick fill sin selección y cubre éxito y error de las tres vías', () => {
    const component = TestBed.createComponent(CadmaPyComponent).componentInstance;
    component.launchQuickFillFromSelectedSmileit();
    expect(component.quickFillErrorMessage()).toContain('Select a completed Smile-it job');
    component.quickFillSmileitJobId.set('smile-1');
    component.launchQuickFillFromSelectedSmileit();
    expect(component.quickFillErrorMessage()).toBe('Select the SA method before continuing.');

    component.updateQuickFillSaMethod('rdkit');
    component.launchQuickFillFromSelectedSmileit();
    expect(quickFillMock.launchAutoFillFromSmileitJob).toHaveBeenCalledWith('smile-1', 'rdkit');
    expect(component.candidateImportedFilenames()).toEqual(['guide.csv']);

    quickFillMock.launchAutoFillFromSmileitJob.mockReturnValueOnce(throwError(() => new Error('launch down')));
    component.quickFillSmileitJobId.set('smile-1');
    component.launchQuickFillFromSelectedSmileit();
    expect(component.quickFillErrorMessage()).toBe('Unable to generate the Smile-it reports: launch down');

    workflowMock.sourceConfigsJson.set('[{"filename":"guide.csv","content_text":"smiles,name\\nCCO,Ethanol\\n","smiles_column":"smiles","name_column":"name"}]');
    component.updateQuickFillSaMethod('rdkit');
    component.launchQuickFillFromCurrentGuide();
    expect(quickFillMock.launchAutoFillFromCurrentGuide).toHaveBeenCalled();
    component.updateQuickFillSaMethod('');
    component.quickFillSmileitJobId.set('smile-1');
    component.applyQuickFillFromPreviousJobs();
    expect(component.quickFillErrorMessage()).toBe('Select the SA method before continuing.');
  });

  it('valida y guarda un borrador pausado, y maneja su ausencia o error', () => {
    const component = TestBed.createComponent(CadmaPyComponent).componentInstance;
    component.savePausedProgress();
    expect(component.candidateDraftMessage()).toContain('Project label is required');
    workflowMock.projectLabel.set('Draft');
    component.savePausedProgress();
    expect(component.candidateDraftMessage()).toContain('Select a reference family');
    workflowMock.selectedReferenceLibraryId.set('family-1');
    component.savePausedProgress();
    expect(component.candidateDraftMessage()).toContain('main SMILES guide');
    workflowMock.smilesCsvText.set('smiles\nCCO');
    workflowMock.savePausedDraft.mockReturnValueOnce({ projectLabel: 'Draft' });
    component.savePausedProgress();
    expect(apiMock.createComparisonJob).toHaveBeenCalledWith(expect.objectContaining({ start_paused: true }));
    expect(component.candidateDraftMessage()).toContain('Paused job saved');

    workflowMock.resumePausedDraft.mockReturnValueOnce(null);
    component.resumePausedProgress('missing');
    expect(component.candidateDraftMessage()).toContain('no longer available');
    component.deletePausedProgress('draft-1');
    expect(component.candidateDraftMessage()).toBe('Paused draft removed.');
  });

  it('cubre etiquetas, selección transitoria y controles de overlays', () => {
    const component = TestBed.createComponent(CadmaPyComponent).componentInstance;
    expect(component.scopeIcon('root')).toBe('');
    expect(component.scopeLabel('root')).toBe('cadmaPy.scopeLabels.root');
    expect(component.scopeLabel('admin-team')).toBe('cadmaPy.scopeLabels.group');
    expect(component.scopeLabel('local-lab')).toBe('cadmaPy.scopeLabels.personal');
    expect(component.scopeLabel('other')).toBe('');
    expect(component.scopeCssClass('other')).toBe('scope-unknown');
    component.showDiagram.set(true);
    component.onDiagramBackdropClick({ target: { classList: { contains: (value: string) => value === 'diagram-overlay' } } } as unknown as Event);
    expect(component.showDiagram()).toBe(false);
    component.expandChart('score');
    expect(component.expandedChart()).toBe('score');
    component.onExpandedChartBackdrop({ target: { classList: { contains: (value: string) => value === 'chart-expand-overlay' } } } as unknown as Event);
    expect(component.expandedChart()).toBeNull();
  });

  it('aplica quick fill desde guía y jobs previos, incluyendo errores', () => {
    const component = TestBed.createComponent(CadmaPyComponent).componentInstance;
    workflowMock.projectLabel.set('Batch');
    component.updateQuickFillSaMethod('rdkit');
    workflowMock.sourceConfigsJson.set(
      '[{"filename":"guide.csv","content_text":"smiles,name\\nCCO,Ethanol","smiles_column":"smiles","name_column":"name"}]',
    );

    component.launchQuickFillFromCurrentGuide();
    expect(quickFillMock.launchAutoFillFromCurrentGuide).toHaveBeenCalled();
    expect(component.candidateDraftMessage()).toContain('Quick fill completed');

    component.updateQuickFillSaMethod('rdkit');
    component.quickFillSmileitJobId.set('smile-1');
    component.applyQuickFillFromPreviousJobs();
    expect(quickFillMock.buildAutoFillPayload).toHaveBeenCalledWith(expect.objectContaining({ saMethod: 'rdkit' }));

    quickFillMock.buildAutoFillPayload.mockReturnValueOnce(throwError(() => new Error('payload down')));
    component.applyQuickFillFromPreviousJobs();
    expect(component.quickFillErrorMessage()).toBe('Unable to auto-fill candidate values: payload down');
  });

  it('carga jobs rápidos, filtra el método SA y conserva errores de selección', () => {
    const component = TestBed.createComponent(CadmaPyComponent).componentInstance;
    const saJob = { id: 'sa-1', parameters: { methods: ['rdkit'] } } as unknown as ScientificJobView;
    quickFillMock.loadSourceJobs.mockReturnValueOnce(
      of({ smileitJobs: [], toxicityJobs: [], saScoreJobs: [saJob] }) as ReturnType<typeof quickFillMock.loadSourceJobs>,
    );
    component.quickFillSaScoreJobId.set('sa-1');
    component.quickFillSaMethod.set('ambit');
    component.loadQuickFillJobs();

    expect(component.quickFillSaScoreJobId()).toBe('sa-1');
    expect(component.quickFillSaMethod()).toBe('');
    component.updateQuickFillSaJob('sa-1');
    expect(component.quickFillAvailableSaMethods()).toEqual(['rdkit']);
  });

  it('guarda y actualiza familias, importa archivos CSV y sincroniza cambios', async () => {
    const component = TestBed.createComponent(CadmaPyComponent).componentInstance;
    component.libraryName.set(' New family ');
    component.diseaseName.set(' Disease ');
    const file = { name: 'reference.csv', text: vi.fn(() => Promise.resolve('smiles,name\nCCO,Ethanol')) } as unknown as File;
    const input = { files: { item: (index: number) => index === 0 ? file : null } } as unknown as HTMLInputElement;
    await component.onReferenceFileChange('combined', { target: input } as unknown as Event);
    await component.onCandidateFileChange('smiles', { target: input } as unknown as Event);

    expect(workflowMock.smilesCsvText()).toContain('Ethanol');
    component.saveReferenceLibrary();
    expect(apiMock.createReferenceLibrary).toHaveBeenCalledWith(expect.objectContaining({ name: 'New family' }));

    component.libraries.set([makeLibrary()]);
    component.selectLibrary('family-1');
    component.saveReferenceLibrary();
    expect(apiMock.updateReferenceLibrary).toHaveBeenCalledWith('family-1', expect.anything());
  });

  it('explora, elimina y reanuda borradores pausados', () => {
    const component = TestBed.createComponent(CadmaPyComponent).componentInstance;
    component.libraries.set([makeLibrary()]);
    component.browseLibrary('family-1');
    expect(component.browsingLibrary()?.id).toBe('family-1');
    component.confirmBrowsingSelection();
    expect(workflowMock.selectedReferenceLibraryId()).toBe('family-1');

    const event = { stopPropagation: vi.fn() } as unknown as Event;
    component.deleteLibrary({ ...makeLibrary(), deletable: false }, event);
    expect(apiMock.previewLibraryDeletion).not.toHaveBeenCalled();
    component.deleteLibrary(makeLibrary(), event);
    expect(apiMock.previewLibraryDeletion).toHaveBeenCalledWith('family-1');

    workflowMock.resumePausedDraft.mockReturnValueOnce({
      referenceLibraryId: 'family-1', referenceLibraryName: 'Neuro family', projectLabel: 'Resumed',
      combinedCsvText: '', smilesCsvText: 'smiles\nCCO', toxicityCsvText: '', saCsvText: '',
      sourceConfigsJson: '[{"filename":"guide.csv"}]', scoreConfigJson: '', filenames: ['guide.csv'],
      totalFiles: 1, totalUsableRows: 1,
    });
    component.resumePausedProgress('draft-1');
    expect(component.candidateDraftMessage()).toContain('Resumed paused draft');
    expect(component.candidateImportedFilenames()).toEqual(['guide.csv']);
  });

  it('maneja inspección de gráficas, progreso pausado y exportación', () => {
    const component = TestBed.createComponent(CadmaPyComponent).componentInstance;
    workflowMock.selectedReferenceLibraryId.set('family-1');
    workflowMock.projectLabel.set('Batch');
    workflowMock.sourceConfigsJson.set('[{"filename":"guide.csv"}]');
    expect(component.canPauseCurrentProgress()).toBe(true);
    workflowMock.progressSnapshot.set({ job_id: 'job', status: 'paused', progress_percentage: 55, progress_event_index: 2, updated_at: '', progress_stage: 'paused', progress_message: 'Paused' });
    workflowMock.progressPercentage.set(55);
    expect(workflowMock.progressSnapshot()?.status).toBe('paused');

    const result = makeResult();
    workflowMock.resultData.set(result);
    jobsApiMock.inspectSmileitStructure.mockReturnValueOnce(throwError(() => new Error('inspect down')));
    component.onMetricChartClick({ seriesType: 'scatter', data: { smiles: 'CCO' } });
    expect(component.chartCompoundError()).toBe('Could not generate the molecule preview.');
    expect(component.formatChartCompoundValue(null)).toBe('—');
    expect(component.chartCompoundMetrics()).toHaveLength(12);
    component.exportSelectionCsv();
  });
});
