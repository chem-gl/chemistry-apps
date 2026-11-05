// smileit.component.ts: Pantalla principal de Smile-it con bloques de asignación, análisis medicinal y exportes reproducibles.

import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  Injector,
  OnDestroy,
  OnInit,
  ViewChild,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { JobAccessModeService } from '../core/auth/job-access-mode.service';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Subscription } from 'rxjs';
import {
  JobLogEntryView,
  JobsApiService,
  SmileitCatalogEntryView,
  SmileitPatternEntryView,
  SmileitStructureInspectionView,
  SmileitStructuralAnnotationView,
} from '../core/api/jobs-api.service';
import {
  AnnotationLegendGroupView,
  PRIVILEGED_CATEGORY_KEY,
  RISK_CATEGORY_KEYS,
  RiskCategoryGroupView,
  RiskCategoryKey,
  resolveAnnotationRiskCategory,
  resolvePatternRiskCategory,
  riskCategoryColor,
} from './smileit-risk.utils';
import {
  SmileitAssignmentBlockDraft,
  SmileitBlockWorkflowService,
  SmileitCatalogWorkflowService,
  SmileitWorkflowService,
  SmileitWorkflowState,
} from '../core/application/smileit-workflow.service';
import { BlockAssignmentPanelComponent } from './block-assignment-panel/block-assignment-panel.component';
import { CatalogPanelComponent } from './catalog-panel/catalog-panel.component';
import { SmileitInspectionService } from './core/services/smileit-inspection.service';
import { GenerationResultPanelComponent } from './generation-result-panel/generation-result-panel.component';
import { LibraryEntryDetailDialogComponent } from './library-entry-detail-dialog/library-entry-detail-dialog.component';
import { PrincipalMoleculeEditorModule } from './principal-molecule/principal-molecule-editor.module';
import { PrincipalSvgViewerModule } from './principal-visualizer/principal-svg-viewer.module';
import { ScientificAppHeaderComponent } from '../core/shared/components/scientific-app-header/scientific-app-header.component';
import { ScientificDocPanelComponent } from '../core/shared/components/scientific-doc-panel/scientific-doc-panel.component';
import { SMILEIT_DOC_TABS } from './smileit-doc-content';

@Component({
  selector: 'app-smileit',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslocoPipe,
    PrincipalMoleculeEditorModule,
    PrincipalSvgViewerModule,
    CatalogPanelComponent,
    BlockAssignmentPanelComponent,
    GenerationResultPanelComponent,
    LibraryEntryDetailDialogComponent,
    ScientificAppHeaderComponent,
    ScientificDocPanelComponent,
  ],
  encapsulation: ViewEncapsulation.None,
  providers: [
    SmileitWorkflowState,
    SmileitCatalogWorkflowService,
    SmileitBlockWorkflowService,
    SmileitWorkflowService,
  ],
  templateUrl: './smileit.component.html',
  styleUrl: './smileit.component.scss',
})
export class SmileitComponent implements OnInit, OnDestroy {
  readonly workflow = inject(SmileitWorkflowService);
  private readonly inspectionService = inject(SmileitInspectionService);
  private readonly injector = inject(Injector);
  private readonly jobsApiService = inject(JobsApiService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly translocoService = inject(TranslocoService);
  private readonly route = inject(ActivatedRoute);
  readonly accessMode = inject(JobAccessModeService);
  readonly showDocPanel = signal<boolean>(false);
  readonly docTabs = SMILEIT_DOC_TABS;
  private routeSubscription: Subscription | null = null;
  readonly isLogsCollapsed = signal<boolean>(false);
  readonly isAdvancedSectionCollapsed = signal<boolean>(true);
  readonly selectedPatternForDetail = signal<SmileitPatternEntryView | null>(null);
  readonly patternEnabledState = signal<Record<string, boolean>>({});
  /** Categorías de riesgo desactivadas por el usuario; ausencia de clave = activa. */
  readonly disabledRiskCategories = signal<Record<string, boolean>>({});
  /** Los andamios privilegiados se controlan con un interruptor independiente. */
  readonly privilegedAnnotationsEnabled = signal<boolean>(true);
  readonly selectedLibraryEntryForDetail = signal<SmileitCatalogEntryView | null>(null);
  readonly libraryDetailOpenContext = signal<'browser' | 'reference'>('browser');
  readonly libraryEntryInspections = signal<Record<string, SmileitStructureInspectionView | null>>(
    {},
  );
  readonly libraryEntryInspectionErrors = signal<Record<string, string | null>>({});
  /** Categoría de riesgo de cada patrón del catálogo, indexada por stable_id. */
  private readonly patternRiskCategoryByStableId = computed<Map<string, RiskCategoryKey>>(() => {
    const categoryByStableId: Map<string, RiskCategoryKey> = new Map();
    this.patternEntries().forEach((pattern: SmileitPatternEntryView) => {
      categoryByStableId.set(pattern.stable_id, resolvePatternRiskCategory(pattern));
    });
    return categoryByStableId;
  });
  readonly visibleInspectionAnnotations = computed<SmileitStructuralAnnotationView[]>(() => {
    const inspectionResult: SmileitStructureInspectionView | null = this.workflow.inspection();
    if (inspectionResult === null) {
      return [];
    }

    const enabledState: Record<string, boolean> = this.patternEnabledState();
    return inspectionResult.annotations.filter((annotation: SmileitStructuralAnnotationView) => {
      const isPatternEnabled: boolean = enabledState[annotation.pattern_stable_id] ?? true;
      return isPatternEnabled && this.isAnnotationCategoryEnabled(annotation);
    });
  });
  readonly annotationsAreVisible = computed<boolean>(
    () => this.visibleInspectionAnnotations().length > 0,
  );
  /** Categorías presentes en el catálogo de patrones, con sus patrones y su conteo de coincidencias. */
  readonly riskCategoryGroups = computed<RiskCategoryGroupView[]>(() => {
    const patternsByCategory: Map<RiskCategoryKey, SmileitPatternEntryView[]> = new Map();
    this.patternEntries().forEach((pattern: SmileitPatternEntryView) => {
      const categoryKey: RiskCategoryKey = resolvePatternRiskCategory(pattern);
      const patterns: SmileitPatternEntryView[] = patternsByCategory.get(categoryKey) ?? [];
      patterns.push(pattern);
      patternsByCategory.set(categoryKey, patterns);
    });

    const matchCountByCategory: Map<RiskCategoryKey, number> = this.countAnnotationsByCategory();

    return RISK_CATEGORY_KEYS.filter((categoryKey: RiskCategoryKey) =>
      patternsByCategory.has(categoryKey),
    ).map((categoryKey: RiskCategoryKey): RiskCategoryGroupView => {
      return {
        key: categoryKey,
        patterns: patternsByCategory.get(categoryKey) ?? [],
        isEnabled: this.isRiskCategoryEnabled(categoryKey),
        matchCount: matchCountByCategory.get(categoryKey) ?? 0,
      };
    });
  });
  /** Indica si todas las categorías toxicofóricas están activas (para el botón global). */
  readonly allAlertsEnabled = computed<boolean>(() =>
    this.riskCategoryGroups()
      .filter((group: RiskCategoryGroupView) => group.key !== PRIVILEGED_CATEGORY_KEY)
      .every((group: RiskCategoryGroupView) => group.isEnabled),
  );
  /**
   * Anotaciones de la inspección agrupadas por categoría para la leyenda.
   * Se conservan las anotaciones ocultas a nivel de patrón para poder restaurarlas
   * con el ojo de cada chip; el estado del grupo refleja la categoría.
   */
  readonly annotationLegendGroups = computed<AnnotationLegendGroupView[]>(() => {
    const inspectionResult: SmileitStructureInspectionView | null = this.workflow.inspection();
    if (inspectionResult === null) {
      return [];
    }

    const annotationsByCategory: Map<
      RiskCategoryKey,
      SmileitStructuralAnnotationView[]
    > = new Map();
    inspectionResult.annotations.forEach((annotation: SmileitStructuralAnnotationView) => {
      const categoryKey: RiskCategoryKey = this.resolveAnnotationCategory(annotation);
      const annotations: SmileitStructuralAnnotationView[] =
        annotationsByCategory.get(categoryKey) ?? [];
      annotations.push(annotation);
      annotationsByCategory.set(categoryKey, annotations);
    });

    return RISK_CATEGORY_KEYS.filter((categoryKey: RiskCategoryKey) =>
      annotationsByCategory.has(categoryKey),
    ).map((categoryKey: RiskCategoryKey): AnnotationLegendGroupView => {
      return {
        key: categoryKey,
        annotations: annotationsByCategory.get(categoryKey) ?? [],
        isEnabled: this.isRiskCategoryEnabled(categoryKey),
      };
    });
  });
  private readonly libraryEntryPreviewSubscriptions = new Map<string, Subscription>();
  private readonly libraryPreviewSyncEffect = effect(
    () => {
      this.syncVisibleLibraryPreviews();
    },
    { injector: this.injector },
  );
  private readonly patternEnabledStateSyncEffect = effect(
    () => {
      const availablePatterns: SmileitPatternEntryView[] = this.patternEntries();
      const knownPatternStableIds: Set<string> = new Set(
        availablePatterns.map((pattern: SmileitPatternEntryView) => pattern.stable_id),
      );
      const currentState: Record<string, boolean> = this.patternEnabledState();
      let mustUpdateState: boolean = false;
      const nextState: Record<string, boolean> = {};

      Object.entries(currentState).forEach(([stableId, isEnabled]) => {
        if (knownPatternStableIds.has(stableId)) {
          nextState[stableId] = isEnabled;
          return;
        }
        mustUpdateState = true;
      });

      if (mustUpdateState) {
        this.patternEnabledState.set(nextState);
      }
    },
    { injector: this.injector },
  );
  @ViewChild('patternCatalogDialog')
  private readonly patternCatalogDialogRef?: ElementRef<HTMLDialogElement>;
  @ViewChild('patternCatalogModalBody')
  private readonly patternCatalogModalBodyRef?: ElementRef<HTMLElement>;
  @ViewChild('patternNameInput')
  private readonly patternNameInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('patternDetailDialog')
  private readonly patternDetailDialogRef?: ElementRef<HTMLDialogElement>;

  readonly patternEntries = computed<SmileitPatternEntryView[]>(() => this.workflow.patterns());
  readonly editingPatternEntry = computed<SmileitPatternEntryView | null>(() => {
    const editingStableId: string | null = this.workflow.patternEditingStableId();
    if (editingStableId === null) {
      return null;
    }

    return (
      this.patternEntries().find((patternEntry: SmileitPatternEntryView) => {
        return patternEntry.stable_id === editingStableId;
      }) ?? null
    );
  });

  /**
   * Texto plano condensado de todos los logs para mostrar en un textbox con scroll.
   * Formato: "LEVEL · #idx · source · mensaje"
   */
  readonly logsAsText = computed<string>(() => {
    const entries: JobLogEntryView[] = this.workflow.jobLogs();
    if (entries.length === 0) {
      return '';
    }
    return entries
      .map((entry: JobLogEntryView) => {
        const baseRow = `${entry.level.toUpperCase()} · #${entry.eventIndex} · ${entry.source} · ${entry.message}`;
        if (Object.keys(entry.payload).length > 0) {
          return `${baseRow}\n  ${JSON.stringify(entry.payload)}`;
        }
        return baseRow;
      })
      .join('\n');
  });
  @ViewChild(CatalogPanelComponent)
  private readonly catalogPanelComponentRef?: CatalogPanelComponent;
  private readonly decoratedInspectionSvg = computed<string>(() =>
    this.inspectionService.decorateInspectionSvg(
      this.workflow.inspectionSvg(),
      this.workflow.selectedAtomIndices(),
      this.visibleInspectionAnnotations(),
    ),
  );

  ngOnInit(): void {
    this.workflow.catalog.loadInitialData();
    this.workflow.loadHistory();
    this.workflow.inspectPrincipalStructure();

    this.routeSubscription = this.route.queryParamMap.subscribe((paramsMap) => {
      const jobId: string | null = paramsMap.get('jobId');
      if (jobId !== null && jobId.trim() !== '') {
        this.workflow.openHistoricalJob(jobId);
      }
    });
  }

  ngOnDestroy(): void {
    this.libraryPreviewSyncEffect.destroy();
    this.patternEnabledStateSyncEffect.destroy();
    this.routeSubscription?.unsubscribe();
    this.libraryEntryPreviewSubscriptions.forEach((subscription: Subscription) => {
      subscription.unsubscribe();
    });
    this.libraryEntryPreviewSubscriptions.clear();
  }

  inspectPrincipalStructure(): void {
    this.workflow.inspectPrincipalStructure();
  }

  onPrincipalSmilesChange(nextPrincipalSmiles: string): void {
    this.workflow.principalSmiles.set(nextPrincipalSmiles);
  }

  dispatch(): void {
    this.workflow.dispatch();
  }

  reset(): void {
    this.workflow.reset();
  }

  openHistoricalJob(jobId: string): void {
    this.workflow.openHistoricalJob(jobId);
  }

  toggleLogsCollapse(): void {
    this.isLogsCollapsed.update((currentValue: boolean) => !currentValue);
  }

  toggleAdvancedSectionCollapse(): void {
    this.isAdvancedSectionCollapsed.update((currentValue: boolean) => !currentValue);
  }

  openPatternCatalogModal(): void {
    const patternCatalogDialog: HTMLDialogElement | undefined =
      this.patternCatalogDialogRef?.nativeElement;
    if (patternCatalogDialog === undefined) {
      return;
    }

    if (patternCatalogDialog.open) {
      patternCatalogDialog.close();
    }

    try {
      patternCatalogDialog.showModal();
    } catch {
      patternCatalogDialog.setAttribute('open', 'true');
    }
  }

  closePatternCatalogModal(): void {
    const patternCatalogDialog: HTMLDialogElement | undefined =
      this.patternCatalogDialogRef?.nativeElement;
    if (patternCatalogDialog?.open) {
      patternCatalogDialog.close();
    }
  }

  onPatternCatalogDialogClick(event: MouseEvent | KeyboardEvent): void {
    const dialogElement: HTMLDialogElement | undefined =
      this.patternCatalogDialogRef?.nativeElement;
    if (dialogElement === undefined) {
      return;
    }

    if (event.target === dialogElement) {
      this.closePatternCatalogModal();
    }
  }

  /**
   * Evita que pulsaciones de teclado (Enter/Space) dentro del modal 'se propaguen'
   * y cierren el dialog desde el fondo. Requerido por reglas de accesibilidad.
   */
  onPatternModalSectionKeydown(event: KeyboardEvent): void {
    const key = event.key;
    if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
      event.stopPropagation();
    }
  }

  openPatternDetail(pattern: SmileitPatternEntryView): void {
    this.selectedPatternForDetail.set(pattern);
    const patternDetailDialog: HTMLDialogElement | undefined =
      this.patternDetailDialogRef?.nativeElement;
    if (patternDetailDialog === undefined) {
      return;
    }

    if (patternDetailDialog.open) {
      patternDetailDialog.close();
    }

    try {
      patternDetailDialog.showModal();
    } catch {
      patternDetailDialog.setAttribute('open', 'true');
    }
  }

  closePatternDetail(): void {
    const patternDetailDialog: HTMLDialogElement | undefined =
      this.patternDetailDialogRef?.nativeElement;
    if (patternDetailDialog?.open) {
      patternDetailDialog.close();
    }
    this.selectedPatternForDetail.set(null);
  }

  onPatternDetailDialogClick(event: MouseEvent | KeyboardEvent): void {
    const dialogElement: HTMLDialogElement | undefined = this.patternDetailDialogRef?.nativeElement;
    if (dialogElement === undefined) {
      return;
    }

    if (event.target === dialogElement) {
      this.closePatternDetail();
    }
  }

  isPatternEnabled(pattern: SmileitPatternEntryView): boolean {
    return this.patternEnabledState()[pattern.stable_id] ?? true;
  }

  /** Verifica si una anotación es visible por su stable_id (para uso directo en template). */
  isAnnotationEnabled(patternStableId: string): boolean {
    return (
      (this.patternEnabledState() as Record<string, boolean | undefined>)[patternStableId] ?? true
    );
  }

  togglePatternEnabled(patternStableId: string): void {
    this.patternEnabledState.update((currentState: Record<string, boolean>) => {
      const currentValue: boolean = currentState[patternStableId] ?? true;
      return {
        ...currentState,
        [patternStableId]: !currentValue,
      };
    });
  }

  /** Indica si una categoría de riesgo está activa (los privilegiados usan su propio switch). */
  isRiskCategoryEnabled(categoryKey: RiskCategoryKey): boolean {
    if (categoryKey === PRIVILEGED_CATEGORY_KEY) {
      return this.privilegedAnnotationsEnabled();
    }

    return !(this.disabledRiskCategories()[categoryKey] ?? false);
  }

  /** Indica si la anotación pertenece a una categoría activa. */
  isAnnotationCategoryEnabled(annotation: SmileitStructuralAnnotationView): boolean {
    return this.isRiskCategoryEnabled(this.resolveAnnotationCategory(annotation));
  }

  /** Indica si la anotación se pinta en el SVG (patrón y categoría activos). */
  isAnnotationVisible(annotation: SmileitStructuralAnnotationView): boolean {
    return this.isAnnotationEnabled(annotation.pattern_stable_id) &&
      this.isAnnotationCategoryEnabled(annotation);
  }

  /** Nombre traducido de la categoría de riesgo. */
  riskCategoryLabel(categoryKey: RiskCategoryKey): string {
    return this.translocoService.translate(`smileit.annotations.categories.${categoryKey}`);
  }

  /** Color de acento de la categoría (rojo toxicofórico / verde privilegiado). */
  riskCategoryAccent(categoryKey: RiskCategoryKey): string {
    return riskCategoryColor(categoryKey);
  }

  /**
   * Activa o desactiva una categoría de riesgo.
   * La categoría privilegiada se delega al interruptor independiente.
   */
  toggleRiskCategory(categoryKey: RiskCategoryKey): void {
    if (categoryKey === PRIVILEGED_CATEGORY_KEY) {
      this.togglePrivilegedAnnotations();
      return;
    }

    this.disabledRiskCategories.update((currentState: Record<string, boolean>) => {
      const nextState: Record<string, boolean> = { ...currentState };
      if (nextState[categoryKey] === true) {
        delete nextState[categoryKey];
      } else {
        nextState[categoryKey] = true;
      }
      return nextState;
    });
  }

  /** Desactiva de golpe todas las categorías toxicofóricas presentes en el catálogo. */
  disableAllToxicophoreCategories(): void {
    const nextState: Record<string, boolean> = { ...this.disabledRiskCategories() };
    this.riskCategoryGroups().forEach((group: RiskCategoryGroupView) => {
      if (group.key !== PRIVILEGED_CATEGORY_KEY) {
        nextState[group.key] = true;
      }
    });
    this.disabledRiskCategories.set(nextState);
  }

  /** Reactiva todas las categorías, incluidas las privilegiadas. */
  enableAllRiskCategories(): void {
    this.disabledRiskCategories.set({});
    this.privilegedAnnotationsEnabled.set(true);
  }

  /** Muestra u oculta las anotaciones de andamios privilegiados. */
  togglePrivilegedAnnotations(): void {
    this.privilegedAnnotationsEnabled.update((currentValue: boolean) => !currentValue);
  }

  /** Alterna entre "desactivar todo" y "activar todo" según el estado actual. */
  toggleAllAlerts(): void {
    if (this.allAlertsEnabled()) {
      this.disableAllToxicophoreCategories();
      return;
    }

    this.enableAllRiskCategories();
  }

  beginPatternEntryEdition(pattern: SmileitPatternEntryView): void {
    if (this.accessMode.isOpenMode()) return;
    this.workflow.catalog.beginPatternEntryEdition(pattern);
    this.bringPatternEditorToTop();
  }

  cancelPatternEdition(): void {
    this.workflow.catalog.cancelPatternEdition();
  }

  deletePatternEntry(pattern: SmileitPatternEntryView): void {
    if (this.accessMode.isOpenMode()) return;
    this.workflow.catalog.deletePatternEntry(pattern);

    const selectedPattern: SmileitPatternEntryView | null = this.selectedPatternForDetail();
    if (selectedPattern !== null && selectedPattern.stable_id === pattern.stable_id) {
      this.closePatternDetail();
    }
  }

  isPatternBeingEdited(pattern: SmileitPatternEntryView): boolean {
    return this.workflow.patternEditingStableId() === pattern.stable_id;
  }

  openLibraryEntryDetail(
    catalogEntry: SmileitCatalogEntryView,
    openContext: 'browser' | 'reference' = 'browser',
  ): void {
    this.selectedLibraryEntryForDetail.set(catalogEntry);
    this.libraryDetailOpenContext.set(openContext);
  }

  closeLibraryEntryDetail(): void {
    this.selectedLibraryEntryForDetail.set(null);
    this.libraryDetailOpenContext.set('browser');
  }

  /** Cierra el detalle y abre el editor de la entrada seleccionada */
  editLibraryEntryFromDetail(catalogEntry: SmileitCatalogEntryView): void {
    if (this.accessMode.isOpenMode()) return;
    this.closeLibraryEntryDetail();
    this.catalogPanelComponentRef?.beginCatalogEntryEdition(catalogEntry);
  }

  catalogEntryPreviewSvg(catalogEntry: SmileitCatalogEntryView): SafeHtml | null {
    const previewKey: string = this.buildCatalogEntryPreviewKey(catalogEntry);
    const inspectionResult: SmileitStructureInspectionView | null =
      this.libraryEntryInspections()[previewKey] ?? null;

    if (inspectionResult === null) {
      return null;
    }

    const decoratedSvgMarkup: string = this.inspectionService.decorateInspectionSvg(
      inspectionResult.svg,
      catalogEntry.anchor_atom_indices,
      [],
    );

    return this.sanitizer.bypassSecurityTrustHtml(decoratedSvgMarkup); // NOSONAR: S6268 - el SVG proviene del backend interno validado, nunca de entrada directa del usuario
  }

  catalogEntryPreviewError(catalogEntry: SmileitCatalogEntryView): string | null {
    const previewKey: string = this.buildCatalogEntryPreviewKey(catalogEntry);
    return this.libraryEntryInspectionErrors()[previewKey] ?? null;
  }

  isReferencedInAnyBlock(catalogEntry: SmileitCatalogEntryView): boolean {
    return this.workflow
      .assignmentBlocks()
      .some((block: SmileitAssignmentBlockDraft) =>
        this.workflow.catalog.isCatalogEntryReferenced(block, catalogEntry),
      );
  }

  isCatalogEntryEditable(catalogEntry: SmileitCatalogEntryView): boolean {
    return !this.accessMode.isOpenMode() && this.workflow.catalog.isCatalogEntryEditable(catalogEntry);
  }

  isAtomSelected(atomIndex: number): boolean {
    return this.workflow.selectedAtomIndices().includes(atomIndex);
  }

  coverageLabel(atomIndex: number): string | null {
    const coverageItem = this.workflow
      .selectedSiteCoverage()
      .find((entry) => entry.siteAtomIndex === atomIndex);
    return coverageItem ? `${coverageItem.blockLabel} · P${coverageItem.priority}` : null;
  }

  patternTypeLabel(patternType: string): string {
    if (patternType === 'toxicophore') {
      return this.translocoService.translate('smileit.patterns.toxicophore');
    }

    if (patternType === 'privileged') {
      return this.translocoService.translate('smileit.patterns.privileged');
    }

    return patternType;
  }

  toTrustedSvg(svgMarkup: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(svgMarkup); // NOSONAR: S6268 - el SVG proviene del backend interno validado, nunca de entrada directa del usuario
  }

  toTrustedInspectionSvg(): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(this.decoratedInspectionSvg()); // NOSONAR: S6268 - el SVG proviene del backend interno validado, nunca de entrada directa del usuario
  }

  onInspectionSvgClick(mouseEvent: MouseEvent): void {
    if (this.workflow.isProcessing()) return;

    const atomIndexFromPointer: number | null = this.resolveAtomIndexFromPointer(mouseEvent);
    if (atomIndexFromPointer !== null) {
      this.workflow.toggleSelectedAtom(atomIndexFromPointer);
    }
  }

  private resolveAtomIndexFromPointer(mouseEvent: MouseEvent): number | null {
    return this.inspectionService.extractAtomIndexFromEvent(mouseEvent);
  }

  /** Categoría de riesgo de una anotación, resuelta con el catálogo de patrones. */
  private resolveAnnotationCategory(
    annotation: SmileitStructuralAnnotationView,
  ): RiskCategoryKey {
    return resolveAnnotationRiskCategory(annotation, this.patternRiskCategoryByStableId());
  }

  /** Cuenta las anotaciones de la inspección actual por categoría de riesgo. */
  private countAnnotationsByCategory(): Map<RiskCategoryKey, number> {
    const annotationCountByCategory: Map<RiskCategoryKey, number> = new Map();
    const inspectionResult: SmileitStructureInspectionView | null = this.workflow.inspection();
    if (inspectionResult === null) {
      return annotationCountByCategory;
    }

    inspectionResult.annotations.forEach((annotation: SmileitStructuralAnnotationView) => {
      const categoryKey: RiskCategoryKey = this.resolveAnnotationCategory(annotation);
      annotationCountByCategory.set(
        categoryKey,
        (annotationCountByCategory.get(categoryKey) ?? 0) + 1,
      );
    });
    return annotationCountByCategory;
  }

  /**
   * Lleva el formulario de edición al área visible superior del modal y enfoca el primer campo.
   */
  private bringPatternEditorToTop(): void {
    const modalBody: HTMLElement | undefined = this.patternCatalogModalBodyRef?.nativeElement;
    if (modalBody !== undefined) {
      modalBody.scrollTo({ top: 0, behavior: 'smooth' });
    }

    setTimeout(() => {
      this.patternNameInputRef?.nativeElement.focus({ preventScroll: true });
    }, 0);
  }

  private syncVisibleLibraryPreviews(): void {
    const topLibraryEntries: SmileitCatalogEntryView[] = this.workflow
      .catalogGroups()
      .flatMap((group) => group.entries);
    const blockReferencedEntries: SmileitCatalogEntryView[] = this.workflow
      .assignmentBlocks()
      .flatMap((block: SmileitAssignmentBlockDraft) => block.catalogRefs);

    const uniqueEntriesByPreviewKey: Map<string, SmileitCatalogEntryView> = new Map();
    [...topLibraryEntries, ...blockReferencedEntries].forEach(
      (catalogEntry: SmileitCatalogEntryView) => {
        uniqueEntriesByPreviewKey.set(this.buildCatalogEntryPreviewKey(catalogEntry), catalogEntry);
      },
    );

    const visibleCatalogEntries: SmileitCatalogEntryView[] = [
      ...uniqueEntriesByPreviewKey.values(),
    ];
    const visiblePreviewKeys: Set<string> = new Set(
      visibleCatalogEntries.map((catalogEntry) => this.buildCatalogEntryPreviewKey(catalogEntry)),
    );

    this.libraryEntryPreviewSubscriptions.forEach(
      (subscription: Subscription, previewKey: string) => {
        if (visiblePreviewKeys.has(previewKey)) {
          return;
        }

        subscription.unsubscribe();
        this.libraryEntryPreviewSubscriptions.delete(previewKey);
      },
    );

    visibleCatalogEntries.forEach((catalogEntry: SmileitCatalogEntryView) => {
      const previewKey: string = this.buildCatalogEntryPreviewKey(catalogEntry);
      const hasCachedPreview: boolean = this.libraryEntryInspections()[previewKey] !== undefined;
      const hasCachedError: boolean = this.libraryEntryInspectionErrors()[previewKey] !== undefined;
      if (
        hasCachedPreview ||
        hasCachedError ||
        this.libraryEntryPreviewSubscriptions.has(previewKey)
      ) {
        return;
      }

      const normalizedSmiles: string = catalogEntry.smiles.trim();
      if (normalizedSmiles === '') {
        this.setLibraryEntryInspectionError(previewKey, 'No SMILES available for preview.');
        return;
      }

      this.setLibraryEntryInspectionError(previewKey, null);

      const previewSubscription: Subscription = this.jobsApiService
        .inspectSmileitStructure(normalizedSmiles)
        .subscribe({
          next: (inspectionResult: SmileitStructureInspectionView) => {
            this.setLibraryEntryInspection(previewKey, inspectionResult);
            this.setLibraryEntryInspectionError(previewKey, null);
            this.libraryEntryPreviewSubscriptions.delete(previewKey);
          },
          error: (requestError: Error) => {
            this.setLibraryEntryInspection(previewKey, null);
            this.setLibraryEntryInspectionError(
              previewKey,
              `Preview unavailable: ${requestError.message}`,
            );
            this.libraryEntryPreviewSubscriptions.delete(previewKey);
          },
        });

      this.libraryEntryPreviewSubscriptions.set(previewKey, previewSubscription);
    });
  }

  private buildCatalogEntryPreviewKey(catalogEntry: SmileitCatalogEntryView): string {
    return `${catalogEntry.stable_id}@${catalogEntry.version}`;
  }

  private setLibraryEntryInspection(
    previewKey: string,
    inspectionResult: SmileitStructureInspectionView | null,
  ): void {
    this.libraryEntryInspections.update(
      (currentState: Record<string, SmileitStructureInspectionView | null>) => ({
        ...currentState,
        [previewKey]: inspectionResult,
      }),
    );
  }

  private setLibraryEntryInspectionError(previewKey: string, errorMessage: string | null): void {
    this.libraryEntryInspectionErrors.update((currentState: Record<string, string | null>) => ({
      ...currentState,
      [previewKey]: errorMessage,
    }));
  }
}
