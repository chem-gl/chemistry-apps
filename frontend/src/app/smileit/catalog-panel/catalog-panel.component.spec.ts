// catalog-panel.component.spec.ts: Pruebas unitarias del panel de catálogo de sustituyentes Smile-it.
// Cubre: señales de estado, computeds de filtrado, métodos de delegación al workflow,
// preview de entradas de catálogo, gestión de anclajes, diálogos (null-safe) y ciclo de vida.

import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JobsApiService } from '../../core/api/jobs-api.service';
import { SmileitWorkflowService } from '../../core/application/smileit-workflow.service';
import { SmileitInspectionService } from '../core/services/smileit-inspection.service';
import { CatalogPanelComponent } from './catalog-panel.component';

/** Construye un mock completo del WorkflowService para el panel de catálogo. */
const buildMockWorkflow = () => ({
  catalogGroups: signal<{ key: string; entries: unknown[] }[]>([]),
  catalogCreateSmiles: signal<string>(''),
  catalogCreateAnchorIndicesText: signal<string>(''),
  isProcessing: signal<boolean>(false),
  catalog: {
    ensureCatalogDraftDefaults: vi.fn(),
    createCatalogEntry: vi.fn(),
    createCatalogEntryAndPrepareNext: vi.fn(),
    beginCatalogEntryEdition: vi.fn(),
  },
});

const buildMockInspectionService = () => ({
  decorateInspectionSvg: vi.fn().mockReturnValue('<svg>decorated</svg>'),
  extractAtomIndexFromEvent: vi.fn().mockReturnValue(null),
});

const buildMockJobsApiService = () => ({
  inspectSmileitStructure: vi.fn().mockReturnValue(
    of({
      svg: '<svg>raw</svg>',
      atoms: [{ index: 0, symbol: 'C' }],
    }),
  ),
});

describe('CatalogPanelComponent', () => {
  let component: CatalogPanelComponent;
  let fixture: ComponentFixture<CatalogPanelComponent>;
  let mockWorkflow: ReturnType<typeof buildMockWorkflow>;
  let mockInspectionService: ReturnType<typeof buildMockInspectionService>;
  let mockJobsApiService: ReturnType<typeof buildMockJobsApiService>;
  let mockSanitizer: {
    bypassSecurityTrustHtml: ReturnType<typeof vi.fn>;
    bypassSecurityTrustResourceUrl: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockWorkflow = buildMockWorkflow();
    mockInspectionService = buildMockInspectionService();
    mockJobsApiService = buildMockJobsApiService();
    mockSanitizer = {
      bypassSecurityTrustHtml: vi.fn().mockImplementation((v: string) => v),
      bypassSecurityTrustResourceUrl: vi.fn().mockReturnValue('trusted-url'),
    };

    await TestBed.configureTestingModule({
      imports: [CatalogPanelComponent],
      providers: [
        { provide: SmileitInspectionService, useValue: mockInspectionService },
        { provide: JobsApiService, useValue: mockJobsApiService },
        { provide: DomSanitizer, useValue: mockSanitizer },
      ],
    })
      .overrideComponent(CatalogPanelComponent, {
        set: {
          template: '',
          providers: [{ provide: SmileitWorkflowService, useValue: mockWorkflow }],
          schemas: [NO_ERRORS_SCHEMA],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(CatalogPanelComponent);
    fixture.componentRef.setInput('libraryEntryInspections', {});
    fixture.componentRef.setInput('libraryEntryInspectionErrors', {});
    fixture.detectChanges();
    component = fixture.componentInstance;
  });

  describe('estado inicial', () => {
    it('isCatalogPanelCollapsed comienza en true', () => {
      expect(component.isCatalogPanelCollapsed()).toBe(true);
    });

    it('selectedLibraryGroupKey comienza en "all"', () => {
      expect(component.selectedLibraryGroupKey()).toBe('all');
    });

    it('isCatalogSmilesSketcherReady comienza en false', () => {
      expect(component.isCatalogSmilesSketcherReady()).toBe(false);
    });

    it('isCatalogSmilesSketchLoading comienza en false', () => {
      expect(component.isCatalogSmilesSketchLoading()).toBe(false);
    });

    it('catalogSketchValidationError comienza null', () => {
      expect(component.catalogSketchValidationError()).toBeNull();
    });

    it('catalogDraftInspection comienza null', () => {
      expect(component.catalogDraftInspection()).toBeNull();
    });
  });

  describe('toggleCatalogPanelCollapse', () => {
    it('cambia isCatalogPanelCollapsed de true a false', () => {
      component.toggleCatalogPanelCollapse();
      expect(component.isCatalogPanelCollapsed()).toBe(false);
    });

    it('regresa a true en la segunda llamada', () => {
      component.toggleCatalogPanelCollapse();
      component.toggleCatalogPanelCollapse();
      expect(component.isCatalogPanelCollapsed()).toBe(true);
    });
  });

  describe('filteredLibraryGroups computed', () => {
    const groupA = { key: 'group-a', entries: [] };
    const groupB = { key: 'group-b', entries: [] };

    it('retorna todos los grupos cuando la clave es "all"', () => {
      mockWorkflow.catalogGroups.set([groupA, groupB]);
      expect(component.filteredLibraryGroups()).toHaveLength(2);
    });

    it('retorna solo el grupo coincidente con la clave seleccionada', () => {
      mockWorkflow.catalogGroups.set([groupA, groupB]);
      component.onLibraryGroupChange('group-a');
      expect(component.filteredLibraryGroups()).toHaveLength(1);
      expect(component.filteredLibraryGroups()[0].key).toBe('group-a');
    });

    it('retorna todos los grupos si la clave seleccionada no tiene coincidencia', () => {
      mockWorkflow.catalogGroups.set([groupA, groupB]);
      component.onLibraryGroupChange('non-existent');
      expect(component.filteredLibraryGroups()).toHaveLength(2);
    });
  });

  describe('filteredLibraryEntries computed', () => {
    it('retorna lista plana de entradas visibles', () => {
      const entryA = { id: 'e-1', stable_id: 'methane', version: 1, smiles: 'C', name: 'methane' };
      const entryB = { id: 'e-2', stable_id: 'ethane', version: 1, smiles: 'CC', name: 'ethane' };
      mockWorkflow.catalogGroups.set([{ key: 'all', entries: [entryA, entryB] }]);
      expect(component.filteredLibraryEntries()).toHaveLength(2);
    });

    it('deduplica entradas repetidas cuando una molécula aparece en múltiples grupos', () => {
      const duplicatedEntry = {
        id: 'e-1',
        stable_id: 'methane',
        version: 1,
        smiles: 'C',
        name: 'methane',
      };

      mockWorkflow.catalogGroups.set([
        { key: 'group-a', entries: [duplicatedEntry] },
        { key: 'group-b', entries: [duplicatedEntry] },
      ]);

      const entries = component.filteredLibraryEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toEqual(duplicatedEntry);
    });

    it('retorna lista vacía cuando no hay grupos', () => {
      mockWorkflow.catalogGroups.set([]);
      expect(component.filteredLibraryEntries()).toHaveLength(0);
    });
  });

  describe('onLibraryGroupChange', () => {
    it('actualiza selectedLibraryGroupKey', () => {
      component.onLibraryGroupChange('group-x');
      expect(component.selectedLibraryGroupKey()).toBe('group-x');
    });
  });

  describe('catalogEntryPreviewError', () => {
    it('retorna null cuando no hay error para la entrada', () => {
      const entry = { stable_id: 'e1', version: 1 } as never;
      fixture.componentRef.setInput('libraryEntryInspectionErrors', {});
      fixture.detectChanges();
      expect(component.catalogEntryPreviewError(entry)).toBeNull();
    });

    it('retorna el error cuando existe la clave en el input', () => {
      const entry = { stable_id: 'e1', version: 1 } as never;
      fixture.componentRef.setInput('libraryEntryInspectionErrors', { 'e1@1': 'Network error' });
      fixture.detectChanges();
      expect(component.catalogEntryPreviewError(entry)).toBe('Network error');
    });
  });

  describe('catalogEntryPreviewSvg', () => {
    it('retorna null cuando no hay inspección para la entrada', () => {
      const entry = { stable_id: 'e2', version: 1, anchor_atom_indices: [] } as never;
      fixture.componentRef.setInput('libraryEntryInspections', {});
      fixture.detectChanges();
      expect(component.catalogEntryPreviewSvg(entry)).toBeNull();
    });

    it('retorna SVG decorado cuando existe inspección', () => {
      const entry = { stable_id: 'e3', version: 2, anchor_atom_indices: [0] } as never;
      fixture.componentRef.setInput('libraryEntryInspections', {
        'e3@2': { svg: '<svg>raw</svg>' },
      });
      fixture.detectChanges();
      const result = component.catalogEntryPreviewSvg(entry);
      expect(mockInspectionService.decorateInspectionSvg).toHaveBeenCalled();
      expect(result).toBeTruthy();
    });
  });

  describe('toggleCatalogDraftAnchor', () => {
    it('actualiza catalogCreateAnchorIndicesText con el índice de átomo dado', () => {
      component.toggleCatalogDraftAnchor(3);
      expect(mockWorkflow.catalogCreateAnchorIndicesText()).toBe('3');
    });
  });

  describe('catalogDraftAnchorIndices', () => {
    it('retorna array vacío cuando el texto de anclaje está vacío', () => {
      mockWorkflow.catalogCreateAnchorIndicesText.set('');
      expect(component.catalogDraftAnchorIndices()).toEqual([]);
    });

    it('retorna solo el primer índice parseado', () => {
      mockWorkflow.catalogCreateAnchorIndicesText.set('5');
      expect(component.catalogDraftAnchorIndices()).toEqual([5]);
    });
  });

  describe('onCatalogDraftSvgClick', () => {
    it('no hace nada cuando isProcessing=true', () => {
      mockWorkflow.isProcessing.set(true);
      mockInspectionService.extractAtomIndexFromEvent.mockReturnValue(2);
      component.onCatalogDraftSvgClick({ target: {} } as MouseEvent);
      expect(mockWorkflow.catalogCreateAnchorIndicesText()).toBe('');
    });

    it('no modifica el anclaje cuando extractAtomIndexFromEvent retorna null', () => {
      mockWorkflow.isProcessing.set(false);
      mockInspectionService.extractAtomIndexFromEvent.mockReturnValue(null);
      component.onCatalogDraftSvgClick({ target: {} } as MouseEvent);
      expect(mockWorkflow.catalogCreateAnchorIndicesText()).toBe('');
    });

    it('actualiza el anclaje cuando se obtiene un índice de átomo', () => {
      mockWorkflow.isProcessing.set(false);
      mockInspectionService.extractAtomIndexFromEvent.mockReturnValue(7);
      component.onCatalogDraftSvgClick({ target: {} } as MouseEvent);
      expect(mockWorkflow.catalogCreateAnchorIndicesText()).toBe('7');
    });
  });

  describe('toTrustedAnchorSelectionSvg', () => {
    it('llama decorateInspectionSvg y bypassSecurityTrustHtml', () => {
      const result = component.toTrustedAnchorSelectionSvg('<svg/>', [0, 1]);
      expect(mockInspectionService.decorateInspectionSvg).toHaveBeenCalledWith(
        '<svg/>',
        [0, 1],
        [],
      );
      expect(mockSanitizer.bypassSecurityTrustHtml).toHaveBeenCalled();
      expect(result).toBeTruthy();
    });
  });

  describe('onCatalogDraftSmilesChange', () => {
    it('actualiza catalogCreateSmiles y dispara la inspección', () => {
      component.onCatalogDraftSmilesChange('CCO');
      expect(mockWorkflow.catalogCreateSmiles()).toBe('CCO');
    });

    it('suscribe a inspectSmileitStructure cuando el SMILES no está vacío', () => {
      component.onCatalogDraftSmilesChange('CCO');
      expect(mockJobsApiService.inspectSmileitStructure).toHaveBeenCalledWith('CCO');
    });

    it('limpia la inspección cuando el SMILES es vacío', () => {
      mockWorkflow.catalogCreateSmiles.set('CCO');
      component.onCatalogDraftSmilesChange('');
      expect(component.catalogDraftInspection()).toBeNull();
      expect(component.catalogDraftInspectionError()).toBeNull();
    });

    it('establece catalogDraftInspectionError cuando la API falla', () => {
      mockJobsApiService.inspectSmileitStructure.mockReturnValue(
        throwError(() => new Error('API error')),
      );
      component.onCatalogDraftSmilesChange('INVALID');
      expect(component.catalogDraftInspectionError()).toContain('API error');
    });
  });

  describe('addCatalogDraftAndClose', () => {
    it('delega a workflow.catalog.createCatalogEntry', () => {
      component.addCatalogDraftAndClose();
      expect(mockWorkflow.catalog.createCatalogEntry).toHaveBeenCalledOnce();
    });

    it('cierra el modal al ejecutar el callback del workflow', () => {
      mockWorkflow.catalog.createCatalogEntry.mockImplementation((cb: () => void) => cb());
      expect(() => component.addCatalogDraftAndClose()).not.toThrow();
    });
  });

  describe('addAnotherCatalogDraft', () => {
    it('delega a workflow.catalog.createCatalogEntryAndPrepareNext', () => {
      component.addAnotherCatalogDraft();
      expect(mockWorkflow.catalog.createCatalogEntryAndPrepareNext).toHaveBeenCalledOnce();
    });
  });

  describe('beginCatalogEntryEdition', () => {
    it('delega a workflow.catalog.beginCatalogEntryEdition', () => {
      const entry = { stable_id: 'e1', version: 1 } as never;
      component.beginCatalogEntryEdition(entry);
      expect(mockWorkflow.catalog.beginCatalogEntryEdition).toHaveBeenCalledWith(entry);
    });
  });

  describe('openLibraryEntryDetail', () => {
    it('emite libraryEntryDetailRequested con la entrada recibida', () => {
      const emitted: unknown[] = [];
      component.libraryEntryDetailRequested.subscribe((e) => emitted.push(e));
      const entry = { stable_id: 'e1', version: 1 } as never;
      component.openLibraryEntryDetail(entry);
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toBe(entry);
    });
  });

  describe('métodos de diálogo null-safe', () => {
    it('closeCatalogStudioModal no lanza error sin ViewChild', () => {
      expect(() => component.closeCatalogStudioModal()).not.toThrow();
    });

    it('closeCatalogSmilesSketcher no lanza error sin ViewChild', () => {
      expect(() => component.closeCatalogSmilesSketcher()).not.toThrow();
    });

    it('onCatalogStudioDialogClick no lanza error sin ViewChild', () => {
      expect(() =>
        component.onCatalogStudioDialogClick({ target: document.body } as unknown as Event),
      ).not.toThrow();
    });

    it('onCatalogSmilesSketchDialogClick no lanza error sin ViewChild', () => {
      expect(() =>
        component.onCatalogSmilesSketchDialogClick({ target: document.body } as unknown as Event),
      ).not.toThrow();
    });

    it('openCatalogStudioModal no lanza error sin ViewChild', () => {
      expect(() => component.openCatalogStudioModal()).not.toThrow();
    });

    it('openCatalogStudioModal muestra el dialog cuando el ref existe', () => {
      const dialogElement = {
        open: false,
        showModal: vi.fn(),
        close: vi.fn(),
        removeAttribute: vi.fn(),
        setAttribute: vi.fn(),
      } as unknown as HTMLDialogElement;

      (
        component as unknown as { catalogStudioDialogRef: { nativeElement: HTMLDialogElement } }
      ).catalogStudioDialogRef = {
        nativeElement: dialogElement,
      };

      component.openCatalogStudioModal();

      expect(dialogElement.showModal).toHaveBeenCalledOnce();
    });
  });

  describe('onCatalogSmilesKetcherLoaded', () => {
    it('marca isCatalogSmilesSketcherReady como true', () => {
      component.onCatalogSmilesKetcherLoaded();
      expect(component.isCatalogSmilesSketcherReady()).toBe(true);
    });
  });

  describe('openCatalogSmilesSketcher', () => {
    it('no hace nada cuando isProcessing=true', () => {
      mockWorkflow.isProcessing.set(true);
      expect(() => component.openCatalogSmilesSketcher()).not.toThrow();
      expect(component.isCatalogSmilesSketchLoading()).toBe(false);
    });

    it('abre el dialog y sincroniza el SMILES cuando el panel está listo', () => {
      component.isCatalogSmilesSketcherReady.set(true);
      const dialogElement = {
        open: false,
        showModal: vi.fn(),
        close: vi.fn(),
        removeAttribute: vi.fn(),
        setAttribute: vi.fn(),
      } as unknown as HTMLDialogElement;

      (
        component as unknown as {
          catalogSmilesSketchDialogRef: { nativeElement: HTMLDialogElement };
        }
      ).catalogSmilesSketchDialogRef = {
        nativeElement: dialogElement,
      };

      component.openCatalogSmilesSketcher();

      expect(dialogElement.showModal).toHaveBeenCalledOnce();
    });
  });

  describe('applyCatalogSmilesFromSketcher', () => {
    it('marca error cuando el sketcher queda vacío', async () => {
      mockWorkflow.catalogCreateSmiles.set('');

      await component.applyCatalogSmilesFromSketcher();

      expect(component.catalogSketchValidationError()).toContain('Draw one molecule');
    });

    it('marca error cuando el sketcher contiene múltiples fragmentos', async () => {
      mockWorkflow.catalogCreateSmiles.set('CCO.c1ccccc1');

      await component.applyCatalogSmilesFromSketcher();

      expect(component.catalogSketchValidationError()).toContain('Only one molecule');
    });
  });

  describe('ngOnDestroy', () => {
    it('no lanza error al destruir el componente', () => {
      expect(() => component.ngOnDestroy()).not.toThrow();
    });

    it('cancela la suscripción activa de inspección al destruir', () => {
      // Iniciar una suscripción primero
      component.onCatalogDraftSmilesChange('C');
      expect(() => component.ngOnDestroy()).not.toThrow();
    });
  });
});
