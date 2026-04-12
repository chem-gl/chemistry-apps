// principal-svg-viewer.component.ts: Visor SVG del scaffold principal con zoom local y eventos de selección de átomos.

import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { SafeHtml } from '@angular/platform-browser';
import { TranslocoPipe } from '@jsverse/transloco';

@Component({
  selector: 'app-principal-svg-viewer',
  standalone: true,
  imports: [CommonModule, TranslocoPipe],
  templateUrl: './principal-svg-viewer.component.html',
  styleUrls: ['./principal-svg-viewer.component.scss'],
})
export class PrincipalSvgViewerComponent {
  @ViewChild('principalSvgViewport')
  private readonly principalSvgViewportRef?: ElementRef<HTMLDivElement>;

  @Input() inspectionSvg: SafeHtml | null = null;
  @Input() isProcessing: boolean = false;

  @Output() readonly inspectionSvgClicked = new EventEmitter<MouseEvent>();

  /** Nivel de zoom local del visor principal (1-4). */
  readonly minZoomLevel: number = 1;
  readonly maxZoomLevel: number = 4;
  zoomLevel: number = 1;
  readonly baseCanvasPx: number = 420;

  get canvasSizePx(): number {
    return this.baseCanvasPx * this.zoomLevel;
  }

  zoomIn(): void {
    const nextZoomLevel: number = Math.min(this.zoomLevel + 1, this.maxZoomLevel);
    this.updateZoom(nextZoomLevel);
  }

  zoomOut(): void {
    const nextZoomLevel: number = Math.max(this.zoomLevel - 1, this.minZoomLevel);
    this.updateZoom(nextZoomLevel);
  }

  onInspectionSvgClick(event: MouseEvent | KeyboardEvent): void {
    if (this.isProcessing) {
      return;
    }
    if (!(event instanceof MouseEvent)) {
      return;
    }
    this.inspectionSvgClicked.emit(event);
  }

  private updateZoom(nextZoomLevel: number): void {
    const currentZoomLevel: number = this.zoomLevel;
    if (nextZoomLevel === currentZoomLevel) {
      return;
    }

    const principalViewport: HTMLDivElement | undefined =
      this.principalSvgViewportRef?.nativeElement;
    if (principalViewport === undefined) {
      this.zoomLevel = nextZoomLevel;
      return;
    }

    const anchorX: number =
      (principalViewport.scrollLeft + principalViewport.clientWidth / 2) / currentZoomLevel;
    const anchorY: number =
      (principalViewport.scrollTop + principalViewport.clientHeight / 2) / currentZoomLevel;

    this.zoomLevel = nextZoomLevel;

    requestAnimationFrame(() => {
      const rawScrollLeft: number = anchorX * nextZoomLevel - principalViewport.clientWidth / 2;
      const rawScrollTop: number = anchorY * nextZoomLevel - principalViewport.clientHeight / 2;
      const maxScrollLeft: number = Math.max(
        0,
        principalViewport.scrollWidth - principalViewport.clientWidth,
      );
      const maxScrollTop: number = Math.max(
        0,
        principalViewport.scrollHeight - principalViewport.clientHeight,
      );
      principalViewport.scrollLeft = Math.max(0, Math.min(maxScrollLeft, rawScrollLeft));
      principalViewport.scrollTop = Math.max(0, Math.min(maxScrollTop, rawScrollTop));
    });
  }
}
