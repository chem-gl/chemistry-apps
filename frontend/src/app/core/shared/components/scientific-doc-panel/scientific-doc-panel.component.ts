import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

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

  selectTab(tabId: string): void {
    this.activeTabId.set(tabId);
  }

  onBackdropClick(): void {
    this.closePanel.emit();
  }
}
