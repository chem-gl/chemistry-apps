// cadma-py.component.spec.ts: Pruebas de la interfaz principal de CADMA Py.

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CadmaPyApiService, CadmaReferenceLibraryView, CadmaReferenceSampleView } from '../core/api/cadma-py-api.service';
import { CadmaPyQuickFillService } from '../core/application/cadma-py-quick-fill.service';
import { CadmaPyWorkflowService } from '../core/application/cadma-py-workflow.service';
import { JobsApiService } from '../core/api/jobs-api.service';
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

describe('CadmaPyComponent', () => {
  const workflowMock = {
    selectedReferenceLibraryId: signal(''), projectLabel: signal(''), sourceConfigsJson: signal(''),
    smilesCsvText: signal(''), combinedCsvText: signal(''), toxicityCsvText: signal(''), saCsvText: signal(''),
    combinedFile: signal<File | null>(null), smilesFile: signal<File | null>(null), toxicityFile: signal<File | null>(null), saFile: signal<File | null>(null),
    scoreConfigJson: signal(''), resultData: signal<null>(null), isProcessing: signal(false), resumedDraftId: signal(''),
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
});
