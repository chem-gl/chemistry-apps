// login.component.ts: Portal de acceso institucional — CADMA-Chem Suite.
// Identidad: Química Teórica y Aplicada. UAM-UNAM.

import { CommonModule, NgOptimizedImage } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { IdentitySessionService } from '../core/auth/identity-session.service';
import { AuthApiService, AuthProviders } from '../core/api/auth-api.service';
import { InstitutionalShowcaseComponent } from '../core/shared/components/institutional-showcase/institutional-showcase.component';

interface GoogleCredentialResponse { credential: string; }
interface GoogleIdentityApi {
  accounts: { id: {
    initialize: (config: { client_id: string; callback: (response: GoogleCredentialResponse) => void }) => void;
    prompt: () => void;
  } };
}

declare global { interface Window { google?: GoogleIdentityApi; } }

@Component({
  selector: 'app-login',
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    TranslocoPipe,
    NgOptimizedImage,
    InstitutionalShowcaseComponent,
  ],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent implements OnInit {
  readonly sessionService = inject(IdentitySessionService);
  private readonly authApiService = inject(AuthApiService);
  private readonly translocoService = inject(TranslocoService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private redirectTarget(): string {
    const redirectTo = this.route.snapshot.queryParamMap.get('redirectTo');
    return redirectTo !== null && /^\/(?!\/)[^:]*$/.test(redirectTo) ? redirectTo : '/apps';
  }

  ngOnInit(): void {
    if (this.sessionService.isAuthenticated()) {
      void this.router.navigateByUrl(this.redirectTarget());
    }
    this.authApiService.getAuthProviders().subscribe({
      next: (providers) => {
        this.googleProvider.set(providers.google);
        if (providers.google.enabled && providers.google.client_id !== null) {
          this.loadGoogleScript(providers.google.client_id);
        }
      },
    });
  }

  readonly username = signal<string>('');
  readonly password = signal<string>('');
  readonly localErrorMessage = signal<string | null>(null);
  readonly googleProvider = signal<AuthProviders['google'] | null>(null);
  readonly googleReady = signal(false);

  private loadGoogleScript(clientId: string): void {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      const googleApi = window.google;
      if (googleApi === undefined) return;
      googleApi.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => this.loginWithGoogleCredential(response.credential),
      });
      this.googleReady.set(true);
    };
    script.onerror = () => this.googleReady.set(false);
    document.head.appendChild(script);
  }

  loginWithGoogle(): void { window.google?.accounts.id.prompt(); }

  private loginWithGoogleCredential(idToken: string): void {
    this.localErrorMessage.set(null);
    this.sessionService.loginWithGoogle(idToken).subscribe({
      next: (wasAuthenticated) => {
        if (wasAuthenticated) {
          void this.router.navigateByUrl(this.redirectTarget());
          return;
        }
        this.localErrorMessage.set(
          this.sessionService.lastAuthenticationError() ??
            this.translocoService.translate('login.errors.unableToAuthenticate'),
        );
      },
      error: (loginError: { message?: string }) => {
        this.localErrorMessage.set(
          loginError.message ?? this.translocoService.translate('login.errors.unableToAuthenticate'),
        );
      },
    });
  }

  submit(): void {
    this.localErrorMessage.set(null);
    this.sessionService.login(this.username(), this.password()).subscribe({
      next: (wasAuthenticated: boolean) => {
        if (!wasAuthenticated) {
          this.localErrorMessage.set(
            this.sessionService.lastAuthenticationError() ??
              this.translocoService.translate('login.errors.unableToAuthenticate'),
          );
          return;
        }

        void this.router.navigateByUrl(this.redirectTarget());
      },
      error: (loginError: { message?: string }) => {
        this.localErrorMessage.set(
          loginError.message ??
            this.translocoService.translate('login.errors.unableToAuthenticate'),
        );
      },
    });
  }
}
