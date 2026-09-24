// apps-hub.component.ts: Catalogo publico de apps cientificas.
// Zona libre (usable sin cuenta) y zona con cuenta (invita a registrarse).
// La "red de enlaces" del diseno es informativa: sigue el orden real del
// pipeline (estructuras -> puntuacion -> toxicidad -> CADMA).

import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { IdentitySessionService } from '../core/auth/identity-session.service';
import { JobAccessModeService } from '../core/auth/job-access-mode.service';
import { AppCardThumbnailComponent } from '../core/shared/components/app-card-thumbnail/app-card-thumbnail.component';
import { InstitutionalShowcaseComponent } from '../core/shared/components/institutional-showcase/institutional-showcase.component';
import {
  ACCOUNT_ONLY_APP_ROUTE_ITEMS,
  FREE_ACCESS_APP_ROUTE_ITEMS,
  ScientificAppRouteItem,
} from '../core/shared/scientific-apps.config';

@Component({
  selector: 'app-apps-hub',
  imports: [CommonModule, RouterLink, TranslocoPipe, AppCardThumbnailComponent, InstitutionalShowcaseComponent],
  templateUrl: './apps-hub.component.html',
  styleUrl: './apps-hub.component.scss',
})
export class AppsHubComponent {
  private readonly sessionService = inject(IdentitySessionService);
  private readonly accessModeService = inject(JobAccessModeService);

  /** Sesion activa: cambia el tono de la invitacion a crear cuenta. */
  readonly isAuthenticated = this.sessionService.isAuthenticated;
  readonly openModeEnabled = this.accessModeService.openModeEnabled;

  /** Apps del modo libre: siempre utilizables, con o sin cuenta. */
  readonly freeApps = computed<ReadonlyArray<ScientificAppRouteItem>>(
    () => (this.openModeEnabled() ? FREE_ACCESS_APP_ROUTE_ITEMS : []),
  );

  /** Apps que piden cuenta: bloqueadas para invitados, filtradas por permiso si hay sesion. */
  readonly accountApps = computed<ReadonlyArray<ScientificAppRouteItem>>(() => {
    const apps = this.openModeEnabled()
      ? ACCOUNT_ONLY_APP_ROUTE_ITEMS
      : [...FREE_ACCESS_APP_ROUTE_ITEMS, ...ACCOUNT_ONLY_APP_ROUTE_ITEMS];
    if (!this.isAuthenticated()) {
      return apps;
    }

    return apps.filter(
      (appItem) =>
        FREE_ACCESS_APP_ROUTE_ITEMS.some((freeApp) => freeApp.key === appItem.key) ||
        this.sessionService.canAccessRoute(appItem.key),
    );
  });

  /** Nombre corto del modulo con el que arranca el modo libre. */
  readonly starterApp = computed<ScientificAppRouteItem | undefined>(() => this.freeApps()[0]);

  /**
   * Mueve el resplandor de reaccion siguiendo el puntero.
   * Es un detalle ambiental: no aporta informacion y esta desactivado en
   * `prefers-reduced-motion`, pero da textura organica a la reticula.
   */
  trackPointer(event: PointerEvent, shell: HTMLElement): void {
    const bounds = shell.getBoundingClientRect();
    shell.style.setProperty('--glow-x', `${event.clientX - bounds.left}px`);
    shell.style.setProperty('--glow-y', `${event.clientY - bounds.top}px`);
  }
}
