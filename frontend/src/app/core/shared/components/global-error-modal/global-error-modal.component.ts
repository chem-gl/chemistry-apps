// global-error-modal.component.ts: Modal global reutilizable para mostrar errores uniformes en todas las apps.
// Bloquea el scroll del fondo mientras está abierto, atrapa el foco dentro de la tarjeta
// y devuelve el foco al elemento activo anterior al cerrarse.

import { CommonModule } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { GlobalErrorModalService } from '../../../application/errors/global-error-modal.service';
import type { ErrorModalViewModel } from '../../../application/errors/error-notifier.port';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), summary, a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

@Component({
  selector: 'app-global-error-modal',
  standalone: true,
  imports: [CommonModule, TranslocoPipe],
  templateUrl: './global-error-modal.component.html',
  styleUrl: './global-error-modal.component.scss',
})
export class GlobalErrorModalComponent {
  readonly errorModalService = inject(GlobalErrorModalService);

  private readonly translocoService = inject(TranslocoService);
  private readonly injector = inject(Injector);
  private readonly modalCard = viewChild<ElementRef<HTMLElement>>('modalCard');

  private isScrollLocked = false;
  private capturedRootOverflow = '';
  private capturedBodyOverflow = '';
  private capturedBodyPosition = '';
  private capturedBodyInset = '';
  private capturedScrollY = 0;
  private previouslyFocusedElement: Element | null = null;
  private lastExternalFocus: HTMLElement | null = null;

  /** Etiqueta accesible: usa la clave Transloco cuando existe, con texto crudo de respaldo. */
  readonly ariaLabel = computed<string>(() => {
    const viewModel: ErrorModalViewModel | null = this.errorModalService.currentError();
    if (viewModel === null) {
      return '';
    }

    if (viewModel.titleKey === undefined) {
      return viewModel.title;
    }

    const translated = this.translocoService.translate(viewModel.titleKey);
    return translated === viewModel.titleKey ? viewModel.title : translated;
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => this.unlockBackground());

    // Transición explícita de estado (abrir/cerrar) en el cuerpo del efecto: traba el scroll
    // del fondo, mueve el foco al botón principal y lo devuelve al cerrar.
    effect(() => {
      const isOpen = this.errorModalService.currentError() !== null;
      if (typeof document === 'undefined') {
        return;
      }

      if (isOpen && !this.isScrollLocked) {
        this.lockBackgroundAndFocus();
        return;
      }

      if (!isOpen && this.isScrollLocked) {
        this.unlockBackground();
      }
    });
  }

  close(): void {
    this.errorModalService.dismiss();
  }

  @HostListener('document:keydown.escape')
  closeOnEscapeKey(): void {
    if (this.errorModalService.currentError() !== null) {
      this.close();
    }
  }

  /**
   * Último elemento enfocable fuera del modal. Los disparadores que se auto-deshabilitan
   * durante la petición pierden el foco (body) antes de que abra el modal; esta memoria
   * permite devolvérselo al cerrar.
   */
  @HostListener('document:focusin', ['$event'])
  trackExternalFocus(event: FocusEvent): void {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target === document.body) {
      return;
    }

    const card = this.cardElement();
    if (card !== undefined && card.contains(target)) {
      return;
    }

    this.lastExternalFocus = target;
  }

  /** Atrapa el tabulador dentro de la tarjeta del modal (alertdialog). */
  onModalKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') {
      return;
    }

    const card = this.cardElement();
    if (card === undefined) {
      return;
    }

    const focusable = [...card.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0] as HTMLElement;
    const last = focusable[focusable.length - 1] as HTMLElement;
    const active = document.activeElement;

    if (event.shiftKey && (active === first || !card.contains(active))) {
      event.preventDefault();
      last.focus();
      return;
    }

    if (!event.shiftKey && (active === last || !card.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  /** Elemento de la tarjeta del modal o undefined si todavía no está renderizada. */
  private cardElement(): HTMLElement | undefined {
    return this.modalCard()?.nativeElement;
  }

  private lockBackgroundAndFocus(): void {
    this.isScrollLocked = true;
    const activeElement = document.activeElement;
    this.previouslyFocusedElement =
      activeElement instanceof HTMLElement && activeElement !== document.body
        ? activeElement
        : this.lastExternalFocus;
    this.capturedRootOverflow = document.documentElement.style.overflow;
    this.capturedBodyOverflow = document.body.style.overflow;
    this.capturedBodyPosition = document.body.style.position;
    this.capturedBodyInset = document.body.style.inset;
    this.capturedScrollY = window.scrollY;

    // Traba el scroll del fondo: el body se fija al viewport (el contenido recortado queda
    // invisible detrás del overlay) y la altura del documento colapsa al viewport, de modo
    // que el backdrop cubre toda la página sin dejar franjas claras bajo el pliegue.
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.inset = '0';

    afterNextRender(
      {
        write: () => {
          this.cardElement()
            ?.querySelector<HTMLButtonElement>('.error-modal-confirm-button')
            ?.focus();
        },
      },
      { injector: this.injector },
    );
  }

  private unlockBackground(): void {
    if (!this.isScrollLocked) {
      return;
    }

    this.isScrollLocked = false;
    document.documentElement.style.overflow = this.capturedRootOverflow;
    document.body.style.overflow = this.capturedBodyOverflow;
    document.body.style.position = this.capturedBodyPosition;
    document.body.style.inset = this.capturedBodyInset;
    window.scrollTo(0, this.capturedScrollY);

    const previous = this.previouslyFocusedElement;
    this.previouslyFocusedElement = null;
    if (
      previous instanceof HTMLElement &&
      previous.isConnected &&
      !(previous instanceof HTMLButtonElement && previous.disabled)
    ) {
      previous.focus();
    }
  }
}
