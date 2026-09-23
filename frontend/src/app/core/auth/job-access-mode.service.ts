import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { IdentitySessionService } from './identity-session.service';

@Injectable({ providedIn: 'root' })
export class JobAccessModeService {
  static current: Pick<JobAccessModeService, 'isOpenMode'> | null = null;
  private readonly session = inject(IdentitySessionService);
  private readonly transloco = inject(TranslocoService, { optional: true });

  readonly isOpenMode = computed(() => this.session.status() === 'anonymous');
  readonly mode = computed<'account' | 'open'>(() => (this.isOpenMode() ? 'open' : 'account'));
  readonly canUseJobControls = computed(() => !this.isOpenMode());

  openModeLimitMessage(error: unknown): string | null {
    if (!this.isOpenMode() || !(error instanceof HttpErrorResponse)) {
      return null;
    }

    const translationKey = error.status === 429 ? 'appMode.open.limits.429' : error.status === 413 ? 'appMode.open.limits.413' : null;
    if (translationKey === null) {
      return null;
    }

    const translatedMessage = this.transloco?.translate(translationKey);
    const message = translatedMessage === undefined || translatedMessage === translationKey
      ? translationKey
      : translatedMessage;
    const retryAfter = error.headers.get('Retry-After');
    return retryAfter === null || retryAfter.trim() === ''
      ? message
      : `${message} Retry-After: ${retryAfter}.`;
  }

  constructor() {
    JobAccessModeService.current = this;
  }
}
