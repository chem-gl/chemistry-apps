// smileit-ui-state.service.ts: Centraliza el estado de UI (paneles colapsables, zooms, diálogos) usando signals.
// Responsabilidad: gestionar toda la interacción visual del usuario sin lógica de negocio.
// Uso: inyectar en componentes que necesitan sincronizar collapse states, zooms, selecciones de UI.

import { computed, Injectable, signal } from '@angular/core';
import type {
  SmileitCatalogEntryView,
  SmileitPatternEntryView,
} from '../../../core/api/jobs-api.service';
import type { SmileitGeneratedStructureView } from '../../../core/application/smileit-workflow.service';

/**
 * Encapsula todos los signals relacionados con estado visual de la interfaz.
 * Evita que smileit.component.ts tenga decenas de signals declarados.
 */
@Injectable({ providedIn: 'root' })
export class SmileitUIStateService {
  // Panel collapse states
  readonly isCatalogPanelCollapsed = signal<boolean>(true);
  readonly isLibraryPanelCollapsed = signal<boolean>(false);
  readonly isGeneratedStructuresCollapsed = signal<boolean>(true);
  readonly isLogsCollapsed = signal<boolean>(false);
  readonly isAdvancedSectionCollapsed = signal<boolean>(true);

  // Block collapse map
  readonly collapsedBlockMap = signal<Record<string, boolean>>({});

  // Dialog states
  readonly selectedPatternForDetail = signal<SmileitPatternEntryView | null>(null);
  readonly selectedGeneratedStructure = signal<SmileitGeneratedStructureView | null>(null);
  readonly selectedLibraryEntryForDetail = signal<SmileitCatalogEntryView | null>(null);
  readonly libraryDetailOpenContext = signal<'browser' | 'reference'>('browser');

  // Zoom levels
  readonly libraryDetailZoomLevel = signal<number>(1);
  readonly libraryDetailPanX = signal<number>(0);
  readonly libraryDetailPanY = signal<number>(0);
  readonly libraryDetailIsDragging = signal<boolean>(false);

  // Library group filter
  readonly selectedLibraryGroupKey = signal<string>('all');
  readonly selectedBlockLibraryGroupKeys = signal<Record<string, string>>({});

  // Computed sizes for library detail zoom
  readonly libraryDetailViewportPx = 280;
  readonly libraryDetailPreviewSize = computed<number>(
    () => 380 + (this.libraryDetailZoomLevel() - 1) * 100,
  );

  // Pan drag tracking
  private _panDragStartX = 0;
  private _panDragStartY = 0;
  private _panAnchorX = 0;
  private _panAnchorY = 0;

  toggleCatalogPanel(): void {
    this.isCatalogPanelCollapsed.update((v) => !v);
  }

  toggleLibraryPanel(): void {
    this.isLibraryPanelCollapsed.update((v) => !v);
  }

  toggleGeneratedStructures(): void {
    this.isGeneratedStructuresCollapsed.update((v) => !v);
  }

  toggleLogs(): void {
    this.isLogsCollapsed.update((v) => !v);
  }

  toggleAdvancedSection(): void {
    this.isAdvancedSectionCollapsed.update((v) => !v);
  }

  toggleBlockCollapse(blockId: string): void {
    this.collapsedBlockMap.update((map) => ({
      ...map,
      [blockId]: !map[blockId],
    }));
  }

  selectLibraryEntryForDetail(
    entry: SmileitCatalogEntryView | null,
    context: 'browser' | 'reference' = 'browser',
  ): void {
    this.selectedLibraryEntryForDetail.set(entry);
    this.libraryDetailOpenContext.set(context);
    this.libraryDetailZoomLevel.set(1);
    this.libraryDetailPanX.set(0);
    this.libraryDetailPanY.set(0);
  }

  selectPatternForDetail(pattern: SmileitPatternEntryView | null): void {
    this.selectedPatternForDetail.set(pattern);
  }

  selectGeneratedStructure(structure: SmileitGeneratedStructureView | null): void {
    this.selectedGeneratedStructure.set(structure);
  }

  startLibraryDetailPan(startX: number, startY: number): void {
    this.libraryDetailIsDragging.set(true);
    this._panDragStartX = startX;
    this._panDragStartY = startY;
    this._panAnchorX = this.libraryDetailPanX();
    this._panAnchorY = this.libraryDetailPanY();
  }

  updateLibraryDetailPan(currentX: number, currentY: number): void {
    const deltaX = currentX - this._panDragStartX;
    const deltaY = currentY - this._panDragStartY;
    this.libraryDetailPanX.set(this._panAnchorX + deltaX);
    this.libraryDetailPanY.set(this._panAnchorY + deltaY);
  }

  endLibraryDetailPan(): void {
    this.libraryDetailIsDragging.set(false);
  }

  zoomLibraryDetailIn(): void {
    this.libraryDetailZoomLevel.update((z) => Math.min(z + 1, 4));
  }

  zoomLibraryDetailOut(): void {
    this.libraryDetailZoomLevel.update((z) => Math.max(z - 1, 1));
  }

  setSelectedLibraryGroupKey(key: string): void {
    this.selectedLibraryGroupKey.set(key);
  }

  setBlockLibraryGroupKey(blockId: string, key: string): void {
    this.selectedBlockLibraryGroupKeys.update((map) => ({
      ...map,
      [blockId]: key,
    }));
  }

  resetAllCollapses(): void {
    this.isCatalogPanelCollapsed.set(true);
    this.isLibraryPanelCollapsed.set(false);
    this.isGeneratedStructuresCollapsed.set(true);
    this.isLogsCollapsed.set(false);
    this.isAdvancedSectionCollapsed.set(true);
    this.collapsedBlockMap.set({});
  }
}
