// identity-api.service.ts: Wrapper transversal para usuarios, grupos, permisos y configs.

import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../shared/constants';

export interface AccessibleScientificAppView {
  app_name: string;
  route_key: string;
  api_base_path: string;
  supports_pause_resume: boolean;
  enabled: boolean;
  group_permission: boolean | null;
  user_permission: boolean | null;
}

export interface EffectiveAppConfigView {
  app_name: string;
  enabled: boolean;
  effective_config: Record<string, unknown>;
  group_config: Record<string, unknown>;
  user_config: Record<string, unknown>;
}

export interface IdentityUserSummaryView {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  is_staff: boolean;
  is_superuser: boolean;
  role: 'root' | 'admin' | 'user';
  account_status: 'active' | 'inactive';
  primary_group_id: number | null;
}

export interface WorkGroupView {
  id: number;
  name: string;
  slug: string;
  description: string;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface GroupMembershipView {
  id: number;
  user: number;
  group: number;
  role_in_group: 'admin' | 'member';
  joined_at: string;
}

export interface AppPermissionView {
  id: number;
  app_name: string;
  group: number | null;
  user: number | null;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface GroupAppConfigView {
  id?: number;
  group?: number;
  app_name: string;
  config: Record<string, unknown>;
  updated_at?: string;
}

export interface CreateIdentityUserPayload {
  username: string;
  email: string;
  password: string;
  first_name?: string;
  last_name?: string;
  role: 'root' | 'admin' | 'user';
  account_status?: 'active' | 'inactive';
  primary_group_id?: number | null;
}

export interface UpdateIdentityUserPayload {
  email?: string;
  first_name?: string;
  last_name?: string;
  password?: string;
  role?: 'root' | 'admin' | 'user';
  account_status?: 'active' | 'inactive';
  primary_group_id?: number | null;
  is_active?: boolean;
  is_staff?: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class IdentityApiService {
  private readonly httpClient = inject(HttpClient);
  private readonly identityBaseUrl = `${API_BASE_URL}/api/identity`;
  private readonly authBaseUrl = `${API_BASE_URL}/api/auth`;

  listAccessibleApps(): Observable<AccessibleScientificAppView[]> {
    return this.httpClient.get<AccessibleScientificAppView[]>(`${this.authBaseUrl}/apps/`);
  }

  getCurrentAppConfig(appName: string): Observable<EffectiveAppConfigView> {
    return this.httpClient.get<EffectiveAppConfigView>(`${this.authBaseUrl}/app-configs/${appName}/`);
  }

  updateCurrentAppConfig(
    appName: string,
    config: Record<string, unknown>,
  ): Observable<{ id: number; user: number; app_name: string; config: Record<string, unknown> }> {
    return this.httpClient.patch<{ id: number; user: number; app_name: string; config: Record<string, unknown> }>(
      `${this.authBaseUrl}/app-configs/${appName}/`,
      { config },
    );
  }

  listUsers(): Observable<IdentityUserSummaryView[]> {
    return this.httpClient.get<IdentityUserSummaryView[]>(`${this.identityBaseUrl}/users/`);
  }

  createUser(payload: CreateIdentityUserPayload): Observable<IdentityUserSummaryView> {
    return this.httpClient.post<IdentityUserSummaryView>(`${this.identityBaseUrl}/users/`, payload);
  }

  updateUser(userId: number, payload: UpdateIdentityUserPayload): Observable<IdentityUserSummaryView> {
    return this.httpClient.patch<IdentityUserSummaryView>(
      `${this.identityBaseUrl}/users/${userId}/`,
      payload,
    );
  }

  listGroups(): Observable<WorkGroupView[]> {
    return this.httpClient.get<WorkGroupView[]>(`${this.identityBaseUrl}/groups/`);
  }

  createGroup(payload: {
    name: string;
    slug: string;
    description: string;
  }): Observable<WorkGroupView> {
    return this.httpClient.post<WorkGroupView>(`${this.identityBaseUrl}/groups/`, payload);
  }

  updateGroup(
    groupId: number,
    payload: Partial<Pick<WorkGroupView, 'name' | 'slug' | 'description'>>,
  ): Observable<WorkGroupView> {
    return this.httpClient.patch<WorkGroupView>(
      `${this.identityBaseUrl}/groups/${groupId}/`,
      payload,
    );
  }

  listMemberships(): Observable<GroupMembershipView[]> {
    return this.httpClient.get<GroupMembershipView[]>(`${this.identityBaseUrl}/memberships/`);
  }

  createMembership(payload: {
    user: number;
    group: number;
    role_in_group: 'admin' | 'member';
  }): Observable<GroupMembershipView> {
    return this.httpClient.post<GroupMembershipView>(
      `${this.identityBaseUrl}/memberships/`,
      payload,
    );
  }

  listAppPermissions(): Observable<AppPermissionView[]> {
    return this.httpClient.get<AppPermissionView[]>(`${this.identityBaseUrl}/app-permissions/`);
  }

  createAppPermission(payload: {
    app_name: string;
    group?: number | null;
    user?: number | null;
    is_enabled: boolean;
  }): Observable<AppPermissionView> {
    return this.httpClient.post<AppPermissionView>(
      `${this.identityBaseUrl}/app-permissions/`,
      payload,
    );
  }

  updateGroupAppConfig(
    groupId: number,
    appName: string,
    config: Record<string, unknown>,
  ): Observable<GroupAppConfigView> {
    return this.httpClient.patch<GroupAppConfigView>(
      `${this.identityBaseUrl}/groups/${groupId}/app-configs/${appName}/`,
      { config },
    );
  }
}
