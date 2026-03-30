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
import { Subscription } from 'rxjs';
import {
  JobLogEntryView,
  JobsApiService,
  SmileitCatalogEntryView,
  SmileitPatternEntryView,
  SmileitStructureInspectionView,
} from '../core/api/jobs-api.service';
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

@Component({
  selector: 'app-smileit',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    PrincipalMoleculeEditorModule,
    PrincipalSvgViewerModule,
    CatalogPanelComponent,
    BlockAssignmentPanelComponent,
    GenerationResultPanelComponent,
    LibraryEntryDetailDialogComponent,
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
  private readonly route = inject(ActivatedRoute);
  private routeSubscription: Subscription | null = null;
  readonly isLogsCollapsed = signal<boolean>(false);
  readonly isAdvancedSectionCollapsed = signal<boolean>(true);
  readonly selectedPatternForDetail = signal<SmileitPatternEntryView | null>(null);
  readonly patternEnabledState = signal<Record<string, boolean>>({});
  readonly selectedLibraryEntryForDetail = signal<SmileitCatalogEntryView | null>(null);
  readonly libraryDetailOpenContext = signal<'browser' | 'reference'>('browser');
  readonly libraryEntryInspections = signal<Record<string, SmileitStructureInspectionView | null>>(
    {},
  );
  readonly libraryEntryInspectionErrors = signal<Record<string, string | null>>({});
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
  private patternCatalogDialogRef?: ElementRef<HTMLDialogElement>;
  @ViewChild('patternDetailDialog')
  private patternDetailDialogRef?: ElementRef<HTMLDialogElement>;

  readonly patternEntries = computed<SmileitPatternEntryView[]>(() => {
    const rawPatterns: unknown = this.workflow.patterns() as unknown;
    return Array.isArray(rawPatterns) ? (rawPatterns as SmileitPatternEntryView[]) : [];
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
  private catalogPanelComponentRef?: CatalogPanelComponent;
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
        this.workflow.catalog.isCatalogEntryReferenced(block, catalogEntry),
      );
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
    if (this.workflow.isProcessing()) return;

    const atomIndexFromPointer: number | null = this.resolveAtomIndexFromPointer(mouseEvent);
    if (atomIndexFromPointer !== null) {
      this.workflow.toggleSelectedAtom(atomIndexFromPointer);
      return;
    }
  }

  private resolveAtomIndexFromPointer(mouseEvent: MouseEvent): number | null {
    return this.inspectionService.extractAtomIndexFromEvent(mouseEvent);
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
