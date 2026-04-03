// smileit.component.spec.ts: Pruebas unitarias del componente principal de Smile-it.
// Cubre: señales de toggle, computed de patrones/logs/anotaciones, y gestión del panel de detalle.
// Los servicios complejos (workflow, inspección) se mockean para aislar sólo la lógica del componente.

import { signal } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  JobLogEntryView,
  SmileitCatalogEntryView,
  SmileitPatternEntryView,
  SmileitStructureInspectionView,
} from '../core/api/jobs-api.service';
import { SmileitInspectionService } from './core/services/smileit-inspection.service';
import { SmileitComponent } from './smileit.component';

// Helpers para construir objetos mínimos de dominio
const buildMockPattern = (stableId: string, name = 'pattern'): SmileitPatternEntryView =>
  ({
    stable_id: stableId,
    name,
    color: '#ff0000',
    caption: '',
  }) as unknown as SmileitPatternEntryView;

const buildMockAnnotation = (patternStableId: string) => ({
  pattern_stable_id: patternStableId,
  atom_indices: [0],
  color: '#00ff00',
  caption: '',
});

/** Mock mínimo del SmileitWorkflowService con señales controlables. */
const buildMockWorkflow = () => {
  const mockCatalog = {
    loadInitialData: vi.fn(),
    catalogGroups: signal([]),
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
        // Proveer el workflow + estado desde los providers del componente
        {
          provide: SmileitInspectionService,
          useValue: {
            decorateInspectionSvg: vi.fn().mockReturnValue(''),
            extractAtomIndexFromEvent: vi.fn().mockReturnValue(null),
          },
        },
      ],
    })
      .overrideComponent(SmileitComponent, {
        set: {
          providers: [{ provide: 'SmileitWorkflowService', useValue: mockWorkflow }],
        },
      })
      .compileComponents();

    const fixture = TestBed.createComponent(SmileitComponent);
    component = fixture.componentInstance;
  });

  describe('señales de colapso', () => {
    it('isLogsCollapsed comienza en false', () => {
      expect(component.isLogsCollapsed()).toBe(false);
    });

    it('toggleLogsCollapse invierte el estado de los logs', () => {
      component.toggleLogsCollapse();
      expect(component.isLogsCollapsed()).toBe(true);
      component.toggleLogsCollapse();
      expect(component.isLogsCollapsed()).toBe(false);
    });

    it('isAdvancedSectionCollapsed comienza en true', () => {
      expect(component.isAdvancedSectionCollapsed()).toBe(true);
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
    it('actualiza el principalSmiles en el workflow', fakeAsync(() => {
      component.onPrincipalSmilesChange('c1ccccc1');
      tick();
      // El workflow.principalSmiles es una señal del state; verificamos la señal del mock
      expect(mockWorkflow.principalSmiles()).toBe('c1ccccc1');
    }));
  });
});
