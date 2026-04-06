// block-assignment-panel.component.spec.ts: Pruebas unitarias del panel de asignación de bloques.
// Cubre: señales de colapso, computed selectedSitesLabel, métodos de delegación al workflow,
// filtrado de catálogo por grupo, comparación de borrador manual e interacciones de eventos.

import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SmileitWorkflowService } from '../../core/application/smileit-workflow.service';
import {
    BlockAssignmentPanelComponent,
    BlockPanelLibraryDetailRequest,
} from './block-assignment-panel.component';

/** Construye un mock mínimo del WorkflowService para el panel de asignación. */
const buildMockWorkflow = () => ({
  selectedAtomIndices: signal<number[]>([]),
  assignmentBlocks: signal<{ id: string }[]>([]),
  catalogGroups: signal<{ key: string; entries: { smiles: string; name: string }[] }[]>([]),
  isProcessing: signal<boolean>(false),
  blocks: {
    addAssignmentBlock: vi.fn(),
    addCatalogReferenceToBlock: vi.fn(),
    applyCatalogEntryToManualDraft: vi.fn(),
    getBlockCollapsedSummary: vi.fn().mockReturnValue({ summary: 'mock-summary' }),
  },
  catalog: {
    isCatalogEntryReferenced: vi.fn().mockReturnValue(false),
  },
});

describe('BlockAssignmentPanelComponent', () => {
  let component: BlockAssignmentPanelComponent;
  let fixture: ComponentFixture<BlockAssignmentPanelComponent>;
  let mockWorkflow: ReturnType<typeof buildMockWorkflow>;

  beforeEach(async () => {
    mockWorkflow = buildMockWorkflow();

    await TestBed.configureTestingModule({
      imports: [BlockAssignmentPanelComponent],
    })
      .overrideComponent(BlockAssignmentPanelComponent, {
        set: {
          template: '',
          providers: [{ provide: SmileitWorkflowService, useValue: mockWorkflow }],
          schemas: [NO_ERRORS_SCHEMA],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(BlockAssignmentPanelComponent);
    fixture.componentRef.setInput('libraryEntryInspections', {});
    fixture.componentRef.setInput('libraryEntryInspectionErrors', {});
    fixture.componentRef.setInput('catalogEntryPreviewSvgResolver', () => null);
    fixture.componentRef.setInput('catalogEntryPreviewErrorResolver', () => null);
    fixture.detectChanges();
    component = fixture.componentInstance;
  });

  describe('estado inicial', () => {
    it('isLibraryPanelCollapsed comienza en false', () => {
      expect(component.isLibraryPanelCollapsed()).toBe(false);
    });

    it('collapsedBlockMap comienza vacío', () => {
      expect(component.collapsedBlockMap()).toEqual({});
    });

    it('selectedBlockLibraryGroupKeys comienza vacío', () => {
      expect(component.selectedBlockLibraryGroupKeys()).toEqual({});
    });
  });

  describe('selectedSitesLabel computed', () => {
    it('retorna "None yet" cuando no hay átomos seleccionados', () => {
      mockWorkflow.selectedAtomIndices.set([]);
      expect(component.selectedSitesLabel()).toBe('None yet');
    });

    it('retorna los índices unidos por coma cuando hay átomos seleccionados', () => {
      mockWorkflow.selectedAtomIndices.set([1, 3, 5]);
      expect(component.selectedSitesLabel()).toBe('1, 3, 5');
    });

    it('retorna un solo índice correctamente', () => {
      mockWorkflow.selectedAtomIndices.set([7]);
      expect(component.selectedSitesLabel()).toBe('7');
    });
  });

  describe('addAssignmentBlock', () => {
    it('delega a workflow.blocks.addAssignmentBlock', () => {
      component.addAssignmentBlock();
      expect(mockWorkflow.blocks.addAssignmentBlock).toHaveBeenCalledOnce();
    });
  });

  describe('toggleLibraryPanelCollapse', () => {
    it('cambia isLibraryPanelCollapsed de false a true', () => {
      component.toggleLibraryPanelCollapse();
      expect(component.isLibraryPanelCollapsed()).toBe(true);
    });

    it('regresa a false en la segunda llamada', () => {
      component.toggleLibraryPanelCollapse();
      component.toggleLibraryPanelCollapse();
      expect(component.isLibraryPanelCollapsed()).toBe(false);
    });
  });

  describe('toggleBlockCollapse', () => {
    it('marca el bloque como colapsado si no estaba en el mapa', () => {
      component.toggleBlockCollapse('block-1');
      expect(component.isBlockCollapsed('block-1')).toBe(true);
    });

    it('regresa a expandido en la segunda llamada para el mismo bloque', () => {
      component.toggleBlockCollapse('block-1');
      component.toggleBlockCollapse('block-1');
      expect(component.isBlockCollapsed('block-1')).toBe(false);
    });

    it('gestiona múltiples bloques de forma independiente', () => {
      component.toggleBlockCollapse('block-a');
      component.toggleBlockCollapse('block-b');
      component.toggleBlockCollapse('block-b');
      expect(component.isBlockCollapsed('block-a')).toBe(true);
      expect(component.isBlockCollapsed('block-b')).toBe(false);
    });
  });

  describe('isBlockCollapsed', () => {
    it('retorna false para un id de bloque desconocido', () => {
      expect(component.isBlockCollapsed('unknown-id')).toBe(false);
    });

    it('retorna true después de colapsar ese bloque', () => {
      component.toggleBlockCollapse('block-x');
      expect(component.isBlockCollapsed('block-x')).toBe(true);
    });
  });

  describe('collapseAllBlocks', () => {
    it('marca todos los bloques de asignación como colapsados', () => {
      mockWorkflow.assignmentBlocks.set([{ id: 'b1' }, { id: 'b2' }]);
      component.collapseAllBlocks();
      expect(component.isBlockCollapsed('b1')).toBe(true);
      expect(component.isBlockCollapsed('b2')).toBe(true);
    });

    it('no lanza error con lista de bloques vacía', () => {
      mockWorkflow.assignmentBlocks.set([]);
      expect(() => component.collapseAllBlocks()).not.toThrow();
    });
  });

  describe('expandAllBlocks', () => {
    it('marca todos los bloques como expandidos', () => {
      mockWorkflow.assignmentBlocks.set([{ id: 'b1' }, { id: 'b2' }]);
      component.collapseAllBlocks();
      component.expandAllBlocks();
      expect(component.isBlockCollapsed('b1')).toBe(false);
      expect(component.isBlockCollapsed('b2')).toBe(false);
    });
  });

  describe('onBlockLibraryGroupChange', () => {
    it('almacena la clave de grupo seleccionada para un bloque', () => {
      component.onBlockLibraryGroupChange('block-1', 'group-a');
      expect(component.selectedBlockLibraryGroupKey('block-1')).toBe('group-a');
    });

    it('no afecta las claves de otros bloques', () => {
      component.onBlockLibraryGroupChange('block-1', 'group-a');
      expect(component.selectedBlockLibraryGroupKey('block-2')).toBe('all');
    });

    it('actualiza la clave al llamar de nuevo para el mismo bloque', () => {
      component.onBlockLibraryGroupChange('block-1', 'group-a');
      component.onBlockLibraryGroupChange('block-1', 'group-b');
      expect(component.selectedBlockLibraryGroupKey('block-1')).toBe('group-b');
    });
  });

  describe('selectedBlockLibraryGroupKey', () => {
    it('retorna "all" para bloque sin clave configurada', () => {
      expect(component.selectedBlockLibraryGroupKey('unknown')).toBe('all');
    });

    it('retorna la clave configurada previamente', () => {
      component.onBlockLibraryGroupChange('b1', 'custom');
      expect(component.selectedBlockLibraryGroupKey('b1')).toBe('custom');
    });
  });

  describe('filteredCatalogGroupsForBlock', () => {
    const groupA = { key: 'group-a', entries: [{ smiles: 'C', name: 'methane' }] };
    const groupB = { key: 'group-b', entries: [{ smiles: 'CC', name: 'ethane' }] };

    it('retorna todos los grupos cuando la clave seleccionada es "all"', () => {
      mockWorkflow.catalogGroups.set([groupA, groupB]);
      const block = { id: 'b1' } as never;
      const result = component.filteredCatalogGroupsForBlock(block);
      expect(result).toHaveLength(2);
    });

    it('retorna solo el grupo coincidente cuando se selecciona una clave específica', () => {
      mockWorkflow.catalogGroups.set([groupA, groupB]);
      component.onBlockLibraryGroupChange('b2', 'group-a');
      const block = { id: 'b2' } as never;
      const result = component.filteredCatalogGroupsForBlock(block);
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('group-a');
    });

    it('retorna todos los grupos si la clave seleccionada no tiene coincidencia', () => {
      mockWorkflow.catalogGroups.set([groupA, groupB]);
      component.onBlockLibraryGroupChange('b3', 'non-existent');
      const block = { id: 'b3' } as never;
      const result = component.filteredCatalogGroupsForBlock(block);
      expect(result).toHaveLength(2);
    });
  });

  describe('filteredCatalogEntriesForBlock', () => {
    it('retorna lista plana de entradas de los grupos filtrados', () => {
      const groups = [
        {
          key: 'all',
          entries: [
            { smiles: 'C', name: 'methane' },
            { smiles: 'CC', name: 'ethane' },
          ],
        },
      ];
      mockWorkflow.catalogGroups.set(groups);
      const block = { id: 'b1' } as never;
      const entries = component.filteredCatalogEntriesForBlock(block);
      expect(entries).toHaveLength(2);
    });

    it('excluye entradas ya referenciadas en el bloque', () => {
      const referencedEntry = { id: 'e-1', smiles: 'C', name: 'methane' };
      const availableEntry = { id: 'e-2', smiles: 'CC', name: 'ethane' };
      mockWorkflow.catalogGroups.set([
        {
          key: 'all',
          entries: [referencedEntry, availableEntry],
        },
      ]);

      vi.mocked(mockWorkflow.catalog.isCatalogEntryReferenced).mockImplementation(
        (_block, entry) => entry === referencedEntry,
      );

      const block = { id: 'b1' } as never;
      const entries = component.filteredCatalogEntriesForBlock(block);
      expect(entries).toEqual([availableEntry]);
    });
  });

  describe('isCatalogEntryLoadedInManualDraft', () => {
    it('retorna true cuando el borrador del bloque coincide con la entrada del catálogo', () => {
      const block = { id: 'b1', draftManualSmiles: 'CCO', draftManualName: 'ethanol' } as never;
      const entry = { smiles: 'CCO', name: 'ethanol' } as never;
      expect(component.isCatalogEntryLoadedInManualDraft(block, entry)).toBe(true);
    });

    it('retorna true con espacios extra (se aplica trim)', () => {
      const block = {
        id: 'b1',
        draftManualSmiles: '  CCO  ',
        draftManualName: '  ethanol  ',
      } as never;
      const entry = { smiles: 'CCO', name: 'ethanol' } as never;
      expect(component.isCatalogEntryLoadedInManualDraft(block, entry)).toBe(true);
    });

    it('retorna false cuando los smiles difieren', () => {
      const block = { id: 'b1', draftManualSmiles: 'CC', draftManualName: 'ethanol' } as never;
      const entry = { smiles: 'CCO', name: 'ethanol' } as never;
      expect(component.isCatalogEntryLoadedInManualDraft(block, entry)).toBe(false);
    });
  });

  describe('isBlockSiteSelected', () => {
    it('retorna true cuando el índice de átomo está en siteAtomIndices', () => {
      const block = { siteAtomIndices: [1, 3, 5] } as never;
      expect(component.isBlockSiteSelected(block, 3)).toBe(true);
    });

    it('retorna false cuando el índice no está en siteAtomIndices', () => {
      const block = { siteAtomIndices: [1, 3, 5] } as never;
      expect(component.isBlockSiteSelected(block, 4)).toBe(false);
    });

    it('retorna false para siteAtomIndices vacío', () => {
      const block = { siteAtomIndices: [] } as never;
      expect(component.isBlockSiteSelected(block, 0)).toBe(false);
    });
  });

  describe('blockSummary', () => {
    it('delega a workflow.blocks.getBlockCollapsedSummary', () => {
      const block = { id: 'b1' } as never;
      const result = component.blockSummary(block);
      expect(mockWorkflow.blocks.getBlockCollapsedSummary).toHaveBeenCalledWith(block);
      expect(result).toEqual({ summary: 'mock-summary' });
    });
  });

  describe('selectCatalogEntryForManualDraft', () => {
    it('delega a workflow.blocks.applyCatalogEntryToManualDraft', () => {
      const entry = { smiles: 'C', name: 'methane' } as never;
      component.selectCatalogEntryForManualDraft('b1', entry);
      expect(mockWorkflow.blocks.applyCatalogEntryToManualDraft).toHaveBeenCalledWith('b1', entry);
    });
  });

  describe('onBlockCatalogBrowserEntryActivate', () => {
    it('agrega referencia y aplica la entrada cuando no está procesando', () => {
      const block = { id: 'b1' } as never;
      const entry = { smiles: 'C', name: 'methane' } as never;
      mockWorkflow.isProcessing.set(false);
      component.onBlockCatalogBrowserEntryActivate(block, entry);
      expect(mockWorkflow.blocks.addCatalogReferenceToBlock).toHaveBeenCalledWith('b1', entry);
      expect(mockWorkflow.blocks.applyCatalogEntryToManualDraft).toHaveBeenCalledWith('b1', entry);
    });

    it('no hace nada cuando isProcessing=true', () => {
      const block = { id: 'b1' } as never;
      const entry = { smiles: 'C', name: 'methane' } as never;
      mockWorkflow.isProcessing.set(true);
      component.onBlockCatalogBrowserEntryActivate(block, entry);
      expect(mockWorkflow.blocks.addCatalogReferenceToBlock).not.toHaveBeenCalled();
    });
  });

  describe('onBlockCatalogEntryCardActivate', () => {
    it('omite la activación si la entrada ya está referenciada en el bloque', () => {
      const block = { id: 'b1' } as never;
      const entry = { smiles: 'C', name: 'methane' } as never;
      vi.mocked(mockWorkflow.catalog.isCatalogEntryReferenced).mockReturnValue(true);
      component.onBlockCatalogEntryCardActivate(block, entry);
      expect(mockWorkflow.blocks.addCatalogReferenceToBlock).not.toHaveBeenCalled();
    });

    it('activa cuando la entrada no está referenciada', () => {
      const block = { id: 'b1' } as never;
      const entry = { smiles: 'C', name: 'methane' } as never;
      vi.mocked(mockWorkflow.catalog.isCatalogEntryReferenced).mockReturnValue(false);
      mockWorkflow.isProcessing.set(false);
      component.onBlockCatalogEntryCardActivate(block, entry);
      expect(mockWorkflow.blocks.addCatalogReferenceToBlock).toHaveBeenCalled();
    });
  });

  describe('openLibraryEntryDetail', () => {
    it('emite libraryEntryDetailRequested con contexto "browser" por defecto', () => {
      const emittedEvents: BlockPanelLibraryDetailRequest[] = [];
      const entry = { smiles: 'C', name: 'methane' } as never;
      component.libraryEntryDetailRequested.subscribe((e) => emittedEvents.push(e));
      component.openLibraryEntryDetail(entry);
      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0]).toEqual({ catalogEntry: entry, openContext: 'browser' });
    });

    it('emite con contexto "reference" cuando se especifica', () => {
      const emittedEvents: BlockPanelLibraryDetailRequest[] = [];
      const entry = { smiles: 'C', name: 'methane' } as never;
      component.libraryEntryDetailRequested.subscribe((e) => emittedEvents.push(e));
      component.openLibraryEntryDetail(entry, 'reference');
      expect(emittedEvents[0]).toEqual({ catalogEntry: entry, openContext: 'reference' });
    });
  });
});
