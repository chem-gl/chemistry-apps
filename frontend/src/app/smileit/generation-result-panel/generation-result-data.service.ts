// generation-result-data.service.ts: Estado y operaciones de paginación/ZIP/SVG para resultados de generación en Smile-it.

import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, Injector, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import JSZip from 'jszip';
import { firstValueFrom } from 'rxjs';
import { JobsApiService, SmileitDerivationPageItemView } from '../../core/api/jobs-api.service';
import {
  SmileitGeneratedStructureView,
  SmileitWorkflowService,
} from '../../core/application/smileit-workflow.service';

@Injectable()
export class GenerationResultDataService implements OnDestroy {
  readonly workflow = inject(SmileitWorkflowService);
  private readonly jobsApiService = inject(JobsApiService);
  private readonly injector = inject(Injector);

  readonly isGeneratedStructuresCollapsed = signal<boolean>(true);
  readonly visibleStructuresCount = signal<number>(100);
  readonly loadedGeneratedStructures = signal<SmileitGeneratedStructureView[]>([]);
  readonly generatedStructuresOffset = signal<number>(0);
  readonly isLoadingGeneratedStructures = signal<boolean>(false);
  readonly lastDerivationsReloadKey = signal<string>('');
  readonly isPreparingImagesZip = signal<boolean>(false);
  readonly imagesZipProgress = signal<number>(0);

  readonly visibleGeneratedStructures = computed<SmileitGeneratedStructureView[]>(() => {
    return this.loadedGeneratedStructures();
  });

  readonly hasMoreGeneratedStructures = computed<boolean>(() => {
    const resultData = this.workflow.resultData();
    if (resultData === null) {
      return false;
    }
    return this.loadedGeneratedStructures().length < resultData.totalGenerated;
  });

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

  ngOnDestroy(): void {
    this.visibleStructuresResetEffect.destroy();
  }

  toggleGeneratedStructuresCollapse(): void {
    this.isGeneratedStructuresCollapsed.update((currentValue: boolean) => !currentValue);
  }

  showMoreStructures(): void {
    this.loadNextGeneratedStructuresPage();
  }

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

  async resolveDetailSvg(structure: SmileitGeneratedStructureView): Promise<string | null> {
    const currentJobId: string | null = this.workflow.currentJobId();
    const structureIndex = structure.structureIndex;
    if (currentJobId === null || structureIndex === undefined) {
      return null;
    }

    const cachedDetailSvg = this.readSvgFromSessionCache(currentJobId, structureIndex, 'detail');
    if (cachedDetailSvg.trim() !== '') {
      this.patchLoadedStructureSvg(structureIndex, cachedDetailSvg);
      return cachedDetailSvg;
    }

    try {
      const svgMarkup = await firstValueFrom(
        this.jobsApiService.getSmileitDerivationSvg(currentJobId, structureIndex, 'detail'),
      );
      this.storeSvgInSessionCache(currentJobId, structureIndex, 'detail', svgMarkup);
      this.storeSvgInSessionCache(currentJobId, structureIndex, 'thumb', svgMarkup);
      this.patchLoadedStructureSvg(structureIndex, svgMarkup);
      return svgMarkup;
    } catch {
      return null;
    }
  }

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

    structures.forEach((structureItem: SmileitGeneratedStructureView, index: number) => {
      smilesLines.push(structureItem.smiles);

      const safeBaseName =
        this.sanitizeFilenameSegment(structureItem.name) ||
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

    const zipSvgConcurrency = 4;
    let resolvedCount = 0;

    for (let chunkStart = 0; chunkStart < structures.length; chunkStart += zipSvgConcurrency) {
      const chunkEnd = Math.min(chunkStart + zipSvgConcurrency, structures.length);
      const chunkStructures = structures.slice(chunkStart, chunkEnd);
      const chunkSvgs = await Promise.all(
        chunkStructures.map((structureItem: SmileitGeneratedStructureView) =>
          this.resolveStructureSvgForZip(currentJobId, structureItem),
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
          const embeddedStructures = resultData.generatedStructures ?? [];
          if (embeddedStructures.length > 0) {
            this.loadedGeneratedStructures.set(embeddedStructures);
            this.generatedStructuresOffset.set(embeddedStructures.length);
            this.visibleStructuresCount.set(embeddedStructures.length);
            return;
          }
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

  private sanitizeFilenameSegment(name: string): string {
    return (
      name
        .replace(/[^a-zA-Z0-9]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 40) || 'structure'
    );
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
