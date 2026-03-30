// smileit.component.ts: Pantalla principal de Smile-it con bloques de asignación, análisis medicinal y exportes reproducibles.

import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
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
import JSZip from 'jszip';
import { Subscription, firstValueFrom } from 'rxjs';
import {
  DownloadedReportFile,
  JobLogEntryView,
  JobsApiService,
  ScientificJobView,
  SmileitCatalogEntryView,
  SmileitDerivationPageItemView,
  SmileitPatternEntryView,
  SmileitStructureInspectionView,
} from '../core/api/jobs-api.service';
import {
  SmileitAssignmentBlockDraft,
  SmileitBlockWorkflowService,
  SmileitCatalogWorkflowService,
  SmileitGeneratedStructureView,
  SmileitWorkflowService,
  SmileitWorkflowState,
} from '../core/application/smileit-workflow.service';
import { JobProgressCardComponent } from '../core/shared/components/job-progress-card/job-progress-card.component';
import { BlockAssignmentPanelComponent } from './block-assignment-panel/block-assignment-panel.component';
import { CatalogPanelComponent } from './catalog-panel/catalog-panel.component';
import { SmileitInspectionService } from './core/services/smileit-inspection.service';
import { PrincipalMoleculeEditorModule } from './principal-molecule/principal-molecule-editor.module';
import { PrincipalSvgViewerModule } from './principal-visualizer/principal-svg-viewer.module';
import {
  formatAtomIndices,
  hasSameNumberSet,
  parseAtomIndicesInput,
  resolveValidAnchorSelection,
  toggleAtomSelection,
} from './smileit-atom-selection.utils';

@Component({
  selector: 'app-smileit',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    PrincipalMoleculeEditorModule,
    PrincipalSvgViewerModule,
    JobProgressCardComponent,
    CatalogPanelComponent,
    BlockAssignmentPanelComponent,
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
  private readonly manualDraftInspectionSubscriptions = new Map<string, Subscription>();
  readonly isGeneratedStructuresCollapsed = signal<boolean>(true);
  readonly isLogsCollapsed = signal<boolean>(false);
  readonly isAdvancedSectionCollapsed = signal<boolean>(true);
  /** Cuántas estructuras generadas se muestran actualmente en el grid (paginación de 100 en 100) */
  readonly visibleStructuresCount = signal<number>(100);
  /** Estructuras realmente cargadas desde backend vía paginación. */
  readonly loadedGeneratedStructures = signal<SmileitGeneratedStructureView[]>([]);
  /** Cursor de paginación (offset absoluto) para pedir el siguiente lote de 100. */
  readonly generatedStructuresOffset = signal<number>(0);
  /** Bandera de carga incremental para el botón "Show 100 more". */
  readonly isLoadingGeneratedStructures = signal<boolean>(false);
  /** Firma del último resultado procesado para evitar recargar derivaciones en bucle. */
  readonly lastDerivationsReloadKey = signal<string>('');
  /** Descarga/armado ZIP de imágenes en progreso (independiente del job principal). */
  readonly isPreparingImagesZip = signal<boolean>(false);
  /** Porcentaje de progreso del proceso auxiliar de ZIP de imágenes. */
  readonly imagesZipProgress = signal<number>(0);
  readonly selectedGeneratedStructure = signal<SmileitGeneratedStructureView | null>(null);
  readonly selectedPatternForDetail = signal<SmileitPatternEntryView | null>(null);
  readonly patternEnabledState = signal<Record<string, boolean>>({});
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
  /** Resetea la paginación cada vez que llega un nuevo resultado (job nuevo o histórico) */
  private readonly visibleStructuresResetEffect = effect(
    () => {
      const resultData = this.workflow.resultData();
      const currentJobId: string | null = this.workflow.currentJobId();

      if (resultData === null || currentJobId === null) {
        this.lastDerivationsReloadKey.set('');
        this.visibleStructuresCount.set(100);
        this.loadedGeneratedStructures.set([]);
        this.generatedStructuresOffset.set(0);
        this.isGeneratedStructuresCollapsed.set(true);
        return;
      }

      const nextReloadKey = `${currentJobId}:${resultData.totalGenerated}:${resultData.isHistoricalSummary}`;
      if (this.lastDerivationsReloadKey() === nextReloadKey) {
        return;
      }

      this.lastDerivationsReloadKey.set(nextReloadKey);
      this.visibleStructuresCount.set(100);
      this.loadedGeneratedStructures.set([]);
      this.generatedStructuresOffset.set(0);
      this.isGeneratedStructuresCollapsed.set(true);
      this.loadNextGeneratedStructuresPage();
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

  /** Slice paginado de las estructuras generadas (primeras N visibles) */
  readonly visibleGeneratedStructures = computed<SmileitGeneratedStructureView[]>(() => {
    return this.loadedGeneratedStructures();
  });

  /** Indica si hay más derivados por cargar desde backend. */
  readonly hasMoreGeneratedStructures = computed<boolean>(() => {
    const resultData = this.workflow.resultData();
    if (resultData === null) {
      return false;
    }
    return this.loadedGeneratedStructures().length < resultData.totalGenerated;
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
  @ViewChild('libraryEntryDetailDialog')
  private libraryEntryDetailDialogRef?: ElementRef<HTMLDialogElement>;
  @ViewChild(CatalogPanelComponent)
  private catalogPanelComponentRef?: CatalogPanelComponent;
  @ViewChild('generatedStructureDialog')
  private generatedStructureDialogRef?: ElementRef<HTMLDialogElement>;
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
    this.manualDraftInspectionSyncEffect.destroy();
    this.patternEnabledStateSyncEffect.destroy();
    this.visibleStructuresResetEffect.destroy();
    this.routeSubscription?.unsubscribe();
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

  toggleGeneratedStructuresCollapse(): void {
    this.isGeneratedStructuresCollapsed.update((currentValue: boolean) => !currentValue);
  }

  toggleLogsCollapse(): void {
    this.isLogsCollapsed.update((currentValue: boolean) => !currentValue);
  }

  toggleAdvancedSectionCollapse(): void {
    this.isAdvancedSectionCollapsed.update((currentValue: boolean) => !currentValue);
  }

  /** Muestra 100 estructuras adicionales en el grid paginado */
  showMoreStructures(): void {
    this.loadNextGeneratedStructuresPage();
  }

  /**
   * Descarga todas las estructuras generadas en un ZIP.
   * Incluye un SVG por estructura y un único TXT con todos los SMILES generados.
   */
  async downloadVisibleStructuresZip(): Promise<void> {
    const resultData = this.workflow.resultData();
    const currentJobId: string | null = this.workflow.currentJobId();
    if (resultData === null || currentJobId === null || this.isPreparingImagesZip()) {
      return;
    }

    this.isPreparingImagesZip.set(true);
    this.imagesZipProgress.set(0);
    this.workflow.exportErrorMessage.set(null);

    try {
      const serverZip = await firstValueFrom(
        this.jobsApiService.downloadSmileitImagesZipServer(currentJobId),
      );
      this.downloadFile(serverZip.filename, serverZip.blob);
      this.imagesZipProgress.set(100);
      return;
    } catch {
      // Fallback automático: si backend ZIP falla, se vuelve al armado local existente.
      this.imagesZipProgress.set(5);
    }

    try {
      await this.downloadVisibleStructuresZipClientFallback(currentJobId, resultData);
    } catch {
      this.workflow.exportErrorMessage.set(
        'Unable to generate ZIP with all derivative images. Please retry.',
      );
    } finally {
      this.isPreparingImagesZip.set(false);
    }
  }

  /** Mantiene el flujo histórico en cliente como respaldo cuando backend ZIP no está disponible. */
  private async downloadVisibleStructuresZipClientFallback(
    currentJobId: string,
    resultData: {
      totalGenerated: number;
      exportNameBase: string;
      principalSmiles: string;
    },
  ): Promise<void> {
    const structures: SmileitGeneratedStructureView[] = await this.loadAllDerivationsForZip(
      currentJobId,
      resultData.totalGenerated,
    );
    const exportBase = this.sanitizeFilenameSegment(resultData.exportNameBase || 'smileit');
    const zip = new JSZip();
    const smilesLines: string[] =
      resultData.principalSmiles.trim() === '' ? [] : [resultData.principalSmiles.trim()];
    const usedNames = new Set<string>();
    const structureFileNames: string[] = [];

    structures.forEach((structure: SmileitGeneratedStructureView, index: number) => {
      smilesLines.push(structure.smiles);

      const safeBaseName =
        this.sanitizeFilenameSegment(structure.name) ||
        `structure_${String(index + 1).padStart(5, '0')}`;
      let fileBase = safeBaseName;
      let suffix = 2;
      while (usedNames.has(fileBase)) {
        fileBase = `${safeBaseName}_${suffix}`;
        suffix += 1;
      }
      usedNames.add(fileBase);
      structureFileNames.push(fileBase);
    });

    // Balance entre velocidad y carga del backend: resolver SVG en lotes pequeños.
    const ZIP_SVG_CONCURRENCY = 4;
    let resolvedCount = 0;

    for (let chunkStart = 0; chunkStart < structures.length; chunkStart += ZIP_SVG_CONCURRENCY) {
      const chunkEnd = Math.min(chunkStart + ZIP_SVG_CONCURRENCY, structures.length);
      const chunkStructures = structures.slice(chunkStart, chunkEnd);
      const chunkSvgs = await Promise.all(
        chunkStructures.map((structure: SmileitGeneratedStructureView) =>
          this.resolveStructureSvgForZip(currentJobId, structure),
        ),
      );

      chunkSvgs.forEach((svgMarkup: string, chunkIndex: number) => {
        const absoluteIndex = chunkStart + chunkIndex;
        if (svgMarkup.trim() !== '') {
          zip.file(`${structureFileNames[absoluteIndex]}.svg`, svgMarkup);
        }
      });

      resolvedCount += chunkSvgs.length;
      const fetchProgress =
        structures.length === 0 ? 0 : Math.round((resolvedCount / structures.length) * 80);
      this.imagesZipProgress.set(fetchProgress);
    }

    zip.file('generated_smiles.txt', smilesLines.join('\n'));

    const zipBlob: Blob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
      const zipProgress = 80 + Math.round(metadata.percent * 0.2);
      this.imagesZipProgress.set(Math.min(100, zipProgress));
    });
    this.downloadFile(`${exportBase}_structures.zip`, zipBlob);
    this.imagesZipProgress.set(100);
  }

  /** Carga todas las derivaciones en lotes de 100 para export global de imágenes. */
  private async loadAllDerivationsForZip(
    jobId: string,
    totalGenerated: number,
  ): Promise<SmileitGeneratedStructureView[]> {
    const items: SmileitGeneratedStructureView[] = [];
    let offset = 0;
    const limit = 100;

    while (offset < totalGenerated) {
      const cachedPageItems = this.readDerivationsPageFromSessionCache(jobId, offset, limit);
      const pageResponse =
        cachedPageItems === null
          ? await firstValueFrom(this.jobsApiService.listSmileitDerivations(jobId, offset, limit))
          : {
              totalGenerated,
              offset,
              limit,
              items: cachedPageItems,
            };

      if (cachedPageItems === null) {
        this.storeDerivationsPageInSessionCache(jobId, offset, limit, pageResponse.items);
      }
      const mappedItems = pageResponse.items.map((item: SmileitDerivationPageItemView) =>
        this.mapDerivationItemToView(item),
      );
      items.push(...mappedItems);
      offset += mappedItems.length;
      if (mappedItems.length === 0) {
        break;
      }
    }

    return items;
  }

  /** Resuelve SVG para export (cache detalle > cache thumb > fetch on-demand). */
  private async resolveStructureSvgForZip(
    jobId: string,
    structure: SmileitGeneratedStructureView,
  ): Promise<string> {
    if (structure.structureIndex === undefined) {
      return structure.svg;
    }

    const cachedDetailSvg = this.readSvgFromSessionCache(jobId, structure.structureIndex, 'detail');
    if (cachedDetailSvg.trim() !== '') {
      return cachedDetailSvg;
    }

    const cachedThumbSvg = this.readSvgFromSessionCache(jobId, structure.structureIndex, 'thumb');
    if (cachedThumbSvg.trim() !== '') {
      return cachedThumbSvg;
    }

    const fetchedSvg = await firstValueFrom(
      this.jobsApiService.getSmileitDerivationSvg(jobId, structure.structureIndex, 'detail'),
    );
    this.storeSvgInSessionCache(jobId, structure.structureIndex, 'detail', fetchedSvg);
    this.storeSvgInSessionCache(jobId, structure.structureIndex, 'thumb', fetchedSvg);
    return fetchedSvg;
  }

  /** Carga siguiente página de derivados (100 items) y precalienta SVG en cache de sesión. */
  private loadNextGeneratedStructuresPage(): void {
    const currentJobId: string | null = this.workflow.currentJobId();
    const resultData = this.workflow.resultData();
    if (currentJobId === null || resultData === null || this.isLoadingGeneratedStructures()) {
      return;
    }

    if (resultData.totalGenerated <= 0) {
      return;
    }

    if (this.loadedGeneratedStructures().length >= resultData.totalGenerated) {
      return;
    }

    const offset = this.generatedStructuresOffset();
    const limit = 100;
    this.isLoadingGeneratedStructures.set(true);

    const cachedPageItems = this.readDerivationsPageFromSessionCache(currentJobId, offset, limit);
    if (cachedPageItems !== null) {
      const nextItems: SmileitGeneratedStructureView[] = cachedPageItems.map(
        (item: SmileitDerivationPageItemView) => this.mapDerivationItemToView(item),
      );
      this.loadedGeneratedStructures.update((currentItems: SmileitGeneratedStructureView[]) => [
        ...currentItems,
        ...nextItems,
      ]);
      this.generatedStructuresOffset.set(offset + nextItems.length);
      this.visibleStructuresCount.set(this.loadedGeneratedStructures().length);
      this.hydrateThumbnailsForStructures(nextItems);
      this.isLoadingGeneratedStructures.set(false);
      return;
    }

    this.jobsApiService.listSmileitDerivations(currentJobId, offset, limit).subscribe({
      next: (pageResponse) => {
        this.storeDerivationsPageInSessionCache(currentJobId, offset, limit, pageResponse.items);
        const nextItems: SmileitGeneratedStructureView[] = pageResponse.items.map(
          (item: SmileitDerivationPageItemView) => this.mapDerivationItemToView(item),
        );
        this.loadedGeneratedStructures.update((currentItems: SmileitGeneratedStructureView[]) => [
          ...currentItems,
          ...nextItems,
        ]);
        this.generatedStructuresOffset.set(offset + nextItems.length);
        this.visibleStructuresCount.set(this.loadedGeneratedStructures().length);
        this.hydrateThumbnailsForStructures(nextItems);
        this.isLoadingGeneratedStructures.set(false);
      },
      error: (errorResponse: unknown) => {
        this.isLoadingGeneratedStructures.set(false);

        const httpError = errorResponse as HttpErrorResponse;
        if (httpError?.status === 404) {
          // Compatibilidad: si backend no expone derivations, usar snapshot embebido cuando exista.
          const embeddedStructures = resultData.generatedStructures ?? [];
          if (embeddedStructures.length > 0) {
            this.loadedGeneratedStructures.set(embeddedStructures);
            this.generatedStructuresOffset.set(embeddedStructures.length);
            this.visibleStructuresCount.set(embeddedStructures.length);
            return;
          }
          // Evita reintentos infinitos si el endpoint no existe en el backend activo.
          this.generatedStructuresOffset.set(resultData.totalGenerated);
          this.workflow.errorMessage.set(
            'Derivations endpoint is not available in backend. Please restart backend with latest changes.',
          );
          return;
        }

        this.workflow.errorMessage.set('Unable to load paginated derivatives.');
      },
    });
  }

  /** Convierte el item paginado del backend al contrato usado por la vista de tarjetas. */
  private mapDerivationItemToView(
    item: SmileitDerivationPageItemView,
  ): SmileitGeneratedStructureView {
    const normalizedName: string = item.name.trim();
    const currentJobId: string | null = this.workflow.currentJobId();
    const cachedSvg =
      currentJobId === null
        ? ''
        : this.readSvgFromSessionCache(currentJobId, item.structureIndex, 'thumb');

    return {
      structureIndex: item.structureIndex,
      name:
        normalizedName === '' ? `Generated molecule ${item.structureIndex + 1}` : normalizedName,
      smiles: item.smiles,
      svg: cachedSvg,
      placeholderAssignments: item.placeholderAssignments,
      traceability: item.traceability,
    };
  }

  /** Precarga SVG thumbnail solo para los nuevos items visibles usando cache por sesión. */
  private hydrateThumbnailsForStructures(structures: SmileitGeneratedStructureView[]): void {
    const currentJobId: string | null = this.workflow.currentJobId();
    if (currentJobId === null) {
      return;
    }

    structures.forEach((structureItem: SmileitGeneratedStructureView) => {
      if (structureItem.svg.trim() !== '' || structureItem.structureIndex === undefined) {
        return;
      }

      this.jobsApiService
        .getSmileitDerivationSvg(currentJobId, structureItem.structureIndex, 'thumb')
        .subscribe({
          next: (svgMarkup: string) => {
            this.storeSvgInSessionCache(
              currentJobId,
              structureItem.structureIndex!,
              'thumb',
              svgMarkup,
            );
            this.patchLoadedStructureSvg(structureItem.structureIndex!, svgMarkup);
          },
          error: () => {
            // Mantener tarjeta usable sin bloquear UX si un thumbnail puntual falla.
          },
        });
    });
  }

  /** Actualiza el SVG de un derivado ya cargado sin perder orden del grid. */
  private patchLoadedStructureSvg(structureIndex: number, svgMarkup: string): void {
    this.loadedGeneratedStructures.update((currentItems: SmileitGeneratedStructureView[]) =>
      currentItems.map((item: SmileitGeneratedStructureView) => {
        if (item.structureIndex !== structureIndex) {
          return item;
        }
        return {
          ...item,
          svg: svgMarkup,
        };
      }),
    );
  }

  /** Lee SVG cacheado en sessionStorage para evitar round-trips repetidos. */
  private readSvgFromSessionCache(
    jobId: string,
    structureIndex: number,
    variant: 'thumb' | 'detail',
  ): string {
    try {
      const cacheKey = `smileit:${jobId}:svg:${variant}:${structureIndex}`;
      return sessionStorage.getItem(cacheKey) ?? '';
    } catch {
      return '';
    }
  }

  /** Guarda SVG en cache de sesión para reutilización durante la misma pestaña. */
  private storeSvgInSessionCache(
    jobId: string,
    structureIndex: number,
    variant: 'thumb' | 'detail',
    svgMarkup: string,
  ): void {
    try {
      const cacheKey = `smileit:${jobId}:svg:${variant}:${structureIndex}`;
      sessionStorage.setItem(cacheKey, svgMarkup);
    } catch {
      // Ignorar quota errors para no interrumpir la interacción.
    }
  }

  /** Lee una página de derivados cacheada por sesión para evitar refetch de lotes de 100. */
  private readDerivationsPageFromSessionCache(
    jobId: string,
    offset: number,
    limit: number,
  ): SmileitDerivationPageItemView[] | null {
    try {
      const cacheKey = `smileit:${jobId}:page:${offset}:${limit}`;
      const rawValue = sessionStorage.getItem(cacheKey);
      if (rawValue === null || rawValue.trim() === '') {
        return null;
      }
      const parsedItems = JSON.parse(rawValue);
      if (!Array.isArray(parsedItems)) {
        return null;
      }
      return parsedItems as SmileitDerivationPageItemView[];
    } catch {
      return null;
    }
  }

  /** Persiste en sesión una página de derivados para reutilizarla en recargas de la vista. */
  private storeDerivationsPageInSessionCache(
    jobId: string,
    offset: number,
    limit: number,
    items: SmileitDerivationPageItemView[],
  ): void {
    try {
      const cacheKey = `smileit:${jobId}:page:${offset}:${limit}`;
      sessionStorage.setItem(cacheKey, JSON.stringify(items));
    } catch {
      // Ignorar quota errors para no interrumpir la UX.
    }
  }

  /** Limpia un segmento de nombre de archivo: no-alfanumérico → "_", colapsa repetidos, trunca a 40 chars */
  private sanitizeFilenameSegment(name: string): string {
    return (
      name
        .replace(/[^a-zA-Z0-9]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 40) || 'structure'
    );
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

  onBlockManualDraftSmilesChange(blockId: string, nextValue: string): void {
    this.workflow.blocks.updateBlockManualDraftSmiles(blockId, nextValue);
    this.refreshManualDraftInspection(blockId);
  }

  addManualSubstituentToBlock(blockId: string): void {
    this.workflow.blocks.addManualSubstituentToBlock(blockId);
    this.refreshManualDraftInspection(blockId);
  }

  selectedManualDraftLabel(block: SmileitAssignmentBlockDraft): string {
    const normalizedName: string = block.draftManualName.trim();
    if (normalizedName !== '') {
      return normalizedName;
    }

    const normalizedSmiles: string = block.draftManualSmiles.trim();
    return normalizedSmiles !== '' ? normalizedSmiles : 'No substituent molecule selected';
  }

  manualDraftAnchorIndices(block: SmileitAssignmentBlockDraft): number[] {
    return parseAtomIndicesInput(block.draftManualAnchorIndicesText);
  }

  manualDraftInspection(blockId: string): SmileitStructureInspectionView | null {
    return this.manualDraftInspections()[blockId] ?? null;
  }

  manualDraftInspectionError(blockId: string): string | null {
    return this.manualDraftInspectionErrors()[blockId] ?? null;
  }

  toggleManualDraftAnchor(blockId: string, atomIndex: number): void {
    const blockDraft: SmileitAssignmentBlockDraft | undefined = this.workflow
      .assignmentBlocks()
      .find((block: SmileitAssignmentBlockDraft) => block.id === blockId);
    if (blockDraft === undefined) {
      return;
    }

    const nextAnchorIndices: number[] = toggleAtomSelection(
      this.manualDraftAnchorIndices(blockDraft),
      atomIndex,
    );
    this.workflow.blocks.updateBlockManualDraftAnchors(
      blockId,
      formatAtomIndices(nextAnchorIndices),
    );
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

  toNumber(rawValue: number | string): number {
    return Number(rawValue);
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

  historicalStatusClass(jobStatus: ScientificJobView['status']): string {
    return `history-status history-${jobStatus}`;
  }

  historicalJobDisplayName(historyJob: ScientificJobView): string {
    const jobParameters = historyJob.parameters as Record<string, unknown> | null;
    const exportBaseName = jobParameters?.['export_name_base'];
    if (
      typeof exportBaseName === 'string' &&
      exportBaseName.trim() !== '' &&
      exportBaseName.trim().toLowerCase() !== 'smileit_run'
    ) {
      return exportBaseName;
    }
    return `Enumeration ${historyJob.id.slice(0, 8)}`;
  }

  historicalJobPrincipalSmiles(historyJob: ScientificJobView): string {
    const jobParameters = historyJob.parameters as Record<string, unknown> | null;
    const principalSmiles = jobParameters?.['principal_smiles'];
    if (typeof principalSmiles === 'string' && principalSmiles.trim() !== '') {
      return principalSmiles;
    }
    return 'Principal SMILES not available';
  }

  historicalJobBlockSummaries(
    historyJob: ScientificJobView,
  ): Array<{ label: string; positions: string; smiles: string }> {
    const jobParameters = historyJob.parameters as Record<string, unknown> | null;
    const rawBlocks = jobParameters?.['assignment_blocks'];
    if (!Array.isArray(rawBlocks)) {
      return [];
    }

    return rawBlocks.map((rawBlock: unknown, blockIndex: number) => {
      const normalizedBlock =
        rawBlock !== null && typeof rawBlock === 'object'
          ? (rawBlock as Record<string, unknown>)
          : ({} as Record<string, unknown>);

      const blockLabel =
        typeof normalizedBlock['label'] === 'string' && normalizedBlock['label'].trim() !== ''
          ? normalizedBlock['label']
          : `Block ${blockIndex + 1}`;

      const rawPositions = normalizedBlock['site_atom_indices'];
      const positions = Array.isArray(rawPositions)
        ? rawPositions
            .map((positionValue: unknown) => String(positionValue))
            .filter((positionValue: string) => positionValue.trim() !== '')
            .join(', ')
        : 'Not assigned';

      const rawResolvedSubstituents = normalizedBlock['resolved_substituents'];
      const uniqueSmiles = new Set<string>();
      if (Array.isArray(rawResolvedSubstituents)) {
        rawResolvedSubstituents.forEach((rawSubstituent: unknown) => {
          if (rawSubstituent === null || typeof rawSubstituent !== 'object') {
            return;
          }
          const substituentSmiles = (rawSubstituent as Record<string, unknown>)['smiles'];
          if (typeof substituentSmiles === 'string' && substituentSmiles.trim() !== '') {
            uniqueSmiles.add(substituentSmiles.trim());
          }
        });
      }

      return {
        label: blockLabel,
        positions,
        smiles: uniqueSmiles.size > 0 ? [...uniqueSmiles].join(' | ') : 'No substituent SMILES',
      };
    });
  }

  structureSubstitutionsLabel(structure: SmileitGeneratedStructureView): string {
    const substituentNames = this.getUniqueSubstituentsForStructure(structure);
    if (substituentNames.length === 0) {
      return 'No explicit substituent assignment';
    }
    return substituentNames.join(' | ');
  }

  structureDisplayName(structure: SmileitGeneratedStructureView, index: number): string {
    const trimmedName = structure.name.trim();
    if (/^smileit_run_\d+$/i.test(trimmedName)) {
      return `Derivative ${index + 1}`;
    }
    return trimmedName === '' ? `Derivative ${index + 1}` : trimmedName;
  }

  placeholderAssignmentsForStructure(structure: SmileitGeneratedStructureView): Array<{
    placeholderLabel: string;
    siteAtomIndex: number;
    substituentName: string;
    substituentSmiles?: string;
  }> {
    return structure.placeholderAssignments;
  }

  placeholderAssignmentLabel(
    structure: SmileitGeneratedStructureView,
    placeholderAssignment: {
      placeholderLabel: string;
      siteAtomIndex: number;
      substituentName: string;
      substituentSmiles?: string;
    },
  ): string {
    const substituentDescriptor =
      placeholderAssignment.substituentSmiles?.trim() !== ''
        ? placeholderAssignment.substituentSmiles?.trim()
        : placeholderAssignment.substituentName;
    const duplicateAssignments = this.placeholderAssignmentsForStructure(structure).filter(
      (assignmentItem) => assignmentItem.siteAtomIndex === placeholderAssignment.siteAtomIndex,
    );
    const siteSuffix = duplicateAssignments.length > 1 ? ' (reused site)' : '';
    return `${placeholderAssignment.placeholderLabel} = ${substituentDescriptor} · site ${placeholderAssignment.siteAtomIndex}${siteSuffix}`;
  }

  structurePlaceholderSummary(structure: SmileitGeneratedStructureView): string {
    const placeholderAssignments = this.placeholderAssignmentsForStructure(structure);
    if (placeholderAssignments.length === 0) {
      return 'No placeholder assignments available';
    }

    return placeholderAssignments
      .map((placeholderAssignment) =>
        this.placeholderAssignmentLabel(structure, placeholderAssignment),
      )
      .join(' | ');
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
    return this.inspectionService.extractAtomIndexFromEvent(mouseEvent);
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
    const nextAnchorIndices: number[] = resolveValidAnchorSelection(
      currentAnchorIndices,
      inspectionResult,
    );

    if (hasSameNumberSet(currentAnchorIndices, nextAnchorIndices)) {
      return;
    }

    this.workflow.blocks.updateBlockManualDraftAnchors(
      blockId,
      formatAtomIndices(nextAnchorIndices),
    );
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
    const currentJobId: string | null = this.workflow.currentJobId();
    const structureIndex = generatedStructure.structureIndex;

    if (currentJobId !== null && structureIndex !== undefined) {
      const cachedDetailSvg = this.readSvgFromSessionCache(currentJobId, structureIndex, 'detail');
      if (cachedDetailSvg.trim() !== '') {
        const structureWithSvg: SmileitGeneratedStructureView = {
          ...generatedStructure,
          svg: cachedDetailSvg,
        };
        this.selectedGeneratedStructure.set(structureWithSvg);
        this.patchLoadedStructureSvg(structureIndex, cachedDetailSvg);
      } else {
        this.selectedGeneratedStructure.set(generatedStructure);
        this.jobsApiService
          .getSmileitDerivationSvg(currentJobId, structureIndex, 'detail')
          .subscribe({
            next: (svgMarkup: string) => {
              this.storeSvgInSessionCache(currentJobId, structureIndex, 'detail', svgMarkup);
              this.storeSvgInSessionCache(currentJobId, structureIndex, 'thumb', svgMarkup);
              const updatedStructure: SmileitGeneratedStructureView = {
                ...generatedStructure,
                svg: svgMarkup,
              };
              this.selectedGeneratedStructure.set(updatedStructure);
              this.patchLoadedStructureSvg(structureIndex, svgMarkup);
            },
            error: () => {
              // Mantener modal abierto aun si falla el fetch de SVG.
            },
          });
      }
    } else {
      this.selectedGeneratedStructure.set(generatedStructure);
    }

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

  private downloadFile(filename: string, blob: Blob): void {
    const objectUrl: string = URL.createObjectURL(blob);
    const linkElement: HTMLAnchorElement = document.createElement('a');

    linkElement.href = objectUrl;
    linkElement.download = filename;
    linkElement.click();

    URL.revokeObjectURL(objectUrl);
  }
}
