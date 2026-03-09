import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'calculator',
  },
  {
    path: 'calculator',
    loadComponent: () =>
      import('./calculator/calculator.component').then((m) => m.CalculatorComponent),
  },
  {
    path: '**',
    redirectTo: 'calculator',
  },
];
