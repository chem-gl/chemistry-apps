// smiles-structure-trigger.component.ts: Disparador interactivo para mostrar estructuras químicas solo al hover o al clic.

import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, Input, ViewChild, signal } from '@angular/core';
import { SmilesStructurePreviewComponent } from '../smiles-structure-preview/smiles-structure-preview.component';

type StructurePreviewLayout = 'inline' | 'compact' | 'detail';

interface HoverPanelPosition {
  top: number;
  left: number;
  width: number;
  transformOrigin: string;
}

@Component({
  selector: 'app-smiles-structure-trigger',
  imports: [CommonModule, SmilesStructurePreviewComponent],
  templateUrl: './smiles-structure-trigger.component.html',
  styleUrl: './smiles-structure-trigger.component.scss',
})
export class SmilesStructureTriggerComponent {
  @Input() title: string = 'Structure preview';
  @Input() smiles: string = '';
  @Input() svg: string | null = null;
  @Input() layout: StructurePreviewLayout = 'compact';
  @Input() showSmilesText: boolean = true;
  @Input() showAtomCount: boolean = false;
  @Input() emptyLabel: string = 'Pending structure';
  @Input() triggerLabel: string = 'Preview structure';

  @ViewChild('triggerButton') private triggerButtonRef?: ElementRef<HTMLButtonElement>;
  @ViewChild('modalDialog') private modalDialogRef?: ElementRef<HTMLDialogElement>;

  readonly isHoverPreviewVisible = signal<boolean>(false);
  readonly hoverPanelPosition = signal<HoverPanelPosition>({
    top: 0,
    left: 0,
    width: 320,
    transformOrigin: 'top left',
  });

  hasRenderableSmiles(): boolean {
    return this.smiles.trim() !== '';
  }

  openModal(): void {
    if (!this.hasRenderableSmiles()) {
      return;
    }

    const modalDialog: HTMLDialogElement | undefined = this.modalDialogRef?.nativeElement;
    if (modalDialog === undefined || modalDialog.open) {
      return;
    }

    this.hideHoverPreview();
    modalDialog.showModal();
  }

  closeModal(): void {
    this.modalDialogRef?.nativeElement.close();
  }

  showHoverPreview(): void {
    if (!this.hasRenderableSmiles()) {
      return;
    }

    this.updateHoverPreviewPosition();
    this.isHoverPreviewVisible.set(true);
  }

  hideHoverPreview(): void {
    this.isHoverPreviewVisible.set(false);
  }

  hoverPanelStyles(): Record<string, string> {
    const currentPosition: HoverPanelPosition = this.hoverPanelPosition();

    return {
      top: `${currentPosition.top}px`,
      left: `${currentPosition.left}px`,
      width: `${currentPosition.width}px`,
      'transform-origin': currentPosition.transformOrigin,
    };
  }

  onDialogBackdropClick(mouseEvent: MouseEvent): void {
    const dialogElement: HTMLDialogElement | undefined = this.modalDialogRef?.nativeElement;
    if (dialogElement === undefined) {
      return;
    }

    const eventTarget: EventTarget | null = mouseEvent.target;
    if (eventTarget === dialogElement) {
      this.closeModal();
    }
  }

  @HostListener('window:scroll')
  @HostListener('window:resize')
  onViewportChanged(): void {
    if (!this.isHoverPreviewVisible()) {
      return;
    }

    this.updateHoverPreviewPosition();
  }

  private updateHoverPreviewPosition(): void {
    const triggerButton: HTMLButtonElement | undefined = this.triggerButtonRef?.nativeElement;
    if (triggerButton === undefined) {
      return;
    }

    const triggerRect: DOMRect = triggerButton.getBoundingClientRect();
    const viewportPadding: number = 12;
    const previewGap: number = 10;
    const previewWidth: number = Math.min(320, window.innerWidth - viewportPadding * 2);

    let leftPosition: number = triggerRect.left;
    if (leftPosition + previewWidth > window.innerWidth - viewportPadding) {
      leftPosition = window.innerWidth - previewWidth - viewportPadding;
    }
    leftPosition = Math.max(viewportPadding, leftPosition);

    let topPosition: number = triggerRect.bottom + previewGap;
    let transformOrigin: string = 'top left';
    const estimatedPreviewHeight: number = 190;

    if (topPosition + estimatedPreviewHeight > window.innerHeight - viewportPadding) {
      topPosition = Math.max(
        viewportPadding,
        triggerRect.top - estimatedPreviewHeight - previewGap,
      );
      transformOrigin = 'bottom left';
    }

    this.hoverPanelPosition.set({
      top: topPosition,
      left: leftPosition,
      width: previewWidth,
      transformOrigin,
    });
  }
}
