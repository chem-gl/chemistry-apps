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
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { TranslocoPipe } from '@jsverse/transloco';
import { KetcherFrameService } from '../../core/application/ketcher-frame.service';

@Component({
  selector: 'app-principal-molecule-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslocoPipe],
  templateUrl: './principal-molecule-editor.component.html',
  styleUrl: './principal-molecule-editor.component.scss',
})
export class PrincipalMoleculeEditorComponent {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly ketcherFrameService = inject(KetcherFrameService);

  @ViewChild('sketchModifierDialog')
  private readonly sketchModifierDialogRef?: ElementRef<HTMLDialogElement>;

  @ViewChild('ketcherFrame')
  private readonly ketcherFrameRef?: ElementRef<HTMLIFrameElement>;

  @Input() principalSmiles: string = '';
  @Input() isProcessing: boolean = false;
  @Input() isInspecting: boolean = false;

  sketchDraftSmiles: string = '';
  readonly ketcherPublicUrl: SafeResourceUrl;
  isKetcherReady: boolean = false;
  readonly isSketchModifierLoading = signal<boolean>(false);
  /** Error de validación del SMILES al aplicar el sketch modifier (molécula vacía o múltiple). */
  readonly sketchValidationError = signal<string | null>(null);
  private hasCompletedFirstSketchLoad: boolean = false;

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
    this.sketchValidationError.set(null);
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

  onSketchModifierDialogClick(event: MouseEvent | KeyboardEvent): void {
    const dialogElement: HTMLDialogElement | undefined =
      this.sketchModifierDialogRef?.nativeElement;
    if (dialogElement === undefined) {
      return;
    }

    if (event.target === dialogElement) {
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

    // Validar que el SMILES no esté vacío ni contenga múltiples moléculas.
    const validationError: string | null = this.validateSingleMoleculeSmiles(
      this.sketchDraftSmiles,
    );
    if (validationError !== null) {
      this.sketchValidationError.set(validationError);
      return;
    }

    this.sketchValidationError.set(null);
    this.onPrincipalSmilesChange(this.sketchDraftSmiles.trim());
    // Auto-inspect para no requerir clic manual después de dibujar.
    this.inspectRequested.emit();
    this.closeSketchModifier();
  }

  /**
   * Valida que el SMILES sea una única molécula no vacía.
   * Retorna un mensaje de error o null si es válido.
   */
  private validateSingleMoleculeSmiles(smiles: string): string | null {
    const normalizedSmiles: string = smiles.trim();
    if (normalizedSmiles === '') {
      return 'Dibuja una molécula antes de aplicar.';
    }
    if (normalizedSmiles.includes('.')) {
      return 'Solo se permite una molécula. El SMILES contiene múltiples fragmentos (".").';
    }
    return null;
  }

  private async pushDraftToKetcher(): Promise<void> {
    const ketcherApi = await this.ketcherFrameService.waitForApi(
      this.ketcherFrameRef?.nativeElement,
      40,
    );
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
    const ketcherApi = await this.ketcherFrameService.waitForApi(
      this.ketcherFrameRef?.nativeElement,
      40,
    );
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

  private async ensureKetcherReady(): Promise<void> {
    if (this.isKetcherReady) {
      this.syncSketchLoadingVisibility();
      return;
    }

    const api = await this.ketcherFrameService.waitForApi(this.ketcherFrameRef?.nativeElement, 120);
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
