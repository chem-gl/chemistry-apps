import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { Observable, catchError, map, of, shareReplay, tap } from 'rxjs';
import { API_BASE_URL } from '../shared/constants';
import { IdentitySessionService } from './identity-session.service';

@Injectable({ providedIn: 'root' })
export class JobAccessModeService {
  private readonly session = inject(IdentitySessionService);
  private readonly transloco = inject(TranslocoService, { optional: true });
  private readonly httpClient = inject(HttpClient, { optional: true });
  private openModeRequest$: Observable<boolean> | null = null;

  readonly openModeEnabled = signal<boolean>(true);
  readonly isOpenMode = computed(() => this.session.status() === 'anonymous');
  readonly mode = computed<'account' | 'open'>(() => (this.isOpenMode() ? 'open' : 'account'));
  readonly canUseJobControls = computed(() => !this.isOpenMode());

  refreshOpenMode(): void {
    this.whenOpenModeKnown().subscribe((enabled) => this.openModeEnabled.set(enabled));
  }

  /**
   * Observable compartido del estado del modo libre (una sola petición).
   * El guard lo espera para no dejar pasar navegación directa antes de saber
   * si el backend tiene el modo abierto o cerrado. Ante error, CERRADO
   * (fail-closed, seguro por defecto).
   * En SSR no hay HttpClient: dejamos la petición para el cliente.
   */
  whenOpenModeKnown(): Observable<boolean> {
    if (this.openModeRequest$ === null) {
      if (this.httpClient === null) {
        // SSR: no hay HttpClient, no cacheamos — el cliente hará la petición real.
        return of(false).pipe(tap((enabled) => this.openModeEnabled.set(enabled)));
      }
      this.openModeRequest$ = this.httpClient
        .get<{ mode?: string }>(`${API_BASE_URL}/api/public/catalog/`)
        .pipe(
          map((catalog) => catalog.mode === 'open'),
          catchError(() => of(false)),
          tap((enabled) => this.openModeEnabled.set(enabled)),
          shareReplay(1),
        );
    }
    return this.openModeRequest$;
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

