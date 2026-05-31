// register.component.ts: Pantalla de auto-registro público de usuarios.
// Soporta registro con y sin token de invitación.

import { CommonModule, NgOptimizedImage } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { AuthApiService, RegisterPayload, RegisterResponse } from '../core/api/auth-api.service';
import { IdentitySessionService } from '../core/auth/identity-session.service';

@Component({
  selector: 'app-register',
  imports: [CommonModule, FormsModule, RouterModule, TranslocoPipe, NgOptimizedImage],
  templateUrl: './register.component.html',
  styleUrl: './register.component.scss',
})
export class RegisterComponent implements OnInit {
  private readonly authApiService = inject(AuthApiService);
  private readonly sessionService = inject(IdentitySessionService);
  private readonly translocoService = inject(TranslocoService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly username = signal<string>('');
  readonly email = signal<string>('');
  readonly password = signal<string>('');
  readonly confirmPassword = signal<string>('');
  readonly invitationToken = signal<string>('');
  readonly isSubmitting = signal<boolean>(false);
  readonly localErrorMessage = signal<string | null>(null);
  readonly registrationSuccess = signal<boolean>(false);

  ngOnInit(): void {
    // Pre-fill token from URL query param
    const tokenParam = this.route.snapshot.queryParamMap.get('token');
    if (tokenParam !== null) {
      this.invitationToken.set(tokenParam);
    }

    // If already authenticated, redirect
    if (this.sessionService.isAuthenticated()) {
      void this.router.navigateByUrl('/dashboard');
    }
  }

  submit(): void {
    this.localErrorMessage.set(null);

    // Client-side validation
    if (!this.username().trim()) {
      this.localErrorMessage.set(
        this.translocoService.translate('register.errors.usernameRequired'),
      );
      return;
    }
    if (!this.email().trim()) {
      this.localErrorMessage.set(
        this.translocoService.translate('register.errors.emailRequired'),
      );
      return;
    }
    if (!this.password()) {
      this.localErrorMessage.set(
        this.translocoService.translate('register.errors.passwordRequired'),
      );
      return;
    }
    if (this.password().length < 8) {
      this.localErrorMessage.set(
        this.translocoService.translate('register.errors.passwordTooShort'),
      );
      return;
    }
    if (this.password() !== this.confirmPassword()) {
      this.localErrorMessage.set(
        this.translocoService.translate('register.errors.passwordMismatch'),
      );
      return;
    }

    this.isSubmitting.set(true);

    const token = this.invitationToken().trim();
    const payload: RegisterPayload = {
      username: this.username().trim(),
      email: this.email().trim(),
      password: this.password(),
    };
    if (token !== '') {
      payload.registration_token = token;
    }

    this.authApiService.register(payload).subscribe({
      next: (response: RegisterResponse) => {
        if (response.access !== undefined && response.refresh !== undefined) {
          // Auto-login: persist tokens and load remote session
          this.sessionService.initializeFromRegistration({
            accessToken: response.access,
            refreshToken: response.refresh,
          }).subscribe({
            next: () => {
              void this.router.navigateByUrl('/dashboard');
            },
            error: () => {
              void this.router.navigateByUrl('/dashboard');
            },
          });
        } else {
          // No auto-login: show success and redirect to login
          this.registrationSuccess.set(true);
          this.isSubmitting.set(false);
          globalThis.setTimeout(() => {
            void this.router.navigateByUrl('/login');
          }, 3000);
        }
      },
      error: (err: { error?: Record<string, string[]>; message?: string }) => {
        this.isSubmitting.set(false);
        // Backend validation errors
        if (err.error && typeof err.error === 'object') {
          const firstError = Object.values(err.error).flat().join('. ');
          this.localErrorMessage.set(firstError || (err.message ?? 'Registration failed.'));
        } else {
          this.localErrorMessage.set(err.message ?? 'Registration failed.');
        }
      },
    });
  }
}
