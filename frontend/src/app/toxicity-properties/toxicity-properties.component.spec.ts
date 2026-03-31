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
    progressSnapshot: signal(null),
    jobLogs: signal([]),
    resultData: signal(null),
    errorMessage: signal<string | null>(null),
    exportErrorMessage: signal<string | null>(null),
    isExporting: signal<boolean>(false),
    historyJobs: signal([]),
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
});
