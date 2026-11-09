// identity-api.service.ts: Wrapper transversal para usuarios, grupos, permisos y configs.
// Delega en los clientes OpenAPI generados (AuthService, IdentityService) y mapea los
// modelos readonly a las vistas planas que consumen los componentes.

import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import {
  AccessibleScientificApp,
  AppPermission,
  AuthService,
  EffectiveAppConfig,
  GroupAppConfig,
  GroupMembership,
  IdentityService,
  IdentityUserSummary,
  RegistrationToken,
  ScientificAppCatalog,
  UserAppConfig,
  WorkGroup,
} from './generated';

/** Roles de identidad disponibles en el dominio transversal. */
export type IdentityRole = 'root' | 'admin' | 'user';

export interface AccessibleScientificAppView {
  app_name: string;
  route_key: string;
  api_base_path: string;
  supports_pause_resume: boolean;
  /** Features opcionales declaradas por la app para habilitar/deshabilitar por grupo. */
  available_features: string[];
  enabled: boolean;
  group_permission: boolean | null;
  user_permission: boolean | null;
}

export interface ScientificAppCatalogItemView {
  plugin_name: string;
  route_key: string;
  api_base_path: string;
  supports_pause_resume: boolean;
  available_features: string[];
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
  role: IdentityRole;
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

export interface RegistrationTokenView {
  id: string;
  token: string;
  group: number;
  group_name: string;
  description: string;
  is_active: boolean;
  max_uses: number;
  use_count: number;
  expires_at: string | null;
  created_at: string;
}

export interface CreateRegistrationTokenPayload {
  group_id: number;
  description?: string;
  max_uses?: number;
  expires_at?: string | null;
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
  role: IdentityRole;
  account_status?: 'active' | 'inactive';
  primary_group_id?: number | null;
}

export interface UpdateIdentityUserPayload {
  email?: string;
  first_name?: string;
  last_name?: string;
  password?: string;
  role?: IdentityRole;
  account_status?: 'active' | 'inactive';
  primary_group_id?: number | null;
  is_active?: boolean;
  is_staff?: boolean;
}

/** Sin transferencia de caché: preserva el comportamiento previo del wrapper. */
const NO_TRANSFER_CACHE = { transferCache: false };

@Injectable({
  providedIn: 'root',
})
export class IdentityApiService {
  private readonly authClient = inject(AuthService);
  private readonly identityClient = inject(IdentityService);

  // ── Auth: apps y configuración del usuario actual ──────────────────

  /** Lista apps accesibles. Si se provee groupId, el acceso se evalúa estrictamente para ese grupo. */
  listAccessibleApps(groupId?: number): Observable<AccessibleScientificAppView[]> {
    return this.authClient
      .authAppsList(groupId, 'body', false, NO_TRANSFER_CACHE)
      .pipe(map((items) => items.map((raw) => this.mapAccessibleApp(raw))));
  }

  getCurrentAppConfig(appName: string): Observable<EffectiveAppConfigView> {
    return this.authClient
      .authAppConfigsRetrieve(appName, 'body', false, NO_TRANSFER_CACHE)
      .pipe(map((raw) => this.mapEffectiveAppConfig(raw)));
  }

  updateCurrentAppConfig(
    appName: string,
    config: Record<string, unknown>,
  ): Observable<{ id: number; user: number; app_name: string; config: Record<string, unknown> }> {
    return this.authClient
      .authAppConfigsPartialUpdate(appName, { config }, 'body', false, NO_TRANSFER_CACHE)
      .pipe(map((raw) => this.mapUserAppConfig(raw)));
  }

  // ── Usuarios ──────────────────────────────────────────────────────

  listUsers(): Observable<IdentityUserSummaryView[]> {
    return this.identityClient
      .identityUsersList('body', false, NO_TRANSFER_CACHE)
      .pipe(map((items) => items.map((raw) => this.mapUser(raw))));
  }

  createUser(payload: CreateIdentityUserPayload): Observable<IdentityUserSummaryView> {
    return this.identityClient
      .identityUsersCreate(payload, 'body', false, NO_TRANSFER_CACHE)
      .pipe(map((raw) => this.mapUser(raw)));
  }

  updateUser(
    userId: number,
    payload: UpdateIdentityUserPayload,
  ): Observable<IdentityUserSummaryView> {
    return this.identityClient
      .identityUsersPartialUpdate(userId, payload, 'body', false, NO_TRANSFER_CACHE)
      .pipe(map((raw) => this.mapUser(raw)));
  }

  deleteUser(userId: number): Observable<void> {
    return this.identityClient
      .identityUsersDestroy(userId, 'body', false, NO_TRANSFER_CACHE)
      .pipe(map(() => {}));
  }

  // ── Grupos ────────────────────────────────────────────────────────

  listGroups(): Observable<WorkGroupView[]> {
    return this.identityClient
      .identityGroupsList('body', false, NO_TRANSFER_CACHE)
      .pipe(map((items) => items.map((raw) => this.mapWorkGroup(raw))));
  }

  listScientificApps(): Observable<ScientificAppCatalogItemView[]> {
    return this.identityClient
      .identityScientificAppsList('body', false, NO_TRANSFER_CACHE)
      .pipe(map((items) => items.map((raw) => this.mapScientificAppCatalog(raw))));
  }

  createGroup(payload: {
    name: string;
    slug: string;
    description: string;
  }): Observable<WorkGroupView> {
    return this.identityClient
      .identityGroupsCreate(payload, 'body', false, NO_TRANSFER_CACHE)
      .pipe(map((raw) => this.mapWorkGroup(raw)));
  }

  updateGroup(
    groupId: number,
    payload: Partial<Pick<WorkGroupView, 'name' | 'slug' | 'description'>>,
  ): Observable<WorkGroupView> {
    return this.identityClient
      .identityGroupsPartialUpdate(groupId, payload, 'body', false, NO_TRANSFER_CACHE)
      .pipe(map((raw) => this.mapWorkGroup(raw)));
  }

  deleteGroup(groupId: number): Observable<void> {
    return this.identityClient
      .identityGroupsDestroy(groupId, 'body', false, NO_TRANSFER_CACHE)
      .pipe(map(() => {}));
  }

  // ── Membresías ────────────────────────────────────────────────────

  listMemberships(): Observable<GroupMembershipView[]> {
    return this.identityClient
      .identityMembershipsList('body', false, NO_TRANSFER_CACHE)
      .pipe(map((items) => items.map((raw) => this.mapGroupMembership(raw))));
  }

  createMembership(payload: {
    user: number;
    group: number;
    role_in_group: 'admin' | 'member';
  }): Observable<GroupMembershipView> {
    return this.identityClient
      .identityMembershipsCreate(payload, 'body', false, NO_TRANSFER_CACHE)
      .pipe(map((raw) => this.mapGroupMembership(raw)));
  }

  updateMembership(
    membershipId: number,
    payload: { role_in_group: 'admin' | 'member' },
  ): Observable<GroupMembershipView> {
    return this.identityClient
      .identityMembershipsPartialUpdate(membershipId, payload, 'body', false, NO_TRANSFER_CACHE)
      .pipe(map((raw) => this.mapGroupMembership(raw)));
  }

  deleteMembership(membershipId: number): Observable<void> {
    return this.identityClient
      .identityMembershipsDestroy(membershipId, 'body', false, NO_TRANSFER_CACHE)
      .pipe(map(() => {}));
  }

  // ── Permisos de app ───────────────────────────────────────────────

  listAppPermissions(): Observable<AppPermissionView[]> {
    return this.identityClient
      .identityAppPermissionsList('body', false, NO_TRANSFER_CACHE)
      .pipe(map((items) => items.map((raw) => this.mapAppPermission(raw))));
  }

  createAppPermission(payload: {
    app_name: string;
    group?: number | null;
    user?: number | null;
    is_enabled: boolean;
  }): Observable<AppPermissionView> {
    return this.identityClient
      .identityAppPermissionsCreate(payload, 'body', false, NO_TRANSFER_CACHE)
      .pipe(map((raw) => this.mapAppPermission(raw)));
  }

  updateAppPermission(
    permissionId: number,
    payload: { is_enabled: boolean },
  ): Observable<AppPermissionView> {
    return this.identityClient
      .identityAppPermissionsPartialUpdate(
        permissionId,
        payload,
        'body',
        false,
        NO_TRANSFER_CACHE,
      )
      .pipe(map((raw) => this.mapAppPermission(raw)));
  }

  deleteAppPermission(permissionId: number): Observable<void> {
    return this.identityClient
      .identityAppPermissionsDestroy(permissionId, 'body', false, NO_TRANSFER_CACHE)
      .pipe(map(() => {}));
  }

  // ── Configuración de app por grupo ────────────────────────────────

  getGroupAppConfig(groupId: number, appName: string): Observable<GroupAppConfigView> {
    // El generado invierte el orden de argumentos: (appName, groupId).
    return this.identityClient
      .identityGroupsAppConfigsRetrieve(appName, groupId, 'body', false, NO_TRANSFER_CACHE)
      .pipe(map((raw) => this.mapGroupAppConfig(raw)));
  }

  updateGroupAppConfig(
    groupId: number,
    appName: string,
    config: Record<string, unknown>,
  ): Observable<GroupAppConfigView> {
    // El generado invierte el orden de argumentos: (appName, groupId, body).
    return this.identityClient
      .identityGroupsAppConfigsPartialUpdate(
        appName,
        groupId,
        { config },
        'body',
        false,
        NO_TRANSFER_CACHE,
      )
      .pipe(map((raw) => this.mapGroupAppConfig(raw)));
  }

  // ── Registration Tokens ──────────────────────────────────────────

  listRegistrationTokens(): Observable<RegistrationTokenView[]> {
    return this.identityClient
      .identityRegistrationTokensList('body', false, NO_TRANSFER_CACHE)
      .pipe(map((items) => items.map((raw) => this.mapRegistrationToken(raw))));
  }

  createRegistrationToken(
    payload: CreateRegistrationTokenPayload,
  ): Observable<RegistrationTokenView> {
    return this.identityClient
      .identityRegistrationTokensCreate(payload, 'body', false, NO_TRANSFER_CACHE)
      .pipe(map((raw) => this.mapRegistrationToken(raw)));
  }

  revokeRegistrationToken(tokenId: string): Observable<void> {
    return this.identityClient
      .identityRegistrationTokensDestroy(tokenId, 'body', false, NO_TRANSFER_CACHE)
      .pipe(map(() => {}));
  }

  // ── Mappers privados (modelo generado → vista) ────────────────────

  private mapAccessibleApp(raw: AccessibleScientificApp): AccessibleScientificAppView {
    return {
      app_name: raw.app_name,
      route_key: raw.route_key,
      api_base_path: raw.api_base_path,
      supports_pause_resume: raw.supports_pause_resume,
      available_features: [...raw.available_features],
      enabled: raw.enabled,
      group_permission: raw.group_permission,
      user_permission: raw.user_permission,
    };
  }

  private mapEffectiveAppConfig(raw: EffectiveAppConfig): EffectiveAppConfigView {
    return {
      app_name: raw.app_name,
      enabled: raw.enabled,
      effective_config: (raw.effective_config ?? {}) as Record<string, unknown>,
      group_config: (raw.group_config ?? {}) as Record<string, unknown>,
      user_config: (raw.user_config ?? {}) as Record<string, unknown>,
    };
  }

  private mapUserAppConfig(
    raw: UserAppConfig,
  ): { id: number; user: number; app_name: string; config: Record<string, unknown> } {
    return {
      id: raw.id,
      user: raw.user,
      app_name: raw.app_name,
      config: (raw.config ?? {}) as Record<string, unknown>,
    };
  }

  private mapUser(raw: IdentityUserSummary): IdentityUserSummaryView {
    return {
      id: raw.id,
      username: raw.username,
      email: raw.email,
      first_name: raw.first_name,
      last_name: raw.last_name,
      is_active: raw.is_active,
      is_staff: raw.is_staff,
      is_superuser: raw.is_superuser,
      role: raw.role as IdentityRole,
      account_status: raw.account_status as 'active' | 'inactive',
      primary_group_id: raw.primary_group_id,
    };
  }

  private mapWorkGroup(raw: WorkGroup): WorkGroupView {
    return {
      id: raw.id,
      name: raw.name,
      slug: raw.slug,
      description: raw.description ?? '',
      created_by: raw.created_by,
      created_at: raw.created_at,
      updated_at: raw.updated_at,
    };
  }

  private mapScientificAppCatalog(raw: ScientificAppCatalog): ScientificAppCatalogItemView {
    return {
      plugin_name: raw.plugin_name,
      route_key: raw.route_key,
      api_base_path: raw.api_base_path,
      supports_pause_resume: raw.supports_pause_resume,
      available_features: [...raw.available_features],
    };
  }

  private mapGroupMembership(raw: GroupMembership): GroupMembershipView {
    return {
      id: raw.id,
      user: raw.user,
      group: raw.group,
      role_in_group: (raw.role_in_group ?? 'member') as 'admin' | 'member',
      joined_at: raw.joined_at,
    };
  }

  private mapAppPermission(raw: AppPermission): AppPermissionView {
    return {
      id: raw.id,
      app_name: raw.app_name,
      group: raw.group ?? null,
      user: raw.user ?? null,
      is_enabled: raw.is_enabled ?? true,
      created_at: raw.created_at,
      updated_at: raw.updated_at,
    };
  }

  private mapRegistrationToken(raw: RegistrationToken): RegistrationTokenView {
    return {
      id: raw.id,
      token: raw.token,
      group: raw.group,
      group_name: raw.group_name,
      description: raw.description ?? '',
      is_active: raw.is_active ?? true,
      max_uses: raw.max_uses ?? 0,
      use_count: raw.use_count,
      expires_at: raw.expires_at ?? null,
      created_at: raw.created_at,
    };
  }

  private mapGroupAppConfig(raw: GroupAppConfig): GroupAppConfigView {
    return {
      id: raw.id,
      group: raw.group,
      app_name: raw.app_name,
      config: (raw.config ?? {}) as Record<string, unknown>,
      updated_at: raw.updated_at,
    };
  }
}
