// app.routes.ts: Enrutado principal con guards de sesión y acceso por app.

import { Routes } from '@angular/router';
import { adminGuard, appAccessGuard, authGuard } from './core/auth/auth.guards';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'dashboard',
  },
  {
    path: 'login',
    loadComponent: () => import('./login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./dashboard/dashboard.component').then((m) => m.DashboardComponent),
  },
  {
    path: 'profile',
    canActivate: [authGuard],
    loadComponent: () => import('./profile/profile.component').then((m) => m.ProfileComponent),
  },
  {
    path: 'admin/identity',
    canActivate: [adminGuard],
    loadComponent: () =>
      import('./identity-admin/identity-admin.component').then((m) => m.IdentityAdminComponent),
  },
  {
    path: 'jobs',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./jobs-monitor/jobs-monitor.component').then((m) => m.JobsMonitorComponent),
  },
  {
    path: 'calculator',
    canActivate: [authGuard, appAccessGuard],
    data: { appKey: 'calculator' },
    loadComponent: () =>
      import('./calculator/calculator.component').then((m) => m.CalculatorComponent),
  },
  {
    path: 'random-numbers',
    canActivate: [authGuard, appAccessGuard],
    data: { appKey: 'random-numbers' },
    loadComponent: () =>
      import('./random-numbers/random-numbers.component').then((m) => m.RandomNumbersComponent),
  },
  {
    path: 'molar-fractions',
    canActivate: [authGuard, appAccessGuard],
    data: { appKey: 'molar-fractions' },
    loadComponent: () =>
      import('./molar-fractions/molar-fractions.component').then((m) => m.MolarFractionsComponent),
  },
  {
    path: 'tunnel',
    canActivate: [authGuard, appAccessGuard],
    data: { appKey: 'tunnel' },
    loadComponent: () => import('./tunnel/tunnel.component').then((m) => m.TunnelComponent),
  },
  {
    path: 'easy-rate',
    canActivate: [authGuard, appAccessGuard],
    data: { appKey: 'easy-rate' },
    loadComponent: () => import('./easy-rate/easy-rate.component').then((m) => m.EasyRateComponent),
  },
  {
    path: 'marcus',
    canActivate: [authGuard, appAccessGuard],
    data: { appKey: 'marcus' },
    loadComponent: () => import('./marcus/marcus.component').then((m) => m.MarcusComponent),
  },
  {
    path: 'smileit',
    canActivate: [authGuard, appAccessGuard],
    data: { appKey: 'smileit' },
    loadComponent: () => import('./smileit/smileit.component').then((m) => m.SmileitComponent),
  },
  {
    path: 'sa-score',
    canActivate: [authGuard, appAccessGuard],
    data: { appKey: 'sa-score' },
    loadComponent: () => import('./sa-score/sa-score.component').then((m) => m.SaScoreComponent),
  },
  {
    path: 'toxicity-properties',
    canActivate: [authGuard, appAccessGuard],
    data: { appKey: 'toxicity-properties' },
    loadComponent: () =>
      import('./toxicity-properties/toxicity-properties.component').then(
        (m) => m.ToxicityPropertiesComponent,
      ),
  },
  {
    path: 'apps',
    canActivate: [authGuard],
    loadComponent: () => import('./apps-hub/apps-hub.component').then((m) => m.AppsHubComponent),
  },
  {
    path: '**',
    redirectTo: 'dashboard',
  },
];
