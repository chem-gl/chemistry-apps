// catalog-panel.component.ts: Panel de catálogo de sustituyentes persistentes para Smile-it.
// Permite crear, editar y explorar entradas de catálogo con un editor visual paso a paso,
// sketcher Ketcher integrado y navegación por grupos filtrables.
// Emite eventos al padre para acciones que requieren dialogs a nivel de shell (ej. detalle de entrada).

import { CommonModule } from '@angular/common';
import {
    Component,
    ElementRef,
    OnDestroy,
    ViewChild,
    computed,
    inject,
    input,
    output,
    signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml, SafeResourceUrl } from '@angular/platform-browser';
import { Subscription } from 'rxjs';
import {
    JobsApiService,
    SmileitCatalogEntryView,
    SmileitStructureInspectionView,
} from '../../core/api/jobs-api.service';
import { SmileitWorkflowService } from '../../core/application/smileit-workflow.service';
import { SmileitInspectionService } from '../core/services/smileit-inspection.service';
import {
    formatAtomIndices,
    hasSameNumberSet,
    parseAtomIndicesInput,
} from '../smileit-atom-selection.utils';

@Component({
  selector: 'app-catalog-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './catalog-panel.component.html',
  styleUrl: './catalog-panel.component.scss',
})
export class CatalogPanelComponent implements OnDestroy {
  // --- Entradas desde el componente padre ---
  /** Cache compartido de inspecciones de entradas de catálogo (lectura por clave preview). */
  readonly libraryEntryInspections =
    input.required<Record<string, SmileitStructureInspectionView | null>>();
  /** Cache compartido de errores de inspección de entradas de catálogo. */
  readonly libraryEntryInspectionErrors = input.required<Record<string, string | null>>();

  // --- Salidas hacia el componente padre ---
  /** Emite cuando el usuario hace clic en una miniatura para ver el detalle completo. */
  readonly libraryEntryDetailRequested = output<SmileitCatalogEntryView>();

  // --- Servicios inyectados desde el árbol de inyectores del padre ---
  readonly workflow = inject(SmileitWorkflowService);
  private readonly inspectionService = inject(SmileitInspectionService);
  private readonly jobsApiService = inject(JobsApiService);
  private readonly sanitizer = inject(DomSanitizer);

  // --- Estado interno del panel ---
  private catalogDraftInspectionSubscription: Subscription | null = null;
  readonly isCatalogPanelCollapsed = signal<boolean>(true);
  readonly catalogDraftInspection = signal<SmileitStructureInspectionView | null>(null);
  readonly catalogDraftInspectionError = signal<string | null>(null);
  readonly selectedLibraryGroupKey = signal<string>('all');
  readonly isCatalogSmilesSketcherReady = signal<boolean>(false);
  readonly isCatalogSmilesSketchLoading = signal<boolean>(false);
  readonly catalogSketchValidationError = signal<string | null>(null);
  readonly catalogSmilesKetcherUrl: SafeResourceUrl =
    this.sanitizer.bypassSecurityTrustResourceUrl('/ketcher/index.html');
  private hasCompletedFirstCatalogSketchLoad = false;

  // --- Computed ---
  /** Grupos de catálogo filtrados por la clave de grupo seleccionada. */
  readonly filteredLibraryGroups = computed(() => {
    const selectedGroupKey = this.selectedLibraryGroupKey();
    const availableGroups = this.workflow.catalogGroups();
    if (selectedGroupKey === 'all') {
      return availableGroups;
    }
    const matchingGroups = availableGroups.filter((group) => group.key === selectedGroupKey);
    return matchingGroups.length > 0 ? matchingGroups : availableGroups;
  });

  /** Lista plana de entradas visibles según el filtro de grupo activo. */
  readonly filteredLibraryEntries = computed<SmileitCatalogEntryView[]>(() => {
    const deduplicatedEntriesByKey: Map<string, SmileitCatalogEntryView> = new Map();

    this.filteredLibraryGroups()
      .flatMap((group) => group.entries)
      .forEach((catalogEntry: SmileitCatalogEntryView) => {
        const dedupeKey: string =
          `${catalogEntry.stable_id}-${catalogEntry.version}-${catalogEntry.id}`;
        if (!deduplicatedEntriesByKey.has(dedupeKey)) {
          deduplicatedEntriesByKey.set(dedupeKey, catalogEntry);
        }
      });

    return [...deduplicatedEntriesByKey.values()];
  });

  // --- ViewChild refs para diálogos nativos ---
  @ViewChild('catalogStudioDialog')
  private readonly catalogStudioDialogRef?: ElementRef<HTMLDialogElement>;
  @ViewChild('catalogSmilesSketchDialog')
  private readonly catalogSmilesSketchDialogRef?: ElementRef<HTMLDialogElement>;
  @ViewChild('catalogSmilesKetcherFrame')
  private readonly catalogSmilesKetcherFrameRef?: ElementRef<HTMLIFrameElement>;

  ngOnDestroy(): void {
    this.catalogDraftInspectionSubscription?.unsubscribe();
  }

  // --- Métodos públicos del template ---

  toggleCatalogPanelCollapse(): void {
    this.isCatalogPanelCollapsed.update((currentValue: boolean) => !currentValue);
  }

  openCatalogStudioModal(): void {
    const dialog = this.catalogStudioDialogRef?.nativeElement;
    if (dialog === undefined || dialog.open) {
      return;
    }
    this.workflow.catalog.ensureCatalogDraftDefaults();
    dialog.showModal();
    this.refreshCatalogDraftInspection();
  }

  closeCatalogStudioModal(): void {
    this.catalogStudioDialogRef?.nativeElement.close();
  }

  onCatalogStudioDialogClick(event: Event): void {
    const dialog = this.catalogStudioDialogRef?.nativeElement;
    if (dialog !== undefined && event.target === dialog) {
      this.closeCatalogStudioModal();
    }
  }

  beginCatalogEntryEdition(catalogEntry: SmileitCatalogEntryView): void {
    this.workflow.catalog.beginCatalogEntryEdition(catalogEntry);
    this.openCatalogStudioModal();
  }

  onCatalogDraftSmilesChange(nextValue: string): void {
    this.workflow.catalogCreateSmiles.set(nextValue);
    this.refreshCatalogDraftInspection();
  }

  openCatalogSmilesSketcher(): void {
    if (this.workflow.isProcessing()) {
      return;
    }
    if (!this.hasCompletedFirstCatalogSketchLoad) {
      this.startCatalogSketchLoadingPhase();
    }
    void this.ensureCatalogKetcherReady();

    const dialog = this.catalogSmilesSketchDialogRef?.nativeElement;
    if (dialog === undefined) {
      return;
    }
    if (dialog.open) {
      if (typeof dialog.close === 'function') {
        dialog.close();
      } else {
        dialog.removeAttribute('open');
      }
    }
    if (typeof dialog.showModal === 'function') {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute('open', 'true');
      }
    } else {
      dialog.setAttribute('open', 'true');
    }
    void this.pushCatalogSmilesToKetcher();
  }

  closeCatalogSmilesSketcher(): void {
    this.isCatalogSmilesSketchLoading.set(false);
    this.catalogSketchValidationError.set(null);
    const dialog = this.catalogSmilesSketchDialogRef?.nativeElement;
    if (dialog === undefined) {
      return;
    }
    if (dialog.open) {
      if (typeof dialog.close === 'function') {
        dialog.close();
      } else {
        dialog.removeAttribute('open');
      }
      return;
    }
    dialog.removeAttribute('open');
  }

  onCatalogSmilesSketchDialogClick(event: Event): void {
    const dialog = this.catalogSmilesSketchDialogRef?.nativeElement;
    if (dialog !== undefined && event.target === dialog) {
      this.closeCatalogSmilesSketcher();
    }
  }

  onCatalogSmilesKetcherLoaded(): void {
    this.isCatalogSmilesSketcherReady.set(true);
    this.syncCatalogSketchLoadingVisibility();
    void this.pushCatalogSmilesToKetcher();
  }

  async applyCatalogSmilesFromSketcher(): Promise<void> {
    await this.pullCatalogSmilesFromKetcher();
    const currentSmiles = this.workflow.catalogCreateSmiles().trim();
    if (currentSmiles === '') {
      this.catalogSketchValidationError.set('Draw one molecule before applying.');
      return;
    }
    if (currentSmiles.includes('.')) {
      this.catalogSketchValidationError.set(
        'Only one molecule is allowed. SMILES contains multiple fragments (".").',
      );
      return;
    }
    this.catalogSketchValidationError.set(null);
    this.refreshCatalogDraftInspection();
    this.closeCatalogSmilesSketcher();
  }

  addCatalogDraftAndClose(): void {
    this.workflow.catalog.createCatalogEntry(() => {
      this.refreshCatalogDraftInspection();
      this.closeCatalogStudioModal();
    });
  }

  addAnotherCatalogDraft(): void {
    this.workflow.catalog.createCatalogEntryAndPrepareNext(() => {
      this.refreshCatalogDraftInspection();
    });
  }

  onCatalogDraftSvgClick(mouseEvent: MouseEvent): void {
    if (this.workflow.isProcessing()) {
      return;
    }
    const atomIndex = this.inspectionService.extractAtomIndexFromEvent(mouseEvent);
    if (atomIndex !== null) {
      this.toggleCatalogDraftAnchor(atomIndex);
    }
  }

  toggleCatalogDraftAnchor(atomIndex: number): void {
    this.workflow.catalogCreateAnchorIndicesText.set(formatAtomIndices([atomIndex]));
  }

  catalogDraftAnchorIndices(): number[] {
    return parseAtomIndicesInput(this.workflow.catalogCreateAnchorIndicesText()).slice(0, 1);
  }

  toTrustedAnchorSelectionSvg(rawSvgMarkup: string, selectedAtomIndices: number[]): SafeHtml {
    const decorated = this.inspectionService.decorateInspectionSvg(
      rawSvgMarkup,
      selectedAtomIndices,
      [],
    );
    return this.sanitizer.bypassSecurityTrustHtml(decorated); // NOSONAR: S6268 - el SVG proviene del backend interno validado, nunca de entrada directa del usuario
  }

  onLibraryGroupChange(nextGroupKey: string): void {
    this.selectedLibraryGroupKey.set(nextGroupKey);
  }

  /** Emite evento al padre para abrir el dialog de detalle (que está a nivel de shell). */
  openLibraryEntryDetail(catalogEntry: SmileitCatalogEntryView): void {
    this.libraryEntryDetailRequested.emit(catalogEntry);
  }

  /** SVG decorado para la miniatura de una entrada de catálogo. Lectura desde cache compartido. */
  catalogEntryPreviewSvg(catalogEntry: SmileitCatalogEntryView): SafeHtml | null {
    const previewKey = this.buildCatalogEntryPreviewKey(catalogEntry);
    const inspectionResult = this.libraryEntryInspections()[previewKey] ?? null;
    if (inspectionResult === null) {
      return null;
    }
    const decorated = this.inspectionService.decorateInspectionSvg(
      inspectionResult.svg,
      catalogEntry.anchor_atom_indices,
      [],
    );
    return this.sanitizer.bypassSecurityTrustHtml(decorated); // NOSONAR: S6268 - el SVG proviene del backend interno validado, nunca de entrada directa del usuario
  }

  /** Error de preview de una entrada de catálogo (carga de inspección fallida). */
  catalogEntryPreviewError(catalogEntry: SmileitCatalogEntryView): string | null {
    const previewKey = this.buildCatalogEntryPreviewKey(catalogEntry);
    return this.libraryEntryInspectionErrors()[previewKey] ?? null;
  }

  // --- Métodos privados ---

  private buildCatalogEntryPreviewKey(catalogEntry: SmileitCatalogEntryView): string {
    return `${catalogEntry.stable_id}@${catalogEntry.version}`;
  }

  private refreshCatalogDraftInspection(): void {
    const catalogDraftSmiles = this.workflow.catalogCreateSmiles().trim();
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

  private ensureCatalogDefaultAnchorSelection(
    inspectionResult: SmileitStructureInspectionView,
  ): void {
    const currentAnchorIndices = this.catalogDraftAnchorIndices();
    if (currentAnchorIndices.length === 0) {
      return;
    }
    const validAtomIndices = new Set(inspectionResult.atoms.map((atom) => atom.index));
    const nextAnchorIndices = currentAnchorIndices.filter((i: number) => validAtomIndices.has(i));
    if (hasSameNumberSet(currentAnchorIndices, nextAnchorIndices)) {
      return;
    }
    this.workflow.catalogCreateAnchorIndicesText.set(formatAtomIndices(nextAnchorIndices));
  }

  private resolveCatalogKetcherApi(): CatalogKetcherApi | null {
    const frame = this.catalogSmilesKetcherFrameRef?.nativeElement;
    const frameWindow = frame?.contentWindow as (Window & { ketcher?: unknown }) | null | undefined;
    const maybeApi = frameWindow?.ketcher;
    if (
      typeof maybeApi !== 'object' ||
      maybeApi === null ||
      !('getSmiles' in maybeApi) ||
      !('setMolecule' in maybeApi)
    ) {
      return null;
    }
    return maybeApi as CatalogKetcherApi;
  }

  private async pushCatalogSmilesToKetcher(): Promise<void> {
    const api = this.resolveCatalogKetcherApi();
    if (api === null) {
      return;
    }
    try {
      await api.setMolecule(this.workflow.catalogCreateSmiles().trim());
    } catch {
      // Si Ketcher no acepta el contenido, se mantiene entrada manual como fallback.
    }
  }

  private async pullCatalogSmilesFromKetcher(): Promise<void> {
    const api = this.resolveCatalogKetcherApi();
    if (api === null) {
      return;
    }
    try {
      const nextSmiles = await api.getSmiles();
      if (typeof nextSmiles === 'string' && nextSmiles.trim() !== '') {
        this.workflow.catalogCreateSmiles.set(nextSmiles.trim());
      }
    } catch {
      // Si Ketcher no responde, se mantiene el valor manual vigente.
    }
  }

  private async ensureCatalogKetcherReady(): Promise<void> {
    if (this.isCatalogSmilesSketcherReady()) {
      this.syncCatalogSketchLoadingVisibility();
      return;
    }
    for (let attempt = 0; attempt < 120; attempt++) {
      if (this.resolveCatalogKetcherApi() !== null) {
        this.isCatalogSmilesSketcherReady.set(true);
        this.syncCatalogSketchLoadingVisibility();
        return;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
  }

  private startCatalogSketchLoadingPhase(): void {
    this.isCatalogSmilesSketchLoading.set(!this.isCatalogSmilesSketcherReady());
    this.syncCatalogSketchLoadingVisibility();
  }

  private syncCatalogSketchLoadingVisibility(): void {
    const mustKeepLoading = !this.isCatalogSmilesSketcherReady();
    this.isCatalogSmilesSketchLoading.set(mustKeepLoading);
    if (!mustKeepLoading) {
      this.hasCompletedFirstCatalogSketchLoad = true;
    }
  }
}

/** Contrato para la API de dibujo molecular Ketcher embebida en el iframe del catálogo. */
type CatalogKetcherApi = {
  getSmiles: () => Promise<string>;
  setMolecule: (molecule: string) => Promise<void>;
};
