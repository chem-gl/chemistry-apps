// smileit-block-workflow.service.ts: Gestión de bloques de asignación del workflow Smileit.
// Responsabilidad: CRUD de bloques, cobertura de sitios, sustituyentes manuales y vistas colapsadas.
// Accede al estado compartido (SmileitWorkflowState) para leer/escribir señales.

import { Injectable, inject } from '@angular/core';
import type { SmileitCatalogEntryView, SmileitCategoryView } from '../../api/jobs-api.service';

import { SmileitWorkflowState } from './smileit-workflow-state.service';
import type {
    SmileitAssignmentBlockDraft,
    SmileitBlockCollapsedSummary,
    SmileitManualSubstituentDraft,
} from './smileit-workflow.types';
import { parseAtomIndicesInput, toggleString } from './smileit-workflow.utils';

@Injectable()
export class SmileitBlockWorkflowService {
  private readonly state = inject(SmileitWorkflowState);
  private blockSequence: number = 0;

  // ── Ciclo de vida de bloques ──────────────────────────────────────────

  /** Agrega un bloque nuevo con sitios no cubiertos por defecto. */
  addAssignmentBlock(): void {
    const uncoveredSites: number[] = this.state.uncoveredSelectedSites();
    const defaultSites: number[] =
      uncoveredSites.length > 0 ? uncoveredSites : [...this.state.selectedAtomIndices()];
    const nextIndex: number = this.state.assignmentBlocks().length + 1;

    this.state.assignmentBlocks.update((currentBlocks: SmileitAssignmentBlockDraft[]) => [
      ...currentBlocks,
      this.createBlockDraft(`Block ${nextIndex}`, defaultSites),
    ]);
  }

  /** Elimina un bloque por su identificador. */
  removeAssignmentBlock(blockId: string): void {
    this.state.assignmentBlocks.update((currentBlocks: SmileitAssignmentBlockDraft[]) =>
      currentBlocks.filter((block: SmileitAssignmentBlockDraft) => block.id !== blockId),
    );
  }

  /** Mueve un bloque una posición arriba (-1) o abajo (+1). */
  moveAssignmentBlock(blockId: string, direction: -1 | 1): void {
    this.state.assignmentBlocks.update((currentBlocks: SmileitAssignmentBlockDraft[]) => {
      const currentIndex: number = currentBlocks.findIndex(
        (block: SmileitAssignmentBlockDraft) => block.id === blockId,
      );
      const targetIndex: number = currentIndex + direction;
      if (currentIndex < 0 || targetIndex < 0 || targetIndex >= currentBlocks.length) {
        return currentBlocks;
      }
      const nextBlocks: SmileitAssignmentBlockDraft[] = [...currentBlocks];
      const [movedBlock] = nextBlocks.splice(currentIndex, 1);
      nextBlocks.splice(targetIndex, 0, movedBlock);
      return nextBlocks;
    });
  }

  /** Actualiza la etiqueta de un bloque. */
  updateBlockLabel(blockId: string, nextLabel: string): void {
    this.updateBlock(blockId, (block: SmileitAssignmentBlockDraft) => ({
      ...block,
      label: nextLabel,
    }));
  }

  // ── Sitios y categorías ───────────────────────────────────────────────

  /** Alterna la asignación de un sitio atómico a un bloque. */
  toggleBlockSite(blockId: string, atomIndex: number): void {
    if (!this.state.selectedAtomIndices().includes(atomIndex)) {
      return;
    }
    this.updateBlock(blockId, (block: SmileitAssignmentBlockDraft) => {
      const nextSites: number[] = block.siteAtomIndices.includes(atomIndex)
        ? block.siteAtomIndices.filter((item: number) => item !== atomIndex)
        : [...block.siteAtomIndices, atomIndex];
      return {
        ...block,
        siteAtomIndices: [...nextSites].sort((left: number, right: number) => left - right),
      };
    });
  }

  /** Alterna la asignación de una categoría química a un bloque. */
  toggleBlockCategory(blockId: string, categoryKey: string): void {
    this.updateBlock(blockId, (block: SmileitAssignmentBlockDraft) => ({
      ...block,
      categoryKeys: toggleString(block.categoryKeys, categoryKey),
    }));
  }

  /** Asigna todas las categorías disponibles a un bloque. */
  setAllCategoriesForBlock(blockId: string): void {
    this.updateBlock(blockId, (block: SmileitAssignmentBlockDraft) => ({
      ...block,
      categoryKeys: this.state.categories().map((category: SmileitCategoryView) => category.key),
    }));
  }

  /** Limpia todas las categorías de un bloque. */
  clearCategoriesForBlock(blockId: string): void {
    this.updateBlock(blockId, (block: SmileitAssignmentBlockDraft) => ({
      ...block,
      categoryKeys: [],
    }));
  }

  // ── Referencias de catálogo en bloques ────────────────────────────────

  /** Agrega una referencia de catálogo a un bloque (sin duplicados). */
  addCatalogReferenceToBlock(blockId: string, catalogEntry: SmileitCatalogEntryView): void {
    this.updateBlock(blockId, (block: SmileitAssignmentBlockDraft) => {
      const alreadyExists: boolean = block.catalogRefs.some(
        (entry: SmileitCatalogEntryView) =>
          entry.stable_id === catalogEntry.stable_id && entry.version === catalogEntry.version,
      );
      if (alreadyExists) {
        return block;
      }
      return { ...block, catalogRefs: [...block.catalogRefs, catalogEntry] };
    });
  }

  /** Elimina una referencia de catálogo de un bloque. */
  removeCatalogReferenceFromBlock(blockId: string, stableId: string, version: number): void {
    this.updateBlock(blockId, (block: SmileitAssignmentBlockDraft) => ({
      ...block,
      catalogRefs: block.catalogRefs.filter(
        (entry: SmileitCatalogEntryView) =>
          !(entry.stable_id === stableId && entry.version === version),
      ),
    }));
  }

  /** Copia datos de una entrada de catálogo al borrador manual del bloque. */
  applyCatalogEntryToManualDraft(blockId: string, catalogEntry: SmileitCatalogEntryView): void {
    const normalizedDraftCategoryKeys: string[] = [...(catalogEntry.categories ?? [])];
    this.updateBlock(blockId, (block: SmileitAssignmentBlockDraft) => ({
      ...block,
      draftManualName: catalogEntry.name,
      draftManualSmiles: catalogEntry.smiles,
      draftManualAnchorIndicesText: catalogEntry.anchor_atom_indices.join(','),
      draftManualSourceReference: `catalog:${catalogEntry.stable_id}:v${catalogEntry.version}`,
      draftManualCategoryKeys: normalizedDraftCategoryKeys,
    }));
  }

  // ── Borrador de sustituyente manual ───────────────────────────────────

  updateBlockManualDraftName(blockId: string, nextValue: string): void {
    this.updateBlock(blockId, (block: SmileitAssignmentBlockDraft) => ({
      ...block,
      draftManualName: nextValue,
    }));
  }

  updateBlockManualDraftSmiles(blockId: string, nextValue: string): void {
    this.updateBlock(blockId, (block: SmileitAssignmentBlockDraft) => ({
      ...block,
      draftManualSmiles: nextValue,
    }));
  }

  updateBlockManualDraftAnchors(blockId: string, nextValue: string): void {
    this.updateBlock(blockId, (block: SmileitAssignmentBlockDraft) => ({
      ...block,
      draftManualAnchorIndicesText: nextValue,
    }));
  }

  updateBlockManualDraftSourceReference(blockId: string, nextValue: string): void {
    this.updateBlock(blockId, (block: SmileitAssignmentBlockDraft) => ({
      ...block,
      draftManualSourceReference: nextValue,
    }));
  }

  toggleBlockManualDraftCategory(blockId: string, categoryKey: string): void {
    this.updateBlock(blockId, (block: SmileitAssignmentBlockDraft) => ({
      ...block,
      draftManualCategoryKeys: toggleString(block.draftManualCategoryKeys, categoryKey),
    }));
  }

  /** Confirma un sustituyente manual en un bloque (valida campos obligatorios). */
  addManualSubstituentToBlock(blockId: string): void {
    const blockDraft: SmileitAssignmentBlockDraft | undefined = this.state
      .assignmentBlocks()
      .find((block: SmileitAssignmentBlockDraft) => block.id === blockId);
    if (blockDraft === undefined) {
      return;
    }

    const manualName: string = blockDraft.draftManualName.trim();
    const manualSmiles: string = blockDraft.draftManualSmiles.trim();
    const anchorAtomIndices: number[] = parseAtomIndicesInput(
      blockDraft.draftManualAnchorIndicesText,
    );

    if (manualName === '' || manualSmiles === '') {
      this.state.errorMessage.set('Manual substituent requires both a name and a SMILES string.');
      return;
    }
    if (anchorAtomIndices.length === 0) {
      this.state.errorMessage.set('Manual substituent requires at least one anchor atom index.');
      return;
    }

    let resolvedCategoryKeys: string[];
    if (blockDraft.draftManualCategoryKeys.length > 0) {
      resolvedCategoryKeys = [...blockDraft.draftManualCategoryKeys];
    } else if (blockDraft.categoryKeys.length > 0) {
      resolvedCategoryKeys = [...blockDraft.categoryKeys];
    } else {
      resolvedCategoryKeys = this.state
        .categories()
        .map((category: SmileitCategoryView) => category.key);
    }

    if (resolvedCategoryKeys.length === 0) {
      this.state.errorMessage.set('Manual substituent requires at least one chemistry category.');
      return;
    }

    const nextManual: SmileitManualSubstituentDraft = {
      name: manualName,
      smiles: manualSmiles,
      anchorAtomIndices,
      categories: resolvedCategoryKeys,
      sourceReference: blockDraft.draftManualSourceReference.trim() || 'manual-ui',
      provenanceMetadata: {},
    };

    this.updateBlock(blockId, (block: SmileitAssignmentBlockDraft) => {
      const duplicateExists: boolean = block.manualSubstituents.some(
        (entry: SmileitManualSubstituentDraft) =>
          entry.name === nextManual.name && entry.smiles === nextManual.smiles,
      );
      if (duplicateExists) {
        return block;
      }
      return {
        ...block,
        manualSubstituents: [...block.manualSubstituents, nextManual],
        draftManualName: '',
        draftManualSmiles: '',
        draftManualAnchorIndicesText: '',
        draftManualSourceReference: 'manual-ui',
        draftManualCategoryKeys: [],
      };
    });
    this.state.errorMessage.set(null);
  }

  /** Elimina un sustituyente manual por índice. */
  removeManualSubstituent(blockId: string, manualIndex: number): void {
    this.updateBlock(blockId, (block: SmileitAssignmentBlockDraft) => ({
      ...block,
      manualSubstituents: block.manualSubstituents.filter(
        (_entry: SmileitManualSubstituentDraft, index: number) => index !== manualIndex,
      ),
    }));
  }

  // ── Vistas derivadas de bloques ───────────────────────────────────────

  /** Retorna las entradas de catálogo que coinciden por categorías del bloque. */
  getAutoCatalogEntriesForBlock(block: SmileitAssignmentBlockDraft): SmileitCatalogEntryView[] {
    if (block.categoryKeys.length === 0) {
      return [];
    }
    const selectedCategories: Set<string> = new Set(block.categoryKeys);
    const matchedEntries: SmileitCatalogEntryView[] = this.state
      .catalogEntries()
      .filter((entry: SmileitCatalogEntryView) =>
        (entry.categories ?? []).some((categoryKey: string) => selectedCategories.has(categoryKey)),
      );
    const deduplicatedEntriesByKey: Map<string, SmileitCatalogEntryView> = new Map();

    matchedEntries.forEach((entry: SmileitCatalogEntryView) => {
      const dedupeKey: string = `${entry.stable_id}::${entry.version}::${entry.id}`;
      if (!deduplicatedEntriesByKey.has(dedupeKey)) {
        deduplicatedEntriesByKey.set(dedupeKey, entry);
      }
    });

    return [...deduplicatedEntriesByKey.values()].sort(
      (left: SmileitCatalogEntryView, right: SmileitCatalogEntryView) =>
        left.name.localeCompare(right.name),
    );
  }

  /** Retorna todas las entradas seleccionables para un bloque (auto + explícitas, deduplicadas). */
  getSelectableCatalogEntriesForBlock(
    block: SmileitAssignmentBlockDraft,
  ): SmileitCatalogEntryView[] {
    const dedupedEntries: Map<string, SmileitCatalogEntryView> = new Map();
    [...block.catalogRefs, ...this.getAutoCatalogEntriesForBlock(block)].forEach(
      (entry: SmileitCatalogEntryView) => {
        const dedupeKey: string = `${entry.stable_id}::${entry.version}`;
        if (!dedupedEntries.has(dedupeKey)) {
          dedupedEntries.set(dedupeKey, entry);
        }
      },
    );
    return [...dedupedEntries.values()].sort(
      (left: SmileitCatalogEntryView, right: SmileitCatalogEntryView) =>
        left.name.localeCompare(right.name),
    );
  }

  /** Genera un resumen colapsado de un bloque para la vista compacta. */
  getBlockCollapsedSummary(block: SmileitAssignmentBlockDraft): SmileitBlockCollapsedSummary {
    const catalogSmilesPreview: string[] = block.catalogRefs
      .map((entry: SmileitCatalogEntryView) => entry.smiles)
      .filter(
        (smilesValue: string, index: number, items: string[]) =>
          items.indexOf(smilesValue) === index,
      );
    const manualSmilesPreview: string[] = block.manualSubstituents
      .map((entry: SmileitManualSubstituentDraft) => entry.smiles)
      .filter(
        (smilesValue: string, index: number, items: string[]) =>
          items.indexOf(smilesValue) === index,
      );

    const catalogSuffix = catalogSmilesPreview.length === 1 ? '' : 's';
    const manualSuffix = manualSmilesPreview.length === 1 ? '' : 's';

    return {
      selectedSitesLabel:
        block.siteAtomIndices.length > 0 ? block.siteAtomIndices.join(', ') : 'No covered sites',
      categoriesLabel:
        block.categoryKeys.length > 0 ? block.categoryKeys.join(', ') : 'No category filters',
      catalogSmilesLabel:
        catalogSmilesPreview.length > 0
          ? `${catalogSmilesPreview.length} rendered structure${catalogSuffix}`
          : 'No catalog references',
      manualSmilesLabel:
        manualSmilesPreview.length > 0
          ? `${manualSmilesPreview.length} rendered structure${manualSuffix}`
          : 'No manual substituents',
      sourceCount:
        block.categoryKeys.length + block.catalogRefs.length + block.manualSubstituents.length,
    };
  }

  // ── Poda de bloques al cambiar sitios seleccionados ───────────────────

  /** Elimina de cada bloque los sitios que ya no están seleccionados globalmente. */
  pruneBlocksToSelectedSites(): void {
    const selectedSet: Set<number> = new Set(this.state.selectedAtomIndices());
    this.state.assignmentBlocks.update((currentBlocks: SmileitAssignmentBlockDraft[]) =>
      currentBlocks.map((block: SmileitAssignmentBlockDraft) => ({
        ...block,
        siteAtomIndices: block.siteAtomIndices.filter((atomIndex: number) =>
          selectedSet.has(atomIndex),
        ),
      })),
    );
  }

  // ── Helpers privados ──────────────────────────────────────────────────

  private createBlockDraft(label: string, siteAtomIndices: number[]): SmileitAssignmentBlockDraft {
    this.blockSequence += 1;
    return {
      id: `block-${this.blockSequence}`,
      label,
      siteAtomIndices: [...new Set(siteAtomIndices)].sort(
        (left: number, right: number) => left - right,
      ),
      categoryKeys: [],
      catalogRefs: [],
      manualSubstituents: [],
      draftManualName: '',
      draftManualSmiles: '',
      draftManualAnchorIndicesText: '',
      draftManualSourceReference: 'manual-ui',
      draftManualCategoryKeys: [],
    };
  }

  private updateBlock(
    blockId: string,
    updater: (block: SmileitAssignmentBlockDraft) => SmileitAssignmentBlockDraft,
  ): void {
    this.state.assignmentBlocks.update((currentBlocks: SmileitAssignmentBlockDraft[]) =>
      currentBlocks.map((block: SmileitAssignmentBlockDraft) =>
        block.id === blockId ? updater(block) : block,
      ),
    );
  }
}
