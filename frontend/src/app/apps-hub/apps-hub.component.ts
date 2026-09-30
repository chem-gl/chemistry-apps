// apps-hub.component.ts: Catalogo publico de apps cientificas.
// Dos columnas por familia: CADMA (pipeline de priorizacion) y Others
// (fisicoquimica/kinetica). Cada tarjeta conserva su comportamiento de acceso
// (modo libre vs cuenta) y expone su manual de documentacion en la esquina
// superior izquierda.

import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { IdentitySessionService } from '../core/auth/identity-session.service';
import { JobAccessModeService } from '../core/auth/job-access-mode.service';
import { AppCardThumbnailComponent } from '../core/shared/components/app-card-thumbnail/app-card-thumbnail.component';
import { InstitutionalShowcaseComponent } from '../core/shared/components/institutional-showcase/institutional-showcase.component';
import {
  DocTab,
  ScientificDocPanelComponent,
} from '../core/shared/components/scientific-doc-panel/scientific-doc-panel.component';
import { trackGlowPointer } from '../core/shared/pointer-glow.utils';
import {
  CADMA_GROUP_APP_ROUTE_ITEMS,
  OTHER_GROUP_APP_ROUTE_ITEMS,
  ScientificAppRouteItem,
} from '../core/shared/scientific-apps.config';
import { getScientificAppDocTabs } from './app-doc.registry';

/** Columna del hub: titulo traducible + apps visibles para la sesion actual. */
interface AppGroupView {
  id: string;
  titleKey: string;
  apps: ReadonlyArray<ScientificAppRouteItem>;
}

@Component({
  selector: 'app-apps-hub',
  imports: [
    CommonModule,
    RouterLink,
    TranslocoPipe,
    AppCardThumbnailComponent,
    InstitutionalShowcaseComponent,
    ScientificDocPanelComponent,
  ],
  templateUrl: './apps-hub.component.html',
  styleUrl: './apps-hub.component.scss',
})
export class AppsHubComponent {
  private readonly sessionService = inject(IdentitySessionService);
  private readonly accessModeService = inject(JobAccessModeService);

  /** Sesion activa: habilita las apps que piden cuenta. */
  readonly isAuthenticated = this.sessionService.isAuthenticated;
  readonly openModeEnabled = this.accessModeService.openModeEnabled;

  /** Manual abierto desde una tarjeta y sus pestanas activas. */
  readonly docPanelOpen = signal<boolean>(false);
  readonly activeDocTabs = signal<DocTab[]>([]);

  /** Columnas CADMA / Others, ya filtradas por permisos de la sesion. */
  readonly appGroups = computed<ReadonlyArray<AppGroupView>>(() => [
    {
      id: 'cadma',
      titleKey: 'appsHub.groups.cadma',
      apps: this.visibleApps(CADMA_GROUP_APP_ROUTE_ITEMS),
    },
    {
      id: 'others',
      titleKey: 'appsHub.groups.others',
      apps: this.visibleApps(OTHER_GROUP_APP_ROUTE_ITEMS),
    },
  ]);

  /** Una app pide cuenta si no es libre o si el modo libre esta desactivado. */
  requiresAccount(appItem: ScientificAppRouteItem): boolean {
    return !appItem.freeAccess || !this.openModeEnabled();
  }

  /** Bloqueada solo para invitados: la sesion habilita las apps con permiso. */
  isLocked(appItem: ScientificAppRouteItem): boolean {
    return this.requiresAccount(appItem) && !this.isAuthenticated();
  }

  /** Indica si la app tiene manual disponible. */
  hasDoc(appKey: string): boolean {
    return getScientificAppDocTabs(appKey) !== null;
  }

  /** Abre el manual de una app sin disparar la navegacion de la tarjeta. */
  openAppDoc(appKey: string, event: Event): void {
    event.preventDefault();
    event.stopPropagation();

    const tabs = getScientificAppDocTabs(appKey);
    if (tabs === null) {
      return;
    }

    this.activeDocTabs.set(tabs);
    this.docPanelOpen.set(true);
  }

  /**
   * Mueve el resplandor de reaccion siguiendo el puntero.
   * Es un detalle ambiental: no aporta informacion y esta desactivado en
   * `prefers-reduced-motion`, pero da textura organica a la reticula.
   * Compartido con el login via `trackGlowPointer`.
   */
  trackPointer(event: PointerEvent, shell: HTMLElement): void {
    trackGlowPointer(event, shell);
  }

  /** Invitados ven todo; con sesion, solo lo libre o lo que tengan permitido. */
  private visibleApps(
    apps: ReadonlyArray<ScientificAppRouteItem>,
  ): ReadonlyArray<ScientificAppRouteItem> {
    if (!this.isAuthenticated()) {
      return apps;
    }

    return apps.filter(
      (appItem) => appItem.freeAccess || this.sessionService.canAccessRoute(appItem.key),
    );
  }
}
