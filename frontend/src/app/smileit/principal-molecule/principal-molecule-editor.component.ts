// principal-molecule-editor.component.ts: Editor textual de molécula principal con acción de inspección para Smile-it.

import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  ViewChild,
  inject,
  signal,
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
export class PrincipalMoleculeEditorComponent implements OnDestroy {
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
  readonly isSketchModifierLoading = signal<boolean>(false);
  private hasCompletedFirstSketchLoad: boolean = false;

  @Output() readonly principalSmilesChange = new EventEmitter<string>();
  @Output() readonly inspectRequested = new EventEmitter<void>();

  constructor() {
    this.ketcherPublicUrl = this.sanitizer.bypassSecurityTrustResourceUrl('/ketcher/index.html');
  }

  ngOnDestroy(): void {}

  onPrincipalSmilesChange(nextPrincipalSmiles: string): void {
    this.principalSmilesChange.emit(nextPrincipalSmiles);
  }

  requestInspect(): void {
    this.inspectRequested.emit();
  }

  openSketchModifier(): void {
    this.sketchDraftSmiles = this.principalSmiles;
    if (!this.hasCompletedFirstSketchLoad) {
      this.startSketchLoadingPhase();
    }
    void this.ensureKetcherReady();

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
    this.isSketchModifierLoading.set(false);
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
    this.syncSketchLoadingVisibility();
    void this.pushDraftToKetcher();
  }

  async applySketchModifier(): Promise<void> {
    await this.pullDraftFromKetcher();
    this.onPrincipalSmilesChange(this.sketchDraftSmiles.trim());
    this.closeSketchModifier();
  }

  private async pushDraftToKetcher(): Promise<void> {
    const ketcherApi: KetcherApi | null = await this.waitForKetcherApi();
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
    const ketcherApi: KetcherApi | null = await this.waitForKetcherApi();
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

  private async waitForKetcherApi(maxAttempts: number = 40): Promise<KetcherApi | null> {
    for (let attempt: number = 0; attempt < maxAttempts; attempt++) {
      const ketcherApi: KetcherApi | null = this.resolveKetcherApi();
      if (ketcherApi !== null) {
        return ketcherApi;
      }
      await new Promise<void>((resolve: () => void) => setTimeout(resolve, 50));
    }

    return null;
  }

  private async ensureKetcherReady(): Promise<void> {
    if (this.isKetcherReady) {
      this.syncSketchLoadingVisibility();
      return;
    }

    const api: KetcherApi | null = await this.waitForKetcherApi(120);
    if (api !== null) {
      this.isKetcherReady = true;
      this.syncSketchLoadingVisibility();
    }
  }

  private startSketchLoadingPhase(): void {
    this.isSketchModifierLoading.set(!this.isKetcherReady);
    this.syncSketchLoadingVisibility();
  }

  private syncSketchLoadingVisibility(): void {
    const mustKeepLoading: boolean = !this.isKetcherReady;
    this.isSketchModifierLoading.set(mustKeepLoading);
    if (!mustKeepLoading) {
      this.hasCompletedFirstSketchLoad = true;
    }
  }
}

type KetcherApi = {
  getSmiles: () => Promise<string>;
  setMolecule: (molecule: string) => Promise<void>;
};
