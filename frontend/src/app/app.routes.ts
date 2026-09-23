// app.routes.ts: Enrutado principal con guards de sesión y acceso por app.

import { Routes } from '@angular/router';
import {
  adminGuard,
  appAccessGuard,
  authGuard,
  groupAdminGuard,
  guestGuard,
} from './core/auth/auth.guards';

export const routes: Routes = [
  {
    // Puerta de entrada institucional: titulo, equipo y publicaciones.
    path: '',
    pathMatch: 'full',
    redirectTo: 'apps',
  },
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'register',
    loadComponent: () => import('./register/register.component').then((m) => m.RegisterComponent),
  },
  {
    // Redirección de compatibilidad: el antiguo dashboard ahora vive en el hub de apps.
    path: 'dashboard',
    pathMatch: 'full',
    redirectTo: 'apps',
  },
  {
    path: 'profile',
    canActivate: [authGuard],
    loadComponent: () => import('./profile/profile.component').then((m) => m.ProfileComponent),
  },
  {
    // Redirección de compatibilidad: la ruta antigua apunta a la nueva pantalla de usuarios
    path: 'admin/identity',
    redirectTo: 'admin/users',
  },
  {
    path: 'admin/groups',
    canActivate: [groupAdminGuard],
    loadComponent: () =>
      import('./group-manager/group-manager.component').then((m) => m.GroupManagerComponent),
  },
  {
    path: 'admin/users',
    canActivate: [groupAdminGuard],
    loadComponent: () =>
      import('./user-manager/user-manager.component').then((m) => m.UserManagerComponent),
  },
  {
    path: 'jobs',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./jobs-monitor/jobs-monitor.component').then((m) => m.JobsMonitorComponent),
  },
  {
    path: 'jobs/trash',
    canActivate: [adminGuard],
    loadComponent: () =>
      import('./jobs-trash/jobs-trash.component').then((m) => m.JobsTrashComponent),
  },
  {
    // Modo libre: usable sin cuenta.
    path: 'molar-fractions',
    loadComponent: () =>
      import('./molar-fractions/molar-fractions.component').then((m) => m.MolarFractionsComponent),
  },
  {
    // Modo libre: usable sin cuenta.
    path: 'tunnel',
    loadComponent: () => import('./tunnel/tunnel.component').then((m) => m.TunnelComponent),
  },
  {
    // Modo libre: usable sin cuenta.
    path: 'easy-rate',
    loadComponent: () => import('./easy-rate/easy-rate.component').then((m) => m.EasyRateComponent),
  },
  {
    // Modo libre: usable sin cuenta.
    path: 'marcus',
    loadComponent: () => import('./marcus/marcus.component').then((m) => m.MarcusComponent),
  },
  {
    // Modo libre: usable sin cuenta.
    path: 'smileit',
    loadComponent: () => import('./smileit/smileit.component').then((m) => m.SmileitComponent),
  },
  {
    // Modo libre: usable sin cuenta.
    path: 'sa-score',
    loadComponent: () => import('./sa-score/sa-score.component').then((m) => m.SaScoreComponent),
  },
  {
    path: 'cadma-py',
    canActivate: [authGuard, appAccessGuard],
    data: { appKey: 'cadma-py' },
    loadComponent: () => import('./cadma-py/cadma-py.component').then((m) => m.CadmaPyComponent),
  },
  {
    // Modo libre: usable sin cuenta.
    path: 'toxicity-properties',
    loadComponent: () =>
      import('./toxicity-properties/toxicity-properties.component').then(
        (m) => m.ToxicityPropertiesComponent,
      ),
  },
  {
    // Catalogo publico: muestra las apps libres y las que piden cuenta.
    path: 'apps',
    loadComponent: () => import('./apps-hub/apps-hub.component').then((m) => m.AppsHubComponent),
  },
  {
    path: '**',
    redirectTo: 'apps',
  },
];
