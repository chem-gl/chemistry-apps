// app.ts: Layout principal con navegacion filtrada por sesion, permisos y estado visual del header.
//         Tambien verifica la version de la app contra version.json para forzar recarga en produccion
//         cuando hay un nuevo despliegue (cache busting automatico).

import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { environment } from '../environments/environment';
import { IdentitySessionService } from './core/auth/identity-session.service';
import { LanguageService } from './core/i18n/language.service';
import { ScientificNumberInputLocaleService } from './core/i18n/scientific-number-input-locale.service';
import { ActiveGroupSelectorComponent } from './core/shared/components/active-group-selector/active-group-selector.component';
import { GlobalErrorModalComponent } from './core/shared/components/global-error-modal/global-error-modal.component';
import { LanguageSwitcherComponent } from './core/shared/components/language-switcher/language-switcher.component';
import {
  SCIENTIFIC_APP_ROUTE_ITEMS,
  scientificAppTitleKey,
  scientificAppDescriptionKey,
} from './core/shared/scientific-apps.config';

interface PrimaryNavigationItem {
  path: string;
  label?: string;
  labelKey?: string;
  hint?: string;
  hintKey?: string;
}

@Component({
  selector: 'app-root',
  imports: [
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    TranslocoPipe,
    GlobalErrorModalComponent,
    LanguageSwitcherComponent,
    ActiveGroupSelectorComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  readonly sessionService = inject(IdentitySessionService);
  readonly languageService = inject(LanguageService);
  readonly scientificNumberInputLocaleService = inject(ScientificNumberInputLocaleService);
  readonly isScrolled = signal(false);

  readonly primaryNavigationItems = computed<ReadonlyArray<PrimaryNavigationItem>>(() => {
    if (!this.sessionService.isAuthenticated()) {
      return [
        {
          labelKey: 'app.nav.signIn',
          path: '/login',
          hintKey: 'app.navHints.signIn',
        },
      ];
    }

    const scientificNavigationItems = SCIENTIFIC_APP_ROUTE_ITEMS.filter(
      (appItem) => appItem.visibleInMenus && this.sessionService.canAccessRoute(appItem.key),
    ).map((appItem) => ({
      labelKey: scientificAppTitleKey(appItem.key),
      label: appItem.title,
      path: appItem.routePath,
      hintKey: scientificAppDescriptionKey(appItem.key),
      hint: appItem.description,
    }));

    return [
      {
        labelKey: 'app.nav.dashboard',
        path: '/dashboard',
        hintKey: 'app.navHints.dashboard',
      },
      {
        labelKey: 'app.nav.profile',
        path: '/profile',
        hintKey: 'app.navHints.profile',
      },
      {
        labelKey: 'app.nav.jobsMonitor',
        path: '/jobs',
        hintKey: 'app.navHints.jobsMonitor',
      },
      {
        labelKey: 'app.nav.apps',
        path: '/apps',
        hintKey: 'app.navHints.apps',
      },
      ...scientificNavigationItems,
      ...(this.sessionService.canAccessAdminArea()
        ? [
            {
              labelKey: 'app.nav.groups',
              path: '/admin/groups',
              hintKey: 'app.navHints.groups',
            },
            {
              labelKey: 'app.nav.users',
              path: '/admin/users',
              hintKey: 'app.navHints.users',
            },
          ]
        : []),
    ];
  });

  ngOnInit(): void {
    this.languageService.initializeLanguage();
    this.scientificNumberInputLocaleService.initialize();
    this.sessionService.initializeSession().subscribe();
    this.updateScrollState();

    if (environment.production) {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.verifyAppVersion();
    }
  }

  @HostListener('window:scroll')
  updateScrollState(): void {
    this.isScrolled.set(window.scrollY > 8);
  }

  logout(): void {
    this.sessionService.logout();
  }

  /**
   * Verifica que la version compilada coincida con version.json del servidor.
   * Si no coinciden (despliegue nuevo), limpia caches del navegador y recarga.
   * Solo se ejecuta en produccion para evitar recargas innecesarias en desarrollo.
   */
  private async verifyAppVersion(): Promise<void> {
    try {
      const cacheBuster: number = Date.now();
      const response: Response = await fetch(`/version.json?t=${cacheBuster}`);

      if (!response.ok) {
        return;
      }

      const data = (await response.json()) as { version: string };

      if (data.version !== environment.appVersion) {
        // Limpia caches de service workers si existen
        if ('caches' in window) {
          const cacheKeys: string[] = await caches.keys();
          await Promise.all(cacheKeys.map((key: string) => caches.delete(key)));
        }

        window.location.reload();
      }
    } catch {
      // Si falla la verificacion (red, JSON invalido), la app continua normalmente.
    }
  }
}
