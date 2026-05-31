// app.ts: Layout principal con navegacion filtrada por sesion, permisos y estado visual del header.
//         Tambien verifica la version de la app contra version.json para forzar recarga en produccion
//         cuando hay un nuevo despliegue (cache busting automatico).

import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
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

const SCIENTIFIC_APP_NAV_ITEM: PrimaryNavigationItem = {
  labelKey: 'app.nav.apps',
  path: '/apps',
  hintKey: 'app.navHints.apps',
};

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
  private readonly router = inject(Router);
  readonly isScrolled = signal(false);
  readonly isMobileNavOpen = signal(false);
  readonly isAuthPage = signal(false);

  /** Items del dropdown de Apps. */
  readonly appsSubmenuItems = computed<ReadonlyArray<PrimaryNavigationItem>>(() => {
    if (!this.sessionService.isAuthenticated()) {
      return [];
    }
    return SCIENTIFIC_APP_ROUTE_ITEMS.filter(
      (appItem) => appItem.visibleInMenus && this.sessionService.canAccessRoute(appItem.key),
    ).map((appItem) => ({
      labelKey: scientificAppTitleKey(appItem.key),
      label: appItem.title,
      path: appItem.routePath,
      hintKey: scientificAppDescriptionKey(appItem.key),
      hint: appItem.description,
    }));
  });

  /** Items principales del nav (sin apps ni admin). */
  readonly mainNavigationItems = computed<ReadonlyArray<PrimaryNavigationItem>>(() => {
    if (!this.sessionService.isAuthenticated()) {
      return [{ labelKey: 'app.nav.signIn', path: '/login', hintKey: 'app.navHints.signIn' }];
    }

    return [
      { labelKey: 'app.nav.dashboard', path: '/dashboard', hintKey: 'app.navHints.dashboard' },
      { labelKey: 'app.nav.profile', path: '/profile', hintKey: 'app.navHints.profile' },
      { labelKey: 'app.nav.jobsMonitor', path: '/jobs', hintKey: 'app.navHints.jobsMonitor' },
      SCIENTIFIC_APP_NAV_ITEM,
      ...(this.sessionService.canAccessAdminArea()
        ? [
            { labelKey: 'app.nav.groups', path: '/admin/groups', hintKey: 'app.navHints.groups' },
            { labelKey: 'app.nav.users', path: '/admin/users', hintKey: 'app.navHints.users' },
          ]
        : []),
    ];
  });

  /** Apps con submenu tiene items? */
  readonly hasApps = computed(() => this.appsSubmenuItems().length > 0);

  ngOnInit(): void {
    this.languageService.initializeLanguage();
    this.scientificNumberInputLocaleService.initialize();
    this.sessionService.initializeSession().subscribe();
    this.updateScrollState();

    this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        const url = event.urlAfterRedirects.split('?')[0];
        this.isAuthPage.set(url === '/login' || url === '/register');
      }
    });

    if (environment.production) {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.verifyAppVersion();
    }
  }

  @HostListener('window:scroll')
  updateScrollState(): void {
    this.isScrolled.set(window.scrollY > 8);
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.isMobileNavOpen()) {
      this.isMobileNavOpen.set(false);
    }
  }

  toggleMobileNav(event: Event): void {
    event.stopPropagation();
    this.isMobileNavOpen.update((v) => !v);
  }

  closeMobileNav(): void {
    this.isMobileNavOpen.set(false);
  }

  logout(): void {
    this.sessionService.logout();
  }

  private async verifyAppVersion(): Promise<void> {
    try {
      const cacheBuster: number = Date.now();
      const response: Response = await fetch(`/version.json?t=${cacheBuster}`);

      if (!response.ok) {
        return;
      }

      const data = (await response.json()) as { version: string };

      if (data.version !== environment.appVersion) {
        if ('caches' in window) {
          const cacheKeys: string[] = await caches.keys();
          await Promise.all(cacheKeys.map((key: string) => caches.delete(key)));
        }
        window.location.reload();
      }
    } catch {
      // Si falla la verificacion, la app continua normalmente.
    }
  }
}
