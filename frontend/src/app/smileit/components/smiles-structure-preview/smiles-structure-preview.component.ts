// smiles-structure-preview.component.ts: Componente visual reutilizable para representar una estructura química a partir de un SMILES.

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Subscription } from 'rxjs';
import {
  SmilesStructurePreviewService,
  SmilesStructurePreviewView,
} from '../../../core/application/smiles-structure-preview.service';

type StructurePreviewLayout = 'inline' | 'compact' | 'detail';
type StructurePreviewStatus = 'idle' | 'loading' | 'ready' | 'error';

interface StructurePreviewState {
  status: StructurePreviewStatus;
  preview: SmilesStructurePreviewView | null;
}

@Component({
  selector: 'app-smiles-structure-preview',
  imports: [CommonModule],
  templateUrl: './smiles-structure-preview.component.html',
  styleUrl: './smiles-structure-preview.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SmilesStructurePreviewComponent implements OnChanges, OnDestroy {
  @Input() title: string = '';
  @Input() smiles: string = '';
  @Input() svg: string | null = null;
  @Input() layout: StructurePreviewLayout = 'compact';
  @Input() showSmilesText: boolean = true;
  @Input() showAtomCount: boolean = false;
  @Input() emptyLabel: string = 'Pending structure';

  private readonly previewService = inject(SmilesStructurePreviewService);
  private readonly sanitizer = inject(DomSanitizer);
  private previewSubscription: Subscription | null = null;
  readonly state = signal<StructurePreviewState>({ status: 'idle', preview: null });
  readonly trustedSvg = computed<SafeHtml | null>(() => {
    const currentPreview: SmilesStructurePreviewView | null = this.state().preview;
    if (currentPreview === null) {
      return null;
    }

    return this.sanitizer.bypassSecurityTrustHtml(currentPreview.svg);
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['smiles'] !== undefined || changes['svg'] !== undefined) {
      this.refreshPreview();
    }
  }

  ngOnDestroy(): void {
    this.previewSubscription?.unsubscribe();
  }

  ngAfterViewInit?(): void {}

  hasRenderableSmiles(): boolean {
    return this.smiles.trim() !== '';
  }

  private refreshPreview(): void {
    const normalizedSmiles: string = this.smiles.trim();
    this.previewSubscription?.unsubscribe();
    this.previewSubscription = null;

    if (normalizedSmiles === '') {
      this.state.set({ status: 'idle', preview: null });
      return;
    }

    if (this.svg !== null && this.svg.trim() !== '') {
      this.state.set({
        status: 'ready',
        preview: this.previewService.fromSvg(normalizedSmiles, this.svg),
      });
      return;
    }

    this.state.set({ status: 'loading', preview: null });
    this.previewSubscription = this.previewService.getPreview(normalizedSmiles).subscribe({
      next: (preview: SmilesStructurePreviewView) => {
        if (this.smiles.trim() !== normalizedSmiles) {
          return;
        }

        this.state.set({ status: 'ready', preview });
      },
      error: () => {
        if (this.smiles.trim() !== normalizedSmiles) {
          return;
        }

        this.state.set({ status: 'error', preview: null });
      },
    });
  }
}
