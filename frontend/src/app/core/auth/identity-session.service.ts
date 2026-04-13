// identity-session.service.ts: Estado transversal de sesión, RBAC visual y bootstrap auth.

import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  Observable,
  catchError,
  finalize,
  forkJoin,
  map,
  of,
  shareReplay,
  switchMap,
  tap,
} from 'rxjs';
import {
  AuthApiService,
  CurrentUserProfileView,
  SessionTokens,
  UserMembershipSummary,
} from '../api/auth-api.service';
import { AccessibleScientificAppView, IdentityApiService } from '../api/identity-api.service';

const ACCESS_TOKEN_STORAGE_KEY = 'chemistry-apps.access-token';
const REFRESH_TOKEN_STORAGE_KEY = 'chemistry-apps.refresh-token';
const ACTIVE_GROUP_ID_STORAGE_KEY = 'chemistry-apps.active-group-id';
const ROOT_VIEW_CONTEXT_STORAGE_KEY = 'chemistry-apps.root-view-context';

export interface ManagedJobIdentity {
  owner: number | null;
  group: number | null;
}

export type ManagedJobDeleteMode = 'hard' | 'soft' | null;

/** Contexto del grupo activo con información enriquecida de la membresía del usuario. */
export interface ActiveGroupContext {
  groupId: number;
  groupName: string;
  groupSlug: string;
  roleInGroup: 'admin' | 'member';
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

  /**
   * ID del grupo activo seleccionado por el usuario. Se persiste en localStorage.
   * Null indica que no hay grupo activo (root en modo global, o usuario sin grupos).
   */
  readonly activeGroupId = signal<number | null>(
    this._parseStoredGroupId(this.readStorageValue(ACTIVE_GROUP_ID_STORAGE_KEY)),
  );

  /**
   * Modo "ver como root": solo relevante cuando role='root'. Cuando es true,
   * root ve TODOS los elementos sin filtrar por grupo activo.
   */
  readonly isRootViewContext = signal<boolean>(
    this.readStorageValue(ROOT_VIEW_CONTEXT_STORAGE_KEY) === 'true',
  );

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
  readonly hasAdminAccess = computed(
    () => this.currentRole() === 'root' || this.currentRole() === 'admin',
  );

  /** True si el usuario es admin en al menos un grupo (via GroupMembership). */
  readonly hasGroupAdminRole = computed(() =>
    this.userMemberships().some((m) => m.role_in_group === 'admin'),
  );

  /**
   * True si el usuario puede acceder a las páginas de administración.
   * Incluye root, admins globales y usuarios con rol admin en algún grupo.
   */
  readonly canAccessAdminArea = computed(() => this.hasAdminAccess() || this.hasGroupAdminRole());
  readonly userMemberships = computed<UserMembershipSummary[]>(
    () => this.currentUser()?.memberships ?? [],
  );

  /**
   * Contexto enriquecido del grupo activo. Null si no hay grupo activo seleccionado
   * o si el usuario es root en modo de vista global.
   */
  readonly activeGroupContext = computed<ActiveGroupContext | null>(() => {
    const activeId = this.activeGroupId();
    if (activeId === null) {
      return null;
    }

    // Root en modo vista global no tiene contexto de grupo.
    if (this.hasRootAccess() && this.isRootViewContext()) {
      return null;
    }

    const membership = this.userMemberships().find((m) => m.group_id === activeId);
    if (membership === undefined) {
      // El grupo almacenado ya no existe o el usuario fue removido; limpiar estado.
      this._autoSelectFirstValidGroup();
      return null;
    }

    return {
      groupId: membership.group_id,
      groupName: membership.group_name,
      groupSlug: membership.group_slug,
      roleInGroup: membership.role_in_group,
    };
  });

  /**
   * Indica si el usuario actual es admin en el grupo activo.
   * Siempre true para root (independiente del modo de vista).
   */
  readonly isAdminInActiveGroup = computed(() => {
    if (this.hasRootAccess()) {
      return true;
    }
    return this.activeGroupContext()?.roleInGroup === 'admin';
  });

  readonly enabledRouteKeys = computed(() =>
    this.accessibleApps()
      .filter((appItem: AccessibleScientificAppView) => appItem.enabled)
      .map((appItem: AccessibleScientificAppView) => appItem.route_key),
  );

  /**
   * Establece el grupo activo y recarga las apps accesibles para ese grupo.
   * Persiste el valor en localStorage.
   */
  setActiveGroup(groupId: number | null): void {
    this.activeGroupId.set(groupId);
    this.writeStorageValue(ACTIVE_GROUP_ID_STORAGE_KEY, groupId === null ? null : String(groupId));

    // Recargar apps accesibles con el nuevo filtro de grupo
    if (this.isAuthenticated()) {
      this.identityApiService
        .listAccessibleApps(groupId ?? undefined)
        .subscribe((apps) => this.accessibleApps.set(apps));
    }
  }

  /** Alterna el modo de vista root (ver global vs ver por grupo activo). */
  setRootViewContext(isRootView: boolean): void {
    this.isRootViewContext.set(isRootView);
    this.writeStorageValue(ROOT_VIEW_CONTEXT_STORAGE_KEY, isRootView ? 'true' : null);

    if (this.isAuthenticated()) {
      const groupId = isRootView ? undefined : (this.activeGroupId() ?? undefined);
      this.identityApiService
        .listAccessibleApps(groupId)
        .subscribe((apps) => this.accessibleApps.set(apps));
    }
  }

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
      tap((tokens: SessionTokens) => {
        this.accessToken.set(tokens.accessToken);
        this.refreshToken.set(tokens.refreshToken);
        this.writeStorageValue(ACCESS_TOKEN_STORAGE_KEY, tokens.accessToken);
        this.writeStorageValue(REFRESH_TOKEN_STORAGE_KEY, tokens.refreshToken);
      }),
      map((tokens: SessionTokens) => tokens.accessToken),
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
        this._reconcileActiveGroup(currentUser);
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

  canDeleteJob(jobIdentity: ManagedJobIdentity): boolean {
    return this.canManageJob(jobIdentity);
  }

  canRestoreJob(jobIdentity: ManagedJobIdentity): boolean {
    const userProfile = this.currentUser();
    if (userProfile === null) {
      return false;
    }

    if (userProfile.role === 'root') {
      return true;
    }

    return (
      userProfile.role === 'admin' &&
      jobIdentity.group !== null &&
      jobIdentity.group === userProfile.primary_group_id
    );
  }

  resolveDeleteMode(jobIdentity: ManagedJobIdentity): ManagedJobDeleteMode {
    const userProfile = this.currentUser();
    if (userProfile === null || !this.canDeleteJob(jobIdentity)) {
      return null;
    }

    if (userProfile.role === 'root' || userProfile.role === 'admin') {
      return 'soft';
    }

    if (jobIdentity.owner === userProfile.id) {
      return 'hard';
    }

    return null;
  }

  private loadRemoteSession(): Observable<boolean> {
    const activeId = this.activeGroupId();
    return this.fetchSessionPayload(activeId ?? undefined).pipe(
      tap(({ accessibleApps, currentUser }) => {
        this.currentUser.set(currentUser);
        this.accessibleApps.set(accessibleApps);
        this.status.set('authenticated');
        this._reconcileActiveGroup(currentUser);
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
            return this.fetchSessionPayload(activeId ?? undefined).pipe(
              tap(({ accessibleApps, currentUser }) => {
                this.currentUser.set(currentUser);
                this.accessibleApps.set(accessibleApps);
                this.status.set('authenticated');
                this._reconcileActiveGroup(currentUser);
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

  private fetchSessionPayload(groupId?: number): Observable<{
    currentUser: CurrentUserProfileView;
    accessibleApps: AccessibleScientificAppView[];
  }> {
    return forkJoin({
      currentUser: this.authApiService.getCurrentUserProfile(),
      accessibleApps: this.identityApiService.listAccessibleApps(groupId),
    });
  }

  /**
   * Reconcilia el grupo activo almacenado contra las membresías del usuario.
   * Si el grupo ya no existe en las membresías, auto-selecciona el primero disponible.
   */
  private _reconcileActiveGroup(user: CurrentUserProfileView): void {
    const storedId = this.activeGroupId();
    const memberships = user.memberships ?? [];

    if (memberships.length === 0) {
      // Sin membresías, limpiar selección
      if (storedId !== null) {
        this.activeGroupId.set(null);
        this.writeStorageValue(ACTIVE_GROUP_ID_STORAGE_KEY, null);
      }
      return;
    }

    const isStoredValid = storedId !== null && memberships.some((m) => m.group_id === storedId);

    if (!isStoredValid) {
      // Auto-seleccionar el primer grupo o el primero donde es admin
      const firstAdminGroup = memberships.find((m) => m.role_in_group === 'admin');
      const selectedId = (firstAdminGroup ?? memberships[0]).group_id;
      this.activeGroupId.set(selectedId);
      this.writeStorageValue(ACTIVE_GROUP_ID_STORAGE_KEY, String(selectedId));
    }
  }

  /** Si el grupo activo no es válido, auto-selecciona el primer disponible. */
  private _autoSelectFirstValidGroup(): void {
    const memberships = this.userMemberships();
    if (memberships.length === 0) {
      this.activeGroupId.set(null);
      this.writeStorageValue(ACTIVE_GROUP_ID_STORAGE_KEY, null);
      return;
    }

    const firstId = memberships[0].group_id;
    this.activeGroupId.set(firstId);
    this.writeStorageValue(ACTIVE_GROUP_ID_STORAGE_KEY, String(firstId));
  }

  private _parseStoredGroupId(value: string | null): number | null {
    if (value === null) return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
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
