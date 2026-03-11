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
    { label: 'Monitor', path: '/jobs', hint: 'Ver jobs activos y terminados' },
    { label: 'Calculadora', path: '/calculator', hint: 'Lanzar operaciones cientificas' },
    { label: 'Apps', path: '/apps', hint: 'Catalogo y nuevas apps' },
  ];
}
