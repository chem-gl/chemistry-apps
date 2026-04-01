// sa-score.component.spec.ts: Pruebas unitarias del componente SA Score.
// Cubre delegación al workflow, cálculo de lineCount, métodos de formateo,
// manejo de export CSV, carga de archivos y comportamiento de diálogos.

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { JobsApiService, SaScoreMethod } from '../core/api/jobs-api.service';
import { KetcherFrameService } from '../core/application/ketcher-frame.service';
import { SaScoreWorkflowService } from '../core/application/sa-score-workflow.service';
import { SaScoreComponent } from './sa-score.component';

describe('SaScoreComponent', () => {
  const workflowMock = {
    smilesInput: signal<string>(''),
    selectedMethods: signal<Record<SaScoreMethod, boolean>>({
      ambit: true,
      brsa: true,
      rdkit: true,
    }),
    activeSection: signal<string>('idle'),
    currentJobId: signal<string | null>(null),
    progressSnapshot: signal<unknown>(null),
    jobLogs: signal<unknown[]>([]),
    resultData: signal<unknown>(null),
    errorMessage: signal<string | null>(null),
    exportErrorMessage: signal<string | null>(null),
    isExporting: signal<boolean>(false),
    historyJobs: signal<unknown[]>([]),
    isHistoryLoading: signal<boolean>(false),
    isProcessing: signal<boolean>(false),
    progressPercentage: signal<number>(0),
    progressMessage: signal<string>('Preparing...'),
    selectedMethodList: signal<SaScoreMethod[]>(['ambit', 'brsa', 'rdkit']),
    loadHistory: vi.fn(),
    dispatch: vi.fn(),
    reset: vi.fn(),
    openHistoricalJob: vi.fn(),
    toggleMethod: vi.fn(),
    downloadFullCsvReport: vi.fn(() =>
      of({ filename: 'sa_score_all.csv', blob: new Blob(['data'], { type: 'text/csv' }) }),
    ),
    downloadMethodCsvReport: vi.fn(() =>
      of({ filename: 'sa_ambit.csv', blob: new Blob(['data'], { type: 'text/csv' }) }),
    ),
  };

  const jobsApiMock = {
    inspectSmileitStructure: vi.fn(() => of({ svg: '<svg></svg>' })),
  };

  const ketcherServiceMock = {
    waitForApi: vi.fn(() => Promise.resolve(null)),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:mock-url'),
      revokeObjectURL: vi.fn(),
    });

    workflowMock.smilesInput.set('');
    workflowMock.currentJobId.set(null);
    workflowMock.activeSection.set('idle');
    workflowMock.resultData.set(null);

    TestBed.configureTestingModule({
      imports: [SaScoreComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({})) } },
      ],
    });

    TestBed.overrideComponent(SaScoreComponent, {
      set: {
        providers: [
          { provide: SaScoreWorkflowService, useValue: workflowMock },
          { provide: JobsApiService, useValue: jobsApiMock },
          { provide: KetcherFrameService, useValue: ketcherServiceMock },
          { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({})) } },
        ],
      },
    });
  });

  it('llama loadHistory al inicializar', () => {
    const fixture = TestBed.createComponent(SaScoreComponent);
    fixture.detectChanges();
    expect(workflowMock.loadHistory).toHaveBeenCalled();
  });

  it('abre job histórico cuando llega jobId por queryParams', () => {
    TestBed.overrideComponent(SaScoreComponent, {
      set: {
        providers: [
          { provide: SaScoreWorkflowService, useValue: workflowMock },
          { provide: JobsApiService, useValue: jobsApiMock },
          { provide: KetcherFrameService, useValue: ketcherServiceMock },
          {
            provide: ActivatedRoute,
            useValue: { queryParamMap: of(convertToParamMap({ jobId: 'sa-99' })) },
          },
        ],
      },
    });
    const fixture = TestBed.createComponent(SaScoreComponent);
    fixture.detectChanges();
    expect(workflowMock.openHistoricalJob).toHaveBeenCalledWith('sa-99');
  });

  it('delega dispatch, reset y openHistoricalJob al workflow', () => {
    const fixture = TestBed.createComponent(SaScoreComponent);
    const component = fixture.componentInstance;

    component.dispatch();
    component.reset();
    component.openHistoricalJob('sa-1');

    expect(workflowMock.dispatch).toHaveBeenCalled();
    expect(workflowMock.reset).toHaveBeenCalled();
    expect(workflowMock.openHistoricalJob).toHaveBeenCalledWith('sa-1');
  });

  it('lineCount cuenta líneas no vacías del smilesInput', () => {
    const fixture = TestBed.createComponent(SaScoreComponent);
    const component = fixture.componentInstance;

    workflowMock.smilesInput.set('CCO\nCC(=O)O\nc1ccccc1');
    expect(component.lineCount()).toBe(3);

    workflowMock.smilesInput.set('CCO\n\n  \nCC(=O)O');
    expect(component.lineCount()).toBe(2);

    workflowMock.smilesInput.set('');
    expect(component.lineCount()).toBe(0);
  });

  it('historicalStatusClass retorna clase CSS por estado', () => {
    const fixture = TestBed.createComponent(SaScoreComponent);
    const component = fixture.componentInstance;

    expect(component.historicalStatusClass('completed')).toBe('history-status history-completed');
    expect(component.historicalStatusClass('failed')).toBe('history-status history-failed');
    expect(component.historicalStatusClass('running')).toBe('history-status history-running');
    expect(component.historicalStatusClass('pending')).toBe('history-status history-pending');
  });

  it('methodScore retorna -- para null y formato 4 decimales para número', () => {
    const fixture = TestBed.createComponent(SaScoreComponent);
    const component = fixture.componentInstance;

    const molecule = {
      smiles: 'CCO',
      ambit_sa: 2.5,
      ambit_error: null,
      brsa_sa: null,
      brsa_error: 'some error',
      rdkit_sa: 1.2345,
      rdkit_error: null,
    } as Parameters<typeof component.methodScore>[0];

    expect(component.methodScore(molecule, 'ambit')).toBe('2.5000');
    expect(component.methodScore(molecule, 'brsa')).toBe('-');
    expect(component.methodScore(molecule, 'rdkit')).toBe('1.2345');
  });

  it('methodError retorna el error del método correcto o null', () => {
    const fixture = TestBed.createComponent(SaScoreComponent);
    const component = fixture.componentInstance;

    const molecule = {
      smiles: 'CCO',
      ambit_sa: null,
      ambit_error: 'ambit failed',
      brsa_sa: null,
      brsa_error: null,
      rdkit_sa: null,
      rdkit_error: 'rdkit failed',
    } as Parameters<typeof component.methodError>[0];

    expect(component.methodError(molecule, 'ambit')).toBe('ambit failed');
    expect(component.methodError(molecule, 'brsa')).toBeNull();
    expect(component.methodError(molecule, 'rdkit')).toBe('rdkit failed');
  });

  it('exportAllCsv llama downloadFullCsvReport y dispara descarga', () => {
    const fixture = TestBed.createComponent(SaScoreComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
    const createSpy = vi
      .spyOn(document, 'createElement')
      .mockReturnValue(anchor as unknown as HTMLAnchorElement);
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => document.body);

    component.exportAllCsv();

    expect(workflowMock.downloadFullCsvReport).toHaveBeenCalled();
    createSpy.mockRestore();
  });

  it('exportMethodCsv llama downloadMethodCsvReport con el método dado', () => {
    const fixture = TestBed.createComponent(SaScoreComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
    const createSpy = vi
      .spyOn(document, 'createElement')
      .mockReturnValue(anchor as unknown as HTMLAnchorElement);
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => document.body);

    component.exportMethodCsv('ambit');

    expect(workflowMock.downloadMethodCsvReport).toHaveBeenCalledWith('ambit');
    createSpy.mockRestore();
  });

  it('exportCsv llama exportAllCsv cuando el target es all', () => {
    const fixture = TestBed.createComponent(SaScoreComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
    const createSpy = vi
      .spyOn(document, 'createElement')
      .mockReturnValue(anchor as unknown as HTMLAnchorElement);
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => document.body);

    component.selectedExportTarget.set('all');
    component.exportCsv();

    expect(workflowMock.downloadFullCsvReport).toHaveBeenCalled();
    createSpy.mockRestore();
  });

  it('exportCsv llama exportMethodCsv cuando el target es un método', () => {
    const fixture = TestBed.createComponent(SaScoreComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
    const createSpy = vi
      .spyOn(document, 'createElement')
      .mockReturnValue(anchor as unknown as HTMLAnchorElement);
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => document.body);

    component.selectedExportTarget.set('brsa');
    component.exportCsv();

    expect(workflowMock.downloadMethodCsvReport).toHaveBeenCalledWith('brsa');
    createSpy.mockRestore();
  });

  it('onSketchDraftSmilesChange actualiza sketchDraftSmiles', () => {
    const fixture = TestBed.createComponent(SaScoreComponent);
    const component = fixture.componentInstance;

    component.onSketchDraftSmilesChange('CCO');
    expect(component.sketchDraftSmiles).toBe('CCO');
  });

  it('onKetcherFrameLoaded marca isKetcherReady como true', () => {
    const fixture = TestBed.createComponent(SaScoreComponent);
    const component = fixture.componentInstance;

    expect(component.isKetcherReady).toBe(false);
    component.onKetcherFrameLoaded();
    expect(component.isKetcherReady).toBe(true);
  });

  it('closeSketchDialog pone isSketchDialogLoading en false', () => {
    const fixture = TestBed.createComponent(SaScoreComponent);
    const component = fixture.componentInstance;

    component.isSketchDialogLoading.set(true);
    component.closeSketchDialog();
    expect(component.isSketchDialogLoading()).toBe(false);
  });

  it('onFileUpload ignora event sin archivos', () => {
    const fixture = TestBed.createComponent(SaScoreComponent);
    const component = fixture.componentInstance;
    const event = { target: { files: null, value: '' } } as unknown as Event;

    component.onFileUpload(event);
    expect(workflowMock.smilesInput()).toBe('');
  });

  it('openMoleculeImageModal no hace nada para SMILES vacío', () => {
    const fixture = TestBed.createComponent(SaScoreComponent);
    const component = fixture.componentInstance;

    component.openMoleculeImageModal('');
    expect(jobsApiMock.inspectSmileitStructure).not.toHaveBeenCalled();
  });

  it('openMoleculeImageModal llama inspectSmileitStructure con el SMILES dado', () => {
    const fixture = TestBed.createComponent(SaScoreComponent);
    // No se llama a detectChanges para que el @ViewChild del diálogo no se inicialice
    // y se evite el error de showModal() no disponible en JSDOM
    const component = fixture.componentInstance;

    component.openMoleculeImageModal('CCO');

    expect(jobsApiMock.inspectSmileitStructure).toHaveBeenCalledWith('CCO');
    expect(component.moleculeModalSmiles()).toBe('CCO');
  });

  it('onSketchDialogBackdropClick ignora eventos de teclado', () => {
    const fixture = TestBed.createComponent(SaScoreComponent);
    const component = fixture.componentInstance;
    const keyEvent = new KeyboardEvent('keydown', { key: 'Escape' });
    // No lanza error
    component.onSketchDialogBackdropClick(keyEvent);
  });

  it('onMoleculeImageDialogBackdropClick ignora eventos de teclado', () => {
    const fixture = TestBed.createComponent(SaScoreComponent);
    const component = fixture.componentInstance;
    const keyEvent = new KeyboardEvent('keydown', { key: 'Escape' });
    component.onMoleculeImageDialogBackdropClick(keyEvent);
  });

  it('ngOnDestroy cancela la suscripción de ruta', () => {
    const fixture = TestBed.createComponent(SaScoreComponent);
    fixture.detectChanges();
    expect(() => fixture.destroy()).not.toThrow();
  });

  it('openSketchDialog llama showModal en el diálogo y activa isSketchDialogLoading', () => {
    const fixture = TestBed.createComponent(SaScoreComponent);
    const component = fixture.componentInstance;
    const showModalSpy = vi.fn();
    const closeSpy = vi.fn();

    (
      component as unknown as { sketchDialogRef: { nativeElement: HTMLDialogElement } }
    ).sketchDialogRef = {
      nativeElement: {
        showModal: showModalSpy,
        close: closeSpy,
        getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 100 }) as DOMRect,
      } as unknown as HTMLDialogElement,
    };

    component.openSketchDialog();

    expect(showModalSpy).toHaveBeenCalled();
    expect(component.isSketchDialogLoading()).toBe(true);
    expect(component.sketchDraftSmiles).toBe('');
  });

  it('onSketchDialogBackdropClick sin referencia de diálogo retorna sin error', () => {
    const fixture = TestBed.createComponent(SaScoreComponent);
    const component = fixture.componentInstance;
    // sketchDialogRef permanece undefined — debe retornar sin lanzar
    expect(() =>
      component.onSketchDialogBackdropClick(
        new MouseEvent('click', { clientX: 200, clientY: 200 }),
      ),
    ).not.toThrow();
  });

  it('onSketchDialogBackdropClick cierra el diálogo al hacer click fuera', () => {
    const fixture = TestBed.createComponent(SaScoreComponent);
    const component = fixture.componentInstance;
    const closeSpy = vi.fn();

    (
      component as unknown as { sketchDialogRef: { nativeElement: HTMLDialogElement } }
    ).sketchDialogRef = {
      nativeElement: {
        close: closeSpy,
        getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 100 }) as DOMRect,
      } as unknown as HTMLDialogElement,
    };

    component.onSketchDialogBackdropClick(new MouseEvent('click', { clientX: 200, clientY: 200 }));
    expect(closeSpy).toHaveBeenCalled();
  });

  it('onSketchDialogBackdropClick no cierra si el click está dentro del diálogo', () => {
    const fixture = TestBed.createComponent(SaScoreComponent);
    const component = fixture.componentInstance;
    const closeSpy = vi.fn();

    (
      component as unknown as { sketchDialogRef: { nativeElement: HTMLDialogElement } }
    ).sketchDialogRef = {
      nativeElement: {
        close: closeSpy,
        getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 100 }) as DOMRect,
      } as unknown as HTMLDialogElement,
    };

    component.onSketchDialogBackdropClick(new MouseEvent('click', { clientX: 50, clientY: 50 }));
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('closeMoleculeImageModal cierra el diálogo de imagen cuando la referencia existe', () => {
    const fixture = TestBed.createComponent(SaScoreComponent);
    const component = fixture.componentInstance;
    const closeSpy = vi.fn();

    (
      component as unknown as { moleculeImageDialogRef: { nativeElement: HTMLDialogElement } }
    ).moleculeImageDialogRef = {
      nativeElement: { close: closeSpy } as unknown as HTMLDialogElement,
    };

    component.closeMoleculeImageModal();
    expect(closeSpy).toHaveBeenCalled();
  });

  it('onMoleculeImageDialogBackdropClick sin referencia retorna sin error', () => {
    const fixture = TestBed.createComponent(SaScoreComponent);
    const component = fixture.componentInstance;
    expect(() =>
      component.onMoleculeImageDialogBackdropClick(
        new MouseEvent('click', { clientX: 200, clientY: 200 }),
      ),
    ).not.toThrow();
  });

  it('onMoleculeImageDialogBackdropClick cierra el diálogo al hacer click fuera', () => {
    const fixture = TestBed.createComponent(SaScoreComponent);
    const component = fixture.componentInstance;
    const closeSpy = vi.fn();

    (
      component as unknown as { moleculeImageDialogRef: { nativeElement: HTMLDialogElement } }
    ).moleculeImageDialogRef = {
      nativeElement: {
        close: closeSpy,
        getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 100 }) as DOMRect,
      } as unknown as HTMLDialogElement,
    };

    component.onMoleculeImageDialogBackdropClick(
      new MouseEvent('click', { clientX: 200, clientY: 200 }),
    );
    expect(closeSpy).toHaveBeenCalled();
  });

  it('onMoleculeImageDialogBackdropClick no cierra si el click está dentro', () => {
    const fixture = TestBed.createComponent(SaScoreComponent);
    const component = fixture.componentInstance;
    const closeSpy = vi.fn();

    (
      component as unknown as { moleculeImageDialogRef: { nativeElement: HTMLDialogElement } }
    ).moleculeImageDialogRef = {
      nativeElement: {
        close: closeSpy,
        getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 100 }) as DOMRect,
      } as unknown as HTMLDialogElement,
    };

    component.onMoleculeImageDialogBackdropClick(
      new MouseEvent('click', { clientX: 50, clientY: 50 }),
    );
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('openMoleculeImageModal maneja error de API estableciendo moleculeImageError', () => {
    jobsApiMock.inspectSmileitStructure.mockReturnValueOnce(
      throwError(() => new Error('API down')),
    );

    const fixture = TestBed.createComponent(SaScoreComponent);
    const component = fixture.componentInstance;

    component.openMoleculeImageModal('CCO');

    expect(component.moleculeImageError()).toBe('Could not load molecule image.');
    expect(component.isLoadingMoleculeImage()).toBe(false);
  });

  it('onFileUpload con archivo carga y actualiza smilesInput', async () => {
    const fixture = TestBed.createComponent(SaScoreComponent);
    const component = fixture.componentInstance;
    const file = {
      text: vi.fn(() => Promise.resolve('CCO\n# comment\n\nc1ccccc1\n')),
    } as unknown as File;
    const input = { files: [file], value: 'prev' } as unknown as HTMLInputElement;

    component.onFileUpload({ target: input } as unknown as Event);
    await Promise.resolve();
    await Promise.resolve();

    expect(workflowMock.smilesInput()).toBe('CCO\nc1ccccc1');
    expect(input.value).toBe('');
  });

  it('applySketch con sketchDraftSmiles vacío cierra el diálogo sin actualizar smilesInput', async () => {
    const fixture = TestBed.createComponent(SaScoreComponent);
    const component = fixture.componentInstance;

    workflowMock.smilesInput.set('');
    component.sketchDraftSmiles = '';

    await component.applySketch();

    expect(workflowMock.smilesInput()).toBe('');
  });

  it('applySketch con sketchDraftSmiles no vacío actualiza smilesInput y cierra el diálogo', async () => {
    const fixture = TestBed.createComponent(SaScoreComponent);
    const component = fixture.componentInstance;

    workflowMock.smilesInput.set('');
    component.sketchDraftSmiles = 'CCO';

    await component.applySketch();

    expect(workflowMock.smilesInput()).toBe('CCO');
  });

  it('applySketch agrega el SMILES con salto de línea cuando ya hay contenido en smilesInput', async () => {
    const fixture = TestBed.createComponent(SaScoreComponent);
    const component = fixture.componentInstance;

    workflowMock.smilesInput.set('N#N');
    component.sketchDraftSmiles = 'CCO';

    await component.applySketch();

    expect(workflowMock.smilesInput()).toBe('N#N\nCCO');
  });

  it('exportOptions vacío no actualiza selectedExportTarget al inicializar', () => {
    const fixture = TestBed.createComponent(SaScoreComponent);
    const component = fixture.componentInstance;

    // resultData es null → exportOptions retorna [] → el effect no cambia selectedExportTarget
    component.selectedExportTarget.set('ambit');
    workflowMock.resultData.set(null);
    fixture.detectChanges();

    expect(component.selectedExportTarget()).toBe('ambit');
  });
});
