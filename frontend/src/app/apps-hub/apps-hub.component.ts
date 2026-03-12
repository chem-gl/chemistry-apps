// apps-hub.component.ts: Catalogo de navegacion para calculadora y apps cientificas disponibles.

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
  templateUrl: './apps-hub.component.html',
  styleUrl: './apps-hub.component.scss',
})
export class AppsHubComponent {
  readonly scientificApps: ReadonlyArray<ScientificAppRouteItem> = SCIENTIFIC_APP_ROUTE_ITEMS;
}
