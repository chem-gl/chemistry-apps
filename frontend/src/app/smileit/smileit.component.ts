// smileit.component.ts: Pantalla principal de Smile-it con bloques de asignación, análisis medicinal y exportes reproducibles.

import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  Injector,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import {
  DownloadedReportFile,
  JobLogEntryView,
  JobsApiService,
  ScientificJobView,
  SmileitCatalogEntryView,
  SmileitPatternEntryView,
  SmileitStructureInspectionView,
} from '../core/api/jobs-api.service';
import {
  SmileitAssignmentBlockDraft,
  SmileitGeneratedStructureView,
  SmileitWorkflowService,
} from '../core/application/smileit-workflow.service';

@Component({
  selector: 'app-smileit',
  imports: [CommonModule, FormsModule],
  providers: [SmileitWorkflowService],
  templateUrl: './smileit.component.html',
  styleUrl: './smileit.component.scss',
})
export class SmileitComponent implements OnInit, OnDestroy {
  readonly workflow = inject(SmileitWorkflowService);
  private readonly injector = inject(Injector);
  private readonly jobsApiService = inject(JobsApiService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly route = inject(ActivatedRoute);
  private routeSubscription: Subscription | null = null;
  private catalogDraftInspectionSubscription: Subscription | null = null;
  private readonly manualDraftInspectionSubscriptions = new Map<string, Subscription>();
  readonly isCatalogPanelCollapsed = signal<boolean>(true);
  readonly isLibraryPanelCollapsed = signal<boolean>(false);
  readonly isGeneratedStructuresCollapsed = signal<boolean>(false);
  readonly isLogsCollapsed = signal<boolean>(false);
  readonly isAdvancedSectionCollapsed = signal<boolean>(true);
  /** Nivel de zoom del visor principal de la molécula (1–4) */
  readonly principalZoomLevel = signal<number>(1);
  readonly collapsedBlockMap = signal<Record<string, boolean>>({});
  readonly selectedGeneratedStructure = signal<SmileitGeneratedStructureView | null>(null);
  readonly selectedPatternForDetail = signal<SmileitPatternEntryView | null>(null);
  readonly patternEnabledState = signal<Record<string, boolean>>({});
  readonly catalogDraftInspection = signal<SmileitStructureInspectionView | null>(null);
  readonly catalogDraftInspectionError = signal<string | null>(null);
  readonly selectedLibraryGroupKey = signal<string>('aromatic');
  readonly selectedBlockLibraryGroupKeys = signal<Record<string, string>>({});
  readonly selectedLibraryEntryForDetail = signal<SmileitCatalogEntryView | null>(null);
  readonly libraryDetailOpenContext = signal<'browser' | 'reference'>('browser');
  /** Nivel de zoom del previsualizador en el dialog de detalle (1–4) */
  readonly libraryDetailZoomLevel = signal<number>(1);
  /**
   * Tamaño fijo del viewport (ventana visible). Nunca cambia con el zoom.
   * El SVG siempre supera este valor para que el pan esté siempre activo.
   */
  readonly libraryDetailViewportPx = 280;
  /**
   * Tamaño del SVG según el nivel de zoom.
   * Siempre mayor que el viewport para garantizar overflow y pan.
   * 1×: 380px | 2×: 480px | 3×: 580px | 4×: 680px
   */
  readonly libraryDetailPreviewSize = computed<number>(
    () => 380 + (this.libraryDetailZoomLevel() - 1) * 100,
  );
  /** Desplazamiento X (px) del SVG dentro del viewport, para pan con mouse */
  readonly libraryDetailPanX = signal<number>(0);
  /** Desplazamiento Y (px) del SVG dentro del viewport, para pan con mouse */
  readonly libraryDetailPanY = signal<number>(0);
  /** Indica si el usuario está arrastrando la imagen en este momento */
  readonly libraryDetailIsDragging = signal<boolean>(false);
  private _panDragStartX = 0;
  private _panDragStartY = 0;
  private _panAnchorX = 0;
  private _panAnchorY = 0;
  readonly libraryEntryInspections = signal<Record<string, SmileitStructureInspectionView | null>>(
    {},
  );
  readonly libraryEntryInspectionErrors = signal<Record<string, string | null>>({});
  readonly filteredLibraryGroups = computed(() => {
    const selectedGroupKey: string = this.selectedLibraryGroupKey();
    const availableGroups = this.workflow.catalogGroups();

    if (selectedGroupKey === 'all') {
      return availableGroups;
    }

    return availableGroups.filter((group) => group.key === selectedGroupKey);
  });
  /** Lista plana de entradas visibles según el filtro de grupo activo */
  readonly filteredLibraryEntries = computed<SmileitCatalogEntryView[]>(() =>
    this.filteredLibraryGroups().flatMap((group) => group.entries),
  );
  readonly manualDraftInspections = signal<Record<string, SmileitStructureInspectionView | null>>(
    {},
  );
  readonly visibleInspectionAnnotations = computed(() => {
    const inspectionResult: SmileitStructureInspectionView | null = this.workflow.inspection();
    if (inspectionResult === null) {
      return [];
    }

    const enabledState: Record<string, boolean> = this.patternEnabledState();
    return inspectionResult.annotations.filter((annotation) => {
      const isEnabled: boolean = enabledState[annotation.pattern_stable_id] ?? true;
      return isEnabled;
    });
  });
  readonly manualDraftInspectionErrors = signal<Record<string, string | null>>({});
  private readonly libraryEntryPreviewSubscriptions = new Map<string, Subscription>();
  private readonly libraryPreviewSyncEffect = effect(
    () => {
      this.syncVisibleLibraryPreviews();
    },
    { injector: this.injector },
  );
  private readonly manualDraftInspectionSyncEffect = effect(
    () => {
      this.syncManualDraftInspectionState();
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
  @ViewChild('catalogStudioDialog')
  private catalogStudioDialogRef?: ElementRef<HTMLDialogElement>;
  @ViewChild('patternCatalogDialog')
  private patternCatalogDialogRef?: ElementRef<HTMLDialogElement>;
  @ViewChild('patternDetailDialog')
  private patternDetailDialogRef?: ElementRef<HTMLDialogElement>;

  readonly patternEntries = computed<SmileitPatternEntryView[]>(() => {
    const rawPatterns: unknown = this.workflow.patterns() as unknown;
    return Array.isArray(rawPatterns) ? (rawPatterns as SmileitPatternEntryView[]) : [];
  });
  @ViewChild('libraryEntryDetailDialog')
  private libraryEntryDetailDialogRef?: ElementRef<HTMLDialogElement>;
  @ViewChild('generatedStructureDialog')
  private generatedStructureDialogRef?: ElementRef<HTMLDialogElement>;
  private readonly decoratedInspectionSvg = computed<string>(() =>
    this.decorateInspectionSvg(
      this.workflow.inspectionSvg(),
      this.workflow.selectedAtomIndices(),
      this.visibleInspectionAnnotations(),
    ),
  );

  ngOnInit(): void {
    this.workflow.loadInitialData();
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
    this.manualDraftInspectionSyncEffect.destroy();
    this.patternEnabledStateSyncEffect.destroy();
    this.routeSubscription?.unsubscribe();
    this.catalogDraftInspectionSubscription?.unsubscribe();
    this.libraryEntryPreviewSubscriptions.forEach((subscription: Subscription) => {
      subscription.unsubscribe();
    });
    this.libraryEntryPreviewSubscriptions.clear();
    this.manualDraftInspectionSubscriptions.forEach((subscription: Subscription) => {
      subscription.unsubscribe();
    });
    this.manualDraftInspectionSubscriptions.clear();
  }

  inspectPrincipalStructure(): void {
    this.workflow.inspectPrincipalStructure();
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

  addAssignmentBlock(): void {
    this.workflow.addAssignmentBlock();
  }

  toggleCatalogPanelCollapse(): void {
    this.isCatalogPanelCollapsed.update((currentValue: boolean) => !currentValue);
  }

  toggleLibraryPanelCollapse(): void {
    this.isLibraryPanelCollapsed.update((currentValue: boolean) => !currentValue);
  }

  toggleGeneratedStructuresCollapse(): void {
    this.isGeneratedStructuresCollapsed.update((currentValue: boolean) => !currentValue);
  }

  toggleLogsCollapse(): void {
    this.isLogsCollapsed.update((currentValue: boolean) => !currentValue);
  }

  toggleAdvancedSectionCollapse(): void {
    this.isAdvancedSectionCollapsed.update((currentValue: boolean) => !currentValue);
  }

  openCatalogStudioModal(): void {
    const catalogStudioDialog: HTMLDialogElement | undefined =
      this.catalogStudioDialogRef?.nativeElement;
    if (catalogStudioDialog === undefined || catalogStudioDialog.open) {
      return;
    }

    catalogStudioDialog.showModal();
    this.refreshCatalogDraftInspection();
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
    if (patternCatalogDialog !== undefined && patternCatalogDialog.open) {
      patternCatalogDialog.close();
    }
  }

  onPatternCatalogDialogClick(mouseEvent: MouseEvent): void {
    const dialogElement: HTMLDialogElement | undefined =
      this.patternCatalogDialogRef?.nativeElement;
    if (dialogElement === undefined) {
      return;
    }

    if (mouseEvent.target === dialogElement) {
      this.closePatternCatalogModal();
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
    if (patternDetailDialog !== undefined && patternDetailDialog.open) {
      patternDetailDialog.close();
    }
    this.selectedPatternForDetail.set(null);
  }

  onPatternDetailDialogClick(mouseEvent: MouseEvent): void {
    const dialogElement: HTMLDialogElement | undefined = this.patternDetailDialogRef?.nativeElement;
    if (dialogElement === undefined) {
      return;
    }

    if (mouseEvent.target === dialogElement) {
      this.closePatternDetail();
    }
  }

  isPatternEnabled(pattern: SmileitPatternEntryView): boolean {
    return this.patternEnabledState()[pattern.stable_id] ?? true;
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

  beginCatalogEntryEdition(catalogEntry: SmileitCatalogEntryView): void {
    this.workflow.beginCatalogEntryEdition(catalogEntry);
    this.openCatalogStudioModal();
  }

  onCatalogDraftSmilesChange(nextValue: string): void {
    this.workflow.catalogCreateSmiles.set(nextValue);
    this.refreshCatalogDraftInspection();
  }

  stageCurrentCatalogDraft(): void {
    this.workflow.stageCurrentCatalogDraft();
    this.refreshCatalogDraftInspection();
  }

  loadQueuedCatalogDraft(queueDraftId: string): void {
    this.workflow.loadQueuedCatalogDraft(queueDraftId);
    this.refreshCatalogDraftInspection();
  }

  removeQueuedCatalogDraft(queueDraftId: string): void {
    this.workflow.removeQueuedCatalogDraft(queueDraftId);
  }

  onBlockManualDraftSmilesChange(blockId: string, nextValue: string): void {
    this.workflow.updateBlockManualDraftSmiles(blockId, nextValue);
    this.refreshManualDraftInspection(blockId);
  }

  addManualSubstituentToBlock(blockId: string): void {
    this.workflow.addManualSubstituentToBlock(blockId);
    this.refreshManualDraftInspection(blockId);
  }

  selectCatalogEntryForManualDraft(blockId: string, catalogEntry: SmileitCatalogEntryView): void {
    this.workflow.applyCatalogEntryToManualDraft(blockId, catalogEntry);
    this.refreshManualDraftInspection(blockId);
  }

  isCatalogEntryLoadedInManualDraft(
    block: SmileitAssignmentBlockDraft,
    catalogEntry: SmileitCatalogEntryView,
  ): boolean {
    return (
      block.draftManualSmiles.trim() === catalogEntry.smiles.trim() &&
      block.draftManualName.trim() === catalogEntry.name.trim()
    );
  }

  selectedManualDraftLabel(block: SmileitAssignmentBlockDraft): string {
    const normalizedName: string = block.draftManualName.trim();
    if (normalizedName !== '') {
      return normalizedName;
    }

    const normalizedSmiles: string = block.draftManualSmiles.trim();
    return normalizedSmiles !== '' ? normalizedSmiles : 'No substituent molecule selected';
  }

  toTrustedAnchorSelectionSvg(rawSvgMarkup: string, selectedAtomIndices: number[]): SafeHtml {
    const decoratedSvgMarkup: string = this.decorateInspectionSvg(
      rawSvgMarkup,
      selectedAtomIndices,
      [],
    );
    return this.sanitizer.bypassSecurityTrustHtml(decoratedSvgMarkup);
  }

  catalogDraftAnchorIndices(): number[] {
    return this.parseAtomIndicesInput(this.workflow.catalogCreateAnchorIndicesText()).slice(0, 1);
  }

  manualDraftAnchorIndices(block: SmileitAssignmentBlockDraft): number[] {
    return this.parseAtomIndicesInput(block.draftManualAnchorIndicesText);
  }

  manualDraftInspection(blockId: string): SmileitStructureInspectionView | null {
    return this.manualDraftInspections()[blockId] ?? null;
  }

  manualDraftInspectionError(blockId: string): string | null {
    return this.manualDraftInspectionErrors()[blockId] ?? null;
  }

  toggleCatalogDraftAnchor(atomIndex: number): void {
    const nextAnchorIndices: number[] = [atomIndex];
    this.workflow.catalogCreateAnchorIndicesText.set(this.formatAtomIndices(nextAnchorIndices));
  }

  toggleManualDraftAnchor(blockId: string, atomIndex: number): void {
    const blockDraft: SmileitAssignmentBlockDraft | undefined = this.workflow
      .assignmentBlocks()
      .find((block: SmileitAssignmentBlockDraft) => block.id === blockId);
    if (blockDraft === undefined) {
      return;
    }

    const nextAnchorIndices: number[] = this.toggleAtomSelection(
      this.manualDraftAnchorIndices(blockDraft),
      atomIndex,
    );
    this.workflow.updateBlockManualDraftAnchors(blockId, this.formatAtomIndices(nextAnchorIndices));
  }

  onCatalogDraftSvgClick(mouseEvent: MouseEvent): void {
    if (this.workflow.isProcessing()) {
      return;
    }

    const atomIndex: number | null = this.resolveAtomIndexFromPointer(mouseEvent);
    if (atomIndex === null) {
      return;
    }

    this.toggleCatalogDraftAnchor(atomIndex);
  }

  onManualDraftSvgClick(mouseEvent: MouseEvent, blockId: string): void {
    if (this.workflow.isProcessing()) {
      return;
    }

    const atomIndex: number | null = this.resolveAtomIndexFromPointer(mouseEvent);
    if (atomIndex === null) {
      return;
    }

    this.toggleManualDraftAnchor(blockId, atomIndex);
  }

  closeCatalogStudioModal(): void {
    this.catalogStudioDialogRef?.nativeElement.close();
  }

  openLibraryEntryDetail(
    catalogEntry: SmileitCatalogEntryView,
    openContext: 'browser' | 'reference' = 'browser',
  ): void {
    this.selectedLibraryEntryForDetail.set(catalogEntry);
    this.libraryDetailOpenContext.set(openContext);
    this.libraryDetailZoomLevel.set(1);
    this.libraryDetailPanX.set(0);
    this.libraryDetailPanY.set(0);
    const detailDialog: HTMLDialogElement | undefined =
      this.libraryEntryDetailDialogRef?.nativeElement;
    if (detailDialog === undefined) {
      return;
    }

    if (detailDialog.open) {
      detailDialog.close();
    }

    try {
      detailDialog.showModal();
    } catch {
      detailDialog.setAttribute('open', 'true');
    }
  }

  closeLibraryEntryDetail(): void {
    const detailDialog: HTMLDialogElement | undefined =
      this.libraryEntryDetailDialogRef?.nativeElement;
    if (detailDialog !== undefined && detailDialog.open) {
      detailDialog.close();
    }
    detailDialog?.removeAttribute('open');
    this.selectedLibraryEntryForDetail.set(null);
    this.libraryDetailOpenContext.set('browser');
    this.libraryDetailZoomLevel.set(1);
    this.libraryDetailPanX.set(0);
    this.libraryDetailPanY.set(0);
  }

  zoomInLibraryDetail(): void {
    this.libraryDetailZoomLevel.update((level: number) => Math.min(level + 1, 4));
    this.libraryDetailPanX.set(0);
    this.libraryDetailPanY.set(0);
  }

  zoomOutLibraryDetail(): void {
    this.libraryDetailZoomLevel.update((level: number) => Math.max(level - 1, 1));
    this.libraryDetailPanX.set(0);
    this.libraryDetailPanY.set(0);
  }

  /** Aumenta el zoom del visor principal de la molécula */
  zoomInPrincipal(): void {
    this.principalZoomLevel.update((level: number) => Math.min(level + 1, 4));
  }

  /** Disminuye el zoom del visor principal de la molécula */
  zoomOutPrincipal(): void {
    this.principalZoomLevel.update((level: number) => Math.max(level - 1, 1));
  }

  onLibraryDetailPanStart(event: MouseEvent): void {
    this.libraryDetailIsDragging.set(true);
    this._panDragStartX = event.clientX;
    this._panDragStartY = event.clientY;
    this._panAnchorX = this.libraryDetailPanX();
    this._panAnchorY = this.libraryDetailPanY();
    event.preventDefault();
  }

  onLibraryDetailPanMove(event: MouseEvent): void {
    if (!this.libraryDetailIsDragging()) {
      return;
    }
    const rawX: number = this._panAnchorX + (event.clientX - this._panDragStartX);
    const rawY: number = this._panAnchorY + (event.clientY - this._panDragStartY);
    const { x, y } = this.clampLibraryDetailPan(rawX, rawY);
    this.libraryDetailPanX.set(x);
    this.libraryDetailPanY.set(y);
  }

  onLibraryDetailPanEnd(): void {
    this.libraryDetailIsDragging.set(false);
  }

  /** Pan con scroll del mouse: stopPropagation evita que el dialog también haga scroll */
  onLibraryDetailWheel(event: WheelEvent): void {
    event.stopPropagation();
    const rawX: number = this.libraryDetailPanX() - event.deltaX * 0.6;
    const rawY: number = this.libraryDetailPanY() - event.deltaY * 0.6;
    const { x, y } = this.clampLibraryDetailPan(rawX, rawY);
    this.libraryDetailPanX.set(x);
    this.libraryDetailPanY.set(y);
  }

  private clampLibraryDetailPan(rawX: number, rawY: number): { x: number; y: number } {
    const halfOverflow: number =
      (this.libraryDetailPreviewSize() - this.libraryDetailViewportPx) / 2;
    return {
      x: Math.max(-halfOverflow, Math.min(halfOverflow, rawX)),
      y: Math.max(-halfOverflow, Math.min(halfOverflow, rawY)),
    };
  }

  onLibraryDetailDialogClick(mouseEvent: MouseEvent): void {
    const dialogElement: HTMLDialogElement | undefined =
      this.libraryEntryDetailDialogRef?.nativeElement;
    if (dialogElement === undefined) {
      return;
    }
    if (mouseEvent.target === dialogElement) {
      this.closeLibraryEntryDetail();
    }
  }

  /** Cierra el detalle y abre el editor de la entrada seleccionada */
  editLibraryEntryFromDetail(catalogEntry: SmileitCatalogEntryView): void {
    this.closeLibraryEntryDetail();
    this.beginCatalogEntryEdition(catalogEntry);
  }

  onLibraryGroupChange(nextGroupKey: string): void {
    this.selectedLibraryGroupKey.set(nextGroupKey);
  }

  onBlockLibraryGroupChange(blockId: string, nextGroupKey: string): void {
    this.selectedBlockLibraryGroupKeys.update((currentState: Record<string, string>) => ({
      ...currentState,
      [blockId]: nextGroupKey,
    }));
  }

  selectedBlockLibraryGroupKey(blockId: string): string {
    return this.selectedBlockLibraryGroupKeys()[blockId] ?? 'aromatic';
  }

  filteredCatalogGroupsForBlock(block: SmileitAssignmentBlockDraft) {
    const selectedGroupKey: string = this.selectedBlockLibraryGroupKey(block.id);
    const availableGroups = this.workflow.catalogGroups();

    if (selectedGroupKey === 'all') {
      return availableGroups;
    }

    const matchingGroups = availableGroups.filter((group) => group.key === selectedGroupKey);
    return matchingGroups.length > 0 ? matchingGroups : availableGroups;
  }

  filteredCatalogEntriesForBlock(block: SmileitAssignmentBlockDraft): SmileitCatalogEntryView[] {
    const candidateEntries: SmileitCatalogEntryView[] = this.filteredCatalogGroupsForBlock(
      block,
    ).flatMap((group) => group.entries);

    return candidateEntries.filter(
      (catalogEntry: SmileitCatalogEntryView) =>
        !this.workflow.isCatalogEntryReferenced(block, catalogEntry),
    );
  }

  onBlockCatalogBrowserEntryActivate(
    block: SmileitAssignmentBlockDraft,
    catalogEntry: SmileitCatalogEntryView,
  ): void {
    if (this.workflow.isProcessing()) {
      return;
    }

    this.workflow.addCatalogReferenceToBlock(block.id, catalogEntry);
  }

  catalogEntryPreviewSvg(catalogEntry: SmileitCatalogEntryView): SafeHtml | null {
    const previewKey: string = this.buildCatalogEntryPreviewKey(catalogEntry);
    const inspectionResult: SmileitStructureInspectionView | null =
      this.libraryEntryInspections()[previewKey] ?? null;

    if (inspectionResult === null) {
      return null;
    }

    const decoratedSvgMarkup: string = this.decorateInspectionSvg(
      inspectionResult.svg,
      catalogEntry.anchor_atom_indices,
      [],
    );

    return this.sanitizer.bypassSecurityTrustHtml(decoratedSvgMarkup);
  }

  catalogEntryPreviewError(catalogEntry: SmileitCatalogEntryView): string | null {
    const previewKey: string = this.buildCatalogEntryPreviewKey(catalogEntry);
    return this.libraryEntryInspectionErrors()[previewKey] ?? null;
  }

  isReferencedInAnyBlock(catalogEntry: SmileitCatalogEntryView): boolean {
    return this.workflow
      .assignmentBlocks()
      .some((block: SmileitAssignmentBlockDraft) =>
        this.workflow.isCatalogEntryReferenced(block, catalogEntry),
      );
  }

  onCatalogStudioDialogClick(mouseEvent: MouseEvent): void {
    const dialogElement: HTMLDialogElement | undefined = this.catalogStudioDialogRef?.nativeElement;
    if (dialogElement === undefined) {
      return;
    }

    const eventTarget: EventTarget | null = mouseEvent.target;
    if (eventTarget === dialogElement) {
      this.closeCatalogStudioModal();
    }
  }

  toggleBlockCollapse(blockId: string): void {
    this.collapsedBlockMap.update((currentState: Record<string, boolean>) => ({
      ...currentState,
      [blockId]: !(currentState[blockId] ?? false),
    }));
  }

  collapseAllBlocks(): void {
    const nextState: Record<string, boolean> = {};
    this.workflow.assignmentBlocks().forEach((block: SmileitAssignmentBlockDraft) => {
      nextState[block.id] = true;
    });
    this.collapsedBlockMap.set(nextState);
  }

  expandAllBlocks(): void {
    const nextState: Record<string, boolean> = {};
    this.workflow.assignmentBlocks().forEach((block: SmileitAssignmentBlockDraft) => {
      nextState[block.id] = false;
    });
    this.collapsedBlockMap.set(nextState);
  }

  isBlockCollapsed(blockId: string): boolean {
    return this.collapsedBlockMap()[blockId] ?? false;
  }

  exportCsv(): void {
    this.downloadReport(this.workflow.downloadCsvReport.bind(this.workflow));
  }

  exportSmiles(): void {
    this.downloadReport(this.workflow.downloadSmilesReport.bind(this.workflow));
  }

  exportTraceability(): void {
    this.downloadReport(this.workflow.downloadTraceabilityReport.bind(this.workflow));
  }

  exportLog(): void {
    this.downloadReport(this.workflow.downloadLogReport.bind(this.workflow));
  }

  exportError(): void {
    this.downloadReport(this.workflow.downloadErrorReport.bind(this.workflow));
  }

  toNumber(rawValue: number | string): number {
    return Number(rawValue);
  }

  isAtomSelected(atomIndex: number): boolean {
    return this.workflow.selectedAtomIndices().includes(atomIndex);
  }

  isBlockSiteSelected(block: SmileitAssignmentBlockDraft, atomIndex: number): boolean {
    return block.siteAtomIndices.includes(atomIndex);
  }

  blockSummary(
    block: SmileitAssignmentBlockDraft,
  ): ReturnType<SmileitWorkflowService['getBlockCollapsedSummary']> {
    return this.workflow.getBlockCollapsedSummary(block);
  }

  coverageLabel(atomIndex: number): string | null {
    const coverageItem = this.workflow
      .selectedSiteCoverage()
      .find((entry) => entry.siteAtomIndex === atomIndex);
    return coverageItem ? `${coverageItem.blockLabel} · P${coverageItem.priority}` : null;
  }

  historicalStatusClass(jobStatus: ScientificJobView['status']): string {
    return `history-status history-${jobStatus}`;
  }

  hasPayload(logEntry: JobLogEntryView): boolean {
    return Object.keys(logEntry.payload).length > 0;
  }

  logLevelClass(logLevel: JobLogEntryView['level']): string {
    return `log-level log-level-${logLevel}`;
  }

  patternTypeLabel(patternType: string): string {
    if (patternType === 'toxicophore') {
      return 'Toxicophore';
    }

    if (patternType === 'privileged') {
      return 'Privileged scaffold';
    }

    return patternType;
  }

  toTrustedSvg(svgMarkup: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(svgMarkup);
  }

  toTrustedInspectionSvg(): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(this.decoratedInspectionSvg());
  }

  onInspectionSvgClick(mouseEvent: MouseEvent): void {
    if (this.workflow.isProcessing()) {
      return;
    }

    const atomIndexFromPointer: number | null = this.resolveAtomIndexFromPointer(mouseEvent);
    if (atomIndexFromPointer !== null) {
      this.workflow.toggleSelectedAtom(atomIndexFromPointer);
      return;
    }
  }

  private syncManualDraftInspectionState(): void {
    const currentBlocks: SmileitAssignmentBlockDraft[] = this.workflow.assignmentBlocks();
    const currentBlockIds: Set<string> = new Set(
      currentBlocks.map((block: SmileitAssignmentBlockDraft) => block.id),
    );

    this.manualDraftInspectionSubscriptions.forEach(
      (subscription: Subscription, blockId: string) => {
        if (!currentBlockIds.has(blockId)) {
          subscription.unsubscribe();
          this.manualDraftInspectionSubscriptions.delete(blockId);
          this.manualDraftInspections.update(
            (currentState: Record<string, SmileitStructureInspectionView | null>) => {
              const { [blockId]: _ignored, ...nextState } = currentState;
              return nextState;
            },
          );
          this.manualDraftInspectionErrors.update((currentState: Record<string, string | null>) => {
            const { [blockId]: _ignored, ...nextState } = currentState;
            return nextState;
          });
        }
      },
    );

    currentBlocks.forEach((block: SmileitAssignmentBlockDraft) => {
      if (block.draftManualSmiles.trim() === '') {
        this.setManualDraftInspection(block.id, null);
        this.setManualDraftInspectionError(block.id, null);
      }
    });
  }

  private resolveAtomIndexFromPointer(mouseEvent: MouseEvent): number | null {
    const atomIndexFromTarget: number | null = this.extractAtomIndexFromEvent(mouseEvent);
    if (atomIndexFromTarget !== null) {
      return atomIndexFromTarget;
    }

    return null;
  }

  private refreshCatalogDraftInspection(): void {
    const catalogDraftSmiles: string = this.workflow.catalogCreateSmiles().trim();
    this.catalogDraftInspectionSubscription?.unsubscribe();
    this.catalogDraftInspectionSubscription = null;

    if (catalogDraftSmiles === '') {
      this.catalogDraftInspection.set(null);
      this.catalogDraftInspectionError.set(null);
      return;
    }

    this.catalogDraftInspectionError.set(null);
    this.catalogDraftInspectionSubscription = this.jobsApiService
      .inspectSmileitStructure(catalogDraftSmiles)
      .subscribe({
        next: (inspectionResult: SmileitStructureInspectionView) => {
          if (this.workflow.catalogCreateSmiles().trim() !== catalogDraftSmiles) {
            return;
          }

          this.catalogDraftInspection.set(inspectionResult);
          this.ensureCatalogDefaultAnchorSelection(inspectionResult);
        },
        error: (requestError: Error) => {
          if (this.workflow.catalogCreateSmiles().trim() !== catalogDraftSmiles) {
            return;
          }

          this.catalogDraftInspection.set(null);
          this.catalogDraftInspectionError.set(
            `Unable to inspect substituent draft: ${requestError.message}`,
          );
        },
      });
  }

  private refreshManualDraftInspection(blockId: string): void {
    const blockDraft: SmileitAssignmentBlockDraft | undefined = this.workflow
      .assignmentBlocks()
      .find((block: SmileitAssignmentBlockDraft) => block.id === blockId);
    if (blockDraft === undefined) {
      return;
    }

    const manualDraftSmiles: string = blockDraft.draftManualSmiles.trim();
    this.manualDraftInspectionSubscriptions.get(blockId)?.unsubscribe();
    this.manualDraftInspectionSubscriptions.delete(blockId);

    if (manualDraftSmiles === '') {
      this.setManualDraftInspection(blockId, null);
      this.setManualDraftInspectionError(blockId, null);
      return;
    }

    this.setManualDraftInspectionError(blockId, null);
    const inspectionSubscription: Subscription = this.jobsApiService
      .inspectSmileitStructure(manualDraftSmiles)
      .subscribe({
        next: (inspectionResult: SmileitStructureInspectionView) => {
          const currentBlockDraft: SmileitAssignmentBlockDraft | undefined = this.workflow
            .assignmentBlocks()
            .find((block: SmileitAssignmentBlockDraft) => block.id === blockId);
          if (
            currentBlockDraft === undefined ||
            currentBlockDraft.draftManualSmiles.trim() !== manualDraftSmiles
          ) {
            return;
          }

          this.setManualDraftInspection(blockId, inspectionResult);
          this.ensureManualDefaultAnchorSelection(blockId, inspectionResult);
        },
        error: (requestError: Error) => {
          const currentBlockDraft: SmileitAssignmentBlockDraft | undefined = this.workflow
            .assignmentBlocks()
            .find((block: SmileitAssignmentBlockDraft) => block.id === blockId);
          if (
            currentBlockDraft === undefined ||
            currentBlockDraft.draftManualSmiles.trim() !== manualDraftSmiles
          ) {
            return;
          }

          this.setManualDraftInspection(blockId, null);
          this.setManualDraftInspectionError(
            blockId,
            `Unable to inspect manual substituent draft: ${requestError.message}`,
          );
        },
      });

    this.manualDraftInspectionSubscriptions.set(blockId, inspectionSubscription);
  }

  private syncVisibleLibraryPreviews(): void {
    const topLibraryEntries: SmileitCatalogEntryView[] = this.filteredLibraryGroups().flatMap(
      (group) => group.entries,
    );
    const blockCatalogEntries: SmileitCatalogEntryView[] = this.workflow
      .assignmentBlocks()
      .flatMap((block: SmileitAssignmentBlockDraft) => this.filteredCatalogEntriesForBlock(block));
    const blockReferencedEntries: SmileitCatalogEntryView[] = this.workflow
      .assignmentBlocks()
      .flatMap((block: SmileitAssignmentBlockDraft) => block.catalogRefs);

    const uniqueEntriesByPreviewKey: Map<string, SmileitCatalogEntryView> = new Map();
    [...topLibraryEntries, ...blockCatalogEntries, ...blockReferencedEntries].forEach(
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

  private ensureCatalogDefaultAnchorSelection(
    inspectionResult: SmileitStructureInspectionView,
  ): void {
    const currentAnchorIndices: number[] = this.catalogDraftAnchorIndices();
    const nextAnchorIndices: number[] = this.resolveSingleValidAnchorSelection(
      currentAnchorIndices,
      inspectionResult,
    );

    if (this.hasSameNumberSet(currentAnchorIndices, nextAnchorIndices)) {
      return;
    }

    this.workflow.catalogCreateAnchorIndicesText.set(this.formatAtomIndices(nextAnchorIndices));
  }

  private ensureManualDefaultAnchorSelection(
    blockId: string,
    inspectionResult: SmileitStructureInspectionView,
  ): void {
    const blockDraft: SmileitAssignmentBlockDraft | undefined = this.workflow
      .assignmentBlocks()
      .find((block: SmileitAssignmentBlockDraft) => block.id === blockId);
    if (blockDraft === undefined) {
      return;
    }

    const currentAnchorIndices: number[] = this.manualDraftAnchorIndices(blockDraft);
    const nextAnchorIndices: number[] = this.resolveValidAnchorSelection(
      currentAnchorIndices,
      inspectionResult,
    );

    if (this.hasSameNumberSet(currentAnchorIndices, nextAnchorIndices)) {
      return;
    }

    this.workflow.updateBlockManualDraftAnchors(blockId, this.formatAtomIndices(nextAnchorIndices));
  }

  private resolveValidAnchorSelection(
    currentAnchorIndices: number[],
    inspectionResult: SmileitStructureInspectionView,
  ): number[] {
    const validAnchorIndices: number[] = this.normalizeAnchorIndices(
      currentAnchorIndices.filter(
        (atomIndex: number) => atomIndex >= 0 && atomIndex < inspectionResult.atomCount,
      ),
    );

    if (validAnchorIndices.length > 0) {
      return validAnchorIndices;
    }

    return this.resolveDefaultAnchorIndices(inspectionResult);
  }

  private resolveSingleValidAnchorSelection(
    currentAnchorIndices: number[],
    inspectionResult: SmileitStructureInspectionView,
  ): number[] {
    return this.resolveValidAnchorSelection(currentAnchorIndices, inspectionResult).slice(0, 1);
  }

  private resolveDefaultAnchorIndices(inspectionResult: SmileitStructureInspectionView): number[] {
    const preferredAtomIndices: number[] = inspectionResult.atoms
      .filter((atom) => atom.symbol.trim().toUpperCase() !== 'H')
      .map((atom) => atom.index);

    if (preferredAtomIndices.length > 0) {
      return this.normalizeAnchorIndices(preferredAtomIndices);
    }

    return this.normalizeAnchorIndices(inspectionResult.atoms.map((atom) => atom.index));
  }

  private toggleAtomSelection(currentSelection: number[], atomIndex: number): number[] {
    const isAlreadySelected: boolean = currentSelection.includes(atomIndex);
    if (isAlreadySelected) {
      return this.normalizeAnchorIndices(
        currentSelection.filter((selectedAtomIndex: number) => selectedAtomIndex !== atomIndex),
      );
    }

    return this.normalizeAnchorIndices([...currentSelection, atomIndex]);
  }

  private parseAtomIndicesInput(rawText: string): number[] {
    const parsedValues: number[] = rawText
      .split(',')
      .map((part: string) => part.trim())
      .filter((part: string) => part !== '')
      .map((part: string) => Number(part))
      .filter((value: number) => Number.isInteger(value) && value >= 0);

    return this.normalizeAnchorIndices(parsedValues);
  }

  private normalizeAnchorIndices(anchorIndices: number[]): number[] {
    return Array.from(new Set(anchorIndices)).sort((left: number, right: number) => left - right);
  }

  private formatAtomIndices(anchorIndices: number[]): string {
    return anchorIndices.join(',');
  }

  private hasSameNumberSet(firstValues: number[], secondValues: number[]): boolean {
    if (firstValues.length !== secondValues.length) {
      return false;
    }

    return firstValues.every((value: number, index: number) => value === secondValues[index]);
  }

  private setManualDraftInspection(
    blockId: string,
    inspectionResult: SmileitStructureInspectionView | null,
  ): void {
    this.manualDraftInspections.update(
      (currentState: Record<string, SmileitStructureInspectionView | null>) => ({
        ...currentState,
        [blockId]: inspectionResult,
      }),
    );
  }

  private setManualDraftInspectionError(blockId: string, errorMessage: string | null): void {
    this.manualDraftInspectionErrors.update((currentState: Record<string, string | null>) => ({
      ...currentState,
      [blockId]: errorMessage,
    }));
  }

  /**
   * Extrae los nombres únicos de sustituyentes usados en una estructura generada.
   * Limita a los primeros 4 para no saturar la tarjeta visualmente.
   */
  getUniqueSubstituentsForStructure(structure: SmileitGeneratedStructureView): string[] {
    const uniqueNames: Set<string> = new Set(
      structure.traceability.map((traceEntry) => traceEntry.substituent_name),
    );
    return [...uniqueNames].slice(0, 4);
  }

  /**
   * Construye una etiqueta compuesta con el nombre del scaffold y los sustituyentes:
   * "Principal · Sus1 · Sus2" para mostrar en la cabecera del modal.
   */
  getDerivativeCompositeLabel(structure: SmileitGeneratedStructureView): string {
    const substituents: string[] = this.getUniqueSubstituentsForStructure(structure);
    if (substituents.length === 0) {
      return structure.name;
    }
    return `${structure.name}`;
  }

  openGeneratedStructureModal(generatedStructure: SmileitGeneratedStructureView): void {
    this.selectedGeneratedStructure.set(generatedStructure);
    const dialog: HTMLDialogElement | undefined = this.generatedStructureDialogRef?.nativeElement;
    if (dialog === undefined) {
      return;
    }
    if (dialog.open) {
      dialog.close();
    }
    try {
      dialog.showModal();
    } catch {
      dialog.setAttribute('open', 'true');
    }
  }

  closeGeneratedStructureModal(): void {
    const dialog: HTMLDialogElement | undefined = this.generatedStructureDialogRef?.nativeElement;
    if (dialog !== undefined && dialog.open) {
      dialog.close();
    }
    this.selectedGeneratedStructure.set(null);
  }

  onGeneratedStructureDialogClick(mouseEvent: MouseEvent): void {
    // Cierra al hacer click en el backdrop del dialog (área fuera del contenido)
    if (mouseEvent.target === this.generatedStructureDialogRef?.nativeElement) {
      this.closeGeneratedStructureModal();
    }
  }

  private downloadReport(
    downloadFactory: () => ReturnType<SmileitWorkflowService['downloadCsvReport']>,
  ): void {
    downloadFactory().subscribe({
      next: (downloadedFile: DownloadedReportFile) => {
        this.downloadFile(downloadedFile.filename, downloadedFile.blob);
      },
      error: () => {
        // El workflow expone el mensaje de error para la UI.
      },
    });
  }

  private extractAtomIndexFromEvent(mouseEvent: MouseEvent): number | null {
    const composedPathMethod: (() => EventTarget[]) | undefined =
      mouseEvent.composedPath?.bind(mouseEvent);

    if (composedPathMethod !== undefined) {
      const eventPath: EventTarget[] = composedPathMethod();
      for (const eventNode of eventPath) {
        if (!(eventNode instanceof Element)) {
          continue;
        }

        const atomIndexFromElement: number | null = this.extractAtomIndexFromElement(eventNode);
        if (atomIndexFromElement !== null) {
          return atomIndexFromElement;
        }
      }
    }

    return null;
  }

  private extractAtomIndexFromElement(svgElement: Element): number | null {
    let currentElement: Element | null = svgElement;
    while (currentElement !== null) {
      if (!this.isExplicitAtomSelectionTarget(currentElement)) {
        currentElement = currentElement.parentElement;
        continue;
      }

      const atomIndices: number[] = this.readAtomIndicesFromElement(currentElement);
      if (atomIndices.length > 0) {
        return atomIndices[0];
      }
      currentElement = currentElement.parentElement;
    }

    return null;
  }

  private isExplicitAtomSelectionTarget(svgElement: Element): boolean {
    if (svgElement.hasAttribute('data-atom-index')) {
      return true;
    }

    const normalizedClassText: string = this.normalizeClassText(svgElement.className);
    const rawId: string = svgElement.getAttribute('id') ?? '';
    const combinedIdentity: string = `${normalizedClassText} ${rawId}`.trim();
    if (combinedIdentity === '') {
      return false;
    }

    if (combinedIdentity.includes('bond-')) {
      return false;
    }

    return /(^|\s)smileit-atom-hit-zone(\s|$)|(^|\s)smileit-atom-selected-vertex(\s|$)|atom-\d+/.test(
      combinedIdentity,
    );
  }

  private findNearestAtomIndexByCoordinates(
    svgElement: Element,
    mouseEvent: MouseEvent,
  ): number | null {
    const rootSvg: SVGSVGElement | null = svgElement.closest('svg');
    if (rootSvg === null) {
      return null;
    }

    const candidates: NodeListOf<SVGGraphicsElement> = rootSvg.querySelectorAll(
      '[data-smileit-hit-zone="true"], [data-atom-index], [class*="atom-"], [id*="atom-"]',
    );

    let bestDistanceSquared: number = Number.POSITIVE_INFINITY;
    let bestAtomIndex: number | null = null;

    candidates.forEach((candidateElement: SVGGraphicsElement) => {
      const candidateAtomIndices: number[] = this.readAtomIndicesFromElement(candidateElement);
      if (candidateAtomIndices.length === 0) {
        return;
      }

      const candidateBox: DOMRect = candidateElement.getBoundingClientRect();
      if (candidateBox.width === 0 && candidateBox.height === 0) {
        return;
      }

      const centerX: number = candidateBox.left + candidateBox.width / 2;
      const centerY: number = candidateBox.top + candidateBox.height / 2;
      const deltaX: number = centerX - mouseEvent.clientX;
      const deltaY: number = centerY - mouseEvent.clientY;
      const distanceSquared: number = deltaX * deltaX + deltaY * deltaY;

      if (distanceSquared < bestDistanceSquared) {
        bestDistanceSquared = distanceSquared;
        bestAtomIndex = candidateAtomIndices[0];
      }
    });

    const maxDistanceSquared: number = 42 * 42;
    if (bestDistanceSquared <= maxDistanceSquared) {
      return bestAtomIndex;
    }

    return null;
  }

  private readAtomIndicesFromElement(svgElement: Element): number[] {
    const normalizedClassText: string = this.normalizeClassText(svgElement.className);
    const rawId: string = svgElement.getAttribute('id') ?? '';
    const rawDataAtomIndex: string = svgElement.getAttribute('data-atom-index') ?? '';

    const atomIndexCandidates: string[] = [
      normalizedClassText,
      rawId,
      rawDataAtomIndex.length > 0 ? `atom-${rawDataAtomIndex}` : '',
    ].filter((candidateText: string) => candidateText.trim() !== '');

    const parsedIndices: number[] = atomIndexCandidates.flatMap((candidateText: string) =>
      this.parseAtomIndices(candidateText),
    );

    return Array.from(new Set(parsedIndices));
  }

  private normalizeClassText(classNameValue: unknown): string {
    if (typeof classNameValue === 'string') {
      return classNameValue;
    }

    return ((classNameValue as { baseVal?: string } | null)?.baseVal ?? '').trim();
  }

  private parseAtomIndices(rawText: string): number[] {
    const atomRegex: RegExp = /atom-(\d+)/g;
    const indices: number[] = [];

    for (const regexMatch of rawText.matchAll(atomRegex)) {
      const rawIndex: string | undefined = regexMatch[1];
      if (rawIndex === undefined) {
        continue;
      }

      const parsedIndex: number = Number(rawIndex);
      if (Number.isInteger(parsedIndex) && parsedIndex >= 0) {
        indices.push(parsedIndex);
      }
    }

    return indices;
  }

  private decorateInspectionSvg(
    rawSvgMarkup: string,
    selectedAtomIndices: number[],
    annotations: Array<{
      pattern_stable_id: string;
      atom_indices: number[];
      color: string;
      caption: string;
      name: string;
      pattern_type: string;
    }>,
  ): string {
    if (rawSvgMarkup.trim() === '') {
      return rawSvgMarkup;
    }

    const domParser: DOMParser = new DOMParser();
    const parsedDocument: Document = domParser.parseFromString(rawSvgMarkup, 'image/svg+xml');
    const rootSvg: SVGSVGElement | null = parsedDocument.querySelector('svg');
    if (rootSvg === null) {
      return rawSvgMarkup;
    }

    const atomPositions: Map<number, { x: number; y: number }> =
      this.extractAtomPositionsFromBonds(rootSvg);
    this.ensureAtomHighlightStyle(rootSvg, parsedDocument);
    this.drawAnnotationOverlays(rootSvg, parsedDocument, annotations, atomPositions);
    this.drawAtomVertexOverlays(rootSvg, parsedDocument, selectedAtomIndices, atomPositions);

    return rootSvg.outerHTML;
  }

  private drawAnnotationOverlays(
    rootSvg: SVGSVGElement,
    parsedDocument: Document,
    annotations: Array<{
      pattern_stable_id: string;
      atom_indices: number[];
      color: string;
      caption: string;
      name: string;
      pattern_type: string;
    }>,
    atomPositions: Map<number, { x: number; y: number }>,
  ): void {
    rootSvg
      .querySelectorAll('[data-smileit-annotation-overlay="true"]')
      .forEach((overlayNode: Element) => {
        overlayNode.remove();
      });

    if (annotations.length === 0 || atomPositions.size === 0) {
      return;
    }

    const bondSegments: Array<{
      atomA: number;
      atomB: number;
      start: { x: number; y: number };
      end: { x: number; y: number };
      pathData: string;
    }> = this.extractBondSegmentsFromSvg(rootSvg);

    const svgNamespace: string = 'http://www.w3.org/2000/svg';
    const overlayGroup: SVGGElement = parsedDocument.createElementNS(
      svgNamespace,
      'g',
    ) as SVGGElement;
    overlayGroup.setAttribute('data-smileit-annotation-overlay', 'true');

    // Filtro de difuminado suave para cada anotación (estilo RDKit highlights).
    const defsElement: SVGDefsElement = parsedDocument.createElementNS(
      svgNamespace,
      'defs',
    ) as SVGDefsElement;

    const filterIds: Map<string, string> = new Map();
    annotations.forEach((annotation, annotationIndex: number) => {
      const filterId: string = `smileit-highlight-${annotationIndex}`;
      filterIds.set(annotation.pattern_stable_id, filterId);

      const highlightFilter: SVGFilterElement = parsedDocument.createElementNS(
        svgNamespace,
        'filter',
      ) as SVGFilterElement;
      highlightFilter.setAttribute('id', filterId);
      highlightFilter.setAttribute('x', '-60%');
      highlightFilter.setAttribute('y', '-60%');
      highlightFilter.setAttribute('width', '220%');
      highlightFilter.setAttribute('height', '220%');

      // Difuminar ligeramente para bordes suaves (no demasiado para que se vea).
      const blurElement: SVGFEGaussianBlurElement = parsedDocument.createElementNS(
        svgNamespace,
        'feGaussianBlur',
      ) as SVGFEGaussianBlurElement;
      blurElement.setAttribute('in', 'SourceGraphic');
      blurElement.setAttribute('stdDeviation', '2.2');
      highlightFilter.appendChild(blurElement);
      defsElement.appendChild(highlightFilter);
    });
    overlayGroup.appendChild(defsElement);

    // Dibujar highlights detrás de la molécula.
    annotations.forEach((annotation) => {
      const annotationAtomSet: Set<number> = new Set(annotation.atom_indices);
      const filterId: string = filterIds.get(annotation.pattern_stable_id) ?? '';

      // Highlight sobre enlaces del patrón: trazo amplio con color de anotación.
      bondSegments.forEach((bondSegment) => {
        if (
          !annotationAtomSet.has(bondSegment.atomA) ||
          !annotationAtomSet.has(bondSegment.atomB)
        ) {
          return;
        }

        const bondHighlight: SVGPathElement = parsedDocument.createElementNS(
          svgNamespace,
          'path',
        ) as SVGPathElement;
        bondHighlight.setAttribute('d', bondSegment.pathData);
        bondHighlight.setAttribute('fill', 'none');
        bondHighlight.setAttribute('stroke', annotation.color);
        bondHighlight.setAttribute('stroke-width', '12');
        bondHighlight.setAttribute('stroke-linecap', 'round');
        bondHighlight.setAttribute('stroke-linejoin', 'round');
        bondHighlight.setAttribute('stroke-opacity', '0.55');
        bondHighlight.setAttribute('filter', `url(#${filterId})`);
        bondHighlight.setAttribute('data-smileit-hit-zone', 'true');
        bondHighlight.setAttribute('style', 'pointer-events: none;');
        overlayGroup.appendChild(bondHighlight);
      });

      // Highlight sobre átomos: disco con color y opacidad alta para que sean visibles.
      annotation.atom_indices.forEach((atomIndex: number) => {
        const atomPosition = atomPositions.get(atomIndex);
        if (atomPosition === undefined) {
          return;
        }

        const atomHighlight: SVGCircleElement = parsedDocument.createElementNS(
          svgNamespace,
          'circle',
        ) as SVGCircleElement;
        atomHighlight.setAttribute('cx', atomPosition.x.toFixed(2));
        atomHighlight.setAttribute('cy', atomPosition.y.toFixed(2));
        atomHighlight.setAttribute('r', '8');
        atomHighlight.setAttribute('fill', annotation.color);
        atomHighlight.setAttribute('fill-opacity', '0.50');
        atomHighlight.setAttribute('stroke', 'none');
        atomHighlight.setAttribute('filter', `url(#${filterId})`);
        atomHighlight.setAttribute('data-smileit-hit-zone', 'true');
        atomHighlight.setAttribute('style', 'pointer-events: none;');
        overlayGroup.appendChild(atomHighlight);
      });
    });

    // Insertar el overlay ANTES del primer bond para mantener los colores originales
    // y a la vez evitar que quede oculto por el rectángulo de fondo del SVG.
    const firstBondNode: Element | null = rootSvg.querySelector(
      'path[class*="bond-"], line[class*="bond-"]',
    );
    if (firstBondNode !== null && firstBondNode.parentNode === rootSvg) {
      rootSvg.insertBefore(overlayGroup, firstBondNode);
      return;
    }

    // Fallback para SVGs que no tengan clases bond-*.
    rootSvg.appendChild(overlayGroup);
  }

  private drawAtomVertexOverlays(
    rootSvg: SVGSVGElement,
    parsedDocument: Document,
    selectedAtomIndices: number[],
    atomPositions: Map<number, { x: number; y: number }>,
  ): void {
    if (atomPositions.size === 0) {
      return;
    }

    rootSvg.querySelectorAll('[data-smileit-overlay="true"]').forEach((overlayNode: Element) => {
      overlayNode.remove();
    });

    const selectedAtomSet: Set<number> = new Set(selectedAtomIndices);
    const svgNamespace: string = 'http://www.w3.org/2000/svg';
    const overlayGroup: SVGGElement = parsedDocument.createElementNS(
      svgNamespace,
      'g',
    ) as SVGGElement;
    overlayGroup.setAttribute('data-smileit-overlay', 'true');

    for (const [atomIndex, atomPosition] of atomPositions.entries()) {
      const hitZoneCircle: SVGCircleElement = parsedDocument.createElementNS(
        svgNamespace,
        'circle',
      ) as SVGCircleElement;
      hitZoneCircle.setAttribute('cx', atomPosition.x.toFixed(2));
      hitZoneCircle.setAttribute('cy', atomPosition.y.toFixed(2));
      hitZoneCircle.setAttribute('r', '12');
      hitZoneCircle.setAttribute('fill', 'transparent');
      hitZoneCircle.setAttribute('stroke', 'transparent');
      hitZoneCircle.setAttribute('class', `smileit-atom-hit-zone atom-${atomIndex}`);
      hitZoneCircle.setAttribute('data-atom-index', String(atomIndex));
      hitZoneCircle.setAttribute('data-smileit-hit-zone', 'true');
      hitZoneCircle.setAttribute('style', 'pointer-events: all; cursor: crosshair;');
      overlayGroup.appendChild(hitZoneCircle);

      if (selectedAtomSet.has(atomIndex)) {
        const selectedCircle: SVGCircleElement = parsedDocument.createElementNS(
          svgNamespace,
          'circle',
        ) as SVGCircleElement;
        selectedCircle.setAttribute('cx', atomPosition.x.toFixed(2));
        selectedCircle.setAttribute('cy', atomPosition.y.toFixed(2));
        selectedCircle.setAttribute('r', '10');
        selectedCircle.setAttribute('class', `smileit-atom-selected-vertex atom-${atomIndex}`);
        selectedCircle.setAttribute('data-smileit-selected-vertex', 'true');
        selectedCircle.setAttribute('style', 'pointer-events: none;');
        overlayGroup.appendChild(selectedCircle);
      }
    }

    rootSvg.appendChild(overlayGroup);
  }

  private extractAtomPositionsFromBonds(
    rootSvg: SVGSVGElement,
  ): Map<number, { x: number; y: number }> {
    // Paso 1: extraer posiciones exactas desde elementos <text class="atom-N">.
    // RDKit acorta los bonds cuando hay etiquetas de heteroátomos (N, O, S…),
    // por lo que los endpoints de los paths NO coinciden con el centro real del átomo.
    // Los elementos <text> sí están posicionados en el centro del símbolo escrito.
    const atomPositions: Map<number, { x: number; y: number }> = new Map();

    rootSvg.querySelectorAll('text').forEach((textElement: Element) => {
      const classText: string = this.normalizeClassText(textElement.getAttribute('class') ?? '');
      const atomMatch: RegExpMatchArray | null = classText.match(/\batom-(\d+)\b/);
      if (atomMatch === null) {
        return;
      }
      const atomIndex: number = parseInt(atomMatch[1], 10);
      const x: number = parseFloat(textElement.getAttribute('x') ?? '');
      const y: number = parseFloat(textElement.getAttribute('y') ?? '');
      if (Number.isFinite(x) && Number.isFinite(y)) {
        atomPositions.set(atomIndex, { x, y });
      }
    });

    // Paso 2: centroide de todos los endpoints de bond para átomos sin etiqueta (carbono implícito).
    //
    // RDKit dibuja bonds dobles como DOS paths paralelos con la misma clase "bond-X atom-A atom-B".
    // Cada path está desplazado perpendicularmente desde el eje real del bond, de modo que:
    //   - path 1: start ≈ atomA + offset1,   end ≈ atomB + offset1
    //   - path 2: start ≈ atomA + offset2,   end ≈ atomB + offset2
    // Los offsets son simétricos (opuestos en signo), por lo que el CENTROIDE de todos los
    // "start" registrados para un átomo cancela el desplazamiento y da la posición real.
    // Para bonds simples hay un solo path, así que el centroide es trivialmente ese endpoint.
    //
    // Convención de RDKit: en un path "bond-X atom-A atom-B", la primera coordenada del path
    // siempre corresponde a atom-A y la última a atom-B (mismo orden que en el atributo class).
    const bondSegments = this.extractBondSegmentsFromSvg(rootSvg);
    if (bondSegments.length === 0) {
      return atomPositions;
    }

    // Acumular endpoints: start → atomA, end → atomB (solo átomos sin posición del paso 1).
    const endpointAccumulator: Map<number, Array<{ x: number; y: number }>> = new Map();

    for (const segment of bondSegments) {
      if (!atomPositions.has(segment.atomA)) {
        const list = endpointAccumulator.get(segment.atomA) ?? [];
        list.push(segment.start);
        endpointAccumulator.set(segment.atomA, list);
      }
      if (!atomPositions.has(segment.atomB)) {
        const list = endpointAccumulator.get(segment.atomB) ?? [];
        list.push(segment.end);
        endpointAccumulator.set(segment.atomB, list);
      }
    }

    // Calcular centroide por cada átomo acumulado.
    for (const [atomIndex, endpoints] of endpointAccumulator) {
      if (endpoints.length === 0) {
        continue;
      }
      const centroidX: number = endpoints.reduce((sum, p) => sum + p.x, 0) / endpoints.length;
      const centroidY: number = endpoints.reduce((sum, p) => sum + p.y, 0) / endpoints.length;
      atomPositions.set(atomIndex, { x: centroidX, y: centroidY });
    }

    return atomPositions;
  }

  private extractBondSegmentsFromSvg(rootSvg: SVGSVGElement): Array<{
    atomA: number;
    atomB: number;
    start: { x: number; y: number };
    end: { x: number; y: number };
    pathData: string;
  }> {
    const bondSegments: Array<{
      atomA: number;
      atomB: number;
      start: { x: number; y: number };
      end: { x: number; y: number };
      pathData: string;
    }> = [];

    rootSvg.querySelectorAll('path[class*="bond-"]').forEach((bondElement: Element) => {
      const classNameText: string = this.normalizeClassText(
        bondElement.getAttribute('class') ?? '',
      );
      const atomIndices: number[] = this.parseAtomIndices(classNameText);
      if (atomIndices.length < 2) {
        return;
      }

      const pathData: string = bondElement.getAttribute('d') ?? '';
      const endpoints = this.parseBondEndpoints(pathData);
      if (endpoints === null) {
        return;
      }

      bondSegments.push({
        atomA: atomIndices[0],
        atomB: atomIndices[1],
        start: endpoints.start,
        end: endpoints.end,
        pathData,
      });
    });

    return bondSegments;
  }

  private parseBondEndpoints(pathData: string): {
    start: { x: number; y: number };
    end: { x: number; y: number };
  } | null {
    const coordinatePairs: Array<{ x: number; y: number }> = Array.from(
      pathData.matchAll(/(-?\d*\.?\d+),(-?\d*\.?\d+)/g),
      (regexMatch) => ({
        x: Number(regexMatch[1]),
        y: Number(regexMatch[2]),
      }),
    ).filter((coordinate) => Number.isFinite(coordinate.x) && Number.isFinite(coordinate.y));

    if (coordinatePairs.length < 2) {
      return null;
    }

    return {
      start: coordinatePairs[0],
      end: coordinatePairs[coordinatePairs.length - 1],
    };
  }

  private distanceSquared(
    firstPoint: { x: number; y: number },
    secondPoint: { x: number; y: number },
  ): number {
    const deltaX: number = firstPoint.x - secondPoint.x;
    const deltaY: number = firstPoint.y - secondPoint.y;
    return deltaX * deltaX + deltaY * deltaY;
  }

  private ensureAtomHighlightStyle(rootSvg: SVGSVGElement, parsedDocument: Document): void {
    const existingStyleNode: HTMLStyleElement | null = parsedDocument.querySelector(
      'style[data-smileit-atom-highlight="true"]',
    );
    if (existingStyleNode !== null) {
      return;
    }

    const styleNode: HTMLStyleElement = parsedDocument.createElement('style');
    styleNode.setAttribute('data-smileit-atom-highlight', 'true');
    styleNode.textContent = `
      .smileit-atom-selected-vertex {
        stroke: #f97316 !important;
        fill: rgba(249, 115, 22, 0.08) !important;
        stroke-width: 3px !important;
      }
    `;

    rootSvg.insertBefore(styleNode, rootSvg.firstChild);
  }

  private downloadFile(filename: string, blob: Blob): void {
    const objectUrl: string = URL.createObjectURL(blob);
    const linkElement: HTMLAnchorElement = document.createElement('a');

    linkElement.href = objectUrl;
    linkElement.download = filename;
    linkElement.click();

    URL.revokeObjectURL(objectUrl);
  }
}

