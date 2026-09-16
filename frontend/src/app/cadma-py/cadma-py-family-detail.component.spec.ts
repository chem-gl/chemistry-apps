// cadma-py-family-detail.component.spec.ts: Pruebas del detalle de familias CADMA Py.

import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CadmaPyApiService, CadmaReferenceLibraryView, CadmaReferenceRowView } from '../core/api/cadma-py-api.service';
import { JobsApiService } from '../core/api/jobs-api.service';
import { CadmaPyFamilyDetailComponent } from './cadma-py-family-detail.component';

function makeRow(overrides: Partial<CadmaReferenceRowView> = {}): CadmaReferenceRowView {
  return {
    name: 'Ethanol', smiles: 'CCO', MW: 46, logP: 0.3, MR: 12, AtX: 3, HBLA: 1, HBLD: 1,
    RB: 0, PSA: 20, DT: 0.1, M: 0.2, LD50: 300, SA: 2.1, paper_authors: 'A. Author',
    paper_reference: 'Paper', paper_url: '10.1234/example', evidence_note: 'note', ...overrides,
  };
}

function makeLibrary(overrides: Partial<CadmaReferenceLibraryView> = {}): CadmaReferenceLibraryView {
  return {
    id: 'family-1', name: 'Neuro family', disease_name: 'Neuro disease', description: 'Description',
    source_reference: 'local-lab', group_id: null, created_by_id: 1, created_by_name: 'User',
    editable: true, deletable: true, forkable: true, row_count: 2, rows: [makeRow(), makeRow({
      name: 'Benzene', smiles: 'c1ccccc1', MW: 78, logP: 2.1, DT: null as unknown as number,
    })], source_file_count: 0, source_files: [], paper_reference: 'Paper',
    paper_url: 'doi.org/10.1234/example', created_at: '2025-01-02T00:00:00Z',
    updated_at: '2025-01-03T00:00:00Z', ...overrides,
  };
}

describe('CadmaPyFamilyDetailComponent', () => {
  const apiMock = {
    updateReferenceLibrary: vi.fn(() => of(makeLibrary())),
    addCompoundToLibrary: vi.fn(() => of(makeRow())),
    patchReferenceRow: vi.fn(() => of(makeRow())),
    deleteReferenceRow: vi.fn(() => of({ detail: 'deleted' })),
    forkReferenceLibrary: vi.fn(() => of(makeLibrary({ id: 'family-copy' }))),
    importReferenceSample: vi.fn(() => of(makeLibrary({ id: 'family-imported' }))),
  };
  const jobsApiMock = { inspectSmileitStructure: vi.fn(() => of({ svg: '<svg />' })) };
  const translocoMock = { translate: vi.fn((key: string) => key) };

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({ imports: [CadmaPyFamilyDetailComponent] });
    TestBed.overrideComponent(CadmaPyFamilyDetailComponent, {
      set: {
        template: '',
        providers: [
          { provide: CadmaPyApiService, useValue: apiMock },
          { provide: JobsApiService, useValue: jobsApiMock },
          { provide: TranslocoService, useValue: translocoMock },
        ],
      },
    });
  });

  function createComponent(library: CadmaReferenceLibraryView = makeLibrary()) {
    const fixture = TestBed.createComponent(CadmaPyFamilyDetailComponent);
    fixture.componentRef.setInput('library', library);
    fixture.detectChanges();
    return fixture;
  }

  it('calcula alcance, estadísticas, URL DOI y fecha de la familia', () => {
    const component = createComponent().componentInstance;

    expect(component.scopeKind()).toBe('personal');
    expect(component.scopeConfig().cssClass).toBe('scope-personal');
    expect(component.metricStats().find((stat) => stat.key === 'MW')?.mean).toBe(62);
    expect(component.hasAnyNulls()).toBe(true);
    expect(component.paperUrl()).toBe('https://doi.org/10.1234/example');
    expect(component.createdDate()).toContain('Jan');
  });

  it('mantiene siempre un grupo visible y permite ocultar métricas', () => {
    const component = createComponent().componentInstance;

    component.toggleBoxplotGroup('ADME');
    component.toggleBoxplotGroup('Toxicity');
    component.toggleBoxplotGroup('SA Score');
    component.toggleBoxplotGroup('SA Score');
    component.toggleBoxplotMetric('MW');

    expect(component.visibleBoxplotGroups()).toEqual(new Set(['SA Score']));
    expect(component.isMetricHidden('MW')).toBe(true);
    expect(component.visibleMetricsForGroup('ADME').length).toBeGreaterThan(0);
  });

  it('guarda metadatos recortados y emite la familia actualizada', () => {
    const fixture = createComponent();
    const component = fixture.componentInstance;
    const changed = vi.fn();
    component.libraryChanged.subscribe(changed);

    component.startFamilyEdit();
    component.familyDraft.update((draft) => ({ ...draft, name: '  Updated family  ', disease_name: '  Updated disease ' }));
    component.saveFamilyEdit();

    expect(apiMock.updateReferenceLibrary).toHaveBeenCalledWith('family-1', expect.objectContaining({
      name: 'Updated family', disease_name: 'Updated disease',
    }));
    expect(component.editingFamily()).toBe(false);
    expect(changed).toHaveBeenCalledWith('family-1');
  });

  it('rechaza metadatos incompletos y muestra el error de API', () => {
    const fixture = createComponent();
    const component = fixture.componentInstance;
    component.startFamilyEdit();
    component.familyDraft.update((draft) => ({ ...draft, name: '' }));
    component.saveFamilyEdit();
    expect(component.familyEditError()).toBe('Name and disease are required.');
    expect(apiMock.updateReferenceLibrary).not.toHaveBeenCalled();

    apiMock.updateReferenceLibrary.mockReturnValueOnce(throwError(() => new Error('API down')));
    component.familyDraft.update((draft) => ({ ...draft, name: 'Valid name' }));
    component.saveFamilyEdit();
    expect(component.familyEditError()).toBe('API down');
    expect(component.familyEditBusy()).toBe(false);
  });

  it('valida y agrega un compuesto con valores numéricos opcionales', () => {
    const fixture = createComponent();
    const component = fixture.componentInstance;
    const changed = vi.fn();
    component.libraryChanged.subscribe(changed);

    component.submitAddCompound();
    expect(component.addError()).toBe('SMILES is required.');

    component.addSmiles.set('  CCN ');
    component.addName.set('  Ethylamine ');
    component.addDT.set('1.25');
    component.addM.set('');
    component.submitAddCompound();

    expect(apiMock.addCompoundToLibrary).toHaveBeenCalledWith('family-1', expect.objectContaining({
      smiles: 'CCN', name: 'Ethylamine', toxicity_dt: 1.25, toxicity_m: null,
    }));
    expect(component.showAddForm()).toBe(false);
    expect(changed).toHaveBeenCalledWith('family-1');
  });

  it('abre el detalle del compuesto y maneja error de inspección', () => {
    const fixture = createComponent();
    const component = fixture.componentInstance;
    const showModal = vi.fn();
    (component as unknown as { compoundDetailDialogRef: { nativeElement: HTMLDialogElement } }).compoundDetailDialogRef = {
      nativeElement: { showModal } as unknown as HTMLDialogElement,
    };
    jobsApiMock.inspectSmileitStructure.mockReturnValueOnce(throwError(() => new Error('down')));

    component.openCompoundDetail(makeRow());

    expect(showModal).toHaveBeenCalled();
    expect(component.selectedCompound()?.smiles).toBe('CCO');
    expect(component.compoundModalError()).toBe('Could not generate the molecule preview.');
    expect(component.compoundModalBusy()).toBe(false);
  });

  it('resuelve todos los scopes, etiquetas de acceso y métricas vacías', () => {
    const root = createComponent(makeLibrary({ source_reference: 'root', editable: false, deletable: false, forkable: false, created_at: '' })).componentInstance;
    expect(root.scopeKind()).toBe('root');
    expect(root.readOnlyGuidance()).toBe('cadmaPy.familyDetail.rootReadOnly');
    expect(root.editableLabel()).toBe('cadmaPy.familyDetail.readOnly');
    expect(root.createdDate()).toBe('—');

    const group = createComponent(makeLibrary({ source_reference: 'admin-team', editable: false, forkable: true })).componentInstance;
    expect(group.scopeKind()).toBe('group');
    expect(group.readOnlyGuidance()).toBe('cadmaPy.familyDetail.groupReadOnly');
    expect(group.editableLabel()).toBe('cadmaPy.familyDetail.readOnlyTemplate');

    const unknown = createComponent(makeLibrary({ source_reference: 'external', rows: [] })).componentInstance;
    expect(unknown.scopeKind()).toBe('unknown');
    expect(unknown.readOnlyGuidance()).toBe('cadmaPy.familyDetail.defaultReadOnly');
    expect(unknown.metricStats().every((stat) => stat.mean === 0 && stat.nullCount === 0)).toBe(true);
    expect(unknown.formatFileSize(512)).toBe('512 B');
    expect(unknown.formatFileSize(2048)).toBe('2.0 KB');
    expect(unknown.formatFileSize(2 * 1048576)).toBe('2.0 MB');
  });

  it('copia familias guardadas y muestras, incluyendo errores y cancelación', () => {
    const fixture = createComponent(makeLibrary({ id: 'family-1' }));
    const component = fixture.componentInstance;
    const copied = vi.fn();
    component.copiedLibraryCreated.subscribe(copied);
    component.forkFamily();
    component.copyDraftName.set('   ');
    component.confirmForkFamily();
    expect(component.forkError()).toBe('The new copied family needs a name.');

    component.copyDraftName.set('Copy');
    component.confirmForkFamily();
    expect(apiMock.forkReferenceLibrary).toHaveBeenCalledWith('family-1', 'Copy');
    expect(copied).toHaveBeenCalledWith('family-copy');
    component.forkFamily();
    component.cancelForkFamily();
    expect(component.showCopyForm()).toBe(false);

    const sample = createComponent(makeLibrary({ id: 'sample-neuro' })).componentInstance;
    const closed = vi.fn();
    sample.closeBrowsing.subscribe(closed);
    sample.forkFamily();
    sample.confirmForkFamily();
    expect(apiMock.importReferenceSample).toHaveBeenCalledWith('neuro', 'Neuro family Copy');
    expect(closed).toHaveBeenCalled();

    apiMock.forkReferenceLibrary.mockReturnValueOnce(throwError(() => new Error('fork down')));
    component.forkFamily();
    component.copyDraftName.set('Broken copy');
    component.confirmForkFamily();
    expect(component.forkError()).toBe('fork down');
    expect(component.forkBusy()).toBe(false);
  });

  it('edita, duplica y elimina filas con confirmación y errores', () => {
    const fixture = createComponent();
    const component = fixture.componentInstance;
    const changed = vi.fn();
    component.libraryChanged.subscribe(changed);

    component.startEditRow(0, makeRow());
    component.editDraft.update((draft) => ({ ...draft, name: 'Edited' }));
    component.saveRowEdit();
    expect(apiMock.patchReferenceRow).toHaveBeenCalledWith('family-1', 0, expect.objectContaining({ name: 'Edited' }));
    expect(component.editingRowIndex()).toBe(-1);

    apiMock.patchReferenceRow.mockReturnValueOnce(throwError(() => new Error('patch down')));
    component.startEditRow(0, makeRow());
    component.saveRowEdit();
    expect(component.rowActionError()).toBe('patch down');
    component.cancelEdit();

    component.duplicateRow(0);
    expect(apiMock.addCompoundToLibrary).toHaveBeenCalledWith('family-1', expect.objectContaining({ smiles: 'CCO' }));
    apiMock.deleteReferenceRow.mockReturnValueOnce(throwError(() => new Error('delete down')));
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    component.removeRow(0);
    expect(component.rowActionError()).toBe('delete down');
    expect(component.deletingRowIndex()).toBe(-1);
    expect(changed).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('navega compuestos, exporta y protege clicks inválidos', () => {
    const fixture = createComponent();
    const component = fixture.componentInstance;
    const showModal = vi.fn();
    const close = vi.fn();
    (component as unknown as { compoundDetailDialogRef: { nativeElement: HTMLDialogElement } }).compoundDetailDialogRef = {
      nativeElement: { showModal, close } as unknown as HTMLDialogElement,
    };
    component.onBoxplotChartClick({ seriesType: 'bar', data: { smiles: 'CCO' } });
    component.onBoxplotChartClick({ seriesType: 'scatter', data: {} });
    expect(component.selectedCompound()).toBeNull();
    component.openCompoundDetail(makeRow({ smiles: '  ' }));
    expect(showModal).not.toHaveBeenCalled();

    component.openCompoundDetail(makeRow(), 0, true);
    expect(component.isEditingCompound()).toBe(true);
    component.navigateCompound(-1);
    component.navigateCompound(1);
    expect(component.selectedCompound()?.name).toBe('Benzene');
    component.closeCompoundDetail();
    expect(close).toHaveBeenCalled();
    component.exportFamilyCsv();
    expect(component.rowPaperUrl(makeRow({ paper_url: '10.1234/test' }))).toBe('https://doi.org/10.1234/test');
  });

  it('calcula el detalle seleccionado y maneja inspección, navegación y diálogos', () => {
    const fixture = createComponent();
    const component = fixture.componentInstance;
    const showModal = vi.fn();
    const close = vi.fn();
    (component as unknown as { compoundDetailDialogRef: { nativeElement: HTMLDialogElement } }).compoundDetailDialogRef = {
      nativeElement: { showModal, close } as unknown as HTMLDialogElement,
    };
    component.openCompoundDetail(makeRow(), 0);
    expect(component.selectedCompoundAdme()).toHaveLength(8);
    expect(component.selectedCompoundToxicity()).toHaveLength(3);
    expect(component.selectedCompoundSA()?.values).toHaveLength(3);
    expect(component.hasNextCompound()).toBe(true);
    component.navigateCompound(1);
    expect(component.selectedCompound()?.name).toBe('Benzene');
    expect(component.hasPrevCompound()).toBe(true);
    component.onCompoundDialogBackdropClick({ target: { nodeName: 'DIV' } } as unknown as MouseEvent);
    component.closeCompoundDetail();
    expect(close).toHaveBeenCalled();

    const boxplotClose = vi.fn();
    (component as unknown as { boxplotDialogRef: { nativeElement: HTMLDialogElement } }).boxplotDialogRef = {
      nativeElement: { showModal, close: boxplotClose } as unknown as HTMLDialogElement,
    };
    component.openBoxplot();
    expect(component.boxplotOpen()).toBe(true);
    component.closeBoxplot();
    expect(boxplotClose).toHaveBeenCalled();
  });

  it('maneja errores de duplicado, alta y eliminación, incluida la cancelación', () => {
    const fixture = createComponent();
    const component = fixture.componentInstance;
    vi.spyOn(globalThis, 'confirm').mockReturnValue(false);
    component.removeRow(0);
    expect(apiMock.deleteReferenceRow).not.toHaveBeenCalled();
    vi.restoreAllMocks();

    apiMock.addCompoundToLibrary.mockReturnValueOnce(throwError(() => new Error('add down')));
    component.addSmiles.set('CCN');
    component.submitAddCompound();
    expect(component.addError()).toBe('add down');

    apiMock.addCompoundToLibrary.mockReturnValueOnce(throwError(() => new Error('duplicate down')));
    component.duplicateRow(0);
    expect(component.rowActionError()).toBe('duplicate down');
    expect(component.addBusy()).toBe(false);
  });

  it('abre edición automática y cubre etiquetas, formatos y exportación vacía', () => {
    const fixture = TestBed.createComponent(CadmaPyFamilyDetailComponent);
    fixture.componentRef.setInput('library', makeLibrary());
    fixture.componentRef.setInput('autoOpenEditorLibraryId', 'family-1');
    fixture.detectChanges();
    expect(fixture.componentInstance.editingFamily()).toBe(true);
    expect(fixture.componentInstance.selectionActionLabel()).toContain('cadmaPy.familyDetail');
    expect(fixture.componentInstance.trackStat(0, fixture.componentInstance.metricStats()[0]!)).toContain('MW');
    expect(fixture.componentInstance.formatMetricValue('RB', 2.8)).toBe('3');

    const emptyFixture = createComponent(makeLibrary({ rows: [], row_count: 0 }));
    expect(() => emptyFixture.componentInstance.exportFamilyCsv()).not.toThrow();
  });
});
