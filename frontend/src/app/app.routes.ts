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
    path: 'apps',
    loadComponent: () => import('./apps-hub/apps-hub.component').then((m) => m.AppsHubComponent),
  },
  {
    path: '**',
    redirectTo: 'jobs',
  },
];
