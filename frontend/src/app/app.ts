// app.ts: Layout principal con navegacion filtrada por sesion, permisos y estado visual del header.

import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { IdentitySessionService } from './core/auth/identity-session.service';
import { LanguageService } from './core/i18n/language.service';
import { ActiveGroupSelectorComponent } from './core/shared/components/active-group-selector/active-group-selector.component';
import { GlobalErrorModalComponent } from './core/shared/components/global-error-modal/global-error-modal.component';
import { LanguageSwitcherComponent } from './core/shared/components/language-switcher/language-switcher.component';
import { SCIENTIFIC_APP_ROUTE_ITEMS } from './core/shared/scientific-apps.config';

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
      label: appItem.title,
      path: appItem.routePath,
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
    this.sessionService.initializeSession().subscribe();
    this.updateScrollState();
  }

  @HostListener('window:scroll')
  updateScrollState(): void {
    this.isScrolled.set(window.scrollY > 8);
  }

  logout(): void {
    this.sessionService.logout();
  }
}
