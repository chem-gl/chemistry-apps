// apps-hub.component.spec.ts: Pruebas del catalogo publico (columnas CADMA/Others).

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTestingTransloco } from '../core/i18n/testing-transloco.provider';
import { IdentitySessionService } from '../core/auth/identity-session.service';
import { JobAccessModeService } from '../core/auth/job-access-mode.service';
import {
  CADMA_GROUP_APP_ROUTE_ITEMS,
  OTHER_GROUP_APP_ROUTE_ITEMS,
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

  it('agrupa las apps en las columnas CADMA y Others sin necesidad de sesion', () => {
    const groups = hub.appGroups();

    expect(groups.map((group) => group.id)).toEqual(['cadma', 'others']);
    expect(groups[0].apps).toEqual(CADMA_GROUP_APP_ROUTE_ITEMS);
    expect(groups[1].apps).toEqual(OTHER_GROUP_APP_ROUTE_ITEMS);
    expect(CADMA_GROUP_APP_ROUTE_ITEMS.length).toBeGreaterThan(0);
    expect(OTHER_GROUP_APP_ROUTE_ITEMS.length).toBeGreaterThan(0);
  });

  it('bloquea para invitados solo las apps que piden cuenta', () => {
    sessionStub.isAuthenticated.set(false);

    const cadmaPy = CADMA_GROUP_APP_ROUTE_ITEMS.find((appItem) => appItem.key === 'cadma-py');
    const molarFractions = OTHER_GROUP_APP_ROUTE_ITEMS[0];

    expect(cadmaPy).toBeDefined();
    expect(hub.isLocked(cadmaPy!)).toBe(true);
    expect(hub.isLocked(molarFractions)).toBe(false);
  });

  it('bloquea todas las apps cuando el modo libre esta cerrado', () => {
    accessModeStub.openModeEnabled.set(false);

    const molarFractions = OTHER_GROUP_APP_ROUTE_ITEMS[0];
    expect(hub.isLocked(molarFractions)).toBe(true);
  });

  it('oculta las apps con cuenta sin permiso cuando hay sesion', () => {
    sessionStub.isAuthenticated.set(true);
    sessionStub.canAccessRoute = (_appKey: string): boolean => false;

    const cadmaGroup = hub.appGroups().find((group) => group.id === 'cadma');
    const visibleKeys = cadmaGroup?.apps.map((appItem) => appItem.key) ?? [];

    expect(visibleKeys).toEqual(['smileit', 'sa-score', 'toxicity-properties']);
    expect(visibleKeys).not.toContain('cadma-py');
  });

  it('mantiene las apps con cuenta cuando la sesion tiene permiso', () => {
    sessionStub.isAuthenticated.set(true);
    sessionStub.canAccessRoute = (appKey: string): boolean => appKey === 'cadma-py';

    const cadmaGroup = hub.appGroups().find((group) => group.id === 'cadma');
    expect(cadmaGroup?.apps.map((appItem) => appItem.key)).toContain('cadma-py');
  });

  it('cada app expone su manual y lo abre sin navegar', () => {
    expect(hub.hasDoc('molar-fractions')).toBe(true);
    expect(hub.hasDoc('cadma-py')).toBe(true);
    expect(hub.hasDoc('inexistente')).toBe(false);

    const openEvent = { preventDefault: (): void => undefined, stopPropagation: (): void => undefined } as Event;
    hub.openAppDoc('molar-fractions', openEvent);

    expect(hub.docPanelOpen()).toBe(true);
    expect(hub.activeDocTabs().length).toBeGreaterThan(0);
  });

  it('renderiza las dos columnas con manual en cada tarjeta', () => {
    const fixture = TestBed.createComponent(AppsHubComponent);
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelectorAll('.app-column').length).toBe(2);
    expect(host.querySelectorAll('.app-lattice').length).toBe(2);
    expect(host.querySelector('.node-doc-btn')).not.toBeNull();
    expect(host.querySelectorAll('.node-doc-btn.is-coming-soon').length).toBe(0);
    expect(host.querySelector('app-institutional-showcase')).not.toBeNull();
    expect(host.querySelector('.top-actions')).toBeNull();
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
});
