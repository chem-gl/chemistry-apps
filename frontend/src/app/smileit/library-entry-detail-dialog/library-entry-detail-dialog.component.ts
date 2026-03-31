// library-entry-detail-dialog.component.ts: Dialog de detalle de entrada de librería con zoom/pan para Smile-it.

import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  ViewChild,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import { SafeHtml } from '@angular/platform-browser';
import { SmileitCatalogEntryView } from '../../core/api/jobs-api.service';

@Component({
  selector: 'app-library-entry-detail-dialog',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './library-entry-detail-dialog.component.html',
  styleUrl: './library-entry-detail-dialog.component.scss',
})
export class LibraryEntryDetailDialogComponent {
  readonly selectedEntry = input<SmileitCatalogEntryView | null>(null);
  readonly openContext = input<'browser' | 'reference'>('browser');
  readonly previewSvgResolver =
    input.required<(entry: SmileitCatalogEntryView) => SafeHtml | null>();
  readonly isReferencedInAnyBlockResolver =
    input.required<(entry: SmileitCatalogEntryView) => boolean>();
  readonly isCatalogEntryEditableResolver =
    input.required<(entry: SmileitCatalogEntryView) => boolean>();
  readonly isProcessing = input<boolean>(false);

  readonly closeRequested = output<void>();
  readonly editRequested = output<SmileitCatalogEntryView>();

  @ViewChild('libraryEntryDetailDialog')
  private libraryEntryDetailDialogRef?: ElementRef<HTMLDialogElement>;

  readonly libraryDetailZoomLevel = signal<number>(1);
  readonly libraryDetailViewportPx = 280;
  readonly libraryDetailPreviewSize = computed<number>(
    () => 380 + (this.libraryDetailZoomLevel() - 1) * 100,
  );
  readonly libraryDetailPanX = signal<number>(0);
  readonly libraryDetailPanY = signal<number>(0);
  readonly libraryDetailIsDragging = signal<boolean>(false);

  private panDragStartX = 0;
  private panDragStartY = 0;
  private panAnchorX = 0;
  private panAnchorY = 0;

  private readonly dialogSyncEffect = effect(() => {
    const entry = this.selectedEntry();
    const dialogElement = this.libraryEntryDetailDialogRef?.nativeElement;
    if (dialogElement === undefined) {
      return;
    }

    if (entry === null) {
      if (dialogElement.open) {
        dialogElement.close();
      }
      dialogElement.removeAttribute('open');
      this.resetPanZoomState();
      return;
    }

    this.resetPanZoomState();
    if (dialogElement.open) {
      dialogElement.close();
    }
    try {
      dialogElement.showModal();
    } catch {
      dialogElement.setAttribute('open', 'true');
    }
  });

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

  onLibraryDetailPanStart(mouseEvent: MouseEvent): void {
    this.libraryDetailIsDragging.set(true);
    this.panDragStartX = mouseEvent.clientX;
    this.panDragStartY = mouseEvent.clientY;
    this.panAnchorX = this.libraryDetailPanX();
    this.panAnchorY = this.libraryDetailPanY();
    mouseEvent.preventDefault();
  }

  onLibraryDetailPanMove(mouseEvent: MouseEvent): void {
    if (!this.libraryDetailIsDragging()) {
      return;
    }

    const rawX: number = this.panAnchorX + (mouseEvent.clientX - this.panDragStartX);
    const rawY: number = this.panAnchorY + (mouseEvent.clientY - this.panDragStartY);
    const { x, y } = this.clampLibraryDetailPan(rawX, rawY);
    this.libraryDetailPanX.set(x);
    this.libraryDetailPanY.set(y);
  }

  onLibraryDetailPanEnd(): void {
    this.libraryDetailIsDragging.set(false);
  }

  onLibraryDetailWheel(wheelEvent: WheelEvent): void {
    wheelEvent.stopPropagation();
    const rawX: number = this.libraryDetailPanX() - wheelEvent.deltaX * 0.6;
    const rawY: number = this.libraryDetailPanY() - wheelEvent.deltaY * 0.6;
    const { x, y } = this.clampLibraryDetailPan(rawX, rawY);
    this.libraryDetailPanX.set(x);
    this.libraryDetailPanY.set(y);
  }

  onLibraryDetailDialogClick(event: Event): void {
    const dialogElement: HTMLDialogElement | undefined =
      this.libraryEntryDetailDialogRef?.nativeElement;
    if (dialogElement === undefined) {
      return;
    }

    if (event.target === dialogElement) {
      this.requestClose();
    }
  }

  requestClose(): void {
    this.closeRequested.emit();
  }

  requestEdit(entry: SmileitCatalogEntryView): void {
    this.editRequested.emit(entry);
  }

  isEntryAdded(entry: SmileitCatalogEntryView): boolean {
    return this.openContext() === 'reference' || this.isReferencedInAnyBlockResolver()(entry);
  }

  isEntryEditable(entry: SmileitCatalogEntryView): boolean {
    return this.isCatalogEntryEditableResolver()(entry);
  }

  resolvedEntrySvg(entry: SmileitCatalogEntryView): SafeHtml | null {
    return this.previewSvgResolver()(entry);
  }

  private clampLibraryDetailPan(rawX: number, rawY: number): { x: number; y: number } {
    const halfOverflow: number =
      (this.libraryDetailPreviewSize() - this.libraryDetailViewportPx) / 2;
    return {
      x: Math.max(-halfOverflow, Math.min(halfOverflow, rawX)),
      y: Math.max(-halfOverflow, Math.min(halfOverflow, rawY)),
    };
  }

  private resetPanZoomState(): void {
    this.libraryDetailZoomLevel.set(1);
    this.libraryDetailPanX.set(0);
    this.libraryDetailPanY.set(0);
    this.libraryDetailIsDragging.set(false);
  }
}
