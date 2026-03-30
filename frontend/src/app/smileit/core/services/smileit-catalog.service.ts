// smileit-catalog.service.ts: Gestiona estado de catálogo, librería, inspecciones y sketcher.
// Responsabilidad: manejar datos de catálogo, librería, validaciones de SMILES y sincronización de inspecciones.
// Uso: inyectar cuando se necesita interactuar con catálogo, librería, entrada de SMILES por sketcher.

import { computed, effect, inject, Injectable, Injector, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import type {
  SmileitPatternEntryView,
  SmileitStructureInspectionView,
} from '../../../core/api/jobs-api.service';
import { SmileitWorkflowService } from '../../../core/application/smileit-workflow.service';

/**
 * Encapsula lógica de catálogo, librería y validación de sketcher SMILES.
 * Sincroniza inspecciones de entradas de librería bajo demanda.
 */
@Injectable({ providedIn: 'root' })
export class SmileitCatalogService {
  private readonly workflow = inject(SmileitWorkflowService);
  private readonly injector = inject(Injector);

  // Sketcher state
  readonly isCatalogSmilesSketcherReady = signal<boolean>(false);
  readonly isCatalogSmilesSketchLoading = signal<boolean>(false);
  readonly catalogSketchValidationError = signal<string | null>(null);
  private hasCompletedFirstCatalogSketchLoad: boolean = false;

  // Pattern state
  readonly patternEnabledState = signal<Record<string, boolean>>({});

  // Library entry inspections (cached)
  readonly libraryEntryInspections = signal<Record<string, SmileitStructureInspectionView | null>>(
    {},
  );
  readonly libraryEntryInspectionErrors = signal<Record<string, string | null>>({});
  private readonly libraryEntryPreviewSubscriptions = new Map<string, Subscription>();

  // Manual draft inspections
  readonly manualDraftInspections = signal<Record<string, SmileitStructureInspectionView | null>>(
    {},
  );
  readonly manualDraftInspectionErrors = signal<Record<string, string | null>>({});
  private readonly manualDraftInspectionSubscriptions = new Map<string, Subscription>();

  // Computed: pattern entries
  readonly patternEntries = computed<SmileitPatternEntryView[]>(() => {
    const rawPatterns: unknown = this.workflow.patterns() as unknown;
    return Array.isArray(rawPatterns) ? (rawPatterns as SmileitPatternEntryView[]) : [];
  });

  constructor() {
    this.initializeEffects();
  }

  private initializeEffects(): void {
    // Sincroniza estado de visibilidad de patrones con los patrones disponibles
    effect(
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
  }

  /**
   * Marca sketcher como listo (se ejecuta al montar iframe de Ketcher).
   */
  onSketcherReady(): void {
    if (!this.hasCompletedFirstCatalogSketchLoad) {
      this.hasCompletedFirstCatalogSketchLoad = true;
      this.isCatalogSmilesSketcherReady.set(true);
    }
  }

  /**
   * Inicia validación y carga del sketcher.
   */
  onSketcherLoadStart(): void {
    this.isCatalogSmilesSketchLoading.set(true);
    this.catalogSketchValidationError.set(null);
  }

  /**
   * Finaliza carga del sketcher.
   */
  onSketcherLoadEnd(): void {
    this.isCatalogSmilesSketchLoading.set(false);
  }

  /**
   * Valida que un SMILES sea una molécula única y no esté vacía.
   * @param smiles Cadena SMILES a validar
   * @returns Error si es inválido, null si es válido
   */
  validateSmiles(smiles: string): string | null {
    if (!smiles || smiles.trim().length === 0) {
      return 'SMILES cannot be empty';
    }

    const fragmentCount = smiles.split('.').filter((frag) => frag.trim().length > 0).length;
    if (fragmentCount > 1) {
      return `SMILES must represent a single molecule (found ${fragmentCount} fragments)`;
    }

    return null;
  }

  /**
   * Valida sketcher SMILES y retorna error si es inválido.
   */
  validateSketcherSmiles(smiles: string): void {
    const validationError = this.validateSmiles(smiles);
    this.catalogSketchValidationError.set(validationError);
  }

  /**
   * Limpia error de validación del sketcher.
   */
  clearSketcherValidationError(): void {
    this.catalogSketchValidationError.set(null);
  }

  /**
   * Registra una inspección de librería bajo su ID.
   */
  cacheLibraryInspection(entryId: string, inspection: SmileitStructureInspectionView): void {
    this.libraryEntryInspections.update((map) => ({
      ...map,
      [entryId]: inspection,
    }));
    this.libraryEntryInspectionErrors.update((map) => ({
      ...map,
      [entryId]: null,
    }));
  }

  /**
   * Registra un error de inspección de librería.
   */
  cacheLibraryInspectionError(entryId: string, error: string): void {
    this.libraryEntryInspectionErrors.update((map) => ({
      ...map,
      [entryId]: error,
    }));
  }

  /**
   * Obtiene inspección cacheada de librería o null.
   */
  getLibraryInspection(entryId: string): SmileitStructureInspectionView | null {
    return this.libraryEntryInspections()[entryId] ?? null;
  }

  /**
   * Toggle visibilidad de patrón.
   */
  togglePatternEnabled(patternStableId: string): void {
    this.patternEnabledState.update((map) => ({
      ...map,
      [patternStableId]: !map[patternStableId],
    }));
  }

  /**
   * Limpia todas las inspecciones de librería en caché.
   */
  clearLibraryInspections(): void {
    this.libraryEntryPreviewSubscriptions.forEach((sub) => sub.unsubscribe());
    this.libraryEntryPreviewSubscriptions.clear();
    this.libraryEntryInspections.set({});
    this.libraryEntryInspectionErrors.set({});
  }

  /**
   * Limpia todas las inspecciones manuales en caché.
   */
  clearManualDraftInspections(): void {
    this.manualDraftInspectionSubscriptions.forEach((sub) => sub.unsubscribe());
    this.manualDraftInspectionSubscriptions.clear();
    this.manualDraftInspections.set({});
    this.manualDraftInspectionErrors.set({});
  }

  /**
   * Registra una inspección manual bajo su ID de bloque.
   */
  cacheManualInspection(blockId: string, inspection: SmileitStructureInspectionView): void {
    this.manualDraftInspections.update((map) => ({
      ...map,
      [blockId]: inspection,
    }));
    this.manualDraftInspectionErrors.update((map) => ({
      ...map,
      [blockId]: null,
    }));
  }

  /**
   * Registra error de inspección manual.
   */
  cacheManualInspectionError(blockId: string, error: string): void {
    this.manualDraftInspectionErrors.update((map) => ({
      ...map,
      [blockId]: error,
    }));
  }

  /**
   * Obtiene inspección manual cacheada o null.
   */
  getManualInspection(blockId: string): SmileitStructureInspectionView | null {
    return this.manualDraftInspections()[blockId] ?? null;
  }
}
