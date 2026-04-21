// cadma-py-delete-modal.component.ts: Modal de confirmación para eliminar una familia de referencia.
// Muestra los jobs vinculados (si los hay) y pide confirmación explícita al usuario.

import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  input,
  output,
  signal,
  ViewChild,
} from '@angular/core';
import type { CadmaLinkedJobView } from '../core/api/cadma-py-api.service';

export interface DeleteConfirmationResult {
  confirmed: boolean;
  cascade: boolean;
}

@Component({
  selector: 'app-cadma-py-delete-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #deleteDialog class="delete-dialog" (click)="onBackdropClick($event)">
      <section class="delete-card" (click)="$event.stopPropagation()">
        <header class="delete-header">
          <h3>{{ headerTitle() }}</h3>
          <button type="button" class="delete-close-btn" (click)="dismiss()" aria-label="Close">
            ×
          </button>
        </header>

        @if (loading()) {
          <div class="delete-loading">
            <div class="delete-spinner"></div>
            <p>Loading linked jobs...</p>
          </div>
        } @else {
          <div class="delete-body">
            @if (linkedJobs().length === 0) {
              <p class="delete-message">
                Are you sure you want to delete
                <strong>{{ libraryName() }}</strong
                >? This action cannot be undone.
              </p>
            } @else {
              <p class="delete-message delete-warning">
                ⚠️ <strong>{{ libraryName() }}</strong> has
                <strong>{{ linkedJobs().length }}</strong>
                linked {{ linkedJobs().length === 1 ? 'job' : 'jobs' }}
                that will also be deleted:
              </p>
              <ul class="delete-job-list">
                @for (job of linkedJobs(); track job.id) {
                  <li class="delete-job-item">
                    <span class="job-label">{{ job.project_label || job.id }}</span>
                    <span class="job-status" [class]="'status-' + job.status">{{
                      job.status
                    }}</span>
                    <span class="job-date">{{ job.created_at | date: 'short' }}</span>
                  </li>
                }
              </ul>
              <p class="delete-cascade-note">
                All listed jobs and their results will be permanently removed.
              </p>
            }
          </div>

          @if (errorMessage(); as errMsg) {
            <p class="delete-error" role="alert">{{ errMsg }}</p>
          }

          <footer class="delete-footer">
            <button type="button" class="btn-cancel" (click)="dismiss()">Cancel</button>
            <button
              type="button"
              class="btn-confirm-delete"
              (click)="confirm()"
              [disabled]="deleting() || loading()"
            >
              @if (deleting()) {
                Deleting...
              } @else {
                Delete
              }
            </button>
          </footer>
        }
      </section>
    </dialog>
  `,
  styleUrl: './cadma-py-delete-modal.component.scss',
  imports: [DatePipe],
})
export class CadmaPyDeleteModalComponent {
  readonly libraryName = input<string>('');
  readonly linkedJobs = input<CadmaLinkedJobView[]>([]);
  readonly loading = input<boolean>(false);
  readonly deleting = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);

  readonly confirmed = output<DeleteConfirmationResult>();
  readonly dismissed = output<void>();

  @ViewChild('deleteDialog')
  private readonly dialogRef?: ElementRef<HTMLDialogElement>;

  /** Crea el título dinámico del modal. */
  protected headerTitle(): string {
    const jobCount = this.linkedJobs().length;
    if (this.loading()) return 'Checking linked data...';
    if (jobCount === 0) return 'Delete family';
    return `Delete family and ${jobCount} ${jobCount === 1 ? 'job' : 'jobs'}`;
  }

  open(): void {
    this.deleting.set(false);
    this.errorMessage.set(null);
    this.dialogRef?.nativeElement.showModal();
  }

  close(): void {
    this.dialogRef?.nativeElement.close();
  }

  dismiss(): void {
    this.close();
    this.dismissed.emit();
  }

  confirm(): void {
    const cascade = this.linkedJobs().length > 0;
    this.confirmed.emit({ confirmed: true, cascade });
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === this.dialogRef?.nativeElement) {
      this.dismiss();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.dialogRef?.nativeElement.open) {
      this.dismiss();
    }
  }
}
