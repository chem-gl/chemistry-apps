// smileit-generation.service.ts: Gestiona estado de generación, paginación y descarga de estructuras.
// Responsabilidad: manejar paginación incremental, caché de páginas, descarga de ZIP y progreso de descarga.
// Uso: inyectar cuando se necesita cargar más estructuras, paginar o descargar resultados.

import { computed, effect, inject, Injectable, Injector, signal } from '@angular/core';
import {
  SmileitGeneratedStructureView,
  SmileitWorkflowService,
} from '../../../core/application/smileit-workflow.service';

/**
 * Encapsula lógica de paginación y gestión de estructuras generadas.
 * Mantiene caché de páginas para evitar recargas innecesarias.
 */
@Injectable({ providedIn: 'root' })
export class SmileitGenerationService {
  private readonly workflow = inject(SmileitWorkflowService);
  private readonly injector = inject(Injector);

  // Paginación
  readonly loadedGeneratedStructures = signal<SmileitGeneratedStructureView[]>([]);
  readonly generatedStructuresOffset = signal<number>(0);
  readonly visibleStructuresCount = signal<number>(100);
  readonly isLoadingGeneratedStructures = signal<boolean>(false);

  // ZIP download tracking
  readonly isPreparingImagesZip = signal<boolean>(false);
  readonly imagesZipProgress = signal<number>(0);

  // Derivaciones reload tracking
  readonly lastDerivationsReloadKey = signal<string>('');

  // Computed: estructuras actualmente visibles
  readonly visibleGeneratedStructures = computed<SmileitGeneratedStructureView[]>(() => {
    return this.loadedGeneratedStructures();
  });

  // Computed: si hay más por cargar
  readonly hasMoreGeneratedStructures = computed<boolean>(() => {
    const resultData = this.workflow.resultData();
    if (resultData === null) {
      return false;
    }
    return this.loadedGeneratedStructures().length < resultData.totalGenerated;
  });

  constructor() {
    this.initializeEffects();
  }

  private initializeEffects(): void {
    // Resetea paginación cuando hay nuevo resultado
    effect(
      () => {
        const resultData = this.workflow.resultData();
        const currentJobId: string | null = this.workflow.currentJobId();

        if (resultData === null || currentJobId === null) {
          this.resetGeneration();
          return;
        }

        const nextReloadKey = `${currentJobId}:${resultData.totalGenerated}:${resultData.isHistoricalSummary}`;
        if (this.lastDerivationsReloadKey() === nextReloadKey) {
          return;
        }

        this.lastDerivationsReloadKey.set(nextReloadKey);
        this.resetGeneration();
      },
      { injector: this.injector },
    );
  }

  /**
   * Reinicia el estado de paginación (por nuevo job o cambio de resultado).
   */
  resetGeneration(): void {
    this.loadedGeneratedStructures.set([]);
    this.generatedStructuresOffset.set(0);
    this.visibleStructuresCount.set(100);
    this.isLoadingGeneratedStructures.set(false);
    this.imagesZipProgress.set(0);
    this.isPreparingImagesZip.set(false);
  }

  /**
   * Comienza a cargar siguiente página de estructuras.
   */
  startLoadingNextPage(): void {
    this.isLoadingGeneratedStructures.set(true);
  }

  /**
   * Finaliza carga de página.
   */
  finishLoadingNextPage(): void {
    this.isLoadingGeneratedStructures.set(false);
  }

  /**
   * Agrega estructuras al caché (para paginación).
   */
  appendStructures(structures: SmileitGeneratedStructureView[]): void {
    this.loadedGeneratedStructures.update((current) => [...current, ...structures]);
  }

  /**
   * Reemplaza todas las estructuras cacheadas (reinicio).
   */
  setStructures(structures: SmileitGeneratedStructureView[]): void {
    this.loadedGeneratedStructures.set(structures);
  }

  /**
   * Actualiza el offset para siguiente página.
   */
  updateOffset(newOffset: number): void {
    this.generatedStructuresOffset.set(newOffset);
  }

  /**
   * Ejecuta paginación incremental (muestra 100 más).
   */
  showMoreStructures(): void {
    this.visibleStructuresCount.update((count) => count + 100);
  }

  /**
   * Inicia descarga ZIP de imágenes.
   */
  startPreparingImagesZip(): void {
    this.isPreparingImagesZip.set(true);
    this.imagesZipProgress.set(0);
  }

  /**
   * Actualiza progreso de descarga ZIP.
   */
  updateZipProgress(percentage: number): void {
    this.imagesZipProgress.set(Math.min(percentage, 100));
  }

  /**
   * Finaliza descarga ZIP.
   */
  finishPreparingImagesZip(): void {
    this.isPreparingImagesZip.set(false);
    this.imagesZipProgress.set(100);
  }

  /**
   * Obtiene el siguiente offset para paginación.
   */
  getNextOffset(pageSize: number = 100): number {
    return this.generatedStructuresOffset() + pageSize;
  }

  /**
   * Retorna el recuento total de derivados esperados (desde resultData).
   */
  getTotalGeneratedCount(): number {
    const resultData = this.workflow.resultData();
    return resultData?.totalGenerated ?? 0;
  }

  /**
   * Retorna el recuento de estructuras ya cacheadas.
   */
  getCachedStructuresCount(): number {
    return this.loadedGeneratedStructures().length;
  }
}
