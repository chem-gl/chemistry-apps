// smileit-workflow-state.service.ts: Estado centralizado del workflow Smileit.
// Todos los signals y computed compartidos por los sub-servicios (catálogo, bloques, fachada).
// Ningún sub-servicio define signals propios; todos leen/escriben a través de esta única fuente.

import { Injectable, computed, inject, signal } from '@angular/core';
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

import { JobProgressTextService } from '../job-progress-text.service';
import {
  ProgressTextSource,
  UNTRANSLATED_PROGRESS_TEXT,
} from '../progress-stage-messages';

import {
  buildCatalogGroups,
  buildEffectiveCoverage,
  COMBINATORIAL_HARD_LIMIT,
  COMBINATORIAL_WARNING_THRESHOLD,
  detectChemicalNotation,
  estimateCombinatorialTotal,
  parseSingleAnchorIndexInput,
} from './smileit-workflow.utils';

/** Mensaje propio de Smile-it mientras el snapshot no aporta un stage traducible. */
const SMILEIT_DEFAULT_PROGRESS_MESSAGE = 'Preparing Smileit generation...';

@Injectable()
export class SmileitWorkflowState {
  /**
   * Resolutor del texto de progreso. Es opcional porque en SSR y en los inyectores planos de
   * prueba no hay catálogo i18n: en ese caso se conserva el mensaje del backend.
   */
  private readonly progressText: ProgressTextSource =
    inject(JobProgressTextService, { optional: true }) ?? UNTRANSLATED_PROGRESS_TEXT;

  // ── Estructura principal ──────────────────────────────────────────────
  readonly principalSmiles = signal<string>('c1(O)c(NCCC=C)c2c([nH]cc2)c([N+](=O)[O-])c1O');
  readonly inspection = signal<SmileitStructureInspectionView | null>(null);
  /**
   * SMILES con el que se obtuvo la última inspección.
   *
   * Los índices de sitio viven en el espacio atómico canónico que devuelve
   * /inspect-structure; para despachar hay que enviar ese mismo canónico y no el
   * texto crudo del usuario, o el backend remapearía los índices dos veces.
   */
  readonly inspectedPrincipalSmiles = signal<string>('');
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
  readonly patternEditingStableId = signal<string | null>(null);

  // ── Parámetros de generación ──────────────────────────────────────────
  readonly siteOverlapPolicy = signal<SiteOverlapPolicyEnum>(SiteOverlapPolicyEnum.LastBlockWins);
  readonly rSubstitutes = signal<number>(1);
  readonly numBonds = signal<number>(1);
  readonly exportNameBase = signal<string>('smileit_run');
  readonly exportPadding = signal<number>(5);

  // ── Estado de ejecución ───────────────────────────────────────────────
  readonly activeSection = signal<SmileitSection>('idle');
  readonly currentJobId = signal<string | null>(null);
  readonly selectedHistoricalJobId = signal<string | null>(null);
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
  /**
   * Mensaje de progreso visible. Se deriva del stage machine-readable del snapshot porque el
   * backend redacta `progress_message` en español: sin este filtro la UI en inglés mostraría
   * texto sin traducir.
   */
  readonly progressMessage = computed(() =>
    this.progressText.resolve(this.progressSnapshot(), SMILEIT_DEFAULT_PROGRESS_MESSAGE),
  );

  // ── Computed: bloques y cobertura ─────────────────────────────────────
  readonly selectedSiteCoverage = computed<SmileitSiteCoverageView[]>(() =>
    buildEffectiveCoverage(this.selectedAtomIndices(), this.assignmentBlocks()),
  );

  /**
   * Sitios seleccionados que sí admiten sustituyentes (valencia libre).
   *
   * Los índices llegan del endpoint de inspección, que ya marca cada átomo con
   * `isSubstitutable`. Seleccionar un carbono de fusión o un nitrógeno cuaternario
   * saturaba la generación: `r_substitutes` no cambiaba el número de derivados.
   */
  readonly substitutableSelectedSites = computed<number[]>(() => {
    const inspectionResult: SmileitStructureInspectionView | null = this.inspection();
    if (inspectionResult === null) {
      return [...this.selectedAtomIndices()];
    }

    const substitutableByIndex: Map<number, boolean> = new Map(
      inspectionResult.atoms.map((atom) => [atom.index, atom.isSubstitutable]),
    );
    return this.selectedAtomIndices().filter(
      (atomIndex: number) => substitutableByIndex.get(atomIndex) !== false,
    );
  });

  /** Sitios seleccionados que nunca admitirán sustituyentes (aviso en la UI). */
  readonly nonSubstitutableSelectedSites = computed<number[]>(() => {
    const substitutableSites: Set<number> = new Set(this.substitutableSelectedSites());
    return this.selectedAtomIndices().filter(
      (atomIndex: number) => !substitutableSites.has(atomIndex),
    );
  });

  /** SMILES principal normalizado (trim) para comparaciones internas. */
  private readonly currentPrincipalTrimmed = computed<string>(() =>
    this.principalSmiles().trim(),
  );

  /**
   * `principal_smiles` que debe viajar al backend.
   *
   * Si la inspección corresponde al SMILES actual se envía el canónico (mismo
   * espacio atómico que `selectedAtomIndices`); si el usuario editó el SMILES
   * después de inspeccionar, la selección quedó obsoleta y `dispatch` lo bloquea.
   */
  readonly dispatchPrincipalSmiles = computed<string>(() => {
    const inspectionResult: SmileitStructureInspectionView | null = this.inspection();
    if (inspectionResult !== null && !this.hasStaleInspection()) {
      return inspectionResult.canonicalSmiles;
    }
    return this.currentPrincipalTrimmed();
  });

  /** True cuando hay inspección cargada pero corresponde a otro SMILES. */
  readonly hasStaleInspection = computed<boolean>(
    () =>
      this.inspection() !== null &&
      this.inspectedPrincipalSmiles() !== this.currentPrincipalTrimmed(),
  );

  /**
   * Sitios seleccionados que aún no están asignados a ningún bloque.
   * La cobertura "efectiva" (con sustituyentes) se mide aparte en
   * `selectedSiteCoverage`, para que asignar un sitio no dependa del catálogo.
   */
  readonly uncoveredSelectedSites = computed<number[]>(() => {
    const assignedSites: Set<number> = new Set(
      this.assignmentBlocks().flatMap((block: SmileitAssignmentBlockDraft) => block.siteAtomIndices),
    );
    return this.selectedAtomIndices().filter((atomIndex: number) => !assignedSites.has(atomIndex));
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

  /**
   * Estimación de derivados generables (misma fórmula que el backend):
   * suma de los coeficientes elementales simétricos e_k(opciones por sitio)
   * para k = 1..r. Es una cota superior de moléculas distintas (el generador
   * deduplica por SMILES canónico; los intentos de fusión son hasta r!× esa cifra).
   * Solo se usa para avisar/bloquear; el backend es la fuente de verdad.
   */
  readonly estimatedDerivatives = computed<number>(() => {
    const optionCountBySite: Map<number, number> = new Map();
    this.assignmentBlocks().forEach((block: SmileitAssignmentBlockDraft) => {
      const directOptions: number = block.catalogRefs.length + block.manualSubstituents.length;
      const categoryOptions: number = block.categoryKeys.reduce(
        (total: number, categoryKey: string) =>
          total +
          this.catalogEntries().filter((entry) =>
            (entry.categories ?? []).includes(categoryKey),
          ).length,
        0,
      );
      const blockOptions: number = directOptions + categoryOptions;
      block.siteAtomIndices.forEach((siteAtomIndex: number) => {
        const previousOptions: number = optionCountBySite.get(siteAtomIndex) ?? 0;
        optionCountBySite.set(siteAtomIndex, Math.max(previousOptions, blockOptions));
      });
    });

    return estimateCombinatorialTotal(
      Array.from(optionCountBySite.values()).filter((options: number) => options > 0),
      this.rSubstitutes(),
    );
  });

  readonly showsCombinatorialWarning = computed<boolean>(
    () => this.estimatedDerivatives() > COMBINATORIAL_WARNING_THRESHOLD,
  );

  readonly exceedsHardLimit = computed<boolean>(
    () => this.estimatedDerivatives() > COMBINATORIAL_HARD_LIMIT,
  );

  readonly canDispatch = computed(
    () =>
      this.canConfigureGeneration() &&
      !this.isProcessing() &&
      !this.exceedsHardLimit() &&
      !this.hasStaleInspection(),
  );

  readonly maxRSubstitutesByPositions = computed<number>(() => {
    const numSubstitutablePositions: number = this.substitutableSelectedSites().length;
    const MAX_R_SUBSTITUTES_HARD_LIMIT: number = 10;
    return Math.min(numSubstitutablePositions, MAX_R_SUBSTITUTES_HARD_LIMIT);
  });

  // ── Computed: catálogo ────────────────────────────────────────────────
  readonly isCatalogEditing = computed(() => this.catalogEditingStableId() !== null);
  readonly isPatternEditing = computed(() => this.patternEditingStableId() !== null);
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
