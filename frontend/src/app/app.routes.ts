import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'jobs',
  },
  {
    path: 'jobs',
    loadComponent: () =>
      import('./jobs-monitor/jobs-monitor.component').then((m) => m.JobsMonitorComponent),
  },
  {
    path: 'calculator',
    loadComponent: () =>
      import('./calculator/calculator.component').then((m) => m.CalculatorComponent),
  },
  {
    path: 'random-numbers',
    loadComponent: () =>
      import('./random-numbers/random-numbers.component').then((m) => m.RandomNumbersComponent),
  },
  {
    path: 'molar-fractions',
    loadComponent: () =>
      import('./molar-fractions/molar-fractions.component').then((m) => m.MolarFractionsComponent),
  },
  {
    path: 'tunnel',
    loadComponent: () => import('./tunnel/tunnel.component').then((m) => m.TunnelComponent),
  },
  {
    path: 'easy-rate',
    loadComponent: () => import('./easy-rate/easy-rate.component').then((m) => m.EasyRateComponent),
  },
  {
    path: 'marcus',
    loadComponent: () => import('./marcus/marcus.component').then((m) => m.MarcusComponent),
  },
  {
    path: 'apps',
    loadComponent: () => import('./apps-hub/apps-hub.component').then((m) => m.AppsHubComponent),
  },
  {
    path: '**',
    redirectTo: 'jobs',
  },
];
