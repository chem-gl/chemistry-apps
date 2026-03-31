// smileit-block-workflow.service.spec.ts: Pruebas unitarias del servicio de gestión de bloques Smileit.
// Cubre: getBlockCollapsedSummary, addManualSubstituentToBlock, operaciones CRUD de bloques.

import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { VerificationRuleEnum } from '../../api/generated';
import type { SmileitCatalogEntryView } from '../../api/jobs-api.service';
import { SmileitBlockWorkflowService } from './smileit-block-workflow.service';
import { SmileitWorkflowState } from './smileit-workflow-state.service';
import type { SmileitAssignmentBlockDraft } from './smileit-workflow.types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCatalogEntry(
  overrides: Partial<SmileitCatalogEntryView> = {},
): SmileitCatalogEntryView {
  return {
    id: 'e-1',
    stable_id: 'aniline',
    version: 1,
    name: 'Aniline',
    smiles: '[NH2]c1ccccc1',
    anchor_atom_indices: [0],
    categories: ['aromatic'],
    source_reference: 'seed',
    provenance_metadata: {},
    ...overrides,
  };
}

function makeBlock(
  overrides: Partial<SmileitAssignmentBlockDraft> = {},
): SmileitAssignmentBlockDraft {
  return {
    id: 'block-1',
    label: 'Test Block',
    siteAtomIndices: [0, 1],
    categoryKeys: ['aromatic'],
    catalogRefs: [],
    manualSubstituents: [],
    draftManualName: '',
    draftManualSmiles: '',
    draftManualAnchorIndicesText: '',
    draftManualSourceReference: 'manual-ui',
    draftManualCategoryKeys: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

describe('SmileitBlockWorkflowService', () => {
  let state: SmileitWorkflowState;
  let service: SmileitBlockWorkflowService;

  beforeEach(() => {
    const injector: Injector = Injector.create({
      providers: [SmileitWorkflowState, SmileitBlockWorkflowService],
    });
    state = injector.get(SmileitWorkflowState);
    service = runInInjectionContext(injector, () => new SmileitBlockWorkflowService());
  });

  // ── getBlockCollapsedSummary ──────────────────────────────────────────

  describe('getBlockCollapsedSummary', () => {
    it('genera etiqueta de sitios cubiertos cuando existen', () => {
      const block = makeBlock({ siteAtomIndices: [0, 2, 4] });
      const summary = service.getBlockCollapsedSummary(block);
      expect(summary.selectedSitesLabel).toBe('0, 2, 4');
    });

    it('genera etiqueta de No covered sites cuando no hay sitios', () => {
      const block = makeBlock({ siteAtomIndices: [] });
      const summary = service.getBlockCollapsedSummary(block);
      expect(summary.selectedSitesLabel).toBe('No covered sites');
    });

    it('genera etiqueta de categorías cuando hay filtros activos', () => {
      const block = makeBlock({ categoryKeys: ['aromatic', 'polar'] });
      const summary = service.getBlockCollapsedSummary(block);
      expect(summary.categoriesLabel).toBe('aromatic, polar');
    });

    it('genera etiqueta de No category filters cuando está vacío', () => {
      const block = makeBlock({ categoryKeys: [] });
      const summary = service.getBlockCollapsedSummary(block);
      expect(summary.categoriesLabel).toBe('No category filters');
    });

    it('usa singular "structure" cuando hay exactamente una referencia de catálogo', () => {
      const block = makeBlock({ catalogRefs: [makeCatalogEntry()] });
      const summary = service.getBlockCollapsedSummary(block);
      expect(summary.catalogSmilesLabel).toBe('1 rendered structure');
    });

    it('usa plural "structures" cuando hay más de una referencia', () => {
      const block = makeBlock({
        catalogRefs: [
          makeCatalogEntry({ stable_id: 'a', smiles: 'CC' }),
          makeCatalogEntry({ stable_id: 'b', smiles: 'CCC' }),
        ],
      });
      const summary = service.getBlockCollapsedSummary(block);
      expect(summary.catalogSmilesLabel).toBe('2 rendered structures');
    });

    it('genera etiqueta de No catalog references cuando no hay refs', () => {
      const block = makeBlock({ catalogRefs: [] });
      const summary = service.getBlockCollapsedSummary(block);
      expect(summary.catalogSmilesLabel).toBe('No catalog references');
    });

    it('usa singular "structure" para un sustituyente manual único', () => {
      const block = makeBlock({
        manualSubstituents: [
          {
            name: 'Custom',
            smiles: 'NC',
            anchorAtomIndices: [0],
            categories: ['polar'],
          },
        ],
      });
      const summary = service.getBlockCollapsedSummary(block);
      expect(summary.manualSmilesLabel).toBe('1 rendered structure');
    });

    it('calcula sourceCount sumando categorías, refs de catálogo y manuales', () => {
      const block = makeBlock({
        categoryKeys: ['aromatic', 'polar'],
        catalogRefs: [makeCatalogEntry()],
        manualSubstituents: [
          { name: 'M1', smiles: 'NC', anchorAtomIndices: [0], categories: ['polar'] },
        ],
      });
      const summary = service.getBlockCollapsedSummary(block);
      expect(summary.sourceCount).toBe(4); // 2 categorías + 1 ref + 1 manual
    });

    it('deduplica SMILES idénticos de catálogo al contar', () => {
      const block = makeBlock({
        catalogRefs: [
          makeCatalogEntry({ stable_id: 'a', smiles: 'CC' }),
          makeCatalogEntry({ stable_id: 'b', smiles: 'CC' }), // mismo smiles
        ],
      });
      const summary = service.getBlockCollapsedSummary(block);
      expect(summary.catalogSmilesLabel).toBe('1 rendered structure');
    });
  });

  // ── addManualSubstituentToBlock ───────────────────────────────────────

  describe('addManualSubstituentToBlock', () => {
    it('agrega sustituyente cuando el borrador es válido', () => {
      state.assignmentBlocks.set([
        makeBlock({
          id: 'b1',
          draftManualName: 'Methyl',
          draftManualSmiles: 'C',
          draftManualAnchorIndicesText: '0',
          categoryKeys: ['aromatic'],
        }),
      ]);

      service.addManualSubstituentToBlock('b1');

      const block = state.assignmentBlocks().find((b) => b.id === 'b1');
      expect(block?.manualSubstituents).toHaveLength(1);
      expect(block?.manualSubstituents[0].name).toBe('Methyl');
      expect(block?.manualSubstituents[0].smiles).toBe('C');
      expect(block?.manualSubstituents[0].anchorAtomIndices).toEqual([0]);
    });

    it('establece error cuando el nombre del borrador está vacío', () => {
      state.assignmentBlocks.set([
        makeBlock({
          id: 'b1',
          draftManualName: '',
          draftManualSmiles: 'C',
          draftManualAnchorIndicesText: '0',
        }),
      ]);

      service.addManualSubstituentToBlock('b1');

      expect(state.errorMessage()).toContain('name');
      expect(state.assignmentBlocks()[0].manualSubstituents).toHaveLength(0);
    });

    it('establece error cuando el SMILES del borrador está vacío', () => {
      state.assignmentBlocks.set([
        makeBlock({
          id: 'b1',
          draftManualName: 'Methyl',
          draftManualSmiles: '',
          draftManualAnchorIndicesText: '0',
        }),
      ]);

      service.addManualSubstituentToBlock('b1');

      expect(state.errorMessage()).toContain('SMILES');
    });

    it('establece error cuando los índices anchor son inválidos', () => {
      state.assignmentBlocks.set([
        makeBlock({
          id: 'b1',
          draftManualName: 'Methyl',
          draftManualSmiles: 'C',
          draftManualAnchorIndicesText: '',
          categoryKeys: ['aromatic'],
        }),
      ]);

      service.addManualSubstituentToBlock('b1');

      expect(state.errorMessage()).toContain('anchor');
    });

    it('no agrega sustituyente duplicado (mismo nombre y SMILES)', () => {
      state.assignmentBlocks.set([
        makeBlock({
          id: 'b1',
          draftManualName: 'Methyl',
          draftManualSmiles: 'C',
          draftManualAnchorIndicesText: '0',
          categoryKeys: ['aromatic'],
          manualSubstituents: [
            { name: 'Methyl', smiles: 'C', anchorAtomIndices: [0], categories: ['aromatic'] },
          ],
        }),
      ]);

      service.addManualSubstituentToBlock('b1');

      expect(state.assignmentBlocks()[0].manualSubstituents).toHaveLength(1);
    });

    it('limpia el borrador después de agregar correctamente', () => {
      state.assignmentBlocks.set([
        makeBlock({
          id: 'b1',
          draftManualName: 'Ethyl',
          draftManualSmiles: 'CC',
          draftManualAnchorIndicesText: '0',
          categoryKeys: ['polar'],
        }),
      ]);

      service.addManualSubstituentToBlock('b1');

      const block = state.assignmentBlocks().find((b) => b.id === 'b1');
      expect(block?.draftManualName).toBe('');
      expect(block?.draftManualSmiles).toBe('');
      expect(block?.draftManualAnchorIndicesText).toBe('');
    });

    it('usa las categorías del bloque cuando el borrador no tiene categorías propias', () => {
      state.assignmentBlocks.set([
        makeBlock({
          id: 'b1',
          draftManualName: 'Phenyl',
          draftManualSmiles: 'c1ccccc1',
          draftManualAnchorIndicesText: '0',
          draftManualCategoryKeys: [],
          categoryKeys: ['aromatic'],
        }),
      ]);

      service.addManualSubstituentToBlock('b1');

      const added = state.assignmentBlocks()[0].manualSubstituents[0];
      expect(added.categories).toEqual(['aromatic']);
    });

    it('no hace nada cuando el blockId no existe', () => {
      state.assignmentBlocks.set([makeBlock({ id: 'b1' })]);
      service.addManualSubstituentToBlock('nonexistent');
      expect(state.assignmentBlocks()[0].manualSubstituents).toHaveLength(0);
    });
  });

  // ── addAssignmentBlock ────────────────────────────────────────────────

  describe('addAssignmentBlock', () => {
    it('agrega un bloque con los sitios no cubiertos como sitios por defecto', () => {
      state.selectedAtomIndices.set([0, 1, 2]);
      state.assignmentBlocks.set([makeBlock({ id: 'b1', siteAtomIndices: [0] })]);

      service.addAssignmentBlock();

      const blocks = state.assignmentBlocks();
      expect(blocks).toHaveLength(2);
      expect(blocks[1].siteAtomIndices).toEqual([1, 2]);
    });

    it('usa todos los sitios seleccionados si no hay sitios sin cubrir', () => {
      state.selectedAtomIndices.set([0, 1]);
      state.assignmentBlocks.set([makeBlock({ id: 'b1', siteAtomIndices: [0, 1] })]);

      service.addAssignmentBlock();

      const blocks = state.assignmentBlocks();
      expect(blocks[1].siteAtomIndices).toEqual([0, 1]);
    });
  });

  describe('block mutations', () => {
    it('removes an assignment block by id', () => {
      state.assignmentBlocks.set([makeBlock({ id: 'b1' }), makeBlock({ id: 'b2' })]);

      service.removeAssignmentBlock('b1');

      expect(state.assignmentBlocks().map((block) => block.id)).toEqual(['b2']);
    });

    it('moves a block up or down only when the target position is valid', () => {
      state.assignmentBlocks.set([
        makeBlock({ id: 'b1', label: 'Block 1' }),
        makeBlock({ id: 'b2', label: 'Block 2' }),
        makeBlock({ id: 'b3', label: 'Block 3' }),
      ]);

      service.moveAssignmentBlock('b2', -1);
      expect(state.assignmentBlocks().map((block) => block.id)).toEqual(['b2', 'b1', 'b3']);

      service.moveAssignmentBlock('b2', -1);
      expect(state.assignmentBlocks().map((block) => block.id)).toEqual(['b2', 'b1', 'b3']);

      service.moveAssignmentBlock('missing', 1);
      expect(state.assignmentBlocks().map((block) => block.id)).toEqual(['b2', 'b1', 'b3']);
    });

    it('updates the block label', () => {
      state.assignmentBlocks.set([makeBlock({ id: 'b1', label: 'Before' })]);

      service.updateBlockLabel('b1', 'After');

      expect(state.assignmentBlocks()[0].label).toBe('After');
    });

    it('toggles block sites only for globally selected atoms', () => {
      state.selectedAtomIndices.set([0, 2]);
      state.assignmentBlocks.set([makeBlock({ id: 'b1', siteAtomIndices: [0] })]);

      service.toggleBlockSite('b1', 2);
      expect(state.assignmentBlocks()[0].siteAtomIndices).toEqual([0, 2]);

      service.toggleBlockSite('b1', 0);
      expect(state.assignmentBlocks()[0].siteAtomIndices).toEqual([2]);

      service.toggleBlockSite('b1', 7);
      expect(state.assignmentBlocks()[0].siteAtomIndices).toEqual([2]);
    });

    it('toggles, sets and clears chemistry categories for a block', () => {
      state.categories.set([
        {
          id: 'c1',
          key: 'aromatic',
          version: 1,
          name: 'Aromatic',
          description: '',
          verification_rule: VerificationRuleEnum.Aromatic,
          verification_smarts: '',
        },
        {
          id: 'c2',
          key: 'polar',
          version: 1,
          name: 'Polar',
          description: '',
          verification_rule: VerificationRuleEnum.Hydrophobic,
          verification_smarts: '',
        },
      ]);
      state.assignmentBlocks.set([makeBlock({ id: 'b1', categoryKeys: [] })]);

      service.toggleBlockCategory('b1', 'aromatic');
      expect(state.assignmentBlocks()[0].categoryKeys).toEqual(['aromatic']);

      service.toggleBlockCategory('b1', 'aromatic');
      expect(state.assignmentBlocks()[0].categoryKeys).toEqual([]);

      service.setAllCategoriesForBlock('b1');
      expect(state.assignmentBlocks()[0].categoryKeys).toEqual(['aromatic', 'polar']);

      service.clearCategoriesForBlock('b1');
      expect(state.assignmentBlocks()[0].categoryKeys).toEqual([]);
    });

    it('adds and removes catalog references without duplicating stable id plus version', () => {
      const versionOne = makeCatalogEntry({ stable_id: 'aniline', version: 1 });
      const versionTwo = makeCatalogEntry({ stable_id: 'aniline', version: 2 });
      state.assignmentBlocks.set([makeBlock({ id: 'b1', catalogRefs: [] })]);

      service.addCatalogReferenceToBlock('b1', versionOne);
      service.addCatalogReferenceToBlock('b1', versionOne);
      service.addCatalogReferenceToBlock('b1', versionTwo);

      expect(state.assignmentBlocks()[0].catalogRefs).toHaveLength(2);

      service.removeCatalogReferenceFromBlock('b1', 'aniline', 1);
      expect(state.assignmentBlocks()[0].catalogRefs).toEqual([versionTwo]);
    });

    it('updates and removes manual draft data for a block', () => {
      state.assignmentBlocks.set([makeBlock({ id: 'b1' })]);

      service.updateBlockManualDraftName('b1', 'Manual amino');
      service.updateBlockManualDraftSmiles('b1', 'NC');
      service.updateBlockManualDraftAnchors('b1', '0,2');
      service.updateBlockManualDraftSourceReference('b1', 'lab-note');
      service.toggleBlockManualDraftCategory('b1', 'polar');

      expect(state.assignmentBlocks()[0].draftManualName).toBe('Manual amino');
      expect(state.assignmentBlocks()[0].draftManualSmiles).toBe('NC');
      expect(state.assignmentBlocks()[0].draftManualAnchorIndicesText).toBe('0,2');
      expect(state.assignmentBlocks()[0].draftManualSourceReference).toBe('lab-note');
      expect(state.assignmentBlocks()[0].draftManualCategoryKeys).toEqual(['polar']);

      state.assignmentBlocks.set([
        makeBlock({
          id: 'b1',
          manualSubstituents: [
            { name: 'Manual amino', smiles: 'NC', anchorAtomIndices: [0], categories: ['polar'] },
            { name: 'Manual hydroxyl', smiles: 'O', anchorAtomIndices: [0], categories: ['polar'] },
          ],
        }),
      ]);

      service.removeManualSubstituent('b1', 0);

      expect(state.assignmentBlocks()[0].manualSubstituents).toHaveLength(1);
      expect(state.assignmentBlocks()[0].manualSubstituents[0].name).toBe('Manual hydroxyl');
    });

    it('builds automatic and selectable catalog entries from block categories', () => {
      const aromatic = makeCatalogEntry({
        stable_id: 'aniline',
        name: 'Aniline',
        categories: ['aromatic'],
      });
      const polar = makeCatalogEntry({
        stable_id: 'glycol',
        version: 2,
        name: 'Glycol',
        categories: ['polar'],
      });
      state.catalogEntries.set([polar, aromatic]);

      const block = makeBlock({ id: 'b1', categoryKeys: ['aromatic'], catalogRefs: [polar] });

      expect(service.getAutoCatalogEntriesForBlock(block).map((entry) => entry.name)).toEqual([
        'Aniline',
      ]);
      expect(service.getSelectableCatalogEntriesForBlock(block).map((entry) => entry.name)).toEqual([
        'Aniline',
        'Glycol',
      ]);
    });

    it('prunes block sites that are no longer globally selected', () => {
      state.selectedAtomIndices.set([1, 3]);
      state.assignmentBlocks.set([
        makeBlock({ id: 'b1', siteAtomIndices: [0, 1, 3] }),
        makeBlock({ id: 'b2', siteAtomIndices: [2, 3] }),
      ]);

      service.pruneBlocksToSelectedSites();

      expect(state.assignmentBlocks()[0].siteAtomIndices).toEqual([1, 3]);
      expect(state.assignmentBlocks()[1].siteAtomIndices).toEqual([3]);
    });
  });
});
