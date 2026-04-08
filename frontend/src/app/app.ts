// app.ts: Layout principal con navegacion filtrada por sesion, permisos y estado visual del header.

import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { IdentitySessionService } from './core/auth/identity-session.service';
import { GlobalErrorModalComponent } from './core/shared/components/global-error-modal/global-error-modal.component';
import { SCIENTIFIC_APP_ROUTE_ITEMS } from './core/shared/scientific-apps.config';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, GlobalErrorModalComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  readonly sessionService = inject(IdentitySessionService);
  readonly isScrolled = signal(false);

  readonly primaryNavigationItems = computed(() => {
    if (!this.sessionService.isAuthenticated()) {
      return [{ label: 'Sign in', path: '/login', hint: 'Authenticate to load your workspace' }];
    }

    const scientificNavigationItems = SCIENTIFIC_APP_ROUTE_ITEMS.filter(
      (appItem) => appItem.visibleInMenus && this.sessionService.canAccessRoute(appItem.key),
    ).map((appItem) => ({
      label: appItem.title,
      path: appItem.routePath,
      hint: appItem.description,
    }));

    return [
      { label: 'Dashboard', path: '/dashboard', hint: 'Role-aware workspace overview' },
      { label: 'Profile', path: '/profile', hint: 'Manage your personal profile and password' },
      { label: 'Jobs Monitor', path: '/jobs', hint: 'Track active and completed jobs' },
      { label: 'Apps', path: '/apps', hint: 'Visible scientific apps for your current session' },
      ...scientificNavigationItems,
      ...(this.sessionService.hasAdminAccess()
        ? [{ label: 'Identity', path: '/admin/identity', hint: 'Users, groups and permissions' }]
        : []),
    ];
  });

  ngOnInit(): void {
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
