// change-password.component.ts: Pantalla de cambio obligatorio de contraseña.
// Se muestra al primer login con password default (flag must_change_password).

import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { IdentitySessionService } from '../core/auth/identity-session.service';

@Component({
  selector: 'app-change-password',
  imports: [CommonModule, FormsModule, RouterModule, TranslocoPipe],
  templateUrl: './change-password.component.html',
  styleUrl: './change-password.component.scss',
})
export class ChangePasswordComponent {
  private readonly sessionService = inject(IdentitySessionService);
  private readonly translocoService = inject(TranslocoService);
  private readonly router = inject(Router);

  readonly currentPassword = signal<string>('');
  readonly newPassword = signal<string>('');
  readonly confirmPassword = signal<string>('');
  readonly isSubmitting = signal<boolean>(false);
  readonly localErrorMessage = signal<string | null>(null);

  submit(): void {
    this.localErrorMessage.set(null);

    if (!this.currentPassword() || !this.newPassword() || !this.confirmPassword()) {
      this.localErrorMessage.set(
        this.translocoService.translate('changePassword.errors.required'),
      );
      return;
    }
    if (this.newPassword().length < 8) {
      this.localErrorMessage.set(
        this.translocoService.translate('changePassword.errors.tooShort'),
      );
      return;
    }
    if (this.newPassword() === this.currentPassword()) {
      this.localErrorMessage.set(
        this.translocoService.translate('changePassword.errors.sameAsCurrent'),
      );
      return;
    }
    if (this.newPassword() !== this.confirmPassword()) {
      this.localErrorMessage.set(
        this.translocoService.translate('changePassword.errors.mismatch'),
      );
      return;
    }

    this.isSubmitting.set(true);
    this.sessionService.changePassword(this.currentPassword(), this.newPassword()).subscribe({
      next: (changed: boolean) => {
        this.isSubmitting.set(false);
        if (changed) {
          void this.router.navigateByUrl('/apps');
          return;
        }
        this.localErrorMessage.set(
          this.translocoService.translate('changePassword.errors.generic'),
        );
      },
      error: (changeError: { error?: { detail?: string }; message?: string }) => {
        this.isSubmitting.set(false);
        const backendDetail = changeError.error?.detail;
        this.localErrorMessage.set(
          typeof backendDetail === 'string' && backendDetail !== ''
            ? backendDetail
            : this.translocoService.translate('changePassword.errors.generic'),
        );
      },
    });
  }
}
