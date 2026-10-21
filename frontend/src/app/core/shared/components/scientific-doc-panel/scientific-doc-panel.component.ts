import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  linkedSignal,
  output,
  viewChild,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import renderMathInElement from 'katex/contrib/auto-render';
import { LanguageService } from '../../../i18n/language.service';

export interface DocTab {
  id: string;
  titleKey: string;
  contentKey: string;
}

@Component({
  selector: 'app-scientific-doc-panel',
  standalone: true,
  imports: [TranslocoPipe],
  templateUrl: './scientific-doc-panel.component.html',
  styleUrl: './scientific-doc-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScientificDocPanelComponent {
  readonly open = input(false);
  readonly tabs = input<DocTab[]>([]);
  readonly closePanel = output<void>();

  readonly activeTabId = linkedSignal<string>(() => this.tabs()[0]?.id ?? '');

  readonly activeTab = computed<DocTab | null>(
    () => this.tabs().find((tab) => tab.id === this.activeTabId()) ?? null,
  );

  private readonly bodyElement = viewChild<ElementRef<HTMLElement>>('docBody');
  private readonly languageService = inject(LanguageService);
  private readonly translocoService = inject(TranslocoService);
  private readonly sanitizer = inject(DomSanitizer);

  // Contenido propio (i18n del repo, no entrada de usuario): se omite el
  // saneador de Angular para conservar los diagramas <svg> de los ejemplos.
  readonly safeContent = computed<SafeHtml>(() => {
    this.languageService.activeLanguageCode();
    const contentKey = this.activeTab()?.contentKey ?? '';
    return this.sanitizer.bypassSecurityTrustHtml(
      this.translocoService.translate(contentKey),
    );
  });

  constructor() {
    const injector = inject(Injector);
    effect(() => {
      // Depende también de `open()`: al abrir el panel `activeTab()` no cambia
      // y sin esta lectura KaTeX nunca se ejecutaba en la primera apertura.
      this.open();
      this.activeTab();
      // Re-renderiza al cambiar de idioma: el pipe sustituye el innerHTML
      // y hay que volver a aplicar KaTeX sobre el contenido traducido.
      this.languageService.activeLanguageCode();
      afterNextRender({
        write: () => {
          const el = this.bodyElement()?.nativeElement;
          if (el) {
            renderMathInElement(el, {
              delimiters: [
                { left: '$$', right: '$$', display: true },
                { left: String.raw`\(`, right: String.raw`\)`, display: false },
              ],
              ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
              throwOnError: false,
            });
          }
        },
      }, { injector });
    });
  }

  selectTab(tabId: string): void {
    this.activeTabId.set(tabId);
  }

  onBackdropClick(): void {
    this.closePanel.emit();
  }
}
