// apps-hub.component.ts: Catalogo de navegacion para calculadora y futuras apps cientificas.

import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  SCIENTIFIC_APP_ROUTE_ITEMS,
  ScientificAppRouteItem,
} from '../core/shared/scientific-apps.config';

@Component({
  selector: 'app-apps-hub',
  imports: [CommonModule, RouterLink],
  template: `
    <section class="apps-shell" aria-label="Catalogo de apps">
      <header class="apps-header">
        <p class="eyebrow">Ecosistema modular</p>
        <h1>Apps Cientificas</h1>
        <p>Accede a cada modulo desde un punto unico y preparado para crecimiento.</p>
      </header>

      <div class="apps-grid">
        <article class="app-card monitor-card">
          <h2>Monitor de jobs</h2>
          <p>Vista transversal para jobs activos, terminados y fallidos en tiempo real.</p>
          <a routerLink="/jobs" class="app-link">Abrir monitor</a>
        </article>

        @for (appItem of scientificApps; track appItem.key) {
          <article class="app-card" [class.is-disabled]="!appItem.available">
            <h2>{{ appItem.title }}</h2>
            <p>{{ appItem.description }}</p>
            @if (appItem.available) {
              <a [routerLink]="appItem.routePath" class="app-link">Abrir app</a>
            } @else {
              <span class="coming-soon">Disponible pronto</span>
            }
          </article>
        }
      </div>
    </section>
  `,
  styles: `
    .apps-shell {
      display: grid;
      gap: 1rem;
    }

    .apps-header h1 {
      margin: 0.25rem 0;
      font-size: clamp(1.3rem, 3vw, 2rem);
      color: #3f1a09;
    }

    .eyebrow {
      margin: 0;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 0.72rem;
      color: #92400e;
      font-weight: 700;
    }

    .apps-header p {
      margin: 0;
      color: #6c4e3f;
    }

    .apps-grid {
      display: grid;
      gap: 0.85rem;
      grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
    }

    .app-card {
      border-radius: 14px;
      border: 1px solid #f1d7be;
      background: linear-gradient(140deg, #fffaf4, #ffe8d4);
      padding: 1rem;
      display: grid;
      gap: 0.55rem;
    }

    .app-card h2 {
      margin: 0;
      font-size: 1.05rem;
      color: #5c2e0f;
    }

    .app-card p {
      margin: 0;
      color: #7a4b2a;
      font-size: 0.9rem;
    }

    .monitor-card {
      border-color: #f6b784;
      background: linear-gradient(140deg, #fff7ed, #ffe7cf);
    }

    .app-link {
      display: inline-flex;
      width: fit-content;
      text-decoration: none;
      border: 1px solid #b45309;
      border-radius: 999px;
      color: #9a3412;
      background: #fff;
      padding: 0.35rem 0.72rem;
      font-size: 0.85rem;
      font-weight: 700;
    }

    .is-disabled {
      opacity: 0.75;
      filter: grayscale(0.15);
    }

    .coming-soon {
      color: #7c2d12;
      font-size: 0.8rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
  `,
})
export class AppsHubComponent {
  readonly scientificApps: ReadonlyArray<ScientificAppRouteItem> = SCIENTIFIC_APP_ROUTE_ITEMS;
}
