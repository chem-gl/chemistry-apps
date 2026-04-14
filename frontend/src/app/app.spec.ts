import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { IdentitySessionService } from './core/auth/identity-session.service';
import { provideTestingTransloco } from './core/i18n/testing-transloco.provider';

describe('App', () => {
  const sessionServiceMock = {
    initializeSession: () => ({ subscribe: () => void 0 }),
    isAuthenticated: () => true,
    displayName: () => 'Admin User',
    currentRole: () => 'root',
    currentUser: () => ({ id: 1, username: 'admin' }),
    canAccessRoute: () => true,
    hasAdminAccess: () => false,
    canAccessAdminArea: () => false,
    hasRootAccess: () => true,
    userMemberships: () => [],
    isRootViewContext: () => true,
    activeGroupContext: () => null,
    activeGroupId: () => null,
    setRootViewContext: () => void 0,
    setActiveGroup: () => void 0,
    logout: () => void 0,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        provideTestingTransloco(),
        { provide: IdentitySessionService, useValue: sessionServiceMock },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render router outlet', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('router-outlet')).not.toBeNull();
  });

  it('should render primary navigation links', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    const links = Array.from(compiled.querySelectorAll('.main-nav a')).map(
      (anchorElement: Element) => anchorElement.textContent?.trim() ?? '',
    );

    expect(links).toContain('Jobs Monitor');
    expect(links).toContain('Molar Fractions');
    expect(links).toContain('Smileit');
    expect(links).toContain('Apps');
  });
});
