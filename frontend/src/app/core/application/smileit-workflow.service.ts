// smileit-workflow.service.ts: Orquesta el flujo profesional de Smile-it con bloques, catálogo persistente y trazabilidad.

import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import {
  Observable,
  Subscription,
  catchError,
  concatMap,
  finalize,
  forkJoin,
  from,
  last,
  throwError,
} from 'rxjs';
import { PatternTypeEnum, SiteOverlapPolicyEnum } from '../api/generated';
import {
    DownloadedReportFile,
    JobLogEntryView,
    JobLogsPageView,
    JobProgressSnapshotView,
    JobsApiService,
    ScientificJobView,
    SmileitAssignmentBlockParams,
    SmileitCatalogEntryCreateParams,
    SmileitCatalogEntryView,
    SmileitCategoryView,
    SmileitGenerationParams,
    SmileitJobResponseView,
    SmileitManualSubstituentParams,
    SmileitPatternEntryCreateParams,
    SmileitPatternEntryView,
    SmileitQuickPropertiesView,
    SmileitResolvedAssignmentBlockView,
    SmileitStructureInspectionView,
    SmileitTraceabilityRowView,
} from '../api/jobs-api.service';

type SmileitSection = 'idle' | 'inspecting' | 'dispatching' | 'progress' | 'result' | 'error';

export interface SmileitGeneratedStructureView {
  name: string;
  smiles: string;
  svg: string;
  traceability: Array<{
    round_index: number;
    site_atom_index: number;
    block_label: string;
    block_priority: number;
    substituent_name: string;
    substituent_stable_id: string;
    substituent_version: number;
    source_kind: string;
    bond_order: number;
  }>;
}

export interface SmileitManualSubstituentDraft extends SmileitManualSubstituentParams {}

export interface SmileitAssignmentBlockDraft {
  id: string;
  label: string;
  siteAtomIndices: number[];
  categoryKeys: string[];
  catalogRefs: SmileitCatalogEntryView[];
  manualSubstituents: SmileitManualSubstituentDraft[];
  draftManualName: string;
  draftManualSmiles: string;
  draftManualAnchorIndicesText: string;
  draftManualSourceReference: string;
  draftManualCategoryKeys: string[];
}

export interface SmileitSiteCoverageView {
  siteAtomIndex: number;
  blockId: string;
  blockLabel: string;
  priority: number;
  sourceCount: number;
}

export interface SmileitCatalogGroupView {
  key: string;
  name: string;
  entries: SmileitCatalogEntryView[];
}

type SmileitChemicalNotationKind = 'empty' | 'smiles' | 'smarts';

export interface SmileitCatalogDraftPreview {
  name: string;
  smiles: string;
  sourceReference: string;
  anchorAtomIndices: number[];
  categoryKeys: string[];
  categoryNames: string[];
  notationKind: SmileitChemicalNotationKind;
  warnings: string[];
  isReady: boolean;
}

export interface SmileitCatalogQueuedDraft {
  id: string;
  name: string;
  smiles: string;
  anchorAtomIndices: number[];
  categoryKeys: string[];
  categoryNames: string[];
  sourceReference: string;
}

export interface SmileitBlockCollapsedSummary {
  selectedSitesLabel: string;
  categoriesLabel: string;
  catalogSmilesLabel: string;
  manualSmilesLabel: string;
  sourceCount: number;
}

export interface SmileitResultData {
  totalGenerated: number;
  generatedStructures: SmileitGeneratedStructureView[];
  truncated: boolean;
  principalSmiles: string;
  selectedAtomIndices: number[];
  assignmentBlocks: SmileitResolvedAssignmentBlockView[];
  traceabilityRows: SmileitTraceabilityRowView[];
  exportNameBase: string;
  exportPadding: number;
  references: Record<string, Array<Record<string, unknown>>>;
  isHistoricalSummary: boolean;
  summaryMessage: string | null;
}

@Injectable()
export class SmileitWorkflowService implements OnDestroy {
  private readonly jobsApiService = inject(JobsApiService);
  private progressSubscription: Subscription | null = null;
  private logsSubscription: Subscription | null = null;
  private blockSequence: number = 0;
  private catalogDraftSequence: number = 0;

  readonly principalSmiles = signal<string>('c1ccccc1');
  readonly inspection = signal<SmileitStructureInspectionView | null>(null);
  readonly selectedAtomIndices = signal<number[]>([]);

  readonly catalogEntries = signal<SmileitCatalogEntryView[]>([]);
  readonly categories = signal<SmileitCategoryView[]>([]);
  readonly patterns = signal<SmileitPatternEntryView[]>([]);
  readonly assignmentBlocks = signal<SmileitAssignmentBlockDraft[]>([]);

  readonly catalogCreateName = signal<string>('');
  readonly catalogCreateSmiles = signal<string>('');
  readonly catalogCreateAnchorIndicesText = signal<string>('');
  readonly catalogCreateCategoryKeys = signal<string[]>([]);
  readonly catalogCreateSourceReference = signal<string>('local-lab');
  readonly catalogEditingStableId = signal<string | null>(null);
  readonly catalogDraftQueue = signal<SmileitCatalogQueuedDraft[]>([]);

  readonly patternCreateName = signal<string>('');
  readonly patternCreateSmarts = signal<string>('');
  readonly patternCreateType = signal<PatternTypeEnum>(PatternTypeEnum.Toxicophore);
  readonly patternCreateCaption = signal<string>('');
  readonly patternCreateSourceReference = signal<string>('local-lab');

  readonly siteOverlapPolicy = signal<SiteOverlapPolicyEnum>(SiteOverlapPolicyEnum.LastBlockWins);
  readonly rSubstitutes = signal<number>(1);
  readonly numBonds = signal<number>(1);
  readonly allowRepeated = signal<boolean>(false);
  readonly maxStructures = signal<number>(0);
  readonly exportNameBase = signal<string>('smileit_run');
  readonly exportPadding = signal<number>(5);

  readonly activeSection = signal<SmileitSection>('idle');
  readonly currentJobId = signal<string | null>(null);
  readonly progressSnapshot = signal<JobProgressSnapshotView | null>(null);
  readonly jobLogs = signal<JobLogEntryView[]>([]);
  readonly resultData = signal<SmileitResultData | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly exportErrorMessage = signal<string | null>(null);
  readonly isExporting = signal<boolean>(false);
  readonly historyJobs = signal<ScientificJobView[]>([]);
  readonly isHistoryLoading = signal<boolean>(false);

  readonly isProcessing = computed(
    () =>
      this.activeSection() === 'inspecting' ||
      this.activeSection() === 'dispatching' ||
      this.activeSection() === 'progress',
  );

  readonly inspectionSvg = computed(() => this.inspection()?.svg ?? '');
  readonly quickProperties = computed<SmileitQuickPropertiesView | null>(
    () => this.inspection()?.quickProperties ?? null,
  );
  readonly progressPercentage = computed(() => this.progressSnapshot()?.progress_percentage ?? 0);
  readonly progressMessage = computed(
    () => this.progressSnapshot()?.progress_message ?? 'Preparing Smileit generation...',
  );
  readonly selectedSiteCoverage = computed<SmileitSiteCoverageView[]>(() =>
    this.buildEffectiveCoverage(this.selectedAtomIndices(), this.assignmentBlocks()),
  );
  readonly uncoveredSelectedSites = computed<number[]>(() => {
    const coveredSites: Set<number> = new Set(
      this.selectedSiteCoverage().map(
        (coverageItem: SmileitSiteCoverageView) => coverageItem.siteAtomIndex,
      ),
    );
    return this.selectedAtomIndices().filter((atomIndex: number) => !coveredSites.has(atomIndex));
  });
  readonly canConfigureGeneration = computed(() => {
    const principal: string = this.principalSmiles().trim();
    return (
      principal.length > 0 &&
      this.selectedAtomIndices().length > 0 &&
      this.assignmentBlocks().length > 0 &&
      this.uncoveredSelectedSites().length === 0
    );
  });
  readonly canDispatch = computed(() => {
    return this.canConfigureGeneration() && !this.isProcessing();
  });
  readonly isCatalogEditing = computed(() => this.catalogEditingStableId() !== null);
  readonly hasQueuedCatalogDrafts = computed(() => this.catalogDraftQueue().length > 0);
  readonly catalogGroups = computed<SmileitCatalogGroupView[]>(() =>
    this.buildCatalogGroups(this.catalogEntries(), this.categories()),
  );
  readonly catalogDraftPreview = computed<SmileitCatalogDraftPreview>(() => {
    const currentSmiles: string = this.catalogCreateSmiles().trim();
    const parsedAnchorIndices: number[] = this.parseSingleAnchorIndexInput(
      this.catalogCreateAnchorIndicesText(),
    );
    const notationKind: SmileitChemicalNotationKind = this.detectChemicalNotation(currentSmiles);
    const selectedCategoryKeys: string[] = this.catalogCreateCategoryKeys();
    const categoryNameByKey: Map<string, string> = new Map(
      this.categories().map((category: SmileitCategoryView) => [category.key, category.name]),
    );
    const warnings: string[] = [];

    if (notationKind === 'smarts') {
      warnings.push(
        'Catalog entries require SMILES notation. Use the Structural pattern catalog for SMARTS.',
      );
    }
    if (parsedAnchorIndices.length === 0) {
      warnings.push('One anchor atom index is required.');
    }
    if (selectedCategoryKeys.length === 0) {
      warnings.push('Select at least one chemistry category.');
    }

    return {
      name: this.catalogCreateName().trim(),
      smiles: currentSmiles,
      sourceReference: this.catalogCreateSourceReference().trim() || 'local-lab',
      anchorAtomIndices: parsedAnchorIndices,
      categoryKeys: selectedCategoryKeys,
      categoryNames: selectedCategoryKeys.map(
        (categoryKey: string) => categoryNameByKey.get(categoryKey) ?? categoryKey,
      ),
      notationKind,
      warnings,
      isReady:
        this.catalogCreateName().trim() !== '' &&
        currentSmiles !== '' &&
        notationKind !== 'smarts' &&
        parsedAnchorIndices.length > 0 &&
        selectedCategoryKeys.length > 0,
    };
  });

  loadInitialData(): void {
    forkJoin({
      catalog: this.jobsApiService.listSmileitCatalog(),
      categories: this.jobsApiService.listSmileitCategories(),
      patterns: this.jobsApiService.listSmileitPatterns(),
    }).subscribe({
      next: ({ catalog, categories, patterns }) => {
        this.catalogEntries.set(catalog);
        this.categories.set(categories);
        this.patterns.set(patterns);
        this.refreshBlockCatalogRefsToLatestEntries(catalog);
      },
      error: (requestError: Error) => {
        this.errorMessage.set(`Unable to load Smileit reference data: ${requestError.message}`);
      },
    });
  }

  inspectPrincipalStructure(): void {
    const rawSmiles: string = this.principalSmiles().trim();
    if (rawSmiles === '') {
      this.activeSection.set('error');
      this.errorMessage.set('Principal SMILES is required before inspection.');
      return;
    }

    this.activeSection.set('inspecting');
    this.errorMessage.set(null);

    this.jobsApiService.inspectSmileitStructure(rawSmiles).subscribe({
      next: (inspectionResult: SmileitStructureInspectionView) => {
        this.inspection.set(inspectionResult);
        this.selectedAtomIndices.update((currentSelection: number[]) =>
          currentSelection.filter((atomIndex: number) => atomIndex < inspectionResult.atomCount),
        );
        this.pruneBlocksToSelectedSites();
        this.activeSection.set('idle');
      },
      error: (requestError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to inspect principal structure: ${requestError.message}`);
      },
    });
  }

  toggleSelectedAtom(atomIndex: number): void {
    this.selectedAtomIndices.update((currentSelection: number[]) => {
      const nextSelection: number[] = currentSelection.includes(atomIndex)
        ? currentSelection.filter((item: number) => item !== atomIndex)
        : [...currentSelection, atomIndex];
      return nextSelection.sort((left: number, right: number) => left - right);
    });
    this.pruneBlocksToSelectedSites();
  }

  addAssignmentBlock(): void {
    const uncoveredSites: number[] = this.uncoveredSelectedSites();
    const defaultSites: number[] =
      uncoveredSites.length > 0 ? uncoveredSites : [...this.selectedAtomIndices()];
    const nextIndex: number = this.assignmentBlocks().length + 1;

    this.assignmentBlocks.update((currentBlocks: SmileitAssignmentBlockDraft[]) => [
      ...currentBlocks,
      this.createBlockDraft(`Block ${nextIndex}`, defaultSites),
    ]);
  }

  removeAssignmentBlock(blockId: string): void {
    this.assignmentBlocks.update((currentBlocks: SmileitAssignmentBlockDraft[]) =>
      currentBlocks.filter((block: SmileitAssignmentBlockDraft) => block.id !== blockId),
    );
  }

  moveAssignmentBlock(blockId: string, direction: -1 | 1): void {
    this.assignmentBlocks.update((currentBlocks: SmileitAssignmentBlockDraft[]) => {
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

  updateBlockLabel(blockId: string, nextLabel: string): void {
    this.updateBlock(blockId, (block: SmileitAssignmentBlockDraft) => ({
      ...block,
      label: nextLabel,
    }));
  }

  toggleBlockSite(blockId: string, atomIndex: number): void {
    if (!this.selectedAtomIndices().includes(atomIndex)) {
      return;
    }

    this.updateBlock(blockId, (block: SmileitAssignmentBlockDraft) => {
      const nextSites: number[] = block.siteAtomIndices.includes(atomIndex)
        ? block.siteAtomIndices.filter((item: number) => item !== atomIndex)
        : [...block.siteAtomIndices, atomIndex];

      return {
        ...block,
        siteAtomIndices: nextSites.sort((left: number, right: number) => left - right),
      };
    });
  }

  toggleBlockCategory(blockId: string, categoryKey: string): void {
    this.updateBlock(blockId, (block: SmileitAssignmentBlockDraft) => ({
      ...block,
      categoryKeys: this.toggleString(block.categoryKeys, categoryKey),
    }));
  }

  setAllCategoriesForBlock(blockId: string): void {
    this.updateBlock(blockId, (block: SmileitAssignmentBlockDraft) => ({
      ...block,
      categoryKeys: this.categories().map((category: SmileitCategoryView) => category.key),
    }));
  }

  clearCategoriesForBlock(blockId: string): void {
    this.updateBlock(blockId, (block: SmileitAssignmentBlockDraft) => ({
      ...block,
      categoryKeys: [],
    }));
  }

  addCatalogReferenceToBlock(blockId: string, catalogEntry: SmileitCatalogEntryView): void {
    this.updateBlock(blockId, (block: SmileitAssignmentBlockDraft) => {
      const alreadyExists: boolean = block.catalogRefs.some(
        (entry: SmileitCatalogEntryView) =>
          entry.stable_id === catalogEntry.stable_id && entry.version === catalogEntry.version,
      );
      if (alreadyExists) {
        return block;
      }

      return {
        ...block,
        catalogRefs: [...block.catalogRefs, catalogEntry],
      };
    });
  }

  removeCatalogReferenceFromBlock(blockId: string, stableId: string, version: number): void {
    this.updateBlock(blockId, (block: SmileitAssignmentBlockDraft) => ({
      ...block,
      catalogRefs: block.catalogRefs.filter(
        (entry: SmileitCatalogEntryView) =>
          !(entry.stable_id === stableId && entry.version === version),
      ),
    }));
  }

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
      draftManualCategoryKeys: this.toggleString(block.draftManualCategoryKeys, categoryKey),
    }));
  }

  addManualSubstituentToBlock(blockId: string): void {
    const blockDraft: SmileitAssignmentBlockDraft | undefined = this.assignmentBlocks().find(
      (block: SmileitAssignmentBlockDraft) => block.id === blockId,
    );
    if (blockDraft === undefined) {
      return;
    }

    const manualName: string = blockDraft.draftManualName.trim();
    const manualSmiles: string = blockDraft.draftManualSmiles.trim();
    const anchorAtomIndices: number[] = this.parseAtomIndicesInput(
      blockDraft.draftManualAnchorIndicesText,
    );

    if (manualName === '' || manualSmiles === '') {
      this.errorMessage.set('Manual substituent requires both a name and a SMILES string.');
      return;
    }

    if (anchorAtomIndices.length === 0) {
      this.errorMessage.set('Manual substituent requires at least one anchor atom index.');
      return;
    }

    const resolvedCategoryKeys: string[] =
      blockDraft.draftManualCategoryKeys.length > 0
        ? [...blockDraft.draftManualCategoryKeys]
        : blockDraft.categoryKeys.length > 0
          ? [...blockDraft.categoryKeys]
          : this.categories().map((category: SmileitCategoryView) => category.key);

    if (resolvedCategoryKeys.length === 0) {
      this.errorMessage.set('Manual substituent requires at least one chemistry category.');
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
    this.errorMessage.set(null);
  }

  removeManualSubstituent(blockId: string, manualIndex: number): void {
    this.updateBlock(blockId, (block: SmileitAssignmentBlockDraft) => ({
      ...block,
      manualSubstituents: block.manualSubstituents.filter(
        (_entry: SmileitManualSubstituentDraft, index: number) => index !== manualIndex,
      ),
    }));
  }

  toggleCatalogCreateCategory(categoryKey: string): void {
    this.catalogCreateCategoryKeys.update((currentKeys: string[]) =>
      this.toggleString(currentKeys, categoryKey),
    );
  }

  stageCurrentCatalogDraft(): void {
    if (this.isCatalogEditing()) {
      this.errorMessage.set(
        'Finish the current catalog edition before staging multiple new SMILES entries.',
      );
      return;
    }

    const catalogPreview: SmileitCatalogDraftPreview = this.catalogDraftPreview();
    if (!catalogPreview.isReady) {
      this.errorMessage.set(
        catalogPreview.warnings[0] ??
          'Complete the current catalog SMILES before adding it with +.',
      );
      return;
    }

    this.catalogDraftSequence += 1;
    const nextQueuedDraft: SmileitCatalogQueuedDraft = {
      id: `catalog-draft-${this.catalogDraftSequence}`,
      name: catalogPreview.name,
      smiles: catalogPreview.smiles,
      anchorAtomIndices: [...catalogPreview.anchorAtomIndices],
      categoryKeys: [...catalogPreview.categoryKeys],
      categoryNames: [...catalogPreview.categoryNames],
      sourceReference: catalogPreview.sourceReference,
    };

    this.catalogDraftQueue.update((currentQueue: SmileitCatalogQueuedDraft[]) => [
      ...currentQueue,
      nextQueuedDraft,
    ]);
    this.resetCatalogDraftAfterStage();
    this.errorMessage.set(null);
  }

  loadQueuedCatalogDraft(queueDraftId: string): void {
    const queuedDraft: SmileitCatalogQueuedDraft | undefined = this.catalogDraftQueue().find(
      (draft: SmileitCatalogQueuedDraft) => draft.id === queueDraftId,
    );
    if (queuedDraft === undefined) {
      return;
    }

    this.catalogCreateName.set(queuedDraft.name);
    this.catalogCreateSmiles.set(queuedDraft.smiles);
    this.catalogCreateAnchorIndicesText.set(String(queuedDraft.anchorAtomIndices[0] ?? ''));
    this.catalogCreateCategoryKeys.set([...queuedDraft.categoryKeys]);
    this.catalogCreateSourceReference.set(queuedDraft.sourceReference);
    this.removeQueuedCatalogDraft(queueDraftId);
    this.errorMessage.set(null);
  }

  removeQueuedCatalogDraft(queueDraftId: string): void {
    this.catalogDraftQueue.update((currentQueue: SmileitCatalogQueuedDraft[]) =>
      currentQueue.filter((draft: SmileitCatalogQueuedDraft) => draft.id !== queueDraftId),
    );
  }

  createCatalogEntry(): void {
    const editingStableId: string | null = this.catalogEditingStableId();
    const activePreview: SmileitCatalogDraftPreview = this.catalogDraftPreview();

    if (editingStableId === null) {
      const activePreview: SmileitCatalogDraftPreview = this.catalogDraftPreview();
      const activePayload: SmileitCatalogEntryCreateParams | null = activePreview.isReady
        ? {
            name: activePreview.name,
            smiles: activePreview.smiles,
            anchorAtomIndices: [...activePreview.anchorAtomIndices],
            categoryKeys: [...activePreview.categoryKeys],
            sourceReference: activePreview.sourceReference,
            provenanceMetadata: {},
          }
        : null;
      const queuedPayloads: SmileitCatalogEntryCreateParams[] = this.catalogDraftQueue().map(
        (queuedDraft: SmileitCatalogQueuedDraft) => ({
          name: queuedDraft.name,
          smiles: queuedDraft.smiles,
          anchorAtomIndices: [...queuedDraft.anchorAtomIndices],
          categoryKeys: [...queuedDraft.categoryKeys],
          sourceReference: queuedDraft.sourceReference,
          provenanceMetadata: {},
        }),
      );
      const payloadsToCreate: SmileitCatalogEntryCreateParams[] =
        activePayload === null ? queuedPayloads : [...queuedPayloads, activePayload];

      if (payloadsToCreate.length === 0) {
        this.errorMessage.set(
          activePreview.warnings[0] ?? 'Add at least one valid catalog SMILES before saving.',
        );
        return;
      }

      from(payloadsToCreate)
        .pipe(
          concatMap((payload: SmileitCatalogEntryCreateParams) =>
            this.jobsApiService.createSmileitCatalogEntry(payload),
          ),
          last(),
        )
        .subscribe({
          next: (catalogEntries: SmileitCatalogEntryView[]) => {
            this.catalogEntries.set(catalogEntries);
            this.refreshBlockCatalogRefsToLatestEntries(catalogEntries);
            this.catalogDraftQueue.set([]);
            if (activePayload !== null) {
              this.resetCatalogForm();
            }
            this.errorMessage.set(null);
          },
          error: (requestError: Error) => {
            this.errorMessage.set(`Unable to create catalog entry: ${requestError.message}`);
          },
        });
      return;
    }

    if (activePreview.name === '' || activePreview.smiles === '') {
      this.errorMessage.set('Persistent catalog entry requires both name and SMILES.');
      return;
    }

    if (activePreview.anchorAtomIndices.length === 0) {
      this.errorMessage.set('Persistent catalog entry requires one anchor atom index.');
      return;
    }

    if (activePreview.categoryKeys.length === 0) {
      this.errorMessage.set('Persistent catalog entry requires at least one chemistry category.');
      return;
    }

    const requestPayload: SmileitCatalogEntryCreateParams = {
      name: activePreview.name,
      smiles: activePreview.smiles,
      anchorAtomIndices: [...activePreview.anchorAtomIndices],
      categoryKeys: [...activePreview.categoryKeys],
      sourceReference: activePreview.sourceReference,
      provenanceMetadata: {},
    };

    const saveRequest: Observable<SmileitCatalogEntryView[]> =
      this.jobsApiService.updateSmileitCatalogEntry(editingStableId, requestPayload);

    saveRequest.subscribe({
      next: (catalogEntries: SmileitCatalogEntryView[]) => {
        this.catalogEntries.set(catalogEntries);
        this.refreshBlockCatalogRefsToLatestEntries(catalogEntries);
        this.resetCatalogForm();
        this.errorMessage.set(null);
      },
      error: (requestError: Error) => {
        const actionLabel: string = editingStableId === null ? 'create' : 'update';
        this.errorMessage.set(`Unable to ${actionLabel} catalog entry: ${requestError.message}`);
      },
    });
  }

  beginCatalogEntryEdition(entry: SmileitCatalogEntryView): void {
    if (!this.isCatalogEntryEditable(entry)) {
      this.errorMessage.set('Seed catalog entries are read-only and cannot be edited from the UI.');
      return;
    }

    this.catalogEditingStableId.set(entry.stable_id);
    this.catalogCreateName.set(entry.name);
    this.catalogCreateSmiles.set(entry.smiles);
    this.catalogCreateAnchorIndicesText.set(String(entry.anchor_atom_indices[0] ?? ''));
    this.catalogCreateCategoryKeys.set([...(entry.categories ?? [])]);
    this.catalogCreateSourceReference.set(entry.source_reference || 'local-lab');
    this.errorMessage.set(null);
  }

  cancelCatalogEdition(): void {
    this.resetCatalogForm();
    this.errorMessage.set(null);
  }

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

  isCatalogEntryReferenced(
    block: SmileitAssignmentBlockDraft,
    catalogEntry: SmileitCatalogEntryView,
  ): boolean {
    return block.catalogRefs.some(
      (entry: SmileitCatalogEntryView) =>
        entry.stable_id === catalogEntry.stable_id && entry.version === catalogEntry.version,
    );
  }

  getAutoCatalogEntriesForBlock(block: SmileitAssignmentBlockDraft): SmileitCatalogEntryView[] {
    if (block.categoryKeys.length === 0) {
      return [];
    }

    const selectedCategories: Set<string> = new Set(block.categoryKeys);
    const matchedEntries: SmileitCatalogEntryView[] = this.catalogEntries().filter(
      (entry: SmileitCatalogEntryView) =>
        (entry.categories ?? []).some((categoryKey: string) => selectedCategories.has(categoryKey)),
    );

    return [...matchedEntries].sort(
      (left: SmileitCatalogEntryView, right: SmileitCatalogEntryView) =>
        left.name.localeCompare(right.name),
    );
  }

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

    return {
      selectedSitesLabel:
        block.siteAtomIndices.length > 0 ? block.siteAtomIndices.join(', ') : 'No covered sites',
      categoriesLabel:
        block.categoryKeys.length > 0 ? block.categoryKeys.join(', ') : 'No category filters',
      catalogSmilesLabel:
        catalogSmilesPreview.length > 0
          ? `${catalogSmilesPreview.length} rendered structure${catalogSmilesPreview.length === 1 ? '' : 's'}`
          : 'No catalog references',
      manualSmilesLabel:
        manualSmilesPreview.length > 0
          ? `${manualSmilesPreview.length} rendered structure${manualSmilesPreview.length === 1 ? '' : 's'}`
          : 'No manual substituents',
      sourceCount:
        block.categoryKeys.length + block.catalogRefs.length + block.manualSubstituents.length,
    };
  }

  createPatternEntry(): void {
    const patternName: string = this.patternCreateName().trim();
    const patternSmarts: string = this.patternCreateSmarts().trim();
    const patternCaption: string = this.patternCreateCaption().trim();

    if (patternName === '' || patternSmarts === '' || patternCaption === '') {
      this.errorMessage.set('Pattern registration requires name, SMARTS and caption.');
      return;
    }

    const requestPayload: SmileitPatternEntryCreateParams = {
      name: patternName,
      smarts: patternSmarts,
      patternType: this.patternCreateType(),
      caption: patternCaption,
      sourceReference: this.patternCreateSourceReference().trim() || 'local-lab',
      provenanceMetadata: {},
    };

    this.jobsApiService.createSmileitPatternEntry(requestPayload).subscribe({
      next: (patterns: SmileitPatternEntryView[]) => {
        this.patterns.set(patterns);
        this.patternCreateName.set('');
        this.patternCreateSmarts.set('');
        this.patternCreateCaption.set('');
        this.patternCreateType.set(PatternTypeEnum.Toxicophore);
        this.patternCreateSourceReference.set('local-lab');
        this.errorMessage.set(null);
      },
      error: (requestError: Error) => {
        this.errorMessage.set(`Unable to create structural pattern: ${requestError.message}`);
      },
    });
  }

  setRSubstitutes(rawValue: number): void {
    this.rSubstitutes.set(Math.max(1, Math.min(10, Math.trunc(rawValue))));
  }

  setNumBonds(rawValue: number): void {
    void rawValue;
    this.numBonds.set(1);
  }

  setMaxStructures(rawValue: number): void {
    this.maxStructures.set(Math.max(0, Math.trunc(rawValue)));
  }

  setExportPadding(rawValue: number): void {
    void rawValue;
    this.exportPadding.set(5);
  }

  dispatch(): void {
    if (!this.canDispatch()) {
      this.activeSection.set('error');
      this.errorMessage.set(
        'Every selected site must be covered by at least one effective Smile-it assignment block before dispatch.',
      );
      return;
    }

    this.progressSubscription?.unsubscribe();
    this.logsSubscription?.unsubscribe();

    this.activeSection.set('dispatching');
    this.errorMessage.set(null);
    this.exportErrorMessage.set(null);
    this.resultData.set(null);
    this.progressSnapshot.set(null);
    this.jobLogs.set([]);
    this.currentJobId.set(null);

    const dispatchParams: SmileitGenerationParams = this.buildDispatchParams();

    this.jobsApiService.dispatchSmileitJob(dispatchParams).subscribe({
      next: (jobResponse: SmileitJobResponseView) => {
        this.currentJobId.set(jobResponse.id);

        if (jobResponse.status === 'completed') {
          const immediateResultData: SmileitResultData | null = this.extractResultData(jobResponse);
          if (immediateResultData === null) {
            this.activeSection.set('error');
            this.errorMessage.set('Completed job payload is invalid for Smileit result rendering.');
            return;
          }

          this.resultData.set(immediateResultData);
          this.loadHistoricalLogs(jobResponse.id);
          this.activeSection.set('result');
          this.loadHistory();
          return;
        }

        this.activeSection.set('progress');
        this.startProgressStream(jobResponse.id);
      },
      error: (dispatchError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to create Smileit job: ${dispatchError.message}`);
      },
    });
  }

  reset(): void {
    this.progressSubscription?.unsubscribe();
    this.logsSubscription?.unsubscribe();

    this.activeSection.set('idle');
    this.currentJobId.set(null);
    this.progressSnapshot.set(null);
    this.jobLogs.set([]);
    this.resultData.set(null);
    this.errorMessage.set(null);
    this.exportErrorMessage.set(null);
  }

  openHistoricalJob(jobId: string): void {
    this.progressSubscription?.unsubscribe();
    this.logsSubscription?.unsubscribe();

    this.activeSection.set('dispatching');
    this.errorMessage.set(null);
    this.exportErrorMessage.set(null);
    this.currentJobId.set(jobId);
    this.jobLogs.set([]);

    this.jobsApiService.getSmileitJobStatus(jobId).subscribe({
      next: (jobResponse: SmileitJobResponseView) => {
        if (jobResponse.status === 'failed') {
          this.loadHistoricalLogs(jobId);
          this.activeSection.set('error');
          this.errorMessage.set(
            jobResponse.error_trace ?? 'Historical Smileit job ended with error.',
          );
          return;
        }

        const historicalData: SmileitResultData | null =
          this.extractResultData(jobResponse) ?? this.extractSummaryData(jobResponse);

        if (historicalData === null) {
          this.activeSection.set('error');
          this.errorMessage.set('Unable to reconstruct historical Smileit result.');
          return;
        }

        this.resultData.set(historicalData);
        this.loadHistoricalLogs(jobId);
        this.activeSection.set('result');
      },
      error: (statusError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to recover Smileit historical job: ${statusError.message}`);
      },
    });
  }

  loadHistory(): void {
    this.isHistoryLoading.set(true);

    this.jobsApiService.listJobs({ pluginName: 'smileit' }).subscribe({
      next: (jobItems: ScientificJobView[]) => {
        const orderedJobs: ScientificJobView[] = [...jobItems].sort(
          (leftJob: ScientificJobView, rightJob: ScientificJobView) =>
            new Date(rightJob.updated_at).getTime() - new Date(leftJob.updated_at).getTime(),
        );
        this.historyJobs.set(orderedJobs);
        this.isHistoryLoading.set(false);
      },
      error: () => {
        this.isHistoryLoading.set(false);
      },
    });
  }

  downloadCsvReport(): Observable<DownloadedReportFile> {
    return this.downloadCurrentReport(
      (jobId: string) => this.jobsApiService.downloadSmileitCsvReport(jobId),
      'CSV',
    );
  }

  downloadSmilesReport(): Observable<DownloadedReportFile> {
    return this.downloadCurrentReport(
      (jobId: string) => this.jobsApiService.downloadSmileitSmilesReport(jobId),
      'SMILES',
    );
  }

  downloadTraceabilityReport(): Observable<DownloadedReportFile> {
    return this.downloadCurrentReport(
      (jobId: string) => this.jobsApiService.downloadSmileitTraceabilityReport(jobId),
      'traceability',
    );
  }

  downloadLogReport(): Observable<DownloadedReportFile> {
    return this.downloadCurrentReport(
      (jobId: string) => this.jobsApiService.downloadSmileitLogReport(jobId),
      'LOG',
    );
  }

  downloadErrorReport(): Observable<DownloadedReportFile> {
    return this.downloadCurrentReport(
      (jobId: string) => this.jobsApiService.downloadSmileitErrorReport(jobId),
      'error',
    );
  }

  ngOnDestroy(): void {
    this.progressSubscription?.unsubscribe();
    this.logsSubscription?.unsubscribe();
  }

  private downloadCurrentReport(
    downloadFactory: (jobId: string) => Observable<DownloadedReportFile>,
    reportLabel: string,
  ): Observable<DownloadedReportFile> {
    const selectedJobId: string | null = this.currentJobId();
    if (selectedJobId === null || selectedJobId.trim() === '') {
      throw new Error(`No Smileit job selected for ${reportLabel} export.`);
    }

    this.exportErrorMessage.set(null);
    this.isExporting.set(true);

    return downloadFactory(selectedJobId).pipe(
      finalize(() => this.isExporting.set(false)),
      catchError((requestError: unknown) => {
        const normalizedErrorMessage: string =
          requestError instanceof Error
            ? requestError.message
            : `Unknown error while downloading Smileit ${reportLabel} report.`;
        this.exportErrorMessage.set(
          `Unable to download ${reportLabel} report: ${normalizedErrorMessage}`,
        );
        return throwError(() => requestError);
      }),
    );
  }

  private buildDispatchParams(): SmileitGenerationParams {
    return {
      principalSmiles: this.principalSmiles().trim(),
      selectedAtomIndices: [...this.selectedAtomIndices()],
      assignmentBlocks: this.assignmentBlocks().map(
        (block: SmileitAssignmentBlockDraft): SmileitAssignmentBlockParams => ({
          label: block.label.trim() || 'Unnamed block',
          siteAtomIndices: block.siteAtomIndices,
          categoryKeys: [...block.categoryKeys],
          substituentRefs: block.catalogRefs.map((entry: SmileitCatalogEntryView) => ({
            stableId: entry.stable_id,
            version: entry.version,
          })),
          manualSubstituents: block.manualSubstituents.map(
            (entry: SmileitManualSubstituentDraft): SmileitManualSubstituentParams => ({
              name: entry.name,
              smiles: entry.smiles,
              anchorAtomIndices: entry.anchorAtomIndices,
              categories: [...entry.categories],
              sourceReference: entry.sourceReference,
              provenanceMetadata: entry.provenanceMetadata,
            }),
          ),
        }),
      ),
      siteOverlapPolicy: SiteOverlapPolicyEnum.LastBlockWins,
      rSubstitutes: this.rSubstitutes(),
      numBonds: 1,
      allowRepeated: this.allowRepeated(),
      maxStructures: this.maxStructures(),
      exportNameBase: this.exportNameBase().trim() || 'smileit_run',
      exportPadding: 5,
      version: '2.0.0',
    };
  }

  private startProgressStream(jobId: string): void {
    this.startLogsStream(jobId);

    this.progressSubscription = this.jobsApiService.streamJobEvents(jobId).subscribe({
      next: (snapshot: JobProgressSnapshotView) => this.progressSnapshot.set(snapshot),
      complete: () => this.fetchFinalResult(jobId),
      error: () => this.startPollingFallback(jobId),
    });
  }

  private startLogsStream(jobId: string): void {
    this.logsSubscription?.unsubscribe();

    this.logsSubscription = this.jobsApiService.streamJobLogEvents(jobId).subscribe({
      next: (logEntry: JobLogEntryView) => {
        this.jobLogs.update((currentLogs: JobLogEntryView[]) => {
          if (
            currentLogs.some((item: JobLogEntryView) => item.eventIndex === logEntry.eventIndex)
          ) {
            return currentLogs;
          }

          return [...currentLogs, logEntry].sort(
            (leftEntry: JobLogEntryView, rightEntry: JobLogEntryView) =>
              leftEntry.eventIndex - rightEntry.eventIndex,
          );
        });
      },
      error: () => {
        // Mantener funcional la UI incluso si falla la suscripción SSE de logs.
      },
    });
  }

  private loadHistoricalLogs(jobId: string): void {
    this.jobsApiService.getJobLogs(jobId, { limit: 250 }).subscribe({
      next: (logsPage: JobLogsPageView) => this.jobLogs.set(logsPage.results),
      error: () => {
        // Si falla la carga de logs históricos, el resultado principal sigue visible.
      },
    });
  }

  private startPollingFallback(jobId: string): void {
    this.progressSubscription = this.jobsApiService.pollJobUntilCompleted(jobId, 1000).subscribe({
      next: (snapshot: JobProgressSnapshotView) => {
        this.progressSnapshot.set(snapshot);
        this.fetchFinalResult(jobId);
      },
      error: (pollingError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to track Smileit progress: ${pollingError.message}`);
      },
    });
  }

  private fetchFinalResult(jobId: string): void {
    this.jobsApiService.getSmileitJobStatus(jobId).subscribe({
      next: (jobResponse: SmileitJobResponseView) => {
        if (jobResponse.status === 'failed') {
          this.loadHistoricalLogs(jobId);
          this.activeSection.set('error');
          this.errorMessage.set(jobResponse.error_trace ?? 'Smileit job ended without details.');
          this.loadHistory();
          return;
        }

        const finalData: SmileitResultData | null =
          this.extractResultData(jobResponse) ?? this.extractSummaryData(jobResponse);

        if (finalData === null) {
          this.activeSection.set('error');
          this.errorMessage.set('Unable to parse Smileit final result payload.');
          this.loadHistory();
          return;
        }

        this.resultData.set(finalData);
        this.loadHistoricalLogs(jobId);
        this.activeSection.set('result');
        this.loadHistory();
      },
      error: (resultError: Error) => {
        this.activeSection.set('error');
        this.errorMessage.set(`Unable to retrieve Smileit final result: ${resultError.message}`);
        this.loadHistory();
      },
    });
  }

  private extractResultData(jobResponse: SmileitJobResponseView): SmileitResultData | null {
    const rawResult = jobResponse.results;
    if (rawResult === null || rawResult === undefined) {
      return null;
    }

    return {
      totalGenerated: rawResult.total_generated,
      generatedStructures: (rawResult.generated_structures ?? []).map((structureItem, index) => {
        const normalizedName: string = structureItem.name.trim();
        return {
          name: normalizedName === '' ? `Generated molecule ${index + 1}` : normalizedName,
          smiles: structureItem.smiles,
          svg: structureItem.svg,
          traceability: structureItem.traceability ?? [],
        };
      }),
      truncated: rawResult.truncated ?? false,
      principalSmiles: rawResult.principal_smiles,
      selectedAtomIndices: rawResult.selected_atom_indices,
      assignmentBlocks: jobResponse.parameters.assignment_blocks ?? [],
      traceabilityRows: rawResult.traceability_rows ?? [],
      exportNameBase:
        rawResult.export_name_base ?? jobResponse.parameters.export_name_base ?? 'SMILEIT',
      exportPadding: rawResult.export_padding ?? jobResponse.parameters.export_padding ?? 5,
      references: (rawResult.references ?? jobResponse.parameters.references ?? {}) as Record<
        string,
        Array<Record<string, unknown>>
      >,
      isHistoricalSummary: false,
      summaryMessage: null,
    };
  }

  private extractSummaryData(jobResponse: SmileitJobResponseView): SmileitResultData | null {
    const rawParameters = jobResponse.parameters;
    if (rawParameters === null || rawParameters === undefined) {
      return null;
    }

    return {
      totalGenerated: 0,
      generatedStructures: [],
      truncated: false,
      principalSmiles: rawParameters.principal_smiles,
      selectedAtomIndices: rawParameters.selected_atom_indices,
      assignmentBlocks: rawParameters.assignment_blocks ?? [],
      traceabilityRows: [],
      exportNameBase: rawParameters.export_name_base ?? 'SMILEIT',
      exportPadding: rawParameters.export_padding ?? 5,
      references: (rawParameters.references ?? {}) as Record<
        string,
        Array<Record<string, unknown>>
      >,
      isHistoricalSummary: true,
      summaryMessage: `Historical job status: ${jobResponse.status}. Final structures are not available in this snapshot.`,
    };
  }

  private resetCatalogForm(): void {
    this.catalogCreateName.set('');
    this.catalogCreateSmiles.set('');
    this.catalogCreateAnchorIndicesText.set('');
    this.catalogCreateCategoryKeys.set([]);
    this.catalogCreateSourceReference.set('local-lab');
    this.catalogEditingStableId.set(null);
  }

  private resetCatalogDraftAfterStage(): void {
    this.catalogCreateSmiles.set('');
    this.catalogCreateAnchorIndicesText.set('');
    this.catalogEditingStableId.set(null);
  }

  private parseSingleAnchorIndexInput(rawText: string): number[] {
    return this.parseAtomIndicesInput(rawText).slice(0, 1);
  }

  private refreshBlockCatalogRefsToLatestEntries(
    catalogEntries: SmileitCatalogEntryView[] = this.catalogEntries(),
  ): void {
    const latestByStableId: Map<string, SmileitCatalogEntryView> = new Map(
      catalogEntries.map((entry: SmileitCatalogEntryView) => [entry.stable_id, entry]),
    );

    this.assignmentBlocks.update((currentBlocks: SmileitAssignmentBlockDraft[]) =>
      currentBlocks.map((block: SmileitAssignmentBlockDraft) => {
        const dedupeTracker: Set<string> = new Set();
        const normalizedRefs: SmileitCatalogEntryView[] = block.catalogRefs
          .map((entry: SmileitCatalogEntryView) => latestByStableId.get(entry.stable_id) ?? entry)
          .filter((entry: SmileitCatalogEntryView) => {
            const dedupeKey: string = `${entry.stable_id}::${entry.version}`;
            if (dedupeTracker.has(dedupeKey)) {
              return false;
            }
            dedupeTracker.add(dedupeKey);
            return true;
          });

        return {
          ...block,
          catalogRefs: normalizedRefs,
        };
      }),
    );
  }

  private buildCatalogGroups(
    catalogEntries: SmileitCatalogEntryView[],
    categories: SmileitCategoryView[],
  ): SmileitCatalogGroupView[] {
    const categoryNameByKey: Map<string, string> = new Map(
      categories.map((category: SmileitCategoryView) => [category.key, category.name]),
    );
    const groupedEntries: Map<string, SmileitCatalogGroupView> = new Map();

    catalogEntries.forEach((entry: SmileitCatalogEntryView) => {
      const entryCategoryKeys: string[] = entry.categories ?? [];
      const entryCategories: string[] =
        entryCategoryKeys.length > 0 ? entryCategoryKeys : ['uncategorized'];

      entryCategories.forEach((categoryKey: string) => {
        const groupKey: string = categoryKey;
        const groupName: string =
          categoryKey === 'uncategorized'
            ? 'Uncategorized'
            : (categoryNameByKey.get(categoryKey) ?? categoryKey);

        const existingGroup: SmileitCatalogGroupView | undefined = groupedEntries.get(groupKey);
        if (existingGroup === undefined) {
          groupedEntries.set(groupKey, {
            key: groupKey,
            name: groupName,
            entries: [entry],
          });
          return;
        }

        existingGroup.entries.push(entry);
      });
    });

    return [...groupedEntries.values()]
      .map((group: SmileitCatalogGroupView) => ({
        ...group,
        entries: [...group.entries].sort(
          (left: SmileitCatalogEntryView, right: SmileitCatalogEntryView) =>
            left.name.localeCompare(right.name),
        ),
      }))
      .sort((left: SmileitCatalogGroupView, right: SmileitCatalogGroupView) =>
        left.name.localeCompare(right.name),
      );
  }

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

  private pruneBlocksToSelectedSites(): void {
    const selectedSet: Set<number> = new Set(this.selectedAtomIndices());
    this.assignmentBlocks.update((currentBlocks: SmileitAssignmentBlockDraft[]) =>
      currentBlocks.map((block: SmileitAssignmentBlockDraft) => ({
        ...block,
        siteAtomIndices: block.siteAtomIndices.filter((atomIndex: number) =>
          selectedSet.has(atomIndex),
        ),
      })),
    );
  }

  private updateBlock(
    blockId: string,
    updater: (block: SmileitAssignmentBlockDraft) => SmileitAssignmentBlockDraft,
  ): void {
    this.assignmentBlocks.update((currentBlocks: SmileitAssignmentBlockDraft[]) =>
      currentBlocks.map((block: SmileitAssignmentBlockDraft) =>
        block.id === blockId ? updater(block) : block,
      ),
    );
  }

  private buildEffectiveCoverage(
    selectedSites: number[],
    blocks: SmileitAssignmentBlockDraft[],
  ): SmileitSiteCoverageView[] {
    const selectedSiteSet: Set<number> = new Set(selectedSites);
    const coverageMap: Map<number, SmileitSiteCoverageView> = new Map();

    blocks.forEach((block: SmileitAssignmentBlockDraft, index: number) => {
      const sourceCount: number =
        block.categoryKeys.length + block.catalogRefs.length + block.manualSubstituents.length;
      if (sourceCount === 0) {
        return;
      }

      block.siteAtomIndices.forEach((siteAtomIndex: number) => {
        if (!selectedSiteSet.has(siteAtomIndex)) {
          return;
        }

        coverageMap.set(siteAtomIndex, {
          siteAtomIndex,
          blockId: block.id,
          blockLabel: block.label.trim() || `Block ${index + 1}`,
          priority: index + 1,
          sourceCount,
        });
      });
    });

    return [...coverageMap.values()].sort(
      (left: SmileitSiteCoverageView, right: SmileitSiteCoverageView) =>
        left.siteAtomIndex - right.siteAtomIndex,
    );
  }

  private parseAtomIndicesInput(rawValue: string): number[] {
    return rawValue
      .split(',')
      .map((token: string) => Number(token.trim()))
      .filter((token: number) => Number.isInteger(token) && token >= 0)
      .filter((token: number, index: number, items: number[]) => items.indexOf(token) === index)
      .sort((left: number, right: number) => left - right);
  }

  private toggleString(currentValues: string[], nextValue: string): string[] {
    return currentValues.includes(nextValue)
      ? currentValues.filter((item: string) => item !== nextValue)
      : [...currentValues, nextValue].sort((left: string, right: string) =>
          left.localeCompare(right),
        );
  }

  private detectChemicalNotation(rawChemicalText: string): SmileitChemicalNotationKind {
    const normalizedText: string = rawChemicalText.trim();
    if (normalizedText === '') {
      return 'empty';
    }

    // Heurística simple para advertir entrada SMARTS en formularios que exigen SMILES.
    const smartsMarkers: RegExp = /\*|;|\$\(|!|\[\$|\?\]|\(\?\)/;
    return smartsMarkers.test(normalizedText) ? 'smarts' : 'smiles';
  }
}
