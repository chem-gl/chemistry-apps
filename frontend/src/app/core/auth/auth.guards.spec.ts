// auth.guards.spec.ts: Pruebas unitarias de guards de autenticación y RBAC.
// Verifica redirecciones y accesos para evitar rutas expuestas a usuarios sin sesión.

import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  provideRouter,
  Router,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { firstValueFrom, Observable, of } from 'rxjs';
import { vi } from 'vitest';
import { adminGuard, appAccessGuard, authGuard, groupAdminGuard } from './auth.guards';
import { IdentitySessionService } from './identity-session.service';

function asGuardObservable(result: unknown): Observable<boolean | UrlTree> {
  return result as Observable<boolean | UrlTree>;
}

describe('auth guards', () => {
  const sessionServiceMock = {
    initializeSession: vi.fn(),
    hasAdminAccess: vi.fn(),
    canAccessRoute: vi.fn(),
    canAccessAdminArea: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    sessionServiceMock.initializeSession.mockReturnValue(of(true));
    sessionServiceMock.hasAdminAccess.mockReturnValue(false);
    sessionServiceMock.canAccessRoute.mockReturnValue(false);
    sessionServiceMock.canAccessAdminArea.mockReturnValue(false);

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: IdentitySessionService, useValue: sessionServiceMock },
      ],
    });
  });

  it('permite authGuard cuando la sesión ya está autenticada', async () => {
    // Verifica la ruta feliz para no bloquear navegación válida.
    const state = { url: '/dashboard' } as RouterStateSnapshot;

    const result = await TestBed.runInInjectionContext(() =>
      firstValueFrom(asGuardObservable(authGuard({} as ActivatedRouteSnapshot, state))),
    );

    expect(result).toBe(true);
  });

  it('redirige authGuard a login preservando redirectTo', async () => {
    // Verifica que el guard recuerde la URL solicitada al exigir autenticación.
    sessionServiceMock.initializeSession.mockReturnValue(of(false));
    const router = TestBed.inject(Router);
    const state = { url: '/smileit' } as RouterStateSnapshot;

    const result = await TestBed.runInInjectionContext(() =>
      firstValueFrom(asGuardObservable(authGuard({} as ActivatedRouteSnapshot, state))),
    );

    expect(result).toBeInstanceOf(UrlTree);
    expect(router.serializeUrl(result as UrlTree)).toBe('/login?redirectTo=%2Fsmileit');
  });

  it('redirige adminGuard a login cuando no hay sesión', async () => {
    // Verifica el bloqueo temprano de pantallas administrativas sin autenticación.
    sessionServiceMock.initializeSession.mockReturnValue(of(false));
    const router = TestBed.inject(Router);

    const result = await TestBed.runInInjectionContext(() =>
      firstValueFrom(
        asGuardObservable(adminGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)),
      ),
    );

    expect(router.serializeUrl(result as UrlTree)).toBe('/login');
  });

  it('redirige adminGuard a dashboard cuando el usuario no tiene permisos de admin', async () => {
    // Verifica que un usuario autenticado sin privilegios no entre al área de administración.
    sessionServiceMock.hasAdminAccess.mockReturnValue(false);
    const router = TestBed.inject(Router);

    const result = await TestBed.runInInjectionContext(() =>
      firstValueFrom(
        asGuardObservable(adminGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)),
      ),
    );

    expect(router.serializeUrl(result as UrlTree)).toBe('/dashboard');
  });

  it('permite adminGuard cuando el usuario tiene acceso administrativo', async () => {
    // Verifica la rama habilitada para root/admin.
    sessionServiceMock.hasAdminAccess.mockReturnValue(true);

    const result = await TestBed.runInInjectionContext(() =>
      firstValueFrom(
        asGuardObservable(adminGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)),
      ),
    );

    expect(result).toBe(true);
  });

  it('permite appAccessGuard cuando la app es accesible o no se definió appKey', async () => {
    // Verifica el acceso a rutas científicas autorizadas y la rama sin appKey explícita.
    sessionServiceMock.canAccessRoute.mockReturnValue(true);

    const allowed = await TestBed.runInInjectionContext(() =>
      firstValueFrom(
        asGuardObservable(
          appAccessGuard(
            { data: { appKey: 'smileit' } } as unknown as ActivatedRouteSnapshot,
            {} as RouterStateSnapshot,
          ),
        ),
      ),
    );
    const openByDefault = await TestBed.runInInjectionContext(() =>
      firstValueFrom(
        asGuardObservable(
          appAccessGuard(
            { data: {} } as unknown as ActivatedRouteSnapshot,
            {} as RouterStateSnapshot,
          ),
        ),
      ),
    );

    expect(allowed).toBe(true);
    expect(openByDefault).toBe(true);
  });

  it('redirige appAccessGuard a apps cuando la ruta no está permitida', async () => {
    // Verifica la contención de navegación hacia apps deshabilitadas para el usuario.
    sessionServiceMock.canAccessRoute.mockReturnValue(false);
    const router = TestBed.inject(Router);

    const result = await TestBed.runInInjectionContext(() =>
      firstValueFrom(
        asGuardObservable(
          appAccessGuard(
            { data: { appKey: 'sa-score' } } as unknown as ActivatedRouteSnapshot,
            {} as RouterStateSnapshot,
          ),
        ),
      ),
    );

    expect(router.serializeUrl(result as UrlTree)).toBe('/apps');
  });

  it('redirige groupAdminGuard a login o dashboard según el contexto', async () => {
    // Verifica ambas salidas de protección del área de grupos/usuarios.
    const router = TestBed.inject(Router);
    sessionServiceMock.initializeSession.mockReturnValueOnce(of(false));

    const unauthenticated = await TestBed.runInInjectionContext(() =>
      firstValueFrom(
        asGuardObservable(groupAdminGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)),
      ),
    );

    sessionServiceMock.initializeSession.mockReturnValueOnce(of(true));
    sessionServiceMock.canAccessAdminArea.mockReturnValueOnce(false);

    const forbidden = await TestBed.runInInjectionContext(() =>
      firstValueFrom(
        asGuardObservable(groupAdminGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)),
      ),
    );

    expect(router.serializeUrl(unauthenticated as UrlTree)).toBe('/login');
    expect(router.serializeUrl(forbidden as UrlTree)).toBe('/dashboard');
  });

  it('permite groupAdminGuard cuando el usuario puede acceder al área administrativa', async () => {
    // Verifica la rama positiva del guard específico de administración de grupos.
    sessionServiceMock.canAccessAdminArea.mockReturnValue(true);

    const result = await TestBed.runInInjectionContext(() =>
      firstValueFrom(
        asGuardObservable(groupAdminGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)),
      ),
    );

    expect(result).toBe(true);
  });
});
