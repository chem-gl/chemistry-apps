// apps-hub.component.spec.ts: Pruebas del catalogo publico (modo libre y cuenta).

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTestingTransloco } from '../core/i18n/testing-transloco.provider';
import { IdentitySessionService } from '../core/auth/identity-session.service';
import { JobAccessModeService } from '../core/auth/job-access-mode.service';
import {
  ACCOUNT_ONLY_APP_ROUTE_ITEMS,
  FREE_ACCESS_APP_ROUTE_ITEMS,
} from '../core/shared/scientific-apps.config';
import { AppsHubComponent } from './apps-hub.component';

class IdentitySessionStub {
  readonly isAuthenticated = signal(false);
  canAccessRoute = (_appKey: string): boolean => false;
}

class JobAccessModeStub {
  readonly openModeEnabled = signal(true);
}

describe('AppsHubComponent', () => {
  let hub: AppsHubComponent;
  let sessionStub: IdentitySessionStub;
  let accessModeStub: JobAccessModeStub;

  beforeEach(async () => {
    sessionStub = new IdentitySessionStub();
    accessModeStub = new JobAccessModeStub();

    await TestBed.configureTestingModule({
      imports: [AppsHubComponent],
      providers: [
        provideRouter([]),
        provideTestingTransloco(),
        { provide: IdentitySessionService, useValue: sessionStub },
        { provide: JobAccessModeService, useValue: accessModeStub },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AppsHubComponent);
    hub = fixture.componentInstance;
  });

  it('expone las siete apps del modo libre sin necesidad de sesion', () => {
    expect(hub.freeApps().length).toBe(7);
    expect(hub.freeApps()).toEqual(FREE_ACCESS_APP_ROUTE_ITEMS);
  });

  it('muestra las apps con cuenta bloqueadas para invitados', () => {
    sessionStub.isAuthenticated.set(false);

    expect(hub.accountApps()).toEqual(ACCOUNT_ONLY_APP_ROUTE_ITEMS);
    expect(hub.accountApps().length).toBeGreaterThan(0);
  });

  it('mueve las apps libres a la zona bloqueada cuando el modo está cerrado', () => {
    accessModeStub.openModeEnabled.set(false);
    expect(hub.freeApps()).toEqual([]);
    expect(hub.accountApps().slice(0, 7)).toEqual(FREE_ACCESS_APP_ROUTE_ITEMS);
  });

  it('filtra las apps con cuenta por permiso cuando hay sesion', () => {
    sessionStub.isAuthenticated.set(true);
    sessionStub.canAccessRoute = (appKey: string): boolean => appKey === 'cadma-py';

    expect(hub.accountApps().map((appItem) => appItem.key)).toEqual(['cadma-py']);
  });

  it('oculta las apps con cuenta sin permiso cuando hay sesion', () => {
    sessionStub.isAuthenticated.set(true);
    sessionStub.canAccessRoute = (_appKey: string): boolean => false;

    expect(hub.accountApps()).toEqual([]);
  });

  it('propone la primera app libre como punto de partida', () => {
    expect(hub.starterApp()?.key).toBe('molar-fractions');
  });

  it('mueve el resplandor de reaccion con el puntero', () => {
    const fixture = TestBed.createComponent(AppsHubComponent);
    const shell = fixture.nativeElement.querySelector('.apps-shell') as HTMLElement;
    shell.getBoundingClientRect = () =>
      ({ left: 10, top: 20, width: 100, height: 100 }) as DOMRect;

    fixture.componentInstance.trackPointer(
      { clientX: 60, clientY: 70 } as PointerEvent,
      shell,
    );

    expect(shell.style.getPropertyValue('--glow-x')).toBe('50px');
    expect(shell.style.getPropertyValue('--glow-y')).toBe('50px');
  });

  it('renderiza la zona publica y la invitacion a cuenta', () => {
    const fixture = TestBed.createComponent(AppsHubComponent);
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelectorAll('.app-lattice').length).toBe(2);
    expect(host.querySelector('.top-actions .cta-primary')?.textContent).toContain(
      'Start with molar fractions',
    );
    expect(host.querySelector('app-institutional-showcase')).not.toBeNull();
    expect(host.textContent).toContain('Account required');
    expect(host.querySelectorAll('.node-badge.is-locked').length).toBeGreaterThan(0);
  });
});
