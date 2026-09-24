// auth.guards.ts: Guards funcionales para sesión, RBAC y acceso por app.

import { inject } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  Router,
  RouterStateSnapshot,
} from '@angular/router';
import { map, of, switchMap } from 'rxjs';
import { IdentitySessionService } from './identity-session.service';
import { JobAccessModeService } from './job-access-mode.service';

export const authGuard: CanActivateFn = (
  _route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot,
) => {
  const sessionService = inject(IdentitySessionService);
  const router = inject(Router);

  return sessionService.initializeSession().pipe(
    map((isAuthenticated: boolean) => {
      if (isAuthenticated) {
        return true;
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
        return of(true);
      }
      return sessionService.initializeSession().pipe(
        map((isAuthenticated: boolean) =>
          isAuthenticated
            ? true
            : router.createUrlTree(['/login'], { queryParams: { redirectTo: state.url } }),
        ),
      );
    }),
  );
};

export const adminGuard: CanActivateFn = () => {
  const sessionService = inject(IdentitySessionService);
  const router = inject(Router);

  return sessionService.initializeSession().pipe(
    map((isAuthenticated: boolean) => {
      if (!isAuthenticated) {
        return router.createUrlTree(['/login']);
      }

      return sessionService.hasAdminAccess() ? true : router.createUrlTree(['/apps']);
    }),
  );
};

export const appAccessGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const sessionService = inject(IdentitySessionService);
  const router = inject(Router);
  const appKey = String(route.data['appKey'] ?? '');

  return sessionService.initializeSession().pipe(
    map((isAuthenticated: boolean) => {
      if (!isAuthenticated) {
        return router.createUrlTree(['/login']);
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
export const groupAdminGuard: CanActivateFn = () => {
  const sessionService = inject(IdentitySessionService);
  const router = inject(Router);

  return sessionService.initializeSession().pipe(
    map((isAuthenticated: boolean) => {
      if (!isAuthenticated) {
        return router.createUrlTree(['/login']);
      }

      return sessionService.canAccessAdminArea() ? true : router.createUrlTree(['/apps']);
    }),
  );
};

/**
 * Guard de rutas publicas de sesion (login): si ya hay sesion, redirige al
 * catalogo para no mostrarle el formulario a quien ya entro.
 */
export const guestGuard: CanActivateFn = () => {
  const sessionService = inject(IdentitySessionService);
  const router = inject(Router);

  return sessionService.initializeSession().pipe(
    map((isAuthenticated: boolean) =>
      isAuthenticated ? router.createUrlTree(['/apps']) : true,
    ),
  );
};
