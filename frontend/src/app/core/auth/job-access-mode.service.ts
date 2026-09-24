import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { catchError, of } from 'rxjs';
import { API_BASE_URL } from '../shared/constants';
import { IdentitySessionService } from './identity-session.service';

@Injectable({ providedIn: 'root' })
export class JobAccessModeService {
  private readonly session = inject(IdentitySessionService);
  private readonly transloco = inject(TranslocoService, { optional: true });
  private readonly httpClient = inject(HttpClient, { optional: true });

  readonly openModeEnabled = signal<boolean>(true);
  readonly isOpenMode = computed(() => this.session.status() === 'anonymous');
  readonly mode = computed<'account' | 'open'>(() => (this.isOpenMode() ? 'open' : 'account'));
  readonly canUseJobControls = computed(() => !this.isOpenMode());

  refreshOpenMode(): void {
    if (this.httpClient === null) {
      return;
    }
    this.httpClient
      .get<{ mode?: string }>(`${API_BASE_URL}/api/public/catalog/`)
      .pipe(catchError(() => of({ mode: 'open' })))
      .subscribe((catalog) => this.openModeEnabled.set(catalog.mode === 'open'));
  }

  openModeLimitMessage(error: unknown): string | null {
    if (!this.isOpenMode() || !(error instanceof HttpErrorResponse)) {
      return null;
    }

    let translationKey: string | null = null;
    if (error.status === 429) {
      translationKey = 'appMode.open.limits.429';
    } else if (error.status === 413) {
      translationKey = 'appMode.open.limits.413';
    }
    if (translationKey === null) {
      return null;
    }

    const translatedMessage = this.transloco?.translate(translationKey);
    const message = translatedMessage === undefined || translatedMessage === translationKey
      ? translationKey
      : translatedMessage;
    const retryAfter = error.headers.get('Retry-After');
    if (retryAfter === null || retryAfter.trim() === '') {
      return message;
    }
    return `${message} Retry-After: ${retryAfter}.`;
  }
}
