// app.ts: Layout principal con navegacion entre monitor, calculadora y catalogo de apps.

import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  readonly primaryNavigationItems: ReadonlyArray<{ label: string; path: string; hint: string }> = [
    { label: 'Jobs Monitor', path: '/jobs', hint: 'Track active and completed jobs' },
    { label: 'Calculator', path: '/calculator', hint: 'Run scientific operations' },
    {
      label: 'Random Numbers',
      path: '/random-numbers',
      hint: 'Generate random numbers in background',
    },
    {
      label: 'Molar Fractions',
      path: '/molar-fractions',
      hint: 'Compute molar fractions by pH',
    },
    {
      label: 'Tunnel Effect',
      path: '/tunnel',
      hint: 'Calculate tunneling correction and trace input edits',
    },
    { label: 'Apps', path: '/apps', hint: 'Catalog and future scientific apps' },
  ];
}
