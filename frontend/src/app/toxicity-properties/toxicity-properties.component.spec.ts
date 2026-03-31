// toxicity-properties.component.spec.ts: Pruebas unitarias básicas del componente de Toxicity Properties.

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { JobsApiService } from '../core/api/jobs-api.service';
import { KetcherFrameService } from '../core/application/ketcher-frame.service';
import { ToxicityPropertiesWorkflowService } from '../core/application/toxicity-properties-workflow.service';
import { ToxicityPropertiesComponent } from './toxicity-properties.component';

describe('ToxicityPropertiesComponent', () => {
  const workflowMock = {
    smilesInput: signal<string>('CCO'),
    activeSection: signal<'idle' | 'dispatching' | 'progress' | 'result' | 'error'>('idle'),
    currentJobId: signal<string | null>(null),
    progressSnapshot: signal<unknown | null>(null),
    jobLogs: signal<unknown[]>([]),
    resultData: signal<
      | {
          total: number;
          molecules: Array<{
            smiles: string;
            LD50_mgkg: number | null;
            mutagenicity: string | null;
            ames_score: number | null;
            DevTox: string | null;
            devtox_score: number | null;
            error_message: string | null;
          }>;
          scientificReferences: string[];
        }
      | null
    >(null),
    errorMessage: signal<string | null>(null),
    exportErrorMessage: signal<string | null>(null),
    isExporting: signal<boolean>(false),
    historyJobs: signal<Array<{ id: string; status: string; updated_at: string }>>([]),
    isHistoryLoading: signal<boolean>(false),
    isProcessing: signal<boolean>(false),
    progressPercentage: signal<number>(0),
    progressMessage: signal<string>('Preparing toxicity prediction...'),
    dispatch: vi.fn(),
    reset: vi.fn(),
    openHistoricalJob: vi.fn(),
    loadHistory: vi.fn(),
    downloadCsvReport: vi.fn(() =>
      of({
        filename: 'toxicity_properties_report.csv',
        blob: new Blob(['smiles,LD50_mgkg'], { type: 'text/csv' }),
      }),
    ),
  };

  const jobsApiMock = {
    inspectSmileitStructure: vi.fn(() =>
      of({
        svg: '<svg></svg>',
      }),
    ),
  };

  const ketcherFrameServiceMock = {
    waitForApi: vi.fn(() => Promise.resolve(null)),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    workflowMock.smilesInput.set('CCO');
    workflowMock.activeSection.set('idle');
    workflowMock.currentJobId.set(null);
    workflowMock.progressSnapshot.set(null);
    workflowMock.jobLogs.set([]);
    workflowMock.resultData.set(null);
    workflowMock.errorMessage.set(null);
    workflowMock.exportErrorMessage.set(null);
    workflowMock.isExporting.set(false);
    workflowMock.historyJobs.set([]);
    workflowMock.isHistoryLoading.set(false);
    workflowMock.isProcessing.set(false);
    workflowMock.progressPercentage.set(0);
    workflowMock.progressMessage.set('Preparing toxicity prediction...');

    TestBed.configureTestingModule({
      imports: [ToxicityPropertiesComponent],
      providers: [
        {
          provide: JobsApiService,
          useValue: jobsApiMock,
        },
        {
          provide: KetcherFrameService,
          useValue: ketcherFrameServiceMock,
        },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of(convertToParamMap({})),
          },
        },
      ],
    });

    TestBed.overrideComponent(ToxicityPropertiesComponent, {
      set: {
        providers: [
          {
            provide: ToxicityPropertiesWorkflowService,
            useValue: workflowMock,
          },
          {
            provide: JobsApiService,
            useValue: jobsApiMock,
          },
          {
            provide: KetcherFrameService,
            useValue: ketcherFrameServiceMock,
          },
          {
            provide: ActivatedRoute,
            useValue: {
              queryParamMap: of(convertToParamMap({})),
            },
          },
        ],
      },
    });
  });

  it('calls loadHistory on init', () => {
    const fixture = TestBed.createComponent(ToxicityPropertiesComponent);
    fixture.detectChanges();

    expect(workflowMock.loadHistory).toHaveBeenCalled();
  });

  it('delegates action methods to workflow service', () => {
    const fixture = TestBed.createComponent(ToxicityPropertiesComponent);
    const component = fixture.componentInstance;

    component.dispatch();
    component.reset();
    component.openHistoricalJob('tox-job-123');

    expect(workflowMock.dispatch).toHaveBeenCalled();
    expect(workflowMock.reset).toHaveBeenCalled();
    expect(workflowMock.openHistoricalJob).toHaveBeenCalledWith('tox-job-123');
  });

  it('formats decimals and detects row errors', () => {
    const fixture = TestBed.createComponent(ToxicityPropertiesComponent);
    const component = fixture.componentInstance;

    expect(component.formatDecimal(1.23456, 3)).toBe('1.235');
    expect(component.formatDecimal(null)).toBe('-');
    expect(
      component.rowHasError({
        smiles: 'CCO',
        LD50_mgkg: null,
        mutagenicity: null,
        ames_score: null,
        DevTox: null,
        devtox_score: null,
        error_message: 'invalid molecule',
      }),
    ).toBe(true);
  });

  it('opens and closes the sketch dialog', () => {
    const fixture = TestBed.createComponent(ToxicityPropertiesComponent);
    const component = fixture.componentInstance;
    const closeSpy = vi.fn();
    const showModalSpy = vi.fn();

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

    component.closeSketchDialog();
    expect(closeSpy).toHaveBeenCalled();
    expect(component.isSketchDialogLoading()).toBe(false);
  });

  it('closes the sketch dialog only when clicking outside', () => {
    const fixture = TestBed.createComponent(ToxicityPropertiesComponent);
    const component = fixture.componentInstance;
    const closeSpy = vi.fn();

    (
      component as unknown as { sketchDialogRef: { nativeElement: HTMLDialogElement } }
    ).sketchDialogRef = {
      nativeElement: {
        showModal: vi.fn(),
        close: closeSpy,
        getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 100 }) as DOMRect,
      } as unknown as HTMLDialogElement,
    };

    component.onSketchDialogBackdropClick(new MouseEvent('click', { clientX: 200, clientY: 200 }));
    expect(closeSpy).toHaveBeenCalledTimes(1);

    closeSpy.mockClear();
    component.onSketchDialogBackdropClick(new MouseEvent('click', { clientX: 50, clientY: 50 }));
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('uploads SMILES from file ignoring comments and blank lines', async () => {
    const fixture = TestBed.createComponent(ToxicityPropertiesComponent);
    const component = fixture.componentInstance;
    const file = {
      text: vi.fn(() => Promise.resolve('# comment\n\nCCO\n  N#N  \n')),
    } as unknown as File;
    const input = {
      files: [file],
      value: 'previous',
    } as unknown as HTMLInputElement;

    component.onFileUpload({ target: input } as unknown as Event);
    await Promise.resolve();
    await Promise.resolve();

    expect(workflowMock.smilesInput()).toBe('CCO\nN#N');
    expect(input.value).toBe('');
  });

  it('opens the molecule image modal and loads the SVG', () => {
    // Verifica apertura de modal y render seguro del SVG retornado por inspección.
    const fixture = TestBed.createComponent(ToxicityPropertiesComponent);
    const component = fixture.componentInstance;
    const showModalSpy = vi.fn();

    (
      component as unknown as { moleculeImageDialogRef: { nativeElement: HTMLDialogElement } }
    ).moleculeImageDialogRef = {
      nativeElement: {
        showModal: showModalSpy,
        close: vi.fn(),
        getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 100 }) as DOMRect,
      } as unknown as HTMLDialogElement,
    };

    component.openMoleculeImageModal('CCO');

    expect(showModalSpy).toHaveBeenCalled();
    expect(component.moleculeModalSmiles()).toBe('CCO');
    expect(component.isLoadingMoleculeImage()).toBe(false);
    expect(component.moleculeModalSvg()).not.toBeNull();
  });

  it('renders result metadata table and references when workflow has completed data', () => {
    // Verifica caso de uso principal: tabla toxicológica completa tras finalizar el job.
    workflowMock.activeSection.set('result');
    workflowMock.currentJobId.set('tox-job-77');
    workflowMock.resultData.set({
      total: 1,
      molecules: [
        {
          smiles: 'CCO',
          LD50_mgkg: 320.1234,
          mutagenicity: 'Negative',
          ames_score: 0.1432,
          DevTox: 'Low',
          devtox_score: 0.0201,
          error_message: null,
        },
      ],
      scientificReferences: ['Paper A', 'Paper B'],
    });

    const fixture = TestBed.createComponent(ToxicityPropertiesComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('Total molecules:');
    expect(host.textContent).toContain('ADMET-AI');
    expect(host.textContent).toContain('tox-job-77');
    expect(host.querySelectorAll('table.result-table tbody tr').length).toBeGreaterThan(0);
    expect(host.textContent).toContain('Paper A');
    expect(host.textContent).toContain('Paper B');
  });

  it('renders progress card and dispatching status depending on active section', () => {
    // Verifica transición visual de dispatching a progress con feedback de ejecución.
    const fixture = TestBed.createComponent(ToxicityPropertiesComponent);

    workflowMock.activeSection.set('dispatching');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Submitting toxicity job to backend...',
    );

    workflowMock.activeSection.set('progress');
    workflowMock.currentJobId.set('tox-job-progress');
    workflowMock.progressPercentage.set(60);
    workflowMock.progressMessage.set('Predicting molecules');
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('app-job-progress-card')).not.toBeNull();
  });

  it('renders error banner and history table states from workflow signals', () => {
    // Verifica mensajes de error y estado histórico vacío/no-vacío en la UI.
    const fixture = TestBed.createComponent(ToxicityPropertiesComponent);

    workflowMock.activeSection.set('error');
    workflowMock.errorMessage.set('Compatibility validation failed');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Compatibility validation failed',
    );

    workflowMock.historyJobs.set([]);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'No historical toxicity jobs yet.',
    );

    workflowMock.historyJobs.set([
      {
        id: 'tox-history-1',
        status: 'completed',
        updated_at: '2026-03-31T10:00:00Z',
      },
    ]);
    fixture.detectChanges();

    const openButton = (fixture.nativeElement as HTMLElement).querySelector(
      'button.history-open-btn',
    ) as HTMLButtonElement | null;
    expect(openButton).not.toBeNull();
    openButton?.click();
    expect(workflowMock.openHistoricalJob).toHaveBeenCalledWith('tox-history-1');
  });
});
