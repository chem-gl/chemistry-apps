// principal-molecule-editor.component.ts: Editor textual de molécula principal con acción de inspección para Smile-it.

import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  ViewChild,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

@Component({
  selector: 'app-principal-molecule-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './principal-molecule-editor.component.html',
  styleUrl: './principal-molecule-editor.component.scss',
})
export class PrincipalMoleculeEditorComponent {
  private readonly sanitizer = inject(DomSanitizer);

  @ViewChild('sketchModifierDialog')
  private sketchModifierDialogRef?: ElementRef<HTMLDialogElement>;

  @ViewChild('ketcherFrame')
  private ketcherFrameRef?: ElementRef<HTMLIFrameElement>;

  @Input() principalSmiles: string = '';
  @Input() isProcessing: boolean = false;
  @Input() isInspecting: boolean = false;

  sketchDraftSmiles: string = '';
  readonly ketcherPublicUrl: SafeResourceUrl;
  isKetcherReady: boolean = false;

  @Output() readonly principalSmilesChange = new EventEmitter<string>();
  @Output() readonly inspectRequested = new EventEmitter<void>();

  constructor() {
    this.ketcherPublicUrl = this.sanitizer.bypassSecurityTrustResourceUrl('/ketcher/index.html');
  }

  onPrincipalSmilesChange(nextPrincipalSmiles: string): void {
    this.principalSmilesChange.emit(nextPrincipalSmiles);
  }

  requestInspect(): void {
    this.inspectRequested.emit();
  }

  openSketchModifier(): void {
    this.sketchDraftSmiles = this.principalSmiles;

    const dialogElement: HTMLDialogElement | undefined =
      this.sketchModifierDialogRef?.nativeElement;
    if (dialogElement === undefined) {
      return;
    }

    if (dialogElement.open) {
      if (typeof dialogElement.close === 'function') {
        dialogElement.close();
      } else {
        dialogElement.removeAttribute('open');
      }
    }

    if (typeof dialogElement.showModal === 'function') {
      try {
        dialogElement.showModal();
        void this.pushDraftToKetcher();
        return;
      } catch {
        dialogElement.setAttribute('open', 'true');
        void this.pushDraftToKetcher();
        return;
      }
    }

    dialogElement.setAttribute('open', 'true');
    void this.pushDraftToKetcher();
  }

  closeSketchModifier(): void {
    const dialogElement: HTMLDialogElement | undefined =
      this.sketchModifierDialogRef?.nativeElement;
    if (dialogElement === undefined) {
      return;
    }

    if (dialogElement.open) {
      if (typeof dialogElement.close === 'function') {
        dialogElement.close();
        return;
      }

      dialogElement.removeAttribute('open');
      return;
    }

    dialogElement.removeAttribute('open');
  }

  onSketchModifierDialogClick(mouseEvent: MouseEvent): void {
    const dialogElement: HTMLDialogElement | undefined =
      this.sketchModifierDialogRef?.nativeElement;
    if (dialogElement === undefined) {
      return;
    }

    if (mouseEvent.target === dialogElement) {
      this.closeSketchModifier();
    }
  }

  onKetcherFrameLoaded(): void {
    this.isKetcherReady = true;
    void this.pushDraftToKetcher();
  }

  onSketchDraftSmilesChange(nextSmiles: string): void {
    this.sketchDraftSmiles = nextSmiles;
  }

  async applySketchModifier(): Promise<void> {
    await this.pullDraftFromKetcher();
    this.onPrincipalSmilesChange(this.sketchDraftSmiles);
    this.closeSketchModifier();
  }

  private async pushDraftToKetcher(): Promise<void> {
    const ketcherApi: KetcherApi | null = this.resolveKetcherApi();
    if (ketcherApi === null) {
      return;
    }

    try {
      const normalizedSmiles: string = this.sketchDraftSmiles.trim();
      await ketcherApi.setMolecule(normalizedSmiles);
    } catch {
      // Mantiene fallback por textarea si Ketcher no acepta el contenido.
    }
  }

  private async pullDraftFromKetcher(): Promise<void> {
    const ketcherApi: KetcherApi | null = this.resolveKetcherApi();
    if (ketcherApi === null) {
      return;
    }

    try {
      const nextSmiles: string = await ketcherApi.getSmiles();
      if (typeof nextSmiles === 'string' && nextSmiles.trim() !== '') {
        this.sketchDraftSmiles = nextSmiles.trim();
      }
    } catch {
      // Mantiene fallback por textarea si Ketcher no responde.
    }
  }

  private resolveKetcherApi(): KetcherApi | null {
    if (!this.isKetcherReady) {
      return null;
    }

    const frameElement: HTMLIFrameElement | undefined = this.ketcherFrameRef?.nativeElement;
    const frameWindow: (Window & { ketcher?: unknown }) | null | undefined =
      frameElement?.contentWindow as (Window & { ketcher?: unknown }) | null | undefined;
    const maybeKetcherApi: unknown = frameWindow?.ketcher;
    if (
      typeof maybeKetcherApi !== 'object' ||
      maybeKetcherApi === null ||
      !('getSmiles' in maybeKetcherApi) ||
      !('setMolecule' in maybeKetcherApi)
    ) {
      return null;
    }

    return maybeKetcherApi as KetcherApi;
  }
}

type KetcherApi = {
  getSmiles: () => Promise<string>;
  setMolecule: (molecule: string) => Promise<void>;
};
