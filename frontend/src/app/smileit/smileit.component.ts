// smileit.component.ts: Pantalla Smileit para inspección, sustitución y generación combinatoria de SMILES.

import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
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
import { SmileitWorkflowService } from '../core/application/smileit-workflow.service';

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

  onInspectionSvgClick(mouseEvent: MouseEvent): void {
    if (this.workflow.isProcessing()) {
      return;
    }

    const eventTarget: EventTarget | null = mouseEvent.target;
    if (!(eventTarget instanceof Element)) {
      return;
    }

    const atomIndexFromClass: number | null = this.extractAtomIndexFromElement(eventTarget);
    if (atomIndexFromClass !== null) {
      this.workflow.toggleSelectedAtom(atomIndexFromClass);
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

  private extractAtomIndexFromElement(svgElement: Element): number | null {
    let currentElement: Element | null = svgElement;
    while (currentElement !== null) {
      const atomIndices: number[] = this.readAtomIndicesFromClassName(currentElement.className);
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

    const svgRect: DOMRect = rootSvg.getBoundingClientRect();
    if (svgRect.width <= 0 || svgRect.height <= 0) {
      return null;
    }

    const viewBox: SVGRect = rootSvg.viewBox.baseVal;
    const scaleX: number = viewBox.width > 0 ? viewBox.width / svgRect.width : 1;
    const scaleY: number = viewBox.height > 0 ? viewBox.height / svgRect.height : 1;

    const svgX: number = (mouseEvent.clientX - svgRect.left) * scaleX + viewBox.x;
    const svgY: number = (mouseEvent.clientY - svgRect.top) * scaleY + viewBox.y;

    const candidates: NodeListOf<SVGGraphicsElement> = rootSvg.querySelectorAll('[class*="atom-"]');

    let bestDistanceSquared: number = Number.POSITIVE_INFINITY;
    let bestAtomIndex: number | null = null;

    candidates.forEach((candidateElement: SVGGraphicsElement) => {
      const candidateAtomIndices: number[] = this.readAtomIndicesFromClassName(
        candidateElement.className,
      );
      if (candidateAtomIndices.length === 0) {
        return;
      }

      const candidateBox: DOMRect = candidateElement.getBBox();
      const centerX: number = candidateBox.x + candidateBox.width / 2;
      const centerY: number = candidateBox.y + candidateBox.height / 2;
      const deltaX: number = centerX - svgX;
      const deltaY: number = centerY - svgY;
      const distanceSquared: number = deltaX * deltaX + deltaY * deltaY;

      if (distanceSquared < bestDistanceSquared) {
        bestDistanceSquared = distanceSquared;
        bestAtomIndex = candidateAtomIndices[0];
      }
    });

    // Umbral de tolerancia para evitar seleccionar átomos con clicks lejanos al dibujo.
    const maxDistanceSquared: number = 28 * 28;
    if (bestDistanceSquared <= maxDistanceSquared) {
      return bestAtomIndex;
    }

    return null;
  }

  private readAtomIndicesFromClassName(classNameValue: unknown): number[] {
    const normalizedClassText: string =
      typeof classNameValue === 'string'
        ? classNameValue
        : ((classNameValue as { baseVal?: string } | null)?.baseVal ?? '');

    const classTokens: string[] = normalizedClassText
      .split(/\s+/)
      .filter((token) => token.length > 0);
    const atomIndices: number[] = classTokens
      .filter((token) => /^atom-\d+$/.test(token))
      .map((token) => Number(token.replace('atom-', '')))
      .filter((indexValue) => Number.isInteger(indexValue) && indexValue >= 0);

    return atomIndices;
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
