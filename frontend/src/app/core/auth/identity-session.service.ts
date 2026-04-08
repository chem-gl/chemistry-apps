// identity-session.service.ts: Estado transversal de sesión, RBAC visual y bootstrap auth.

import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, finalize, forkJoin, map, of, shareReplay, switchMap, tap } from 'rxjs';
import {
    AuthApiService,
    CurrentUserProfileView,
    SessionTokens,
} from '../api/auth-api.service';
import { AccessibleScientificAppView, IdentityApiService } from '../api/identity-api.service';

const ACCESS_TOKEN_STORAGE_KEY = 'chemistry-apps.access-token';
const REFRESH_TOKEN_STORAGE_KEY = 'chemistry-apps.refresh-token';

export interface ManagedJobIdentity {
  owner: number | null;
  group: number | null;
}

type SessionStatus = 'idle' | 'loading' | 'authenticated' | 'anonymous';

@Injectable({
  providedIn: 'root',
})
export class IdentitySessionService {
  private readonly authApiService = inject(AuthApiService);
  private readonly identityApiService = inject(IdentityApiService);
  private readonly router = inject(Router);

  private sessionInitialization$: Observable<boolean> | null = null;

  readonly status = signal<SessionStatus>('idle');
  readonly accessToken = signal<string | null>(this.readStorageValue(ACCESS_TOKEN_STORAGE_KEY));
  readonly refreshToken = signal<string | null>(this.readStorageValue(REFRESH_TOKEN_STORAGE_KEY));
  readonly currentUser = signal<CurrentUserProfileView | null>(null);
  readonly accessibleApps = signal<AccessibleScientificAppView[]>([]);
  readonly lastAuthenticationError = signal<string | null>(null);

  readonly isAuthenticated = computed(() => this.status() === 'authenticated');
  readonly isLoading = computed(() => this.status() === 'loading');
  readonly currentRole = computed(() => this.currentUser()?.role ?? null);
  readonly displayName = computed(() => {
    const userProfile = this.currentUser();
    if (userProfile === null) {
      return 'Guest';
    }

    const fullName = `${userProfile.first_name} ${userProfile.last_name}`.trim();
    return fullName === '' ? userProfile.username : fullName;
  });
  readonly hasRootAccess = computed(() => this.currentRole() === 'root');
  readonly hasAdminAccess = computed(() => this.currentRole() === 'root' || this.currentRole() === 'admin');
  readonly enabledRouteKeys = computed(() =>
    this.accessibleApps()
      .filter((appItem: AccessibleScientificAppView) => appItem.enabled)
      .map((appItem: AccessibleScientificAppView) => appItem.route_key),
  );

  initializeSession(): Observable<boolean> {
    if (this.status() === 'authenticated') {
      return of(true);
    }

    const storedRefreshToken = this.refreshToken();
    const storedAccessToken = this.accessToken();
    if (storedAccessToken === null && storedRefreshToken === null) {
      this.status.set('anonymous');
      return of(false);
    }

    if (this.sessionInitialization$ !== null) {
      return this.sessionInitialization$;
    }

    this.status.set('loading');
    this.lastAuthenticationError.set(null);

    this.sessionInitialization$ = this.loadRemoteSession().pipe(
      finalize(() => {
        this.sessionInitialization$ = null;
      }),
      shareReplay(1),
    );

    return this.sessionInitialization$;
  }

  login(username: string, password: string): Observable<boolean> {
    this.status.set('loading');
    this.lastAuthenticationError.set(null);

    return this.authApiService.login(username, password).pipe(
      tap((tokens: SessionTokens) => {
        this.persistTokens(tokens);
      }),
      switchMap(() => this.loadRemoteSession()),
      catchError((authenticationError: { message?: string }) => {
        this.clearSessionState();
        this.lastAuthenticationError.set(
          authenticationError.message ?? 'Unable to sign in with the provided credentials.',
        );
        return of(false);
      }),
    );
  }

  logout(): void {
    this.clearSessionState();
    void this.router.navigateByUrl('/login');
  }

  refreshAccessToken(): Observable<string | null> {
    const storedRefreshToken = this.refreshToken();
    if (storedRefreshToken === null) {
      return of(null);
    }

    return this.authApiService.refresh(storedRefreshToken).pipe(
      tap((nextAccessToken: string) => {
        this.accessToken.set(nextAccessToken);
        this.writeStorageValue(ACCESS_TOKEN_STORAGE_KEY, nextAccessToken);
      }),
      catchError(() => {
        this.clearSessionState();
        return of(null);
      }),
    );
  }

  reloadSessionData(): Observable<boolean> {
    if (!this.isAuthenticated()) {
      return this.initializeSession();
    }

    return this.fetchSessionPayload().pipe(
      tap(({ accessibleApps, currentUser }) => {
        this.currentUser.set(currentUser);
        this.accessibleApps.set(accessibleApps);
        this.status.set('authenticated');
      }),
      map(() => true),
      catchError(() => of(false)),
    );
  }

  canAccessRoute(routeKey: string): boolean {
    return this.enabledRouteKeys().includes(routeKey);
  }

  canViewJob(jobIdentity: ManagedJobIdentity): boolean {
    const userProfile = this.currentUser();
    if (userProfile === null) {
      return false;
    }

    if (userProfile.role === 'root') {
      return true;
    }

    if (jobIdentity.owner === userProfile.id) {
      return true;
    }

    return jobIdentity.group !== null && jobIdentity.group === userProfile.primary_group_id;
  }

  canManageJob(jobIdentity: ManagedJobIdentity): boolean {
    const userProfile = this.currentUser();
    if (userProfile === null) {
      return false;
    }

    if (userProfile.role === 'root') {
      return true;
    }

    if (jobIdentity.owner === userProfile.id) {
      return true;
    }

    return (
      userProfile.role === 'admin' &&
      jobIdentity.group !== null &&
      jobIdentity.group === userProfile.primary_group_id
    );
  }

  private loadRemoteSession(): Observable<boolean> {
    return this.fetchSessionPayload().pipe(
      tap(({ accessibleApps, currentUser }) => {
        this.currentUser.set(currentUser);
        this.accessibleApps.set(accessibleApps);
        this.status.set('authenticated');
      }),
      map(() => true),
      catchError(() => {
        const storedRefreshToken = this.refreshToken();
        if (storedRefreshToken === null) {
          this.clearSessionState();
          return of(false);
        }

        return this.refreshAccessToken().pipe(
          switchMap((nextAccessToken: string | null) => {
            if (nextAccessToken === null) {
              return of(false);
            }
            return this.fetchSessionPayload().pipe(
              tap(({ accessibleApps, currentUser }) => {
                this.currentUser.set(currentUser);
                this.accessibleApps.set(accessibleApps);
                this.status.set('authenticated');
              }),
              map(() => true),
              catchError(() => {
                this.clearSessionState();
                return of(false);
              }),
            );
          }),
        );
      }),
    );
  }

  private fetchSessionPayload(): Observable<{
    currentUser: CurrentUserProfileView;
    accessibleApps: AccessibleScientificAppView[];
  }> {
    return forkJoin({
      currentUser: this.authApiService.getCurrentUserProfile(),
      accessibleApps: this.identityApiService.listAccessibleApps(),
    });
  }

  private persistTokens(tokens: SessionTokens): void {
    this.accessToken.set(tokens.accessToken);
    this.refreshToken.set(tokens.refreshToken);
    this.writeStorageValue(ACCESS_TOKEN_STORAGE_KEY, tokens.accessToken);
    this.writeStorageValue(REFRESH_TOKEN_STORAGE_KEY, tokens.refreshToken);
  }

  private clearSessionState(): void {
    this.status.set('anonymous');
    this.currentUser.set(null);
    this.accessibleApps.set([]);
    this.accessToken.set(null);
    this.refreshToken.set(null);
    this.writeStorageValue(ACCESS_TOKEN_STORAGE_KEY, null);
    this.writeStorageValue(REFRESH_TOKEN_STORAGE_KEY, null);
  }

  private readStorageValue(storageKey: string): string | null {
    try {
      return globalThis.localStorage?.getItem(storageKey) ?? null;
    } catch {
      return null;
    }
  }

  private writeStorageValue(storageKey: string, nextValue: string | null): void {
    try {
      if (nextValue === null) {
        globalThis.localStorage?.removeItem(storageKey);
        return;
      }

      globalThis.localStorage?.setItem(storageKey, nextValue);
    } catch {
      // Ignora storage no disponible para mantener compatibilidad SSR/tests.
    }
  }
}
