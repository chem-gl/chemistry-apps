import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { IdentitySessionService } from './identity-session.service';

@Injectable({ providedIn: 'root' })
export class JobAccessModeService {
  private readonly session = inject(IdentitySessionService);
  private readonly transloco = inject(TranslocoService, { optional: true });

  readonly isOpenMode = computed(() => this.session.status() === 'anonymous');
  readonly mode = computed<'account' | 'open'>(() => (this.isOpenMode() ? 'open' : 'account'));
  readonly canUseJobControls = computed(() => !this.isOpenMode());

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
