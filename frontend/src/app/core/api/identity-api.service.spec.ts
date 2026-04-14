// identity-api.service.spec.ts: Pruebas del wrapper HTTP transversal de identidad.
// Verifica rutas y payloads para usuarios, grupos, membresías, permisos y configs.

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../shared/constants';
import { IdentityApiService } from './identity-api.service';

describe('IdentityApiService', () => {
  let service: IdentityApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    service = TestBed.inject(IdentityApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('construye las requests de apps accesibles y configuración del usuario actual', () => {
    // Verifica las rutas auth con y sin filtro de grupo para evitar URLs mal cableadas.
    service.listAccessibleApps(7).subscribe();
    service.getCurrentAppConfig('smileit').subscribe();
    service.updateCurrentAppConfig('smileit', { mode: 'advanced' }).subscribe();

    const appsRequest = httpMock.expectOne(
      (request) =>
        request.method === 'GET' &&
        request.urlWithParams === `${API_BASE_URL}/api/auth/apps/?group_id=7`,
    );
    const configRequest = httpMock.expectOne(
      (request) =>
        request.method === 'GET' && request.url === `${API_BASE_URL}/api/auth/app-configs/smileit/`,
    );
    const updateConfigRequest = httpMock.expectOne(
      (request) =>
        request.method === 'PATCH' &&
        request.url === `${API_BASE_URL}/api/auth/app-configs/smileit/`,
    );

    expect(appsRequest.request.method).toBe('GET');
    expect(configRequest.request.method).toBe('GET');
    expect(updateConfigRequest.request.method).toBe('PATCH');
    expect(updateConfigRequest.request.body).toEqual({ config: { mode: 'advanced' } });

    appsRequest.flush([]);
    configRequest.flush({});
    updateConfigRequest.flush({
      id: 1,
      user: 2,
      app_name: 'smileit',
      config: { mode: 'advanced' },
    });
  });

  it('construye CRUD de usuarios y grupos con payloads esperados', () => {
    // Verifica las operaciones principales del panel de administración.
    service.listUsers().subscribe();
    service
      .createUser({ username: 'alice', email: 'alice@test.local', password: '123', role: 'user' })
      .subscribe();
    service.updateUser(8, { is_active: false }).subscribe();
    service.deleteUser(8).subscribe();
    service.listGroups().subscribe();
    service.createGroup({ name: 'Alpha', slug: 'alpha', description: 'Main group' }).subscribe();
    service.updateGroup(3, { description: 'Updated' }).subscribe();
    service.deleteGroup(3).subscribe();

    const listUsersRequest = httpMock.expectOne(
      (request) =>
        request.method === 'GET' && request.url === `${API_BASE_URL}/api/identity/users/`,
    );
    const createUserRequest = httpMock.expectOne(
      (request) =>
        request.method === 'POST' && request.url === `${API_BASE_URL}/api/identity/users/`,
    );
    const updateUserRequest = httpMock.expectOne(
      (request) =>
        request.method === 'PATCH' && request.url === `${API_BASE_URL}/api/identity/users/8/`,
    );
    const deleteUserRequest = httpMock.expectOne(
      (request) =>
        request.method === 'DELETE' && request.url === `${API_BASE_URL}/api/identity/users/8/`,
    );
    const listGroupsRequest = httpMock.expectOne(
      (request) =>
        request.method === 'GET' && request.url === `${API_BASE_URL}/api/identity/groups/`,
    );
    const createGroupRequest = httpMock.expectOne(
      (request) =>
        request.method === 'POST' && request.url === `${API_BASE_URL}/api/identity/groups/`,
    );
    const updateGroupRequest = httpMock.expectOne(
      (request) =>
        request.method === 'PATCH' && request.url === `${API_BASE_URL}/api/identity/groups/3/`,
    );
    const deleteGroupRequest = httpMock.expectOne(
      (request) =>
        request.method === 'DELETE' && request.url === `${API_BASE_URL}/api/identity/groups/3/`,
    );

    expect(listUsersRequest.request.method).toBe('GET');
    expect(createUserRequest.request.body).toEqual({
      username: 'alice',
      email: 'alice@test.local',
      password: '123',
      role: 'user',
    });
    expect(updateUserRequest.request.body).toEqual({ is_active: false });
    expect(deleteUserRequest.request.method).toBe('DELETE');
    expect(listGroupsRequest.request.method).toBe('GET');
    expect(createGroupRequest.request.body).toEqual({
      name: 'Alpha',
      slug: 'alpha',
      description: 'Main group',
    });
    expect(updateGroupRequest.request.body).toEqual({ description: 'Updated' });
    expect(deleteGroupRequest.request.method).toBe('DELETE');

    listUsersRequest.flush([]);
    createUserRequest.flush({});
    updateUserRequest.flush({});
    deleteUserRequest.flush({});
    listGroupsRequest.flush([]);
    createGroupRequest.flush({});
    updateGroupRequest.flush({});
    deleteGroupRequest.flush({});
  });

  it('construye CRUD de membresías, permisos y configs grupales', () => {
    // Verifica endpoints secundarios que alimentan la administración RBAC.
    service.listMemberships().subscribe();
    service.createMembership({ user: 1, group: 2, role_in_group: 'admin' }).subscribe();
    service.updateMembership(4, { role_in_group: 'member' }).subscribe();
    service.deleteMembership(4).subscribe();
    service.listAppPermissions().subscribe();
    service.createAppPermission({ app_name: 'smileit', group: 2, is_enabled: true }).subscribe();
    service.updateAppPermission(9, { is_enabled: false }).subscribe();
    service.deleteAppPermission(9).subscribe();
    service.getGroupAppConfig(2, 'smileit').subscribe();
    service.updateGroupAppConfig(2, 'smileit', { export_name_base: 'SERIE' }).subscribe();

    const listMembershipsRequest = httpMock.expectOne(
      (request) =>
        request.method === 'GET' && request.url === `${API_BASE_URL}/api/identity/memberships/`,
    );
    const createMembershipRequest = httpMock.expectOne(
      (request) =>
        request.method === 'POST' && request.url === `${API_BASE_URL}/api/identity/memberships/`,
    );
    const updateMembershipRequest = httpMock.expectOne(
      (request) =>
        request.method === 'PATCH' && request.url === `${API_BASE_URL}/api/identity/memberships/4/`,
    );
    const deleteMembershipRequest = httpMock.expectOne(
      (request) =>
        request.method === 'DELETE' &&
        request.url === `${API_BASE_URL}/api/identity/memberships/4/`,
    );
    const listPermissionsRequest = httpMock.expectOne(
      (request) =>
        request.method === 'GET' && request.url === `${API_BASE_URL}/api/identity/app-permissions/`,
    );
    const createPermissionRequest = httpMock.expectOne(
      (request) =>
        request.method === 'POST' &&
        request.url === `${API_BASE_URL}/api/identity/app-permissions/`,
    );
    const updatePermissionRequest = httpMock.expectOne(
      (request) =>
        request.method === 'PATCH' &&
        request.url === `${API_BASE_URL}/api/identity/app-permissions/9/`,
    );
    const deletePermissionRequest = httpMock.expectOne(
      (request) =>
        request.method === 'DELETE' &&
        request.url === `${API_BASE_URL}/api/identity/app-permissions/9/`,
    );
    const getGroupConfigRequest = httpMock.expectOne(
      (request) =>
        request.method === 'GET' &&
        request.url === `${API_BASE_URL}/api/identity/groups/2/app-configs/smileit/`,
    );
    const updateGroupConfigRequest = httpMock.expectOne(
      (request) =>
        request.method === 'PATCH' &&
        request.url === `${API_BASE_URL}/api/identity/groups/2/app-configs/smileit/`,
    );

    expect(listMembershipsRequest.request.method).toBe('GET');
    expect(createMembershipRequest.request.body).toEqual({
      user: 1,
      group: 2,
      role_in_group: 'admin',
    });
    expect(updateMembershipRequest.request.body).toEqual({ role_in_group: 'member' });
    expect(deleteMembershipRequest.request.method).toBe('DELETE');
    expect(listPermissionsRequest.request.method).toBe('GET');
    expect(createPermissionRequest.request.body).toEqual({
      app_name: 'smileit',
      group: 2,
      is_enabled: true,
    });
    expect(updatePermissionRequest.request.body).toEqual({ is_enabled: false });
    expect(deletePermissionRequest.request.method).toBe('DELETE');
    expect(getGroupConfigRequest.request.method).toBe('GET');
    expect(updateGroupConfigRequest.request.body).toEqual({
      config: { export_name_base: 'SERIE' },
    });

    listMembershipsRequest.flush([]);
    createMembershipRequest.flush({});
    updateMembershipRequest.flush({});
    deleteMembershipRequest.flush({});
    listPermissionsRequest.flush([]);
    createPermissionRequest.flush({});
    updatePermissionRequest.flush({});
    deletePermissionRequest.flush({});
    getGroupConfigRequest.flush({});
    updateGroupConfigRequest.flush({});
  });
});
