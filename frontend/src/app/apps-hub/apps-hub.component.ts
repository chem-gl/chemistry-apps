// apps-hub.component.ts: Catalogo de navegacion para apps cientificas visibles (excluye ejemplos internos).

import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  ScientificAppRouteItem,
  VISIBLE_SCIENTIFIC_APP_ROUTE_ITEMS,
} from '../core/shared/scientific-apps.config';

@Component({
  selector: 'app-apps-hub',
  imports: [CommonModule, RouterLink],
  templateUrl: './apps-hub.component.html',
  styleUrl: './apps-hub.component.scss',
})
export class AppsHubComponent {
  readonly scientificApps: ReadonlyArray<ScientificAppRouteItem> =
    VISIBLE_SCIENTIFIC_APP_ROUTE_ITEMS;
}
