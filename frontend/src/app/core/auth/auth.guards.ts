// auth.guards.ts: Guards funcionales para sesión, RBAC y acceso por app.

import { inject } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  Router,
  RouterStateSnapshot,
} from '@angular/router';
import { map } from 'rxjs';
import { IdentitySessionService } from './identity-session.service';

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

export const adminGuard: CanActivateFn = () => {
  const sessionService = inject(IdentitySessionService);
  const router = inject(Router);

  return sessionService.initializeSession().pipe(
    map((isAuthenticated: boolean) => {
      if (!isAuthenticated) {
        return router.createUrlTree(['/login']);
      }

      return sessionService.hasAdminAccess() ? true : router.createUrlTree(['/dashboard']);
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

      return sessionService.canAccessAdminArea() ? true : router.createUrlTree(['/dashboard']);
    }),
  );
};
