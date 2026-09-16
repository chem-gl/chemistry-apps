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
import { TranslocoPipe } from '@jsverse/transloco';
import renderMathInElement from 'katex/contrib/auto-render';

export interface DocTab {
  id: string;
  titleKey: string;
  content: string;
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

  constructor() {
    const injector = inject(Injector);
    effect(() => {
      this.activeTab();
      afterNextRender({
        write: () => {
          const el = this.bodyElement()?.nativeElement;
          if (el) {
            renderMathInElement(el, {
              delimiters: [
                { left: '$$', right: '$$', display: true },
                { left: '\\(', right: '\\)', display: false },
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
