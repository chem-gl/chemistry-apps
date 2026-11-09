// identity-api.service.spec.ts: Pruebas del wrapper HTTP transversal de identidad.
// Verifica rutas y payloads para usuarios, grupos, membresías y permisos.

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../shared/constants';
import { provideApi } from './generated';
import { IdentityApiService } from './identity-api.service';

describe('IdentityApiService', () => {
  let service: IdentityApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideApi(API_BASE_URL),
      ],
    });

    service = TestBed.inject(IdentityApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('construye la request de apps accesibles con filtro de grupo', () => {
    // Verifica la ruta auth con filtro de grupo para evitar URLs mal cableadas.
    service.listAccessibleApps(7).subscribe();

    const appsRequest = httpMock.expectOne(
      (request) =>
        request.method === 'GET' &&
        request.urlWithParams === `${API_BASE_URL}/api/auth/apps/?group_id=7`,
    );

    expect(appsRequest.request.method).toBe('GET');

    appsRequest.flush([]);
  });

  it('listAccessibleApps sin groupId no envía group_id en la query', () => {
    // Verifica que la omisión del parámetro opcional no emite group_id= vacío.
    service.listAccessibleApps().subscribe();

    const request = httpMock.expectOne(
      (req) =>
        req.method === 'GET' &&
        req.url === `${API_BASE_URL}/api/auth/apps/` &&
        !req.params.has('group_id'),
    );

    expect(request.request.urlWithParams).toBe(`${API_BASE_URL}/api/auth/apps/`);

    request.flush([]);
  });

  it('construye CRUD de usuarios y grupos con payloads esperados', () => {
    // Verifica las operaciones principales del panel de administración.
    service.listUsers().subscribe();
    service
      .createUser({ username: 'alice', email: 'alice@test.local', password: '123', role: 'user' })
      .subscribe();
    service.updateUser(8, { is_active: false }).subscribe();
    service.listGroups().subscribe();
    service.listScientificApps().subscribe();
    service.createGroup({ name: 'Alpha', slug: 'alpha', description: 'Main group' }).subscribe();
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
    const listGroupsRequest = httpMock.expectOne(
      (request) =>
        request.method === 'GET' && request.url === `${API_BASE_URL}/api/identity/groups/`,
    );
    const listScientificAppsRequest = httpMock.expectOne(
      (request) =>
        request.method === 'GET' && request.url === `${API_BASE_URL}/api/identity/scientific-apps/`,
    );
    const createGroupRequest = httpMock.expectOne(
      (request) =>
        request.method === 'POST' && request.url === `${API_BASE_URL}/api/identity/groups/`,
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
    expect(listGroupsRequest.request.method).toBe('GET');
    expect(listScientificAppsRequest.request.method).toBe('GET');
    expect(createGroupRequest.request.body).toEqual({
      name: 'Alpha',
      slug: 'alpha',
      description: 'Main group',
    });
    expect(deleteGroupRequest.request.method).toBe('DELETE');

    listUsersRequest.flush([]);
    createUserRequest.flush({});
    updateUserRequest.flush({});
    listGroupsRequest.flush([]);
    listScientificAppsRequest.flush([]);
    createGroupRequest.flush({});
    deleteGroupRequest.flush({});
  });

  it('construye CRUD de membresías y permisos de app', () => {
    // Verifica endpoints secundarios que alimentan la administración RBAC.
    service.listMemberships().subscribe();
    service.createMembership({ user: 1, group: 2, role_in_group: 'admin' }).subscribe();
    service.updateMembership(4, { role_in_group: 'member' }).subscribe();
    service.deleteMembership(4).subscribe();
    service.listAppPermissions().subscribe();
    service.createAppPermission({ app_name: 'smileit', group: 2, is_enabled: true }).subscribe();
    service.updateAppPermission(9, { is_enabled: false }).subscribe();

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

    listMembershipsRequest.flush([]);
    createMembershipRequest.flush({});
    updateMembershipRequest.flush({});
    deleteMembershipRequest.flush({});
    listPermissionsRequest.flush([]);
    createPermissionRequest.flush({});
    updatePermissionRequest.flush({});
  });
});
