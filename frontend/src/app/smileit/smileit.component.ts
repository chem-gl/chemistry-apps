// smileit.component.ts: Pantalla Smileit para inspección, sustitución y generación combinatoria de SMILES.

import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import {
  DownloadedReportFile,
  JobLogEntryView,
  ScientificJobView,
  SmileitCatalogEntryView,
} from '../core/api/jobs-api.service';
import {
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
  private readonly sanitizer = inject(DomSanitizer);
  private readonly route = inject(ActivatedRoute);
  private routeSubscription: Subscription | null = null;
  readonly selectedGeneratedStructure = signal<SmileitGeneratedStructureView | null>(null);
  private readonly highlightedInspectionSvg = computed<string>(() =>
    this.decorateInspectionSvg(this.workflow.inspectionSvg(), this.workflow.selectedAtomIndices()),
  );

  ngOnInit(): void {
    this.workflow.loadCatalog();
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
    this.routeSubscription?.unsubscribe();
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

  addCatalogSubstituent(entry: SmileitCatalogEntryView): void {
    this.workflow.addCatalogSubstituent(entry);
  }

  addCustomSubstituent(): void {
    this.workflow.addCustomSubstituent();
  }

  removeSubstituent(indexToRemove: number): void {
    this.workflow.removeSubstituent(indexToRemove);
  }

  exportCsv(): void {
    this.workflow.downloadCsvReport().subscribe({
      next: (downloadedFile: DownloadedReportFile) => {
        this.downloadFile(downloadedFile.filename, downloadedFile.blob);
      },
      error: () => {
        // El workflow expone el mensaje de error para la UI.
      },
    });
  }

  exportLog(): void {
    this.workflow.downloadLogReport().subscribe({
      next: (downloadedFile: DownloadedReportFile) => {
        this.downloadFile(downloadedFile.filename, downloadedFile.blob);
      },
      error: () => {
        // El workflow expone el mensaje de error para la UI.
      },
    });
  }

  exportError(): void {
    this.workflow.downloadErrorReport().subscribe({
      next: (downloadedFile: DownloadedReportFile) => {
        this.downloadFile(downloadedFile.filename, downloadedFile.blob);
      },
      error: () => {
        // El workflow expone el mensaje de error para la UI.
      },
    });
  }

  toNumber(rawValue: number | string): number {
    return Number(rawValue);
  }

  isAtomSelected(atomIndex: number): boolean {
    return this.workflow.selectedAtomIndices().includes(atomIndex);
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

  toTrustedSvg(svgMarkup: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(svgMarkup);
  }

  toTrustedInspectionSvg(): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(this.highlightedInspectionSvg());
  }

  onInspectionSvgClick(mouseEvent: MouseEvent): void {
    if (this.workflow.isProcessing()) {
      return;
    }

    const atomIndexFromTarget: number | null = this.extractAtomIndexFromEvent(mouseEvent);
    if (atomIndexFromTarget !== null) {
      this.workflow.toggleSelectedAtom(atomIndexFromTarget);
      return;
    }

    const eventTarget: EventTarget | null = mouseEvent.target;
    if (!(eventTarget instanceof Element)) {
      return;
    }

    const nearestAtomIndex: number | null = this.findNearestAtomIndexByCoordinates(
      eventTarget,
      mouseEvent,
    );
    if (nearestAtomIndex !== null) {
      this.workflow.toggleSelectedAtom(nearestAtomIndex);
    }
  }

  openGeneratedStructureModal(generatedStructure: SmileitGeneratedStructureView): void {
    this.selectedGeneratedStructure.set(generatedStructure);
  }

  closeGeneratedStructureModal(): void {
    this.selectedGeneratedStructure.set(null);
  }

  onGeneratedStructureDialogBackdropClick(mouseEvent: MouseEvent): void {
    const eventTarget: EventTarget | null = mouseEvent.target;
    if (
      eventTarget instanceof HTMLElement &&
      eventTarget.classList.contains('structure-modal-backdrop')
    ) {
      this.closeGeneratedStructureModal();
    }
  }

  onGeneratedStructureDialogKeydown(keyboardEvent: KeyboardEvent): void {
    if (keyboardEvent.key === 'Escape') {
      this.closeGeneratedStructureModal();
    }
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
      const atomIndices: number[] = this.readAtomIndicesFromElement(currentElement);
      if (atomIndices.length > 0) {
        return atomIndices[0];
      }
      currentElement = currentElement.parentElement;
    }

    return null;
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

    // Umbral de tolerancia para evitar seleccionar átomos con clicks lejanos al dibujo.
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
    ].filter((candidateText) => candidateText.trim() !== '');

    const parsedIndices: number[] = atomIndexCandidates.flatMap((candidateText) =>
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

  private decorateInspectionSvg(rawSvgMarkup: string, selectedAtomIndices: number[]): string {
    if (rawSvgMarkup.trim() === '') {
      return rawSvgMarkup;
    }

    const domParser: DOMParser = new DOMParser();
    const parsedDocument: Document = domParser.parseFromString(rawSvgMarkup, 'image/svg+xml');
    const rootSvg: SVGSVGElement | null = parsedDocument.querySelector('svg');
    if (rootSvg === null) {
      return rawSvgMarkup;
    }

    this.ensureAtomHighlightStyle(rootSvg, parsedDocument);
    this.drawAtomVertexOverlays(rootSvg, parsedDocument, selectedAtomIndices);

    return rootSvg.outerHTML;
  }

  private drawAtomVertexOverlays(
    rootSvg: SVGSVGElement,
    parsedDocument: Document,
    selectedAtomIndices: number[],
  ): void {
    const atomPositions: Map<number, { x: number; y: number }> =
      this.extractAtomPositionsFromBonds(rootSvg);
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
    const bondSegments: Array<{
      atomA: number;
      atomB: number;
      start: { x: number; y: number };
      end: { x: number; y: number };
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
      });
    });

    const atomPositions: Map<number, { x: number; y: number }> = new Map();
    if (bondSegments.length === 0) {
      return atomPositions;
    }

    const firstSegment = bondSegments[0];
    atomPositions.set(firstSegment.atomA, firstSegment.start);
    atomPositions.set(firstSegment.atomB, firstSegment.end);

    let hasProgress: boolean = true;
    while (hasProgress) {
      hasProgress = false;

      for (const bondSegment of bondSegments) {
        const atomAPosition = atomPositions.get(bondSegment.atomA);
        const atomBPosition = atomPositions.get(bondSegment.atomB);

        if (atomAPosition !== undefined && atomBPosition === undefined) {
          const distanceToStart: number = this.distanceSquared(atomAPosition, bondSegment.start);
          const distanceToEnd: number = this.distanceSquared(atomAPosition, bondSegment.end);
          atomPositions.set(
            bondSegment.atomB,
            distanceToStart <= distanceToEnd ? bondSegment.end : bondSegment.start,
          );
          hasProgress = true;
          continue;
        }

        if (atomBPosition !== undefined && atomAPosition === undefined) {
          const distanceToStart: number = this.distanceSquared(atomBPosition, bondSegment.start);
          const distanceToEnd: number = this.distanceSquared(atomBPosition, bondSegment.end);
          atomPositions.set(
            bondSegment.atomA,
            distanceToStart <= distanceToEnd ? bondSegment.end : bondSegment.start,
          );
          hasProgress = true;
        }
      }
    }

    return atomPositions;
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
