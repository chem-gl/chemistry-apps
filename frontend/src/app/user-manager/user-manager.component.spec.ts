// user-manager.component.spec.ts: Pruebas del panel de administración de usuarios.
// Verifica carga, filtros, creación de usuarios y gestión de membresías por grupo.

import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { IdentityApiService } from '../core/api/identity-api.service';
import { IdentitySessionService } from '../core/auth/identity-session.service';
import { UserManagerComponent } from './user-manager.component';

describe('UserManagerComponent', () => {
  const identityApiServiceMock = {
    listUsers: vi.fn(),
    listGroups: vi.fn(),
    listMemberships: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    createMembership: vi.fn(),
    deleteMembership: vi.fn(),
  };

  const sessionServiceMock = {
    resolveManagedGroupIds: vi.fn(() => [1]),
    resolveVisibleGroups: vi.fn((groups: unknown[]) => groups),
    hasAdminAccess: vi.fn(() => true),
  };

  const users = [
    { id: 1, username: 'alice', is_active: true, role: 'user' },
    { id: 2, username: 'bob', is_active: false, role: 'admin' },
  ];
  const groups = [
    { id: 1, name: 'Alpha' },
    { id: 2, name: 'Beta' },
  ];
  const memberships = [
    { id: 10, user: 1, group: 1, role_in_group: 'member' },
    { id: 11, user: 2, group: 2, role_in_group: 'admin' },
  ];

  beforeEach(async () => {
    vi.clearAllMocks();
    identityApiServiceMock.listUsers.mockReturnValue(of(users));
    identityApiServiceMock.listGroups.mockReturnValue(of(groups));
    identityApiServiceMock.listMemberships.mockReturnValue(of(memberships));
    identityApiServiceMock.createUser.mockReturnValue(of({ id: 3, username: 'carol' }));
    identityApiServiceMock.updateUser.mockImplementation((userId: number, payload: object) =>
      of({ id: userId, username: userId === 1 ? 'alice' : 'bob', ...payload }),
    );
    identityApiServiceMock.createMembership.mockReturnValue(
      of({ id: 12, user: 1, group: 2, role_in_group: 'member' }),
    );
    identityApiServiceMock.deleteMembership.mockReturnValue(of(void 0));

    await TestBed.configureTestingModule({
      imports: [UserManagerComponent],
      providers: [
        { provide: IdentityApiService, useValue: identityApiServiceMock },
        { provide: IdentitySessionService, useValue: sessionServiceMock },
      ],
    }).compileComponents();
  });

  it('carga usuarios, grupos y membresías al iniciar', () => {
    // Verifica el bootstrap de datos del panel de usuarios.
    const fixture = TestBed.createComponent(UserManagerComponent);
    const component = fixture.componentInstance;

    component.ngOnInit();

    expect(component.users()).toEqual(users);
    expect(component.groups()).toEqual(groups);
    expect(component.memberships()).toEqual(memberships);
    expect(component.managedGroupIds()).toEqual([1]);
    expect(component.visibleGroups()).toEqual(groups);
  });

  it('aplica filtros y helpers derivados sobre usuarios y grupos', () => {
    // Verifica la lógica declarativa que decide qué usuarios se muestran.
    const fixture = TestBed.createComponent(UserManagerComponent);
    const component = fixture.componentInstance;
    component.ngOnInit();

    expect(component.visibleUsers()).toEqual(users);
    component.filterGroupId.set('1');
    expect(component.visibleUsers().map((user) => user.id)).toEqual([1]);
    expect(component.groupName(1)).toBe('Alpha');
    expect(component.groupName(999)).toBe('999');
    expect(component.membershipsForUser(1)).toEqual([memberships[0]]);
  });

  it('crea usuarios y valida que exista grupo primario', () => {
    // Verifica tanto el rechazo temprano como el alta exitosa de usuarios.
    const fixture = TestBed.createComponent(UserManagerComponent);
    const component = fixture.componentInstance;
    component.ngOnInit();

    component.submitCreateUser();
    expect(component.errorMessage()).toBe('Debe seleccionar un grupo primario para el usuario.');

    component.createUserForm.set({
      username: 'carol',
      email: 'carol@test.local',
      password: 'secret',
      first_name: 'Carol',
      last_name: 'Stone',
      role: 'user',
      primary_group_id: '1',
    });
    component.submitCreateUser();

    expect(identityApiServiceMock.createUser).toHaveBeenCalledWith({
      username: 'carol',
      email: 'carol@test.local',
      password: 'secret',
      first_name: 'Carol',
      last_name: 'Stone',
      role: 'user',
      primary_group_id: 1,
    });
    expect(component.createUserForm().username).toBe('');
  });

  it('actualiza estado y rol del usuario desde el listado', () => {
    // Verifica mutaciones rápidas del panel sin recargar toda la página.
    const fixture = TestBed.createComponent(UserManagerComponent);
    const component = fixture.componentInstance;
    component.ngOnInit();

    component.toggleUserStatus(users[0] as never);
    component.changeUserRole(users[0] as never, 'admin');

    expect(identityApiServiceMock.updateUser).toHaveBeenCalledWith(1, { is_active: false });
    expect(identityApiServiceMock.updateUser).toHaveBeenCalledWith(1, { role: 'admin' });
  });

  it('gestiona membresías y reporta errores del backend', () => {
    // Verifica alta y baja de membresías con feedback para conflictos del servidor.
    const fixture = TestBed.createComponent(UserManagerComponent);
    const component = fixture.componentInstance;
    component.ngOnInit();

    component.addMembershipForm.set({ userId: '1', groupId: '2', roleInGroup: 'member' });
    component.submitAddMembership();

    expect(identityApiServiceMock.createMembership).toHaveBeenCalledWith({
      user: 1,
      group: 2,
      role_in_group: 'member',
    });
    expect(component.addMembershipForm()).toEqual({
      userId: '',
      groupId: '',
      roleInGroup: 'member',
    });

    component.removeMembership(10);
    expect(identityApiServiceMock.deleteMembership).toHaveBeenCalledWith(10);
    expect(component.successMessage()).toBe('Membresía eliminada.');

    identityApiServiceMock.deleteMembership.mockReturnValueOnce(
      throwError(() => ({ error: { detail: 'No puedes borrar esta membresía.' } })),
    );
    component.removeMembership(11);

    expect(component.errorMessage()).toBe('No puedes borrar esta membresía.');
  });

  it('muestra error si la carga inicial o la creación fallan', () => {
    // Verifica los dos puntos de fallo más visibles del panel.
    identityApiServiceMock.listUsers.mockReturnValueOnce(
      throwError(() => new Error('load failed')),
    );
    const failedLoadFixture = TestBed.createComponent(UserManagerComponent);
    const failedLoadComponent = failedLoadFixture.componentInstance;
    failedLoadComponent.ngOnInit();
    expect(failedLoadComponent.errorMessage()).toBe('Error al cargar los datos de usuarios.');

    identityApiServiceMock.createUser.mockReturnValueOnce(
      throwError(() => ({ error: { username: ['Username already exists.'] } })),
    );
    const failedCreateFixture = TestBed.createComponent(UserManagerComponent);
    const failedCreateComponent = failedCreateFixture.componentInstance;
    failedCreateComponent.ngOnInit();
    failedCreateComponent.createUserForm.set({
      username: 'alice',
      email: 'alice@test.local',
      password: 'secret',
      first_name: '',
      last_name: '',
      role: 'user',
      primary_group_id: '1',
    });
    failedCreateComponent.submitCreateUser();

    expect(failedCreateComponent.errorMessage()).toBe('Username already exists.');
  });
});
