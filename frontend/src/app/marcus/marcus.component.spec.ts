// marcus.component.spec.ts: Pruebas unitarias del componente Marcus.
// Cubre delegación al workflow, manejo de archivos Gaussian, formateo y export de reportes.

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, vi } from 'vitest';
import {
  JobLogEntryView,
  JobProgressSnapshotView,
  ScientificJobView,
} from '../core/api/jobs-api.service';
import {
  MarcusResultData,
  MarcusWorkflowService,
} from '../core/application/marcus-workflow.service';
import { MarcusComponent } from './marcus.component';

describe('MarcusComponent', () => {
  const workflowMock = {
    reactant1File: signal<File | null>(null),
    reactant2File: signal<File | null>(null),
    product1AdiabaticFile: signal<File | null>(null),
    product2AdiabaticFile: signal<File | null>(null),
    product1VerticalFile: signal<File | null>(null),
    product2VerticalFile: signal<File | null>(null),
    title: signal<string>(''),
    diffusion: signal<boolean>(false),
    radiusReactant1: signal<number | null>(null),
    radiusReactant2: signal<number | null>(null),
    reactionDistance: signal<number | null>(null),
    activeSection: signal<string>('idle'),
    currentJobId: signal<string | null>(null),
    progressSnapshot: signal<JobProgressSnapshotView | null>(null),
    jobLogs: signal<JobLogEntryView[]>([]),
    resultData: signal<MarcusResultData | null>(null),
    errorMessage: signal<string | null>(null),
    exportErrorMessage: signal<string | null>(null),
    isExporting: signal<boolean>(false),
    historyJobs: signal<ScientificJobView[]>([]),
    isHistoryLoading: signal<boolean>(false),
    isProcessing: signal<boolean>(false),
    canDispatch: signal<boolean>(false),
    progressPercentage: signal<number>(0),
    progressMessage: signal<string>('Preparing Marcus job...'),
    showDiffusionFields: signal<boolean>(false),
    loadHistory: vi.fn(),
    dispatch: vi.fn(),
    reset: vi.fn(),
    clearFiles: vi.fn(),
    openHistoricalJob: vi.fn(),
    updateReactant1File: vi.fn(),
    updateReactant2File: vi.fn(),
    updateProduct1AdiabaticFile: vi.fn(),
    updateProduct2AdiabaticFile: vi.fn(),
    updateProduct1VerticalFile: vi.fn(),
    updateProduct2VerticalFile: vi.fn(),
    updateDiffusion: vi.fn(),
    downloadCsvReport: vi.fn(() =>
      of({ filename: 'marcus.csv', blob: new Blob(['data'], { type: 'text/csv' }) }),
    ),
    downloadLogReport: vi.fn(() =>
      of({ filename: 'marcus.log', blob: new Blob(['log'], { type: 'text/plain' }) }),
    ),
    downloadErrorReport: vi.fn(() =>
      of({ filename: 'marcus_error.txt', blob: new Blob(['err'], { type: 'text/plain' }) }),
    ),
    downloadInputsZip: vi.fn(() =>
      of({ filename: 'marcus_inputs.zip', blob: new Blob(['zip'], { type: 'application/zip' }) }),
    ),
  };

  function makeFakeFileInput(file: File | null): HTMLInputElement {
    return {
      files: file ? [file] : null,
    } as unknown as HTMLInputElement;
  }

  function makeFakeFile(name: string, size = 1024): File {
    return new File(['x'.repeat(size)], name, { type: 'text/plain' });
  }

  afterEach(() => vi.unstubAllGlobals());

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:mock-url'),
      revokeObjectURL: vi.fn(),
    });

    workflowMock.currentJobId.set(null);
    workflowMock.isExporting.set(false);
    workflowMock.activeSection.set('idle');

    TestBed.configureTestingModule({
      imports: [MarcusComponent],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { queryParamMap: of(convertToParamMap({})) },
        },
      ],
    });

    TestBed.overrideComponent(MarcusComponent, {
      set: {
        providers: [
          { provide: MarcusWorkflowService, useValue: workflowMock },
          {
            provide: ActivatedRoute,
            useValue: { queryParamMap: of(convertToParamMap({})) },
          },
        ],
      },
    });
  });

  it('llama loadHistory al inicializar', () => {
    const fixture = TestBed.createComponent(MarcusComponent);
    fixture.detectChanges();
    expect(workflowMock.loadHistory).toHaveBeenCalled();
  });

  it('abre job histórico cuando llega jobId por queryParams', () => {
    TestBed.overrideComponent(MarcusComponent, {
      set: {
        providers: [
          { provide: MarcusWorkflowService, useValue: workflowMock },
          {
            provide: ActivatedRoute,
            useValue: { queryParamMap: of(convertToParamMap({ jobId: 'marcus-88' })) },
          },
        ],
      },
    });
    const fixture = TestBed.createComponent(MarcusComponent);
    fixture.detectChanges();
    expect(workflowMock.openHistoricalJob).toHaveBeenCalledWith('marcus-88');
  });

  it('delega dispatch, reset, clearFiles y openHistoricalJob al workflow', () => {
    const fixture = TestBed.createComponent(MarcusComponent);
    const component = fixture.componentInstance;

    component.dispatch();
    component.reset();
    component.clearFiles();
    component.openHistoricalJob('marcus-1');

    expect(workflowMock.dispatch).toHaveBeenCalled();
    expect(workflowMock.reset).toHaveBeenCalled();
    expect(workflowMock.clearFiles).toHaveBeenCalled();
    expect(workflowMock.openHistoricalJob).toHaveBeenCalledWith('marcus-1');
  });

  it('propaga cambios de archivos Gaussian al workflow', () => {
    const fixture = TestBed.createComponent(MarcusComponent);
    const component = fixture.componentInstance;
    const file1 = makeFakeFile('reactant1.log');
    const file2 = makeFakeFile('reactant2.log');
    const file3 = makeFakeFile('prod1_adiabatic.log');
    const file4 = makeFakeFile('prod2_adiabatic.log');
    const file5 = makeFakeFile('prod1_vertical.log');
    const file6 = makeFakeFile('prod2_vertical.log');

    component.onReactant1FileChange({ target: makeFakeFileInput(file1) } as unknown as Event);
    component.onReactant2FileChange({ target: makeFakeFileInput(file2) } as unknown as Event);
    component.onProduct1AdiabaticFileChange({
      target: makeFakeFileInput(file3),
    } as unknown as Event);
    component.onProduct2AdiabaticFileChange({
      target: makeFakeFileInput(file4),
    } as unknown as Event);
    component.onProduct1VerticalFileChange({
      target: makeFakeFileInput(file5),
    } as unknown as Event);
    component.onProduct2VerticalFileChange({
      target: makeFakeFileInput(file6),
    } as unknown as Event);

    expect(workflowMock.updateReactant1File).toHaveBeenCalledWith(file1);
    expect(workflowMock.updateReactant2File).toHaveBeenCalledWith(file2);
    expect(workflowMock.updateProduct1AdiabaticFile).toHaveBeenCalledWith(file3);
    expect(workflowMock.updateProduct2AdiabaticFile).toHaveBeenCalledWith(file4);
    expect(workflowMock.updateProduct1VerticalFile).toHaveBeenCalledWith(file5);
    expect(workflowMock.updateProduct2VerticalFile).toHaveBeenCalledWith(file6);
  });

  it('propaga cambio del checkbox de difusión al workflow', () => {
    const fixture = TestBed.createComponent(MarcusComponent);
    const component = fixture.componentInstance;
    const event = { target: { checked: true } } as unknown as Event;
    component.onDiffusionChange(event);
    expect(workflowMock.updateDiffusion).toHaveBeenCalledWith(true);
  });

  it('canExport retorna false si no hay jobId', () => {
    const fixture = TestBed.createComponent(MarcusComponent);
    const component = fixture.componentInstance;
    workflowMock.currentJobId.set(null);
    expect(component.canExport()).toBe(false);
  });

  it('canExport retorna true si hay jobId y no está exportando', () => {
    const fixture = TestBed.createComponent(MarcusComponent);
    const component = fixture.componentInstance;
    workflowMock.currentJobId.set('marcus-001');
    workflowMock.isExporting.set(false);
    expect(component.canExport()).toBe(true);
  });

  it('formatea constante de velocidad — null retorna -- y número en exponencial', () => {
    const fixture = TestBed.createComponent(MarcusComponent);
    const component = fixture.componentInstance;
    expect(component.formatRateConstant(null)).toBe('--');
    expect(component.formatRateConstant(1.23456e8)).toBe(
      (1.23456e8).toExponential(4).toUpperCase(),
    );
  });

  it('formatea energía kcal/mol — null retorna -- y número con 4 decimales', () => {
    const fixture = TestBed.createComponent(MarcusComponent);
    const component = fixture.componentInstance;
    expect(component.formatKcalMol(null)).toBe('--');
    expect(component.formatKcalMol(3.14159)).toBe('3.1416');
  });

  it('formatea bytes en B, KB y MB', () => {
    const fixture = TestBed.createComponent(MarcusComponent);
    const component = fixture.componentInstance;
    expect(component.formatBytes(512)).toBe('512 B');
    expect(component.formatBytes(2048)).toBe('2.0 KB');
    expect(component.formatBytes(1572864)).toBe('1.50 MB');
  });

  it('exportCsv llama downloadCsvReport y dispara la descarga', () => {
    const fixture = TestBed.createComponent(MarcusComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const anchor = {
      href: '',
      download: '',
      style: { display: '' },
      click: vi.fn(),
      remove: vi.fn(),
    };
    const createSpy = vi
      .spyOn(document, 'createElement')
      .mockReturnValue(anchor as unknown as HTMLAnchorElement);
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => document.body);

    component.exportCsv();

    expect(workflowMock.downloadCsvReport).toHaveBeenCalled();
    createSpy.mockRestore();
  });

  it('exportLog llama downloadLogReport', () => {
    const fixture = TestBed.createComponent(MarcusComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const anchor = {
      href: '',
      download: '',
      style: { display: '' },
      click: vi.fn(),
      remove: vi.fn(),
    };
    const createSpy = vi
      .spyOn(document, 'createElement')
      .mockReturnValue(anchor as unknown as HTMLAnchorElement);
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => document.body);

    component.exportLog();

    expect(workflowMock.downloadLogReport).toHaveBeenCalled();
    createSpy.mockRestore();
  });

  it('exportError llama downloadErrorReport', () => {
    const fixture = TestBed.createComponent(MarcusComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const anchor = {
      href: '',
      download: '',
      style: { display: '' },
      click: vi.fn(),
      remove: vi.fn(),
    };
    const createSpy = vi
      .spyOn(document, 'createElement')
      .mockReturnValue(anchor as unknown as HTMLAnchorElement);
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => document.body);

    component.exportError();

    expect(workflowMock.downloadErrorReport).toHaveBeenCalled();
    createSpy.mockRestore();
  });

  it('exportInputsZip llama downloadInputsZip', () => {
    const fixture = TestBed.createComponent(MarcusComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const anchor = {
      href: '',
      download: '',
      style: { display: '' },
      click: vi.fn(),
      remove: vi.fn(),
    };
    const createSpy = vi
      .spyOn(document, 'createElement')
      .mockReturnValue(anchor as unknown as HTMLAnchorElement);
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => document.body);

    component.exportInputsZip();

    expect(workflowMock.downloadInputsZip).toHaveBeenCalled();
    createSpy.mockRestore();
  });

  it('propaga null al workflow cuando el input de archivos Gaussian está vacío', () => {
    // Cubre la rama input.files?.[0] ?? null cuando files es null (input sin selección).
    const fixture = TestBed.createComponent(MarcusComponent);
    const component = fixture.componentInstance;
    const emptyInputEvent = (handler: (e: Event) => void) =>
      handler({ target: { files: null } } as unknown as Event);

    emptyInputEvent((e) => component.onReactant1FileChange(e));
    emptyInputEvent((e) => component.onReactant2FileChange(e));
    emptyInputEvent((e) => component.onProduct1AdiabaticFileChange(e));
    emptyInputEvent((e) => component.onProduct2AdiabaticFileChange(e));
    emptyInputEvent((e) => component.onProduct1VerticalFileChange(e));
    emptyInputEvent((e) => component.onProduct2VerticalFileChange(e));

    expect(workflowMock.updateReactant1File).toHaveBeenCalledWith(null);
    expect(workflowMock.updateReactant2File).toHaveBeenCalledWith(null);
    expect(workflowMock.updateProduct1AdiabaticFile).toHaveBeenCalledWith(null);
    expect(workflowMock.updateProduct2AdiabaticFile).toHaveBeenCalledWith(null);
    expect(workflowMock.updateProduct1VerticalFile).toHaveBeenCalledWith(null);
    expect(workflowMock.updateProduct2VerticalFile).toHaveBeenCalledWith(null);
  });

  it('canExport retorna false cuando isExporting es true aunque haya jobId', () => {
    // Cubre !this.workflow.isExporting() → false branch en canExport.
    const fixture = TestBed.createComponent(MarcusComponent);
    const component = fixture.componentInstance;
    workflowMock.currentJobId.set('marcus-002');
    workflowMock.isExporting.set(true);
    expect(component.canExport()).toBe(false);
  });
});
