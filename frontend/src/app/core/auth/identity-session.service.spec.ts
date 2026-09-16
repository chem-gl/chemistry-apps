// identity-session.service.spec.ts: Pruebas unitarias del servicio de sesión e identidad.
// Verifica que la sesión se inicialice usando un grupo válido y que el acceso a apps
// quede acotado por el grupo activo seleccionado.

import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { vi } from 'vitest';
import { AuthApiService } from '../api/auth-api.service';
import { IdentityApiService } from '../api/identity-api.service';
import { IdentitySessionService } from './identity-session.service';

function createJwtWithExp(expirationEpochSeconds: number): string {
  const toBase64Url = (value: string): string =>
    btoa(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

  const header = toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = toBase64Url(JSON.stringify({ exp: expirationEpochSeconds }));
  return `${header}.${payload}.signature`;
}

function buildAccessibleApp(routeKey: string) {
  return {
    app_name: routeKey,
    route_key: routeKey,
    api_base_path: `/api/${routeKey}/`,
    supports_pause_resume: false,
    available_features: [],
    enabled: true,
    group_permission: true,
    user_permission: null,
  };
}

describe('IdentitySessionService', () => {
  const authApiServiceMock = {
    getCurrentUserProfile: vi.fn(),
    refresh: vi.fn(),
    login: vi.fn(),
  };

  const identityApiServiceMock = {
    listAccessibleApps: vi.fn(),
    listGroups: vi.fn(),
  };

  const currentUserProfile = {
    id: 10,
    username: 'group-user',
    email: 'group-user@test.local',
    role: 'user' as const,
    account_status: 'active' as const,
    first_name: 'Group',
    last_name: 'User',
    avatar: '',
    email_verified: true,
    primary_group_id: 2,
    created_at: null,
    updated_at: null,
    memberships: [
      {
        group_id: 1,
        group_name: 'Alpha',
        group_slug: 'alpha',
        role_in_group: 'member' as const,
      },
      {
        group_id: 2,
        group_name: 'Beta',
        group_slug: 'beta',
        role_in_group: 'admin' as const,
      },
    ],
  };

  const rootUserProfile = {
    id: 99,
    username: 'root',
    email: 'root@test.local',
    role: 'root' as const,
    account_status: 'active' as const,
    first_name: 'Root',
    last_name: 'User',
    avatar: '',
    email_verified: true,
    primary_group_id: 3,
    created_at: null,
    updated_at: null,
    memberships: [
      {
        group_id: 1,
        group_name: 'Superadmin',
        group_slug: 'superadmin',
        role_in_group: 'admin' as const,
      },
    ],
  };

  const rootGroups = [
    { id: 1, name: 'Superadmin', slug: 'superadmin', description: '' },
    { id: 3, name: 'Marcus Lab', slug: 'marcus-lab', description: '' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    localStorage.clear();

    authApiServiceMock.getCurrentUserProfile.mockReturnValue(of(currentUserProfile));
    identityApiServiceMock.listAccessibleApps.mockReturnValue(
      of([
        {
          app_name: 'smileit',
          route_key: 'smileit',
          api_base_path: '/api/smileit/',
          supports_pause_resume: false,
          available_features: [],
          enabled: true,
          group_permission: true,
          user_permission: null,
        },
      ]),
    );
    identityApiServiceMock.listGroups.mockReturnValue(of(rootGroups));

    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: { navigateByUrl: vi.fn() } },
        { provide: AuthApiService, useValue: authApiServiceMock },
        { provide: IdentityApiService, useValue: identityApiServiceMock },
      ],
    });
  });

  it('usa el grupo primario cuando no hay grupo activo almacenado', () => {
    localStorage.setItem('chemistry-apps.access-token', 'token');
    localStorage.setItem('chemistry-apps.refresh-token', 'refresh');
    const service = TestBed.inject(IdentitySessionService);
    let result = false;

    service.initializeSession().subscribe((isAuthenticated) => {
      result = isAuthenticated;
    });

    expect(result).toBe(true);
    expect(identityApiServiceMock.listAccessibleApps).toHaveBeenCalledWith(2);
    expect(service.activeGroupId()).toBe(2);
  });

  it('conserva el grupo activo almacenado si todavía pertenece al usuario', () => {
    localStorage.setItem('chemistry-apps.access-token', 'token');
    localStorage.setItem('chemistry-apps.refresh-token', 'refresh');
    localStorage.setItem('chemistry-apps.active-group-id', '1');
    const service = TestBed.inject(IdentitySessionService);
    let result = false;

    service.initializeSession().subscribe((isAuthenticated) => {
      result = isAuthenticated;
    });

    expect(result).toBe(true);
    expect(identityApiServiceMock.listAccessibleApps).toHaveBeenCalledWith(1);
    expect(service.activeGroupId()).toBe(1);
  });

  it('recarga apps usando el grupo activo al cambiar de contexto', () => {
    localStorage.setItem('chemistry-apps.access-token', 'token');
    localStorage.setItem('chemistry-apps.refresh-token', 'refresh');
    const service = TestBed.inject(IdentitySessionService);

    service.initializeSession().subscribe();
    identityApiServiceMock.listAccessibleApps.mockClear();

    service.setActiveGroup(1);

    expect(identityApiServiceMock.listAccessibleApps).toHaveBeenCalledWith(1);
    expect(service.activeGroupId()).toBe(1);
  });

  // Verifica que una respuesta vieja no sobrescriba las apps del grupo más reciente.
  it('ignora respuestas viejas al cambiar de grupo rápidamente', () => {
    localStorage.setItem('chemistry-apps.access-token', 'token');
    localStorage.setItem('chemistry-apps.refresh-token', 'refresh');
    const service = TestBed.inject(IdentitySessionService);

    service.initializeSession().subscribe();

    const firstGroupApps$ = new Subject<ReturnType<typeof buildAccessibleApp>[]>();
    const secondGroupApps$ = new Subject<ReturnType<typeof buildAccessibleApp>[]>();
    identityApiServiceMock.listAccessibleApps
      .mockReturnValueOnce(firstGroupApps$)
      .mockReturnValueOnce(secondGroupApps$);

    service.setActiveGroup(1);
    service.setActiveGroup(2);

    secondGroupApps$.next([buildAccessibleApp('tunnel')]);
    expect(service.accessibleApps().map((app) => app.route_key)).toEqual(['tunnel']);

    firstGroupApps$.next([buildAccessibleApp('smileit')]);
    expect(service.accessibleApps().map((app) => app.route_key)).toEqual(['tunnel']);
  });

  it('agenda refresh automático antes del vencimiento del access token', () => {
    vi.useFakeTimers();
    const nowMilliseconds = Date.now();
    const accessToken = createJwtWithExp(Math.floor((nowMilliseconds + 70_000) / 1000));
    const refreshedToken = createJwtWithExp(Math.floor((nowMilliseconds + 3_600_000) / 1000));

    localStorage.setItem('chemistry-apps.access-token', accessToken);
    localStorage.setItem('chemistry-apps.refresh-token', 'refresh-token');
    authApiServiceMock.refresh.mockReturnValue(
      of({
        accessToken: refreshedToken,
        refreshToken: 'refresh-next-token',
      }),
    );

    const service = TestBed.inject(IdentitySessionService);
    service.initializeSession().subscribe();

    vi.advanceTimersByTime(11_000);

    expect(authApiServiceMock.refresh).toHaveBeenCalledWith('refresh-token');
    expect(service.accessToken()).toBe(refreshedToken);
  });

  it('permite a root conservar un grupo activo conocido aunque no tenga membresía explícita', () => {
    localStorage.setItem('chemistry-apps.access-token', 'token');
    localStorage.setItem('chemistry-apps.refresh-token', 'refresh');
    localStorage.setItem('chemistry-apps.active-group-id', '3');
    authApiServiceMock.getCurrentUserProfile.mockReturnValueOnce(of(rootUserProfile));

    const service = TestBed.inject(IdentitySessionService);
    let result = false;

    service.initializeSession().subscribe((isAuthenticated) => {
      result = isAuthenticated;
    });

    expect(result).toBe(true);
    expect(identityApiServiceMock.listGroups).toHaveBeenCalled();
    expect(identityApiServiceMock.listAccessibleApps).toHaveBeenCalledWith(3);
    expect(service.activeGroupId()).toBe(3);
    expect(service.activeGroupContext()).toEqual({
      groupId: 3,
      groupName: 'Marcus Lab',
      groupSlug: 'marcus-lab',
      roleInGroup: 'admin',
    });
  });

  it('devuelve false sin tokens y conserva el estado anónimo', () => {
    const service = TestBed.inject(IdentitySessionService);

    let result: boolean | undefined;
    service.initializeSession().subscribe((value) => (result = value));

    expect(result).toBe(false);
    expect(service.status()).toBe('anonymous');
    expect(authApiServiceMock.getCurrentUserProfile).not.toHaveBeenCalled();
  });

  it('devuelve true sin consultar la API cuando la sesión ya está autenticada', () => {
    const service = TestBed.inject(IdentitySessionService);
    service.status.set('authenticated');

    let result: boolean | undefined;
    service.initializeSession().subscribe((value) => (result = value));

    expect(result).toBe(true);
    expect(authApiServiceMock.getCurrentUserProfile).not.toHaveBeenCalled();
  });

  it('no reintenta una inicialización anónima que terminó con error', () => {
    localStorage.setItem('chemistry-apps.access-token', 'token');
    authApiServiceMock.getCurrentUserProfile.mockReturnValue(throwError(() => new Error('offline')));
    const service = TestBed.inject(IdentitySessionService);

    service.initializeSession().subscribe();
    expect(service.status()).toBe('anonymous');
    expect(service.lastAuthenticationError()).toBe('Session expired. Please sign in again.');
    authApiServiceMock.getCurrentUserProfile.mockClear();

    let result: boolean | undefined;
    service.initializeSession().subscribe((value) => (result = value));

    expect(result).toBe(false);
    expect(authApiServiceMock.getCurrentUserProfile).not.toHaveBeenCalled();
  });

  it('inicia sesión, persiste tokens y permite cerrar sesión', () => {
    authApiServiceMock.login.mockReturnValue(of({ accessToken: 'access', refreshToken: 'refresh' }));
    const service = TestBed.inject(IdentitySessionService);

    let result: boolean | undefined;
    service.login('user', 'password').subscribe((value) => (result = value));

    expect(result).toBe(true);
    expect(service.accessToken()).toBe('access');
    expect(localStorage.getItem('chemistry-apps.access-token')).toBe('access');

    service.logout();
    expect(service.isAuthenticated()).toBe(false);
    expect(localStorage.getItem('chemistry-apps.access-token')).toBeNull();
  });

  it('expone el mensaje del backend cuando el login falla', () => {
    authApiServiceMock.login.mockReturnValue(throwError(() => new Error('Invalid credentials')));
    const service = TestBed.inject(IdentitySessionService);

    let result: boolean | undefined;
    service.login('user', 'wrong').subscribe((value) => (result = value));

    expect(result).toBe(false);
    expect(service.status()).toBe('anonymous');
    expect(service.lastAuthenticationError()).toBe('Invalid credentials');
  });

  it('no intenta refrescar si no hay refresh token y conserva el error de refresh', () => {
    const service = TestBed.inject(IdentitySessionService);

    let result: string | null | undefined;
    service.refreshAccessToken().subscribe((value) => (result = value));
    expect(result).toBeNull();
    expect(authApiServiceMock.refresh).not.toHaveBeenCalled();

    service.refreshToken.set('refresh');
    authApiServiceMock.refresh.mockReturnValue(throwError(() => new Error('expired')));
    service.refreshAccessToken().subscribe((value) => (result = value));

    expect(result).toBeNull();
    expect(service.lastAuthenticationError()).toBe('Unable to refresh the authentication token.');
  });

  it('recupera la sesión tras un primer fallo usando refresh token', () => {
    localStorage.setItem('chemistry-apps.access-token', 'expired');
    localStorage.setItem('chemistry-apps.refresh-token', 'refresh');
    authApiServiceMock.getCurrentUserProfile
      .mockReturnValueOnce(throwError(() => new Error('expired')))
      .mockReturnValueOnce(of(currentUserProfile));
    authApiServiceMock.refresh.mockReturnValue(
      of({ accessToken: 'new-access', refreshToken: 'new-refresh' }),
    );
    const service = TestBed.inject(IdentitySessionService);

    let result: boolean | undefined;
    service.initializeSession().subscribe((value) => (result = value));

    expect(result).toBe(true);
    expect(authApiServiceMock.refresh).toHaveBeenCalledWith('refresh');
    expect(service.accessToken()).toBe('new-access');
  });

  it('aplica permisos de jobs según rol, propietario y grupo', () => {
    const service = TestBed.inject(IdentitySessionService);
    service.currentUser.set(currentUserProfile);

    expect(service.canViewJob({ owner: 10, group: null })).toBe(true);
    expect(service.canViewJob({ owner: 99, group: 2 })).toBe(true);
    expect(service.canViewJob({ owner: 99, group: 8 })).toBe(false);
    expect(service.canManageJob({ owner: 99, group: 2 })).toBe(false);
    expect(service.resolveDeleteMode({ owner: 10, group: null })).toBe('hard');
    expect(service.resolveDeleteMode({ owner: 99, group: 2 })).toBeNull();
  });

  it('aplica permisos administrativos y modo de borrado para root y admin', () => {
    const service = TestBed.inject(IdentitySessionService);
    service.currentUser.set({ ...currentUserProfile, role: 'admin' });

    expect(service.hasAdminAccess()).toBe(true);
    expect(service.canManageJob({ owner: 99, group: 2 })).toBe(true);
    expect(service.canRestoreJob({ owner: 99, group: 2 })).toBe(true);
    expect(service.resolveDeleteMode({ owner: 99, group: 2 })).toBe('soft');
    expect(service.canRestoreJob({ owner: 10, group: null })).toBe(false);

    service.currentUser.set({ ...rootUserProfile, memberships: [] });
    expect(service.canViewJob({ owner: null, group: null })).toBe(true);
    const typedRootGroups = rootGroups as unknown as Parameters<typeof service.resolveManagedGroupIds>[0];
    expect(service.resolveManagedGroupIds(typedRootGroups, [])).toEqual([1, 3]);
    expect(service.resolveVisibleGroups(typedRootGroups, [])).toEqual(rootGroups);
  });

  it('selecciona el primer grupo de root y usa vista global cuando corresponde', () => {
    localStorage.setItem('chemistry-apps.access-token', 'token');
    localStorage.setItem('chemistry-apps.refresh-token', 'refresh');
    localStorage.setItem('chemistry-apps.root-view-context', 'true');
    authApiServiceMock.getCurrentUserProfile.mockReturnValueOnce(of({ ...rootUserProfile, primary_group_id: 99 }));
    identityApiServiceMock.listGroups.mockReturnValueOnce(
      of([{ id: 4, name: 'Lab', slug: 'lab', description: '' }] as unknown as typeof rootGroups),
    );
    const service = TestBed.inject(IdentitySessionService);

    service.initializeSession().subscribe();

    expect(identityApiServiceMock.listAccessibleApps).toHaveBeenCalledWith(undefined);
    expect(service.activeGroupId()).toBe(4);
    expect(service.activeGroupContext()).toBeNull();
  });

  it('tolera fallo al cargar grupos de root y devuelve vista sin grupos', () => {
    localStorage.setItem('chemistry-apps.access-token', 'token');
    localStorage.setItem('chemistry-apps.refresh-token', 'refresh');
    authApiServiceMock.getCurrentUserProfile.mockReturnValueOnce(of(rootUserProfile));
    identityApiServiceMock.listGroups.mockReturnValueOnce(throwError(() => new Error('groups unavailable')));
    const service = TestBed.inject(IdentitySessionService);

    let result: boolean | undefined;
    service.initializeSession().subscribe((value) => (result = value));

    expect(result).toBe(true);
    expect(service.knownGroups()).toEqual([]);
    expect(service.activeGroupId()).toBeNull();
  });

  it('resuelve grupos administrables y apps habilitadas', () => {
    const service = TestBed.inject(IdentitySessionService);
    service.currentUser.set(currentUserProfile);
    service.accessibleApps.set([
      buildAccessibleApp('smileit'),
      { ...buildAccessibleApp('tunnel'), enabled: false },
    ]);

    expect(service.enabledRouteKeys()).toEqual(['smileit']);
    expect(service.canAccessRoute('smileit')).toBe(true);
    expect(service.canAccessRoute('tunnel')).toBe(false);
    expect(
      service.resolveManagedGroupIds([], [
        { user: 10, group: 2, role_in_group: 'admin', id: 1, joined_at: '' },
      ]),
    ).toEqual([2]);
    expect(
      service.resolveVisibleGroups(
        rootGroups as unknown as Parameters<typeof service.resolveVisibleGroups>[0],
        [2],
      ),
    ).toEqual([]);
  });

  it('usa username cuando el perfil no tiene nombre y deniega permisos sin sesión', () => {
    const service = TestBed.inject(IdentitySessionService);

    expect(service.displayName()).toBe('Guest');
    expect(service.canViewJob({ owner: 10, group: 2 })).toBe(false);
    expect(service.canManageJob({ owner: 10, group: 2 })).toBe(false);
    expect(service.canDeleteJob({ owner: 10, group: 2 })).toBe(false);
    expect(service.canRestoreJob({ owner: 10, group: 2 })).toBe(false);
    expect(service.resolveDeleteMode({ owner: 10, group: 2 })).toBeNull();

    service.currentUser.set({ ...currentUserProfile, first_name: '', last_name: '' });
    expect(service.displayName()).toBe('group-user');
    expect(service.hasGroupAdminRole()).toBe(true);
    expect(service.canAccessAdminArea()).toBe(true);
  });

  it('recarga datos de una sesión autenticada y devuelve false si falla la API', () => {
    const service = TestBed.inject(IdentitySessionService);
    service.status.set('authenticated');
    authApiServiceMock.getCurrentUserProfile.mockReturnValue(of(currentUserProfile));
    identityApiServiceMock.listAccessibleApps.mockReturnValue(of([buildAccessibleApp('tunnel')]));

    let result: boolean | undefined;
    service.reloadSessionData().subscribe((value) => (result = value));

    expect(result).toBe(true);
    expect(service.accessibleApps().map((app) => app.route_key)).toEqual(['tunnel']);

    authApiServiceMock.getCurrentUserProfile.mockReturnValue(throwError(() => new Error('offline')));
    service.reloadSessionData().subscribe((value) => (result = value));
    expect(result).toBe(false);
  });

  it('inicializa sesión desde registro y persiste ambos tokens', () => {
    const service = TestBed.inject(IdentitySessionService);

    let result: boolean | undefined;
    service.initializeFromRegistration({ accessToken: 'registered-access', refreshToken: 'registered-refresh' })
      .subscribe((value) => (result = value));

    expect(result).toBe(true);
    expect(localStorage.getItem('chemistry-apps.access-token')).toBe('registered-access');
    expect(localStorage.getItem('chemistry-apps.refresh-token')).toBe('registered-refresh');
    expect(service.status()).toBe('authenticated');
  });

  it('cambia la vista root, persiste el contexto y solicita apps globales', () => {
    localStorage.setItem('chemistry-apps.access-token', 'token');
    localStorage.setItem('chemistry-apps.refresh-token', 'refresh');
    authApiServiceMock.getCurrentUserProfile.mockReturnValue(of(rootUserProfile));
    const service = TestBed.inject(IdentitySessionService);
    service.initializeSession().subscribe();
    identityApiServiceMock.listAccessibleApps.mockClear();

    service.setRootViewContext(true);
    expect(localStorage.getItem('chemistry-apps.root-view-context')).toBe('true');
    expect(identityApiServiceMock.listAccessibleApps).toHaveBeenCalledWith(undefined);

    service.setRootViewContext(false);
    expect(localStorage.getItem('chemistry-apps.root-view-context')).toBeNull();
    expect(identityApiServiceMock.listAccessibleApps).toHaveBeenCalledWith(3);
  });

  it('selecciona null para usuarios sin membresías y limpia un grupo almacenado inválido', () => {
    localStorage.setItem('chemistry-apps.access-token', 'token');
    localStorage.setItem('chemistry-apps.refresh-token', 'refresh');
    localStorage.setItem('chemistry-apps.active-group-id', 'not-a-number');
    authApiServiceMock.getCurrentUserProfile.mockReturnValueOnce(
      of({ ...currentUserProfile, memberships: [], primary_group_id: null }),
    );
    const service = TestBed.inject(IdentitySessionService);
    service.initializeSession().subscribe();

    expect(service.activeGroupId()).toBeNull();
    expect(localStorage.getItem('chemistry-apps.active-group-id')).toBeNull();
    expect(identityApiServiceMock.listAccessibleApps).toHaveBeenCalledWith(undefined);
  });

  it('ignora tokens malformados al programar refresh', () => {
    vi.useFakeTimers();
    localStorage.setItem('chemistry-apps.access-token', 'not-a-jwt');
    localStorage.setItem('chemistry-apps.refresh-token', 'refresh');
    const service = TestBed.inject(IdentitySessionService);

    service.initializeSession().subscribe();
    authApiServiceMock.refresh.mockClear();
    vi.advanceTimersByTime(10_000);

    expect(authApiServiceMock.refresh).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
