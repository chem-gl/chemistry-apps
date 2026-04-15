// group-manager.component.spec.ts: Pruebas del panel de administración de grupos.
// Verifica carga de datos, gestión de membresías y permisos de apps por grupo.

import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { IdentityApiService } from '../core/api/identity-api.service';
import { IdentitySessionService } from '../core/auth/identity-session.service';
import { GroupManagerComponent } from './group-manager.component';

describe('GroupManagerComponent', () => {
  const identityApiServiceMock = {
    listGroups: vi.fn(),
    listScientificApps: vi.fn(),
    listUsers: vi.fn(),
    listMemberships: vi.fn(),
    listAppPermissions: vi.fn(),
    createGroup: vi.fn(),
    createMembership: vi.fn(),
    deleteMembership: vi.fn(),
    updateMembership: vi.fn(),
    createAppPermission: vi.fn(),
    updateAppPermission: vi.fn(),
    deleteGroup: vi.fn(),
  };

  const sessionServiceMock = {
    resolveManagedGroupIds: vi.fn((_groups: unknown[], memberships: Array<{ group: number }>) =>
      memberships.map((membership) => membership.group),
    ),
    resolveVisibleGroups: vi.fn((groups: unknown[]) => groups),
    reloadSessionData: vi.fn(() => of(void 0)),
    setKnownGroups: vi.fn(),
  };

  const groups = [{ id: 1, name: 'Alpha', slug: 'alpha', description: '' }];
  const scientificApps = [
    { plugin_name: 'smileit', route_key: 'smileit', api_base_path: '/api/smileit/jobs/' },
    {
      plugin_name: 'marcus-kinetics',
      route_key: 'marcus',
      api_base_path: '/api/marcus/jobs/',
    },
  ];
  const users = [{ id: 4, username: 'alice' }];
  const memberships = [{ id: 7, user: 4, group: 1, role_in_group: 'member' }];
  const permissions = [{ id: 10, app_name: 'smileit', group: 1, user: null, is_enabled: true }];

  beforeEach(async () => {
    vi.clearAllMocks();
    identityApiServiceMock.listGroups.mockReturnValue(of(groups));
    identityApiServiceMock.listScientificApps.mockReturnValue(of(scientificApps));
    identityApiServiceMock.listUsers.mockReturnValue(of(users));
    identityApiServiceMock.listMemberships.mockReturnValue(of(memberships));
    identityApiServiceMock.listAppPermissions.mockReturnValue(of(permissions));
    identityApiServiceMock.createGroup.mockReturnValue(of({ id: 2, name: 'Beta' }));
    identityApiServiceMock.createMembership.mockReturnValue(
      of({ id: 8, user: 4, group: 1, role_in_group: 'admin' }),
    );
    identityApiServiceMock.deleteMembership.mockReturnValue(of(void 0));
    identityApiServiceMock.updateMembership.mockReturnValue(
      of({ id: 7, user: 4, group: 1, role_in_group: 'admin' }),
    );
    identityApiServiceMock.createAppPermission.mockReturnValue(
      of({ id: 11, app_name: 'sa-score', group: 1, user: null, is_enabled: true }),
    );
    identityApiServiceMock.updateAppPermission.mockReturnValue(
      of({ id: 10, app_name: 'smileit', group: 1, user: null, is_enabled: false }),
    );
    identityApiServiceMock.deleteGroup.mockReturnValue(of(void 0));

    await TestBed.configureTestingModule({
      imports: [GroupManagerComponent],
      providers: [
        { provide: IdentityApiService, useValue: identityApiServiceMock },
        { provide: IdentitySessionService, useValue: sessionServiceMock },
      ],
    }).compileComponents();
  });

  it('carga grupos, usuarios, membresías y permisos al iniciar', () => {
    // Verifica la inicialización completa del panel de grupos.
    const fixture = TestBed.createComponent(GroupManagerComponent);
    const component = fixture.componentInstance;

    component.ngOnInit();

    expect(component.groups()).toEqual(groups);
    expect(component.users()).toEqual(users);
    expect(component.memberships()).toEqual(memberships);
    expect(component.appPermissions()).toEqual(permissions);
    expect(component.scientificApps()).toEqual(scientificApps);
    expect(component.visibleGroups()).toEqual(groups);
    expect(component.managedGroupIds()).toEqual([1]);
    expect(component.isLoading()).toBe(false);
  });

  it('muestra error si falla la carga inicial', () => {
    // Verifica la ruta de error del `forkJoin` inicial.
    identityApiServiceMock.listGroups.mockReturnValueOnce(throwError(() => new Error('boom')));
    const fixture = TestBed.createComponent(GroupManagerComponent);
    const component = fixture.componentInstance;

    component.ngOnInit();

    expect(component.errorMessage()).toBe('Error al cargar los grupos. Intente nuevamente.');
    expect(component.isLoading()).toBe(false);
  });

  it('expone helpers de expansión y filtrado por grupo', () => {
    // Verifica utilidades derivadas usadas por la UI de administración.
    const fixture = TestBed.createComponent(GroupManagerComponent);
    const component = fixture.componentInstance;
    component.ngOnInit();

    component.toggleExpand(1);
    expect(component.expandedGroupId()).toBe(1);
    component.toggleExpand(1);
    expect(component.expandedGroupId()).toBeNull();
    expect(component.membershipsForGroup(1)).toEqual(memberships);
    expect(component.permissionsForGroup(1)).toEqual(permissions);
    expect(component.userName(4)).toBe('alice');
    expect(component.userName(999)).toBe('999');
    expect(component.appPermissionEnabled(1, 'smileit')).toBe(true);
    expect(component.appPermissionEnabled(1, 'marcus-kinetics')).toBe(false);
    expect(component.appLabel(scientificApps[1] as never)).toBe('Marcus Theory');
    expect(component.appTestIdKey(scientificApps[1] as never)).toBe('marcus');

    component.groupSearchQuery.set('alp');
    expect(component.filteredGroups().map((group) => group.id)).toEqual([1]);

    component.memberSearchQuery.set('ali');
    expect(component.visibleMembershipsForGroup(1).map((membership) => membership.id)).toEqual([7]);
    expect(component.availableUsersForGroup(1)).toEqual([]);
  });

  it('crea grupos y miembros reseteando formularios y mensajes', () => {
    // Verifica los flujos de alta del panel y su actualización local inmediata.
    const fixture = TestBed.createComponent(GroupManagerComponent);
    const component = fixture.componentInstance;
    component.ngOnInit();

    component.createGroupForm.set({ name: 'Beta', slug: 'beta', description: 'Second' });
    component.submitCreateGroup();

    expect(identityApiServiceMock.createGroup).toHaveBeenCalledWith({
      name: 'Beta',
      slug: 'beta',
      description: 'Second',
    });
    expect(component.createGroupForm()).toEqual({ name: '', slug: '', description: '' });

    component.addMemberForm.set({ userId: '4', roleInGroup: 'admin' });
    component.addMember(1);

    expect(identityApiServiceMock.createMembership).toHaveBeenCalledWith({
      user: 4,
      group: 1,
      role_in_group: 'admin',
    });
    expect(component.memberships().map((membership) => membership.id)).toContain(8);
    expect(component.addMemberForm()).toEqual({ userId: '', roleInGroup: 'member' });
  });

  it('actualiza y elimina miembros manejando errores con detalle del backend', () => {
    // Verifica edición de rol, borrado exitoso y mensaje detallado en error de borrado.
    const fixture = TestBed.createComponent(GroupManagerComponent);
    const component = fixture.componentInstance;
    component.ngOnInit();

    component.updateMemberRole(7, 'admin');
    expect(component.memberships()[0].role_in_group).toBe('admin');

    component.removeMember(7);
    expect(component.memberships().find((membership) => membership.id === 7)).toBeUndefined();

    identityApiServiceMock.deleteMembership.mockReturnValueOnce(
      throwError(() => ({ error: { detail: 'No puedes eliminarte a ti mismo.' } })),
    );
    component.removeMember(999);

    expect(component.errorMessage()).toBe('No puedes eliminarte a ti mismo.');
  });

  it('crea o actualiza permisos de app según exista una regla previa', () => {
    // Verifica ambas ramas de toggleAppPermission para RBAC por grupo.
    const fixture = TestBed.createComponent(GroupManagerComponent);
    const component = fixture.componentInstance;
    component.ngOnInit();

    component.toggleAppPermission(1, 'smileit');
    expect(identityApiServiceMock.updateAppPermission).toHaveBeenCalledWith(10, {
      is_enabled: false,
    });

    component.toggleAppPermission(1, 'marcus-kinetics');
    expect(identityApiServiceMock.createAppPermission).toHaveBeenCalledWith({
      app_name: 'marcus-kinetics',
      group: 1,
      is_enabled: true,
    });
    expect(component.appPermissions().map((permission) => permission.id)).toContain(11);
  });

  it('borra grupos confirmados y reporta errores si la API falla', () => {
    // Verifica el flujo destructivo con confirmación y feedback al usuario.
    const confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    const fixture = TestBed.createComponent(GroupManagerComponent);
    const component = fixture.componentInstance;
    component.ngOnInit();
    component.expandedGroupId.set(1);

    component.deleteGroup(1);

    expect(identityApiServiceMock.deleteGroup).toHaveBeenCalledWith(1);
    expect(component.expandedGroupId()).toBeNull();

    identityApiServiceMock.deleteGroup.mockReturnValueOnce(
      throwError(() => ({ error: { detail: 'No se pudo eliminar el grupo.' } })),
    );
    component.deleteGroup(2);

    expect(component.errorMessage()).toBe('No se pudo eliminar el grupo.');
    confirmSpy.mockRestore();
  });
});
