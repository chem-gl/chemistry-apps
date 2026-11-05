// smileit.component.spec.ts: Pruebas unitarias del componente principal de Smile-it.
// Cubre: señales de toggle, computed de patrones/logs/anotaciones, y gestión del panel de detalle.
// Los servicios complejos (workflow, inspección) se mockean para aislar sólo la lógica del componente.

import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  JobLogEntryView,
  SmileitCatalogEntryView,
  SmileitPatternEntryView,
  SmileitStructureInspectionView,
} from '../core/api/jobs-api.service';
import { JobsApiService } from '../core/api/jobs-api.service';
import { SmileitWorkflowService } from '../core/application/smileit-workflow.service';
import { SmileitInspectionService } from './core/services/smileit-inspection.service';
import { SmileitComponent } from './smileit.component';
import { RISK_CATEGORY_METADATA_KEY } from './smileit-risk.utils';

// Helpers para construir objetos mínimos de dominio
const buildMockPattern = (
  stableId: string,
  name = 'pattern',
  provenanceMetadata: Record<string, string> = {},
): SmileitPatternEntryView =>
  ({
    stable_id: stableId,
    name,
    color: '#ff0000',
    caption: '',
    provenance_metadata: provenanceMetadata,
  }) as unknown as SmileitPatternEntryView;

const buildMockAnnotation = (
  patternStableId: string,
  overrides: Record<string, unknown> = {},
) => ({
  pattern_stable_id: patternStableId,
  atom_indices: [0],
  color: '#00ff00',
  caption: '',
  ...overrides,
});

/** Mock mínimo del SmileitWorkflowService con señales controlables. */
const buildMockWorkflow = () => {
  const mockCatalog = {
    loadInitialData: vi.fn(),
    catalogGroups: signal([]),
    beginPatternEntryEdition: vi.fn(),
    cancelPatternEdition: vi.fn(),
    deletePatternEntry: vi.fn(),
    isPatternEntryEditable: vi.fn().mockReturnValue(true),
  };

  return {
    catalog: mockCatalog,
    blocks: {},
    state: {},
    principalSmiles: signal<string>(''),
    inspection: signal<SmileitStructureInspectionView | null>(null),
    selectedAtomIndices: signal<number[]>([]),
    catalogEntries: signal([]),
    categories: signal([]),
    patterns: signal([]),
    assignmentBlocks: signal([]),
    catalogCreateName: signal(''),
    catalogCreateSmiles: signal(''),
    catalogCreateAnchorIndicesText: signal(''),
    catalogCreateCategoryKeys: signal<string[]>([]),
    catalogCreateSourceReference: signal(''),
    catalogEditingStableId: signal<string | null>(null),
    catalogDraftQueue: signal([]),
    patternCreateName: signal(''),
    patternCreateSmarts: signal(''),
    patternCreateType: signal('functional'),
    patternCreateCaption: signal(''),
    patternCreateSourceReference: signal(''),
    patternEditingStableId: signal<string | null>(null),
    siteOverlapPolicy: signal('last_block_wins'),
    rSubstitutes: signal(false),
    numBonds: signal(1),
    maxStructures: signal(1000),
    exportNameBase: signal('smileit_run'),
    exportPadding: signal(5),
    activeSection: signal('idle'),
    currentJobId: signal<string | null>(null),
    progressSnapshot: signal(null),
    jobLogs: signal<JobLogEntryView[]>([]),
    resultData: signal(null),
    errorMessage: signal<string | null>(null),
    exportErrorMessage: signal<string | null>(null),
    isExporting: signal(false),
    historyJobs: signal([]),
    isHistoryLoading: signal(false),
    isProcessing: signal(false),
    inspectionSvg: signal(''),
    quickProperties: signal(null),
    progressPercentage: signal(0),
    progressMessage: signal(''),
    selectedSiteCoverage: signal([]),
    catalogGroups: signal([]),
    loadHistory: vi.fn(),
    inspectPrincipalStructure: vi.fn(),
    dispatch: vi.fn(),
    reset: vi.fn(),
    openHistoricalJob: vi.fn(),
    downloadCsvReport: vi.fn(),
    downloadSmilesReport: vi.fn(),
    downloadLogReport: vi.fn(),
    toggleSelectedAtom: vi.fn(),
  };
};

describe('SmileitComponent', () => {
  let component: SmileitComponent;
  let mockWorkflow: ReturnType<typeof buildMockWorkflow>;

  beforeEach(async () => {
    mockWorkflow = buildMockWorkflow();

    await TestBed.configureTestingModule({
      imports: [SmileitComponent],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { queryParamMap: of(convertToParamMap({})) },
        },
        {
          provide: SmileitInspectionService,
          useValue: {
            decorateInspectionSvg: vi.fn().mockReturnValue(''),
            extractAtomIndexFromEvent: vi.fn().mockReturnValue(null),
          },
        },
        // Mock de JobsApiService para evitar dependencia de HttpClient en tests
        { provide: JobsApiService, useValue: {} },
        // Mock de TranslocoService para pruebas de traduccion aisladas
        {
          provide: TranslocoService,
          useValue: {
            translate: (key: string) => {
              const translations: Record<string, string> = {
                'smileit.patterns.toxicophore': 'Toxicophore',
                'smileit.patterns.privileged': 'Privileged scaffold',
              };
              return translations[key] ?? key;
            },
          },
        },
      ],
    })
      .overrideComponent(SmileitComponent, {
        set: {
          // Reemplazar providers del componente: usar clase como token DI (no string)
          // NO_ERRORS_SCHEMA: sólo se prueba lógica del componente, no el template ni sus hijos
          providers: [{ provide: SmileitWorkflowService, useValue: mockWorkflow }],
          schemas: [NO_ERRORS_SCHEMA],
        },
      })
      .compileComponents();

    const fixture = TestBed.createComponent(SmileitComponent);
    component = fixture.componentInstance;
  });

  describe('señales de colapso', () => {
    it('toggleLogsCollapse invierte el estado de los logs', () => {
      component.toggleLogsCollapse();
      expect(component.isLogsCollapsed()).toBe(true);
      component.toggleLogsCollapse();
      expect(component.isLogsCollapsed()).toBe(false);
    });

    it('toggleAdvancedSectionCollapse invierte el estado de la sección avanzada', () => {
      component.toggleAdvancedSectionCollapse();
      expect(component.isAdvancedSectionCollapsed()).toBe(false);
      component.toggleAdvancedSectionCollapse();
      expect(component.isAdvancedSectionCollapsed()).toBe(true);
    });
  });

  describe('patternEnabledState y togglePatternEnabled', () => {
    it('isPatternEnabled retorna true por defecto para cualquier patrón', () => {
      const pattern = buildMockPattern('pat-1');
      expect(component.isPatternEnabled(pattern)).toBe(true);
    });

    it('isAnnotationEnabled retorna true por defecto para cualquier stable_id', () => {
      expect(component.isAnnotationEnabled('pat-1')).toBe(true);
    });

    it('togglePatternEnabled deshabilita un patrón habilitado', () => {
      component.togglePatternEnabled('pat-A');
      expect(component.isAnnotationEnabled('pat-A')).toBe(false);
    });

    it('togglePatternEnabled rehabilita un patrón deshabilitado', () => {
      component.togglePatternEnabled('pat-A');
      component.togglePatternEnabled('pat-A');
      expect(component.isAnnotationEnabled('pat-A')).toBe(true);
    });
  });

  describe('edicion de patrones en modal', () => {
    it('isPatternBeingEdited retorna true cuando coincide el stable_id en edicion', () => {
      mockWorkflow.patternEditingStableId.set('pat-editing');
      const editingPattern = buildMockPattern('pat-editing');
      const otherPattern = buildMockPattern('pat-other');

      expect(component.isPatternBeingEdited(editingPattern)).toBe(true);
      expect(component.isPatternBeingEdited(otherPattern)).toBe(false);
    });

    it('beginPatternEntryEdition delega al workflow de catalogo', () => {
      const pattern = buildMockPattern('pat-delegate');
      component.beginPatternEntryEdition(pattern);
      expect(mockWorkflow.catalog.beginPatternEntryEdition).toHaveBeenCalledWith(pattern);
    });
  });

  describe('openLibraryEntryDetail y closeLibraryEntryDetail', () => {
    it('openLibraryEntryDetail guarda la entrada y contexto', () => {
      const entry = { id: 1, label: 'Test' } as unknown as SmileitCatalogEntryView;
      component.openLibraryEntryDetail(entry, 'reference');

      expect(component.selectedLibraryEntryForDetail()).toBe(entry);
      expect(component.libraryDetailOpenContext()).toBe('reference');
    });

    it('closeLibraryEntryDetail limpia la entrada y restablece contexto', () => {
      const entry = { id: 1 } as unknown as SmileitCatalogEntryView;
      component.openLibraryEntryDetail(entry, 'reference');
      component.closeLibraryEntryDetail();

      expect(component.selectedLibraryEntryForDetail()).toBeNull();
      expect(component.libraryDetailOpenContext()).toBe('browser');
    });
  });

  describe('onPatternModalSectionKeydown', () => {
    it('detiene la propagación de Enter', () => {
      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      const stopSpy = vi.spyOn(event, 'stopPropagation');
      component.onPatternModalSectionKeydown(event);
      expect(stopSpy).toHaveBeenCalled();
    });

    it('detiene la propagación de Space/Spacebar', () => {
      const spaceEvent = new KeyboardEvent('keydown', { key: ' ' });
      const stopSpy = vi.spyOn(spaceEvent, 'stopPropagation');
      component.onPatternModalSectionKeydown(spaceEvent);
      expect(stopSpy).toHaveBeenCalled();
    });

    it('no detiene la propagación de otras teclas', () => {
      const event = new KeyboardEvent('keydown', { key: 'Tab' });
      const stopSpy = vi.spyOn(event, 'stopPropagation');
      component.onPatternModalSectionKeydown(event);
      expect(stopSpy).not.toHaveBeenCalled();
    });
  });

  describe('onPrincipalSmilesChange', () => {
    it('actualiza el principalSmiles en el workflow', () => {
      component.onPrincipalSmilesChange('c1ccccc1');
      expect(mockWorkflow.principalSmiles()).toBe('c1ccccc1');
    });
  });

  describe('ngOnInit', () => {
    it('llama loadInitialData, loadHistory e inspectPrincipalStructure al inicializar', () => {
      component.ngOnInit();
      expect(mockWorkflow.catalog.loadInitialData).toHaveBeenCalled();
      expect(mockWorkflow.loadHistory).toHaveBeenCalled();
      expect(mockWorkflow.inspectPrincipalStructure).toHaveBeenCalled();
    });

    it('llama openHistoricalJob con el jobId de la ruta si está presente', async () => {
      // Reconfigurar con un queryParam jobId
      TestBed.resetTestingModule();
      mockWorkflow = buildMockWorkflow();

      await TestBed.configureTestingModule({
        imports: [SmileitComponent],
        providers: [
          {
            provide: ActivatedRoute,
            useValue: { queryParamMap: of(convertToParamMap({ jobId: 'abc-123' })) },
          },
          {
            provide: SmileitInspectionService,
            useValue: {
              decorateInspectionSvg: vi.fn().mockReturnValue(''),
              extractAtomIndexFromEvent: vi.fn().mockReturnValue(null),
            },
          },
          { provide: JobsApiService, useValue: {} },
        ],
      })
        .overrideComponent(SmileitComponent, {
          set: {
            providers: [{ provide: SmileitWorkflowService, useValue: mockWorkflow }],
            schemas: [NO_ERRORS_SCHEMA],
          },
        })
        .compileComponents();

      const fixture = TestBed.createComponent(SmileitComponent);
      const comp = fixture.componentInstance;
      comp.ngOnInit();
      expect(mockWorkflow.openHistoricalJob).toHaveBeenCalledWith('abc-123');
    });

    it('no llama openHistoricalJob si el jobId de la ruta está vacío', () => {
      component.ngOnInit();
      expect(mockWorkflow.openHistoricalJob).not.toHaveBeenCalled();
    });
  });

  describe('métodos delegados al workflow', () => {
    it('dispatch() delega al workflow', () => {
      component.dispatch();
      expect(mockWorkflow.dispatch).toHaveBeenCalled();
    });

    it('reset() delega al workflow', () => {
      component.reset();
      expect(mockWorkflow.reset).toHaveBeenCalled();
    });

    it('openHistoricalJob() delega al workflow con el jobId', () => {
      component.openHistoricalJob('job-xyz');
      expect(mockWorkflow.openHistoricalJob).toHaveBeenCalledWith('job-xyz');
    });

    it('inspectPrincipalStructure() delega al workflow', () => {
      component.inspectPrincipalStructure();
      expect(mockWorkflow.inspectPrincipalStructure).toHaveBeenCalled();
    });
  });

  describe('computed logsAsText', () => {
    it('retorna string vacío cuando no hay logs', () => {
      mockWorkflow.jobLogs.set([]);
      expect(component.logsAsText()).toBe('');
    });

    it('formatea la entrada de log correctamente sin payload', () => {
      mockWorkflow.jobLogs.set([
        { level: 'info', eventIndex: 0, source: 'engine', message: 'OK', payload: {} } as never,
      ]);
      expect(component.logsAsText()).toBe('INFO · #0 · engine · OK');
    });

    it('incluye el payload cuando tiene datos', () => {
      mockWorkflow.jobLogs.set([
        {
          level: 'warn',
          eventIndex: 1,
          source: 'core',
          message: 'Warn',
          payload: { x: 1 },
        } as never,
      ]);
      const result = component.logsAsText();
      expect(result).toContain('WARN · #1 · core · Warn');
      expect(result).toContain('{"x":1}');
    });

    it('une múltiples entradas con saltos de línea', () => {
      mockWorkflow.jobLogs.set([
        { level: 'info', eventIndex: 0, source: 'a', message: 'M1', payload: {} } as never,
        { level: 'info', eventIndex: 1, source: 'b', message: 'M2', payload: {} } as never,
      ]);
      const lines = component.logsAsText().split('\n');
      expect(lines).toHaveLength(2);
    });
  });

  describe('computed patternEntries', () => {
    it('retorna array vacío cuando workflow.patterns retorna array vacío', () => {
      mockWorkflow.patterns.set([]);
      expect(component.patternEntries()).toEqual([]);
    });

    it('retorna los patrones cuando el workflow los tiene', () => {
      const pat = buildMockPattern('p1');
      mockWorkflow.patterns.set([pat] as never);
      expect(component.patternEntries()).toHaveLength(1);
    });
  });

  describe('computed visibleInspectionAnnotations', () => {
    it('retorna array vacío cuando inspection es null', () => {
      mockWorkflow.inspection.set(null);
      expect(component.visibleInspectionAnnotations()).toEqual([]);
    });

    it('filtra las anotaciones deshabilitadas', () => {
      const annotation = buildMockAnnotation('pat-X');
      mockWorkflow.inspection.set({ annotations: [annotation] } as never);
      // Deshabilitar el patrón
      component.togglePatternEnabled('pat-X');
      const visible = component.visibleInspectionAnnotations();
      expect(visible).toHaveLength(0);
    });

    it('incluye las anotaciones habilitadas', () => {
      const annotation = buildMockAnnotation('pat-Y');
      mockWorkflow.inspection.set({ annotations: [annotation] } as never);
      // pat-Y habilitado por defecto
      const visible = component.visibleInspectionAnnotations();
      expect(visible).toHaveLength(1);
    });
  });

  describe('filtrado por categorías de riesgo', () => {
    const buildRiskCatalog = (): void => {
      mockWorkflow.patterns.set([
        buildMockPattern('pat-hep', 'Hepatotoxic pattern', {
          [RISK_CATEGORY_METADATA_KEY]: 'hepatotoxicity',
        }),
        buildMockPattern('pat-react', 'Reactive pattern', {
          [RISK_CATEGORY_METADATA_KEY]: 'reactivity',
        }),
        buildMockPattern('pat-priv', 'Privileged scaffold', {
          [RISK_CATEGORY_METADATA_KEY]: 'privileged_scaffold',
        }),
      ] as never);
      mockWorkflow.inspection.set({
        annotations: [
          buildMockAnnotation('pat-hep', { pattern_type: 'toxicophore', color: '#d93a2f' }),
          buildMockAnnotation('pat-react', { pattern_type: 'toxicophore', color: '#d93a2f' }),
          buildMockAnnotation('pat-priv', { pattern_type: 'privileged', color: '#2f9e44' }),
        ],
      } as never);
    };

    const visiblePatternIds = (): string[] =>
      component.visibleInspectionAnnotations().map((annotation) => annotation.pattern_stable_id);

    it('disableAllToxicophoreCategories oculta las anotaciones rojas y mantiene las verdes', () => {
      buildRiskCatalog();

      component.disableAllToxicophoreCategories();

      expect(visiblePatternIds()).toEqual(['pat-priv']);
      expect(component.privilegedAnnotationsEnabled()).toBe(true);
      expect(component.isRiskCategoryEnabled('hepatotoxicity')).toBe(false);
      expect(component.isRiskCategoryEnabled('reactivity')).toBe(false);
      expect(component.isRiskCategoryEnabled('privileged_scaffold')).toBe(true);
    });

    it('desactivar una categoría oculta solo los patrones de esa categoría', () => {
      buildRiskCatalog();

      component.toggleRiskCategory('hepatotoxicity');

      expect(visiblePatternIds()).toEqual(['pat-react', 'pat-priv']);
      expect(component.isRiskCategoryEnabled('hepatotoxicity')).toBe(false);
      expect(component.isRiskCategoryEnabled('reactivity')).toBe(true);
    });

    it('togglePrivilegedAnnotations oculta solo las anotaciones verdes', () => {
      buildRiskCatalog();

      component.togglePrivilegedAnnotations();

      expect(visiblePatternIds()).toEqual(['pat-hep', 'pat-react']);
      expect(component.isRiskCategoryEnabled('privileged_scaffold')).toBe(false);
    });

    it('enableAllRiskCategories restaura las anotaciones tras desactivar todo', () => {
      buildRiskCatalog();
      component.disableAllToxicophoreCategories();
      component.togglePrivilegedAnnotations();
      expect(component.annotationsAreVisible()).toBe(false);

      component.enableAllRiskCategories();

      expect(component.annotationsAreVisible()).toBe(true);
      expect(component.visibleInspectionAnnotations()).toHaveLength(3);
      expect(component.privilegedAnnotationsEnabled()).toBe(true);
    });

    it('el toggle por patrón convive con el toggle de categoría', () => {
      buildRiskCatalog();
      component.togglePatternEnabled('pat-hep');
      expect(visiblePatternIds()).toEqual(['pat-react', 'pat-priv']);

      component.toggleRiskCategory('reactivity');
      expect(visiblePatternIds()).toEqual(['pat-priv']);

      component.toggleRiskCategory('reactivity');
      // pat-hep sigue oculto por su toggle individual
      expect(visiblePatternIds()).toEqual(['pat-react', 'pat-priv']);

      component.togglePatternEnabled('pat-hep');
      expect(visiblePatternIds()).toEqual(['pat-hep', 'pat-react', 'pat-priv']);
    });

    it('toggleAllAlerts desactiva y reactiva todas las categorías según el estado', () => {
      buildRiskCatalog();
      expect(component.allAlertsEnabled()).toBe(true);

      component.toggleAllAlerts();
      expect(component.allAlertsEnabled()).toBe(false);
      expect(visiblePatternIds()).toEqual(['pat-priv']);

      component.toggleAllAlerts();
      expect(component.allAlertsEnabled()).toBe(true);
      expect(visiblePatternIds()).toEqual(['pat-hep', 'pat-react', 'pat-priv']);
    });

    it('riskCategoryGroups agrupa los patrones presentes con su conteo de coincidencias', () => {
      buildRiskCatalog();

      const groups = component.riskCategoryGroups();

      expect(groups.map((group) => group.key)).toEqual([
        'hepatotoxicity',
        'reactivity',
        'privileged_scaffold',
      ]);
      expect(groups[0].patterns.map((pattern) => pattern.stable_id)).toEqual(['pat-hep']);
      expect(groups[0].matchCount).toBe(1);
      expect(groups.every((group) => group.isEnabled)).toBe(true);

      component.toggleRiskCategory('hepatotoxicity');
      expect(component.riskCategoryGroups()[0].isEnabled).toBe(false);
    });

    it('annotationLegendGroups agrupa las anotaciones por categoría y expone su estado', () => {
      buildRiskCatalog();

      const groups = component.annotationLegendGroups();

      expect(groups.map((group) => group.key)).toEqual([
        'hepatotoxicity',
        'reactivity',
        'privileged_scaffold',
      ]);
      expect(groups[0].annotations.map((annotation) => annotation.pattern_stable_id)).toEqual([
        'pat-hep',
      ]);
      expect(groups.every((group) => group.isEnabled)).toBe(true);

      component.togglePrivilegedAnnotations();
      const privilegedGroup = component
        .annotationLegendGroups()
        .find((group) => group.key === 'privileged_scaffold');
      expect(privilegedGroup?.isEnabled).toBe(false);
    });

    it('los patrones sin categoría conocida caen en la categoría other', () => {
      mockWorkflow.patterns.set([
        buildMockPattern('pat-legacy', 'Legacy pattern', { other: 'unrelated' }),
        buildMockPattern('pat-null'),
        buildMockPattern('pat-priv', 'Privileged scaffold', {
          [RISK_CATEGORY_METADATA_KEY]: 'privileged_scaffold',
        }),
      ] as never);
      mockWorkflow.inspection.set({
        annotations: [
          buildMockAnnotation('pat-legacy'),
          buildMockAnnotation('pat-null'),
          buildMockAnnotation('pat-unregistered', { pattern_type: 'privileged' }),
        ],
      } as never);

      const groups = component.riskCategoryGroups();
      expect(groups.map((group) => group.key)).toEqual(['other', 'privileged_scaffold']);
      expect(groups[0].matchCount).toBe(2);

      const legendKeys = component.annotationLegendGroups().map((group) => group.key);
      expect(legendKeys).toEqual(['other', 'privileged_scaffold']);

      component.toggleRiskCategory('privileged_scaffold');
      expect(visiblePatternIds()).toEqual(['pat-legacy', 'pat-null']);
    });
  });

  describe('catalogEntryPreviewError', () => {
    it('retorna null si no hay error para la entrada', () => {
      const entry = { smiles: 'C', anchor_atom_indices: [] } as unknown as SmileitCatalogEntryView;
      expect(component.catalogEntryPreviewError(entry)).toBeNull();
    });
  });

  describe('isReferencedInAnyBlock', () => {
    it('retorna false cuando no hay bloques', () => {
      mockWorkflow.assignmentBlocks.set([]);
      const entry = { smiles: 'C' } as unknown as SmileitCatalogEntryView;
      expect(component.isReferencedInAnyBlock(entry)).toBe(false);
    });
  });

  describe('isAtomSelected', () => {
    it('retorna false cuando no hay átomos seleccionados', () => {
      mockWorkflow.selectedAtomIndices.set([]);
      expect(component.isAtomSelected(5)).toBe(false);
    });

    it('retorna true cuando el índice está en la selección', () => {
      mockWorkflow.selectedAtomIndices.set([3, 5, 7]);
      expect(component.isAtomSelected(5)).toBe(true);
    });
  });

  describe('coverageLabel', () => {
    it('retorna null cuando no hay cobertura para el átomo', () => {
      mockWorkflow.selectedSiteCoverage.set([]);
      expect(component.coverageLabel(0)).toBeNull();
    });

    it('retorna la etiqueta formateada cuando existe cobertura', () => {
      mockWorkflow.selectedSiteCoverage.set([
        { siteAtomIndex: 2, blockLabel: 'Block-A', priority: 1 } as never,
      ]);
      expect(component.coverageLabel(2)).toBe('Block-A · P1');
    });
  });

  describe('patternTypeLabel', () => {
    it('retorna "Toxicophore" para el tipo toxicophore', () => {
      expect(component.patternTypeLabel('toxicophore')).toBe('Toxicophore');
    });

    it('retorna "Privileged scaffold" para el tipo privileged', () => {
      expect(component.patternTypeLabel('privileged')).toBe('Privileged scaffold');
    });

    it('retorna el tipo tal cual si no es reconocido', () => {
      expect(component.patternTypeLabel('custom')).toBe('custom');
    });
  });

  describe('onPatternCatalogDialogClick', () => {
    it('no lanza error cuando no hay ref al dialog', () => {
      const event = new MouseEvent('click');
      expect(() => component.onPatternCatalogDialogClick(event)).not.toThrow();
    });
  });

  describe('openPatternCatalogModal y closePatternCatalogModal', () => {
    it('abre el dialog cuando el ref existe', () => {
      const dialogElement = {
        open: false,
        showModal: vi.fn(),
        close: vi.fn(),
        setAttribute: vi.fn(),
      } as unknown as HTMLDialogElement;

      (
        component as unknown as { patternCatalogDialogRef: { nativeElement: HTMLDialogElement } }
      ).patternCatalogDialogRef = {
        nativeElement: dialogElement,
      };

      component.openPatternCatalogModal();

      expect(dialogElement.showModal).toHaveBeenCalledOnce();
    });
  });

  describe('openPatternDetail y closePatternDetail', () => {
    it('openPatternDetail guarda el patrón seleccionado', () => {
      const pat = buildMockPattern('p-detail');
      component.openPatternDetail(pat);
      expect(component.selectedPatternForDetail()).toBe(pat);
    });

    it('openPatternDetail abre el dialog cuando el ref existe', () => {
      const dialogElement = {
        open: false,
        showModal: vi.fn(),
        close: vi.fn(),
        setAttribute: vi.fn(),
      } as unknown as HTMLDialogElement;

      (
        component as unknown as { patternDetailDialogRef: { nativeElement: HTMLDialogElement } }
      ).patternDetailDialogRef = {
        nativeElement: dialogElement,
      };

      component.openPatternDetail(buildMockPattern('p-dialog'));

      expect(dialogElement.showModal).toHaveBeenCalledOnce();
    });

    it('closePatternDetail limpia el patrón seleccionado', () => {
      const pat = buildMockPattern('p-detail');
      component.openPatternDetail(pat);
      component.closePatternDetail();
      expect(component.selectedPatternForDetail()).toBeNull();
    });
  });

  describe('editLibraryEntryFromDetail', () => {
    it('cierra el detalle de la entrada al llamar editLibraryEntryFromDetail', () => {
      const entry = { id: 1 } as unknown as SmileitCatalogEntryView;
      component.openLibraryEntryDetail(entry, 'reference');
      component.editLibraryEntryFromDetail(entry);
      expect(component.selectedLibraryEntryForDetail()).toBeNull();
    });
  });

  describe('catalogEntryPreviewSvg', () => {
    it('retorna null cuando no hay inspección para la entrada', () => {
      const entry = {
        smiles: 'CCO',
        anchor_atom_indices: [],
      } as unknown as SmileitCatalogEntryView;
      expect(component.catalogEntryPreviewSvg(entry)).toBeNull();
    });
  });

  describe('onInspectionSvgClick', () => {
    it('no hace nada cuando el workflow está procesando', () => {
      mockWorkflow.isProcessing.set(true);
      const event = new MouseEvent('click');
      expect(() => component.onInspectionSvgClick(event)).not.toThrow();
    });

    it('no hace nada cuando no hay índice de átomo resuelto', () => {
      mockWorkflow.isProcessing.set(false);
      const event = new MouseEvent('click');
      // extractAtomIndexFromEvent retorna null (configurado en beforeEach)
      expect(() => component.onInspectionSvgClick(event)).not.toThrow();
    });

    it('llama toggleSelectedAtom cuando se resuelve un índice de átomo válido', () => {
      mockWorkflow.isProcessing.set(false);
      const mockInspectionService = TestBed.inject(SmileitInspectionService);
      vi.mocked(mockInspectionService.extractAtomIndexFromEvent).mockReturnValue(4);
      const event = new MouseEvent('click');
      component.onInspectionSvgClick(event);
      expect(mockWorkflow.toggleSelectedAtom).toHaveBeenCalledWith(4);
    });
  });

  describe('toTrustedSvg y toTrustedInspectionSvg', () => {
    it('toTrustedSvg retorna SafeHtml sin lanzar error', () => {
      const result = component.toTrustedSvg('<svg><circle/></svg>');
      expect(result).toBeTruthy();
    });

    it('toTrustedInspectionSvg retorna SafeHtml usando inspectionSvg del workflow', () => {
      mockWorkflow.inspectionSvg.set('<svg>inspection</svg>');
      const result = component.toTrustedInspectionSvg();
      expect(result).toBeTruthy();
    });
  });

  describe('catalogEntryPreviewSvg con inspección disponible', () => {
    it('retorna SVG decorado cuando existe inspección para la entrada', () => {
      const entry = {
        stable_id: 'e-1',
        version: 2,
        smiles: 'C',
        anchor_atom_indices: [0],
      } as unknown as SmileitCatalogEntryView;

      // Simular inspección en la cache interna del componente
      component.libraryEntryInspections.set({
        'e-1@2': { svg: '<svg>raw</svg>', atoms: [] } as never,
      });

      const result = component.catalogEntryPreviewSvg(entry);
      expect(result).toBeTruthy();
    });
  });

  describe('isReferencedInAnyBlock con bloque referenciado', () => {
    it('retorna true cuando al menos un bloque referencia la entrada', () => {
      const entry = {
        smiles: 'C',
        stable_id: 'e1',
        version: 1,
      } as unknown as SmileitCatalogEntryView;

      // Necesitamos que blocks.catalog.isCatalogEntryReferenced exista en el mock
      const mockCatalogRef = { isCatalogEntryReferenced: vi.fn().mockReturnValue(true) };
      (mockWorkflow as Record<string, unknown>)['catalog'] = mockCatalogRef;
      mockWorkflow.assignmentBlocks.set([{ id: 'b1', catalogRefs: [] }] as never);

      expect(component.isReferencedInAnyBlock(entry)).toBe(true);
    });
  });
});

describe('SmileitComponent - syncVisibleLibraryPreviews', () => {
  let component: SmileitComponent;
  let mockWorkflow: ReturnType<typeof buildMockWorkflow>;
  let mockInspectionSvc: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mockWorkflow = buildMockWorkflow();
    mockInspectionSvc = vi
      .fn()
      .mockReturnValue(of({ svg: '<svg/>', atoms: [{ index: 0, symbol: 'C' }] }));

    await TestBed.configureTestingModule({
      imports: [SmileitComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({})) } },
        {
          provide: SmileitInspectionService,
          useValue: {
            decorateInspectionSvg: vi.fn().mockReturnValue(''),
            extractAtomIndexFromEvent: vi.fn().mockReturnValue(null),
          },
        },
        { provide: JobsApiService, useValue: { inspectSmileitStructure: mockInspectionSvc } },
      ],
    })
      .overrideComponent(SmileitComponent, {
        set: {
          template: '',
          providers: [{ provide: SmileitWorkflowService, useValue: mockWorkflow }],
          schemas: [NO_ERRORS_SCHEMA],
        },
      })
      .compileComponents();

    const fixture = TestBed.createComponent(SmileitComponent);
    component = fixture.componentInstance;
  });

  it('llama a inspectSmileitStructure para entradas con SMILES válido', () => {
    const entry = { stable_id: 'lib-1', version: 1, smiles: 'CCO' } as never;
    mockWorkflow.catalogGroups.set([{ key: 'all', entries: [entry] }] as never);
    TestBed.flushEffects();

    expect(mockInspectionSvc).toHaveBeenCalledWith('CCO');
  });

  it('establece error cuando la entrada no tiene SMILES', () => {
    const entry = { stable_id: 'lib-empty', version: 1, smiles: '   ' } as never;
    mockWorkflow.catalogGroups.set([{ key: 'all', entries: [entry] }] as never);
    TestBed.flushEffects();

    expect(component.libraryEntryInspectionErrors()['lib-empty@1']).toBe(
      'No SMILES available for preview.',
    );
  });

  it('no repite la inspección si la entrada ya está en cache', () => {
    const entry = { stable_id: 'lib-cached', version: 1, smiles: 'C' } as never;
    component.libraryEntryInspections.set({ 'lib-cached@1': { svg: '<svg/>' } as never });
    mockWorkflow.catalogGroups.set([{ key: 'all', entries: [entry] }] as never);
    TestBed.flushEffects();

    // No debe llamar al API si ya está en cache
    expect(mockInspectionSvc).not.toHaveBeenCalled();
  });

  it('establece error de inspección cuando la API falla', async () => {
    const { throwError } = await import('rxjs');
    mockInspectionSvc.mockReturnValue(throwError(() => new Error('API down')));
    const entry = { stable_id: 'lib-err', version: 1, smiles: 'INVALID' } as never;
    mockWorkflow.catalogGroups.set([{ key: 'all', entries: [entry] }] as never);
    TestBed.flushEffects();

    expect(component.libraryEntryInspectionErrors()['lib-err@1']).toContain('API down');
  });
});
