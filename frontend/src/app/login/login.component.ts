// login.component.ts: Pantalla de acceso para iniciar sesión con JWT y rol transversal.

import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IdentitySessionService } from '../core/auth/identity-session.service';

@Component({
  selector: 'app-login',
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  readonly sessionService = inject(IdentitySessionService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly username = signal<string>('admin');
  readonly password = signal<string>('');
  readonly localErrorMessage = signal<string | null>(null);

  submit(): void {
    this.localErrorMessage.set(null);
    this.sessionService.login(this.username(), this.password()).subscribe({
      next: (wasAuthenticated: boolean) => {
        if (!wasAuthenticated) {
          this.localErrorMessage.set(
            this.sessionService.lastAuthenticationError() ?? 'Unable to authenticate.',
          );
          return;
        }

        const redirectTarget = this.route.snapshot.queryParamMap.get('redirectTo') ?? '/dashboard';
        void this.router.navigateByUrl(redirectTarget);
      },
      error: (loginError: { message?: string }) => {
        this.localErrorMessage.set(loginError.message ?? 'Unable to authenticate.');
      },
    });
  }
}
