// apps-hub.component.ts: Catalogo de navegación filtrado por permisos de sesión.

import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { IdentitySessionService } from '../core/auth/identity-session.service';
import {
  ScientificAppRouteItem,
  VISIBLE_SCIENTIFIC_APP_ROUTE_ITEMS,
} from '../core/shared/scientific-apps.config';

@Component({
  selector: 'app-apps-hub',
  imports: [CommonModule, RouterLink, TranslocoPipe],
  templateUrl: './apps-hub.component.html',
  styleUrl: './apps-hub.component.scss',
})
export class AppsHubComponent {
  private readonly sessionService = inject(IdentitySessionService);

  readonly scientificApps = computed<ReadonlyArray<ScientificAppRouteItem>>(() =>
    VISIBLE_SCIENTIFIC_APP_ROUTE_ITEMS.filter((appItem) =>
      this.sessionService.canAccessRoute(appItem.key),
    ),
  );
}
