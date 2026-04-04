// global-error-modal.component.ts: Modal global reutilizable para mostrar errores uniformes en todas las apps.

import { CommonModule } from '@angular/common';
import { Component, HostListener, inject } from '@angular/core';
import { GlobalErrorModalService } from '../../../application/errors/global-error-modal.service';

@Component({
  selector: 'app-global-error-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './global-error-modal.component.html',
  styleUrl: './global-error-modal.component.scss',
})
export class GlobalErrorModalComponent {
  readonly errorModalService = inject(GlobalErrorModalService);

  close(): void {
    this.errorModalService.dismiss();
  }

  @HostListener('document:keydown.escape')
  closeOnEscapeKey(): void {
    if (this.errorModalService.currentError() !== null) {
      this.close();
    }
  }
}
