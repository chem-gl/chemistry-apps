// auth.guards.ts: Guards funcionales para sesión, RBAC y acceso por app.

import { inject } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  Router,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { map, of, switchMap } from 'rxjs';
import { IdentitySessionService } from './identity-session.service';
import { JobAccessModeService } from './job-access-mode.service';

/**
 * Redirige a `/change-password` cuando hay sesión autenticada con cambio
 * obligatorio pendiente y la URL destino no es la propia pantalla de cambio.
 * Retorna null cuando no aplica redirección.
 */
function passwordChangeRedirect(
  sessionService: IdentitySessionService,
  router: Router,
  url: string,
): UrlTree | null {
  const safeUrl = url ?? '';
  if (safeUrl.startsWith('/change-password')) {
    return null;
  }
  if (sessionService.isAuthenticated() && sessionService.mustChangePassword()) {
    return router.createUrlTree(['/change-password']);
  }
  return null;
}

export const authGuard: CanActivateFn = (
  _route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot,
) => {
  const sessionService = inject(IdentitySessionService);
  const router = inject(Router);

  return sessionService.initializeSession().pipe(
    map((isAuthenticated: boolean) => {
      if (isAuthenticated) {
        return passwordChangeRedirect(sessionService, router, state.url) ?? true;
      }

      return router.createUrlTree(['/login'], {
        queryParams: { redirectTo: state.url },
      });
    }),
  );
};

export const freeAccessGuard: CanActivateFn = (_route, state) => {
  const accessModeService = inject(JobAccessModeService);
  const sessionService = inject(IdentitySessionService);
  const router = inject(Router);

  // Espera a conocer el modo (una sola petición compartida): la navegación
  // directa no debe colarse con el valor por defecto antes del fetch.
  // Modo abierto: entra todo el mundo. Modo cerrado: exige sesión como las
  // apps con cuenta, conservando a dónde iba el usuario.
  return accessModeService.whenOpenModeKnown().pipe(
    switchMap((enabled: boolean) => {
      if (enabled) {
        // Solo redirige cuando ya existe una sesión cargada con flag activo.
        return of(passwordChangeRedirect(sessionService, router, state.url) ?? true);
      }
      return sessionService.initializeSession().pipe(
        map((isAuthenticated: boolean) => {
          if (!isAuthenticated) {
            return router.createUrlTree(['/login'], {
              queryParams: { redirectTo: state.url },
            });
          }
          return passwordChangeRedirect(sessionService, router, state.url) ?? true;
        }),
      );
    }),
  );
};

export const adminGuard: CanActivateFn = (_route, state) => {
  const sessionService = inject(IdentitySessionService);
  const router = inject(Router);

  return sessionService.initializeSession().pipe(
    map((isAuthenticated: boolean) => {
      if (!isAuthenticated) {
        return router.createUrlTree(['/login']);
      }

      const redirect = passwordChangeRedirect(sessionService, router, state.url);
      if (redirect !== null) {
        return redirect;
      }
      return sessionService.hasAdminAccess() ? true : router.createUrlTree(['/apps']);
    }),
  );
};

export const appAccessGuard: CanActivateFn = (
  route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot,
) => {
  const sessionService = inject(IdentitySessionService);
  const router = inject(Router);
  const appKey = String(route.data['appKey'] ?? '');

  return sessionService.initializeSession().pipe(
    map((isAuthenticated: boolean) => {
      if (!isAuthenticated) {
        return router.createUrlTree(['/login']);
      }

      const redirect = passwordChangeRedirect(sessionService, router, state.url);
      if (redirect !== null) {
        return redirect;
      }

      if (appKey === '' || sessionService.canAccessRoute(appKey)) {
        return true;
      }

      return router.createUrlTree(['/apps']);
    }),
  );
};

/**
 * Guard para páginas de administración de grupos/usuarios.
 * Permite el acceso a root, admins globales y usuarios que son admins de al menos un grupo.
 */
export const groupAdminGuard: CanActivateFn = (_route, state) => {
  const sessionService = inject(IdentitySessionService);
  const router = inject(Router);

  return sessionService.initializeSession().pipe(
    map((isAuthenticated: boolean) => {
      if (!isAuthenticated) {
        return router.createUrlTree(['/login']);
      }

      const redirect = passwordChangeRedirect(sessionService, router, state.url);
      if (redirect !== null) {
        return redirect;
      }
      return sessionService.canAccessAdminArea() ? true : router.createUrlTree(['/apps']);
    }),
  );
};

/**
 * Guard de rutas publicas de sesion (login): si ya hay sesion, redirige al
 * catalogo para no mostrarle el formulario a quien ya entro.
 * Con cambio obligatorio pendiente, redirige a `/change-password`.
 */
export const guestGuard: CanActivateFn = () => {
  const sessionService = inject(IdentitySessionService);
  const router = inject(Router);

  return sessionService.initializeSession().pipe(
    map((isAuthenticated: boolean) => {
      if (!isAuthenticated) {
        return true;
      }
      if (sessionService.mustChangePassword()) {
        return router.createUrlTree(['/change-password']);
      }
      return router.createUrlTree(['/apps']);
    }),
  );
};
