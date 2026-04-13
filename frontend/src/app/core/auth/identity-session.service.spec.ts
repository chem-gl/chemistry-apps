// identity-session.service.spec.ts: Pruebas unitarias del servicio de sesión e identidad.
// Verifica que la sesión se inicialice usando un grupo válido y que el acceso a apps
// quede acotado por el grupo activo seleccionado.

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
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

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
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
});
