// smileit-workflow-state.service.ts: Estado centralizado del workflow Smileit.
// Todos los signals y computed compartidos por los sub-servicios (catálogo, bloques, fachada).
// Ningún sub-servicio define signals propios; todos leen/escriben a través de esta única fuente.

import { Injectable, computed, signal } from '@angular/core';
import { PatternTypeEnum, SiteOverlapPolicyEnum } from '../../api/generated';
import type {
    JobLogEntryView,
    JobProgressSnapshotView,
    ScientificJobView,
    SmileitCatalogEntryView,
    SmileitCategoryView,
    SmileitPatternEntryView,
    SmileitQuickPropertiesView,
    SmileitStructureInspectionView,
} from '../../api/jobs-api.service';

import type {
    SmileitAssignmentBlockDraft,
    SmileitCatalogDraftPreview,
    SmileitCatalogGroupView,
    SmileitCatalogQueuedDraft,
    SmileitChemicalNotationKind,
    SmileitResultData,
    SmileitSection,
    SmileitSiteCoverageView,
} from './smileit-workflow.types';

import {
    buildCatalogGroups,
    buildEffectiveCoverage,
    detectChemicalNotation,
    parseSingleAnchorIndexInput,
} from './smileit-workflow.utils';

@Injectable()
export class SmileitWorkflowState {
  // ── Estructura principal ──────────────────────────────────────────────
  readonly principalSmiles = signal<string>('c1(O)c(NCCC=C)c2c([nH]cc2)c([N+](=O)[O-])c1O');
  readonly inspection = signal<SmileitStructureInspectionView | null>(null);
  readonly selectedAtomIndices = signal<number[]>([]);

  // ── Datos de referencia ───────────────────────────────────────────────
  readonly catalogEntries = signal<SmileitCatalogEntryView[]>([]);
  readonly categories = signal<SmileitCategoryView[]>([]);
  readonly patterns = signal<SmileitPatternEntryView[]>([]);
  readonly assignmentBlocks = signal<SmileitAssignmentBlockDraft[]>([]);

  // ── Borrador de catálogo ──────────────────────────────────────────────
  readonly catalogCreateName = signal<string>('');
  readonly catalogCreateSmiles = signal<string>('');
  readonly catalogCreateAnchorIndicesText = signal<string>('');
  readonly catalogCreateCategoryKeys = signal<string[]>([]);
  readonly catalogCreateSourceReference = signal<string>('local-lab');
  readonly catalogEditingStableId = signal<string | null>(null);
  readonly catalogDraftQueue = signal<SmileitCatalogQueuedDraft[]>([]);

  // ── Borrador de patrón ────────────────────────────────────────────────
  readonly patternCreateName = signal<string>('');
  readonly patternCreateSmarts = signal<string>('');
  readonly patternCreateType = signal<PatternTypeEnum>(PatternTypeEnum.Toxicophore);
  readonly patternCreateCaption = signal<string>('');
  readonly patternCreateSourceReference = signal<string>('local-lab');

  // ── Parámetros de generación ──────────────────────────────────────────
  readonly siteOverlapPolicy = signal<SiteOverlapPolicyEnum>(SiteOverlapPolicyEnum.LastBlockWins);
  readonly rSubstitutes = signal<number>(1);
  readonly numBonds = signal<number>(1);
  readonly maxStructures = signal<number>(0);
  readonly exportNameBase = signal<string>('smileit_run');
  readonly exportPadding = signal<number>(5);

  // ── Estado de ejecución ───────────────────────────────────────────────
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

  // ── Computed: ejecución ───────────────────────────────────────────────
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

  // ── Computed: bloques y cobertura ─────────────────────────────────────
  readonly selectedSiteCoverage = computed<SmileitSiteCoverageView[]>(() =>
    buildEffectiveCoverage(this.selectedAtomIndices(), this.assignmentBlocks()),
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

  readonly canDispatch = computed(() => this.canConfigureGeneration() && !this.isProcessing());

  readonly maxRSubstitutesByPositions = computed<number>(() => {
    const numSelectedPositions: number = this.selectedAtomIndices().length;
    const MAX_R_SUBSTITUTES_HARD_LIMIT: number = 10;
    return Math.min(numSelectedPositions, MAX_R_SUBSTITUTES_HARD_LIMIT);
  });

  // ── Computed: catálogo ────────────────────────────────────────────────
  readonly isCatalogEditing = computed(() => this.catalogEditingStableId() !== null);
  readonly hasQueuedCatalogDrafts = computed(() => this.catalogDraftQueue().length > 0);

  readonly catalogGroups = computed<SmileitCatalogGroupView[]>(() =>
    buildCatalogGroups(this.catalogEntries(), this.categories()),
  );

  readonly catalogDraftPreview = computed<SmileitCatalogDraftPreview>(() => {
    const currentName: string = this.catalogCreateName().trim();
    const currentSmiles: string = this.catalogCreateSmiles().trim();
    const parsedAnchorIndices: number[] = parseSingleAnchorIndexInput(
      this.catalogCreateAnchorIndicesText(),
    );
    const notationKind: SmileitChemicalNotationKind = detectChemicalNotation(currentSmiles);
    const selectedCategoryKeys: string[] = this.catalogCreateCategoryKeys();
    const categoryNameByKey: Map<string, string> = new Map(
      this.categories().map((category: SmileitCategoryView) => [category.key, category.name]),
    );
    const warnings: string[] = [];

    if (currentName === '') {
      warnings.push('Substituent name is required.');
    }
    if (currentSmiles === '') {
      warnings.push('SMILES is required.');
    }
    if (notationKind === 'smarts') {
      warnings.push(
        'Catalog entries require SMILES notation. Use the Structural pattern catalog for SMARTS.',
      );
    }
    if (parsedAnchorIndices.length === 0) {
      warnings.push('One anchor atom index is required.');
    }

    const resolvedCategoryNames: string[] =
      selectedCategoryKeys.length > 0
        ? selectedCategoryKeys.map(
            (categoryKey: string) => categoryNameByKey.get(categoryKey) ?? categoryKey,
          )
        : ['Uncategorized'];

    return {
      name: currentName,
      smiles: currentSmiles,
      sourceReference: this.catalogCreateSourceReference().trim() || 'local-lab',
      anchorAtomIndices: parsedAnchorIndices,
      categoryKeys: selectedCategoryKeys,
      categoryNames: resolvedCategoryNames,
      notationKind,
      warnings,
      isReady:
        currentName !== '' &&
        currentSmiles !== '' &&
        notationKind !== 'smarts' &&
        parsedAnchorIndices.length > 0,
    };
  });
}
