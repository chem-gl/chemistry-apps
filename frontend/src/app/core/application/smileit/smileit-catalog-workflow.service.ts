// smileit-catalog-workflow.service.ts: Gestión de catálogo y patrones del workflow Smileit.
// Responsabilidad: CRUD de entradas de catálogo, cola de borradores, edición y patrones SMARTS.
// Accede al estado compartido (SmileitWorkflowState) para leer/escribir señales.

import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin } from 'rxjs';
import { PatternTypeEnum } from '../../api/generated';
import type {
    SmileitCatalogEntryCreateParams,
    SmileitCatalogEntryView,
    SmileitPatternEntryCreateParams,
    SmileitPatternEntryView,
} from '../../api/jobs-api.service';
import { SmileitApiService } from '../../api/smileit-api.service';

import { SmileitWorkflowState } from './smileit-workflow-state.service';
import type {
    SmileitAssignmentBlockDraft,
    SmileitCatalogDraftPreview,
    SmileitCatalogQueuedDraft,
} from './smileit-workflow.types';
import {
    buildNextCloneDraftName,
    buildNextSequentialCatalogDraftName,
    dedupeVersionedEntries,
    extractRequestErrorMessage,
    toggleString,
} from './smileit-workflow.utils';

@Injectable()
export class SmileitCatalogWorkflowService {
  private readonly state = inject(SmileitWorkflowState);
  private readonly smileitApi = inject(SmileitApiService);
  private catalogDraftSequence: number = 0;

  // ── Carga inicial de datos de referencia ──────────────────────────────

  /** Carga catálogo, categorías y patrones del servidor. */
  loadInitialData(): void {
    forkJoin({
      catalog: this.smileitApi.listSmileitCatalog(),
      categories: this.smileitApi.listSmileitCategories(),
      patterns: this.smileitApi.listSmileitPatterns(),
    }).subscribe({
        next: ({ catalog, categories, patterns }) => {
          const normalizedCatalog = this.normalizeCatalogEntries(catalog);
          this.state.catalogEntries.set(normalizedCatalog);
          this.state.categories.set(categories);
          this.state.patterns.set(this.normalizePatternEntries(patterns));
          this.refreshBlockCatalogRefsToLatestEntries(normalizedCatalog);
        },
        error: (requestError: unknown) => {
          this.state.errorMessage.set(
            `Unable to load Smileit reference data: ${extractRequestErrorMessage(requestError)}`,
          );
        },
      });
  }

  // ── Borrador de catálogo ──────────────────────────────────────────────

  /** Establece valores por defecto si el formulario de catálogo está vacío. */
  ensureCatalogDraftDefaults(): void {
    if (this.state.isCatalogEditing()) {
      return;
    }
    if (this.state.catalogCreateName().trim() === '') {
      this.state.catalogCreateName.set(
        buildNextSequentialCatalogDraftName('', this.collectUsedCatalogDraftNames()),
      );
    }
    if (this.state.catalogCreateSourceReference().trim() === '') {
      this.state.catalogCreateSourceReference.set('local-lab');
    }
  }

  /** Alterna la selección de una categoría en el formulario de catálogo. */
  toggleCatalogCreateCategory(categoryKey: string): void {
    this.state.catalogCreateCategoryKeys.update((currentKeys: string[]) =>
      toggleString(currentKeys, categoryKey),
    );
  }

  /** Encola el borrador actual y limpia el formulario. */
  stageCurrentCatalogDraft(): boolean {
    if (this.state.isCatalogEditing()) {
      this.state.errorMessage.set(
        'Finish the current catalog edition before staging multiple new SMILES entries.',
      );
      return false;
    }
    const catalogPreview: SmileitCatalogDraftPreview = this.state.catalogDraftPreview();
    if (!catalogPreview.isReady) {
      this.state.errorMessage.set(
        catalogPreview.warnings[0] ??
          'Complete the current catalog SMILES before adding it with +.',
      );
      return false;
    }

    const nextQueuedDraft: SmileitCatalogQueuedDraft = this.buildQueuedCatalogDraft(catalogPreview);
    this.state.catalogDraftQueue.update((currentQueue: SmileitCatalogQueuedDraft[]) => [
      ...currentQueue,
      nextQueuedDraft,
    ]);
    this.resetCatalogDraftAfterStage();
    this.state.errorMessage.set(null);
    return true;
  }

  /** Encola el borrador actual y prepara el formulario para otra entrada. */
  stageCurrentCatalogDraftAndPrepareNext(): boolean {
    if (this.state.isCatalogEditing()) {
      this.state.errorMessage.set(
        'Finish the current catalog edition before staging multiple new SMILES entries.',
      );
      return false;
    }
    const catalogPreview: SmileitCatalogDraftPreview = this.state.catalogDraftPreview();
    if (!catalogPreview.isReady) {
      this.state.errorMessage.set(
        catalogPreview.warnings[0] ?? 'Complete the current catalog SMILES before adding it.',
      );
      return false;
    }

    const nextQueuedDraft: SmileitCatalogQueuedDraft = this.buildQueuedCatalogDraft(catalogPreview);
    this.state.catalogDraftQueue.update((currentQueue: SmileitCatalogQueuedDraft[]) => [
      ...currentQueue,
      nextQueuedDraft,
    ]);
    this.prepareCatalogDraftForAnother(nextQueuedDraft);
    this.state.errorMessage.set(null);
    return true;
  }

  /** Carga un borrador encolado en el formulario para edición. */
  loadQueuedCatalogDraft(queueDraftId: string): void {
    const queuedDraft: SmileitCatalogQueuedDraft | undefined = this.state
      .catalogDraftQueue()
      .find((draft: SmileitCatalogQueuedDraft) => draft.id === queueDraftId);
    if (queuedDraft === undefined) {
      return;
    }
    this.hydrateCatalogFormFromQueuedDraft(queuedDraft);
    this.removeQueuedCatalogDraft(queueDraftId);
    this.state.errorMessage.set(null);
  }

  /** Clona un borrador encolado y lo carga en el formulario. */
  cloneQueuedCatalogDraft(queueDraftId: string): void {
    const queuedDraft: SmileitCatalogQueuedDraft | undefined = this.state
      .catalogDraftQueue()
      .find((draft: SmileitCatalogQueuedDraft) => draft.id === queueDraftId);
    if (queuedDraft === undefined) {
      return;
    }

    const existingNames: string[] = this.state
      .catalogDraftQueue()
      .map((draft: SmileitCatalogQueuedDraft) => draft.name);
    const nextCloneName: string = buildNextCloneDraftName(queuedDraft.name, existingNames);

    this.catalogDraftSequence += 1;
    const clonedDraft: SmileitCatalogQueuedDraft = {
      ...queuedDraft,
      id: `catalog-draft-${this.catalogDraftSequence}`,
      name: nextCloneName,
      anchorAtomIndices: [...queuedDraft.anchorAtomIndices],
      categoryKeys: [...queuedDraft.categoryKeys],
      categoryNames: [...queuedDraft.categoryNames],
    };

    this.state.catalogDraftQueue.update((currentQueue: SmileitCatalogQueuedDraft[]) => [
      ...currentQueue,
      clonedDraft,
    ]);
    this.hydrateCatalogFormFromQueuedDraft(clonedDraft);
    this.state.errorMessage.set(null);
  }

  /** Elimina un borrador encolado sin cargarlo. */
  removeQueuedCatalogDraft(queueDraftId: string): void {
    this.state.catalogDraftQueue.update((currentQueue: SmileitCatalogQueuedDraft[]) =>
      currentQueue.filter((draft: SmileitCatalogQueuedDraft) => draft.id !== queueDraftId),
    );
  }

  // ── CRUD de catálogo ──────────────────────────────────────────────────

  /** Crea o actualiza una entrada de catálogo en el servidor. */
  createCatalogEntry(onSuccess?: () => void): void {
    const editingStableId: string | null = this.state.catalogEditingStableId();
    const activePreview: SmileitCatalogDraftPreview = this.state.catalogDraftPreview();
    this.state.errorMessage.set(null);

    if (editingStableId === null) {
      if (!activePreview.isReady) {
        this.state.errorMessage.set(
          activePreview.warnings[0] ?? 'Complete the current catalog draft before saving.',
        );
        return;
      }
      const requestPayload: SmileitCatalogEntryCreateParams = this.buildCreatePayload(activePreview);
      this.smileitApi.createSmileitCatalogEntry(requestPayload).subscribe({
        next: (updatedCatalogEntries: SmileitCatalogEntryView[]) => {
          this.refreshCatalogEntriesAfterMutation(updatedCatalogEntries, true, true);
          onSuccess?.();
        },
        error: (requestError: unknown) => {
          this.state.errorMessage.set(
            `Unable to create catalog entry: ${extractRequestErrorMessage(requestError)}`,
          );
        },
      });
      return;
    }

    if (activePreview.name === '' || activePreview.smiles === '') {
      this.state.errorMessage.set('Persistent catalog entry requires both name and SMILES.');
      return;
    }
    if (activePreview.anchorAtomIndices.length === 0) {
      this.state.errorMessage.set('Persistent catalog entry requires one anchor atom index.');
      return;
    }

    const requestPayload: SmileitCatalogEntryCreateParams = this.buildCreatePayload(activePreview);
    const saveRequest: Observable<SmileitCatalogEntryView[]> =
      this.smileitApi.updateSmileitCatalogEntry(editingStableId, requestPayload);

    saveRequest.subscribe({
      next: (updatedCatalogEntries: SmileitCatalogEntryView[]) => {
        this.refreshCatalogEntriesAfterMutation(updatedCatalogEntries, true, false);
        onSuccess?.();
      },
      error: (requestError: unknown) => {
        const actionLabel: string = editingStableId === null ? 'create' : 'update';
        this.state.errorMessage.set(
          `Unable to ${actionLabel} catalog entry: ${extractRequestErrorMessage(requestError)}`,
        );
      },
    });
  }

  /** Crea una entrada y prepara el formulario para otra más. */
  createCatalogEntryAndPrepareNext(onSuccess?: () => void): void {
    if (this.state.isCatalogEditing()) {
      this.state.errorMessage.set('Finish catalog edition before using Add another.');
      return;
    }
    const activePreview: SmileitCatalogDraftPreview = this.state.catalogDraftPreview();
    if (!activePreview.isReady) {
      this.state.errorMessage.set(
        activePreview.warnings[0] ?? 'Complete the current catalog draft before saving.',
      );
      return;
    }

    const requestPayload: SmileitCatalogEntryCreateParams = this.buildCreatePayload(activePreview);

    this.smileitApi.createSmileitCatalogEntry(requestPayload).subscribe({
      next: (updatedCatalogEntries: SmileitCatalogEntryView[]) => {
        this.refreshCatalogEntriesAfterMutation(updatedCatalogEntries, false, true);
        this.prepareCatalogDraftForAnother({
          id: 'catalog-draft-preview',
          name: activePreview.name,
          smiles: activePreview.smiles,
          anchorAtomIndices: [...activePreview.anchorAtomIndices],
          categoryKeys: [...activePreview.categoryKeys],
          categoryNames: [...activePreview.categoryNames],
          sourceReference: activePreview.sourceReference,
        });
        this.state.errorMessage.set(null);
        onSuccess?.();
      },
      error: (requestError: unknown) => {
        this.state.errorMessage.set(
          `Unable to create catalog entry: ${extractRequestErrorMessage(requestError)}`,
        );
      },
    });
  }

  // ── Edición de entradas existentes ────────────────────────────────────

  /** Carga una entrada existente en el formulario para edición. */
  beginCatalogEntryEdition(entry: SmileitCatalogEntryView): void {
    if (!this.isCatalogEntryEditable(entry)) {
      this.state.errorMessage.set(
        'Seed catalog entries are read-only and cannot be edited from the UI.',
      );
      return;
    }
    this.state.catalogEditingStableId.set(entry.stable_id);
    this.state.catalogCreateName.set(entry.name);
    this.state.catalogCreateSmiles.set(entry.smiles);
    this.state.catalogCreateAnchorIndicesText.set(String(entry.anchor_atom_indices[0] ?? ''));
    this.state.catalogCreateCategoryKeys.set([...(entry.categories ?? [])]);
    this.state.catalogCreateSourceReference.set(entry.source_reference || 'local-lab');
    this.state.errorMessage.set(null);
  }

  /** Cancela la edición y limpia el formulario. */
  cancelCatalogEdition(): void {
    this.resetCatalogForm();
    this.state.errorMessage.set(null);
  }

  /** Determina si una entrada puede ser editada (no seeds ni legacy). */
  isCatalogEntryEditable(entry: SmileitCatalogEntryView): boolean {
    const normalizedSourceReference: string = (entry.source_reference ?? '').trim().toLowerCase();
    if (
      normalizedSourceReference === 'legacy-smileit' ||
      normalizedSourceReference === 'smileit-seed'
    ) {
      return false;
    }
    const rawSeedFlag: string = String(entry.provenance_metadata?.['seed'] ?? '')
      .trim()
      .toLowerCase();
    return rawSeedFlag !== 'true' && rawSeedFlag !== '1' && rawSeedFlag !== 'yes';
  }

  /** Comprueba si una entrada de catálogo está referenciada por un bloque. */
  isCatalogEntryReferenced(
    block: SmileitAssignmentBlockDraft,
    catalogEntry: SmileitCatalogEntryView,
  ): boolean {
    return block.catalogRefs.some(
      (entry: SmileitCatalogEntryView) =>
        entry.stable_id === catalogEntry.stable_id && entry.version === catalogEntry.version,
    );
  }

  // ── Patrones SMARTS ───────────────────────────────────────────────────

  /**
   * Crea un patrón estructural en el servidor.
   * Recibe un callback opcional para re-inspeccionar la estructura principal tras la creación.
   */
  createPatternEntry(onPatternCreated?: () => void): void {
    const patternName: string = this.state.patternCreateName().trim();
    const patternSmarts: string = this.state.patternCreateSmarts().trim();
    const patternCaption: string = this.state.patternCreateCaption().trim();

    if (patternName === '' || patternSmarts === '' || patternCaption === '') {
      this.state.errorMessage.set('Pattern registration requires name, SMARTS and caption.');
      return;
    }

    const requestPayload: SmileitPatternEntryCreateParams = {
      name: patternName,
      smarts: patternSmarts,
      patternType: this.state.patternCreateType(),
      caption: patternCaption,
      sourceReference: this.state.patternCreateSourceReference().trim() || 'local-lab',
      provenanceMetadata: {},
    };

    this.state.errorMessage.set(null);

    this.smileitApi.createSmileitPatternEntry(requestPayload).subscribe({
      next: () => {
        this.smileitApi.listSmileitPatterns().subscribe({
          next: (patterns: SmileitPatternEntryView[]) => {
            this.state.patterns.set(this.normalizePatternEntries(patterns));
            this.state.patternCreateName.set('');
            this.state.patternCreateSmarts.set('');
            this.state.patternCreateCaption.set('');
            this.state.patternCreateType.set(PatternTypeEnum.Toxicophore);
            this.state.patternCreateSourceReference.set('local-lab');
            this.state.errorMessage.set(null);
            onPatternCreated?.();
          },
          error: (requestError: unknown) => {
            this.state.errorMessage.set(
              `Unable to refresh structural patterns: ${extractRequestErrorMessage(requestError)}`,
            );
          },
        });
      },
      error: (requestError: unknown) => {
        this.state.errorMessage.set(
          `Unable to create structural pattern: ${extractRequestErrorMessage(requestError)}`,
        );
      },
    });
  }

  // ── Helpers privados ──────────────────────────────────────────────────

  private buildCreatePayload(preview: SmileitCatalogDraftPreview): SmileitCatalogEntryCreateParams {
    return {
      name: preview.name,
      smiles: preview.smiles,
      anchorAtomIndices: [...preview.anchorAtomIndices],
      categoryKeys: [...preview.categoryKeys],
      sourceReference: preview.sourceReference,
      provenanceMetadata: {},
    };
  }

  private normalizeCatalogEntries(rawCatalogEntries: unknown): SmileitCatalogEntryView[] {
    if (!Array.isArray(rawCatalogEntries)) {
      return [];
    }
    return dedupeVersionedEntries(rawCatalogEntries as SmileitCatalogEntryView[]);
  }

  private normalizePatternEntries(rawPatterns: unknown): SmileitPatternEntryView[] {
    if (!Array.isArray(rawPatterns)) {
      return [];
    }
    return dedupeVersionedEntries(rawPatterns as SmileitPatternEntryView[]);
  }

  private refreshCatalogEntriesAfterMutation(
    updatedCatalogEntries: SmileitCatalogEntryView[] | null,
    shouldResetForm: boolean,
    shouldClearQueuedDrafts: boolean,
  ): void {
    if (updatedCatalogEntries !== null) {
      this.applyCatalogEntriesAfterMutation(
        updatedCatalogEntries,
        shouldResetForm,
        shouldClearQueuedDrafts,
      );
      return;
    }

    // Fallback defensivo por si algún backend legado no retorna el catálogo actualizado.
    this.smileitApi.listSmileitCatalog().subscribe({
      next: (catalogEntries: SmileitCatalogEntryView[]) => {
        this.applyCatalogEntriesAfterMutation(
          catalogEntries,
          shouldResetForm,
          shouldClearQueuedDrafts,
        );
      },
      error: (requestError: unknown) => {
        this.state.errorMessage.set(
          `Unable to refresh catalog entries: ${extractRequestErrorMessage(requestError)}`,
        );
      },
    });
  }

  private applyCatalogEntriesAfterMutation(
    catalogEntries: SmileitCatalogEntryView[],
    shouldResetForm: boolean,
    shouldClearQueuedDrafts: boolean,
  ): void {
    const normalizedCatalogEntries: SmileitCatalogEntryView[] =
      this.normalizeCatalogEntries(catalogEntries);
    this.state.catalogEntries.set(normalizedCatalogEntries);
    this.refreshBlockCatalogRefsToLatestEntries(normalizedCatalogEntries);

    if (shouldClearQueuedDrafts) {
      this.state.catalogDraftQueue.set([]);
    }
    if (shouldResetForm) {
      this.resetCatalogForm();
    }
    this.state.errorMessage.set(null);
  }

  /** Actualiza las catalogRefs de cada bloque para que apunten a la última versión. */
  private refreshBlockCatalogRefsToLatestEntries(
    catalogEntries: SmileitCatalogEntryView[] = this.state.catalogEntries(),
  ): void {
    const latestByStableId: Map<string, SmileitCatalogEntryView> = new Map(
      catalogEntries.map((entry: SmileitCatalogEntryView) => [entry.stable_id, entry]),
    );

    this.state.assignmentBlocks.update((currentBlocks: SmileitAssignmentBlockDraft[]) =>
      currentBlocks.map((block: SmileitAssignmentBlockDraft) => {
        const dedupeTracker: Set<string> = new Set();
        const normalizedRefs: SmileitCatalogEntryView[] = block.catalogRefs
          .map(
            (entry: SmileitCatalogEntryView) => latestByStableId.get(entry.stable_id) ?? entry,
          )
          .filter((entry: SmileitCatalogEntryView) => {
            const dedupeKey: string = `${entry.stable_id}::${entry.version}`;
            if (dedupeTracker.has(dedupeKey)) {
              return false;
            }
            dedupeTracker.add(dedupeKey);
            return true;
          });
        return { ...block, catalogRefs: normalizedRefs };
      }),
    );
  }

  private resetCatalogForm(): void {
    this.state.catalogCreateSmiles.set('');
    this.state.catalogCreateAnchorIndicesText.set('');
    this.state.catalogCreateCategoryKeys.set([]);
    this.state.catalogCreateSourceReference.set('local-lab');
    this.state.catalogEditingStableId.set(null);
    this.state.catalogCreateName.set(
      buildNextSequentialCatalogDraftName('', this.collectUsedCatalogDraftNames()),
    );
  }

  private resetCatalogDraftAfterStage(): void {
    this.resetCatalogForm();
  }

  private hydrateCatalogFormFromQueuedDraft(queuedDraft: SmileitCatalogQueuedDraft): void {
    this.state.catalogCreateName.set(queuedDraft.name);
    this.state.catalogCreateSmiles.set(queuedDraft.smiles);
    this.state.catalogCreateAnchorIndicesText.set(String(queuedDraft.anchorAtomIndices[0] ?? ''));
    this.state.catalogCreateCategoryKeys.set([...queuedDraft.categoryKeys]);
    this.state.catalogCreateSourceReference.set(queuedDraft.sourceReference);
  }

  private buildQueuedCatalogDraft(
    catalogPreview: SmileitCatalogDraftPreview,
  ): SmileitCatalogQueuedDraft {
    this.catalogDraftSequence += 1;
    return {
      id: `catalog-draft-${this.catalogDraftSequence}`,
      name: catalogPreview.name,
      smiles: catalogPreview.smiles,
      anchorAtomIndices: [...catalogPreview.anchorAtomIndices],
      categoryKeys: [...catalogPreview.categoryKeys],
      categoryNames: [...catalogPreview.categoryNames],
      sourceReference: catalogPreview.sourceReference,
    };
  }

  private prepareCatalogDraftForAnother(stagedDraft: SmileitCatalogQueuedDraft): void {
    this.state.catalogEditingStableId.set(null);
    this.state.catalogCreateName.set(
      buildNextSequentialCatalogDraftName(stagedDraft.name, this.collectUsedCatalogDraftNames()),
    );
    this.state.catalogCreateSmiles.set(stagedDraft.smiles);
    this.state.catalogCreateAnchorIndicesText.set('');
    this.state.catalogCreateCategoryKeys.set([...stagedDraft.categoryKeys]);
    this.state.catalogCreateSourceReference.set(stagedDraft.sourceReference || 'local-lab');
  }

  private collectUsedCatalogDraftNames(): string[] {
    return [
      ...this.state
        .catalogEntries()
        .map((catalogEntry: SmileitCatalogEntryView) => catalogEntry.name),
      ...this.state
        .catalogDraftQueue()
        .map((queuedDraft: SmileitCatalogQueuedDraft) => queuedDraft.name),
    ];
  }
}
