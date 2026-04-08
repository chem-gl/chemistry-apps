// identity-admin.component.ts: Consola administrativa mínima para usuarios, grupos y permisos.

import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import {
    AppPermissionView,
    GroupMembershipView,
    IdentityApiService,
    IdentityUserSummaryView,
    WorkGroupView,
} from '../core/api/identity-api.service';
import { IdentitySessionService } from '../core/auth/identity-session.service';
import { SCIENTIFIC_APP_ROUTE_ITEMS } from '../core/shared/scientific-apps.config';

type GroupRoleOption = 'admin' | 'member';
type IdentityRoleOption = 'root' | 'admin' | 'user';

@Component({
  selector: 'app-identity-admin',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './identity-admin.component.html',
  styleUrl: './identity-admin.component.scss',
})
export class IdentityAdminComponent implements OnInit {
  readonly sessionService = inject(IdentitySessionService);
  private readonly identityApiService = inject(IdentityApiService);

  readonly isLoading = signal<boolean>(true);
  readonly isSubmitting = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly users = signal<IdentityUserSummaryView[]>([]);
  readonly groups = signal<WorkGroupView[]>([]);
  readonly memberships = signal<GroupMembershipView[]>([]);
  readonly appPermissions = signal<AppPermissionView[]>([]);

  readonly availableAppKeys = SCIENTIFIC_APP_ROUTE_ITEMS.map((appItem) => appItem.key);
  readonly managedGroupIds = computed(() => {
    if (this.sessionService.hasRootAccess()) {
      return this.groups().map((groupItem) => groupItem.id);
    }

    const currentUser = this.sessionService.currentUser();
    if (currentUser === null) {
      return [];
    }

    return this.memberships()
      .filter(
        (membershipItem) =>
          membershipItem.user === currentUser.id && membershipItem.role_in_group === 'admin',
      )
      .map((membershipItem) => membershipItem.group);
  });

  readonly createUserForm = signal({
    username: '',
    email: '',
    password: '',
    first_name: '',
    last_name: '',
    role: 'user' as IdentityRoleOption,
    primary_group_id: '',
  });

  readonly createGroupForm = signal({
    name: '',
    slug: '',
    description: '',
  });

  readonly membershipForm = signal({
    user: '',
    group: '',
    role_in_group: 'member' as GroupRoleOption,
  });

  readonly permissionForm = signal({
    app_name: this.availableAppKeys[0] ?? 'molar-fractions',
    target_scope: 'group' as 'group' | 'user',
    target_id: '',
    is_enabled: true,
  });

  readonly groupConfigForm = signal({
    group_id: '',
    app_name: this.availableAppKeys[0] ?? 'molar-fractions',
    config_json: '{\n  "enabled": true\n}',
  });

  ngOnInit(): void {
    this.sessionService.initializeSession().subscribe({
      next: (isAuthenticated: boolean) => {
        if (!isAuthenticated) {
          this.isLoading.set(false);
          return;
        }
        this.loadAdminData();
      },
      error: (loadError: { message?: string }) => {
        this.errorMessage.set(loadError.message ?? 'Unable to initialize identity console.');
        this.isLoading.set(false);
      },
    });
  }

  loadAdminData(): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    forkJoin({
      users: this.identityApiService.listUsers(),
      groups: this.identityApiService.listGroups(),
      memberships: this.identityApiService.listMemberships(),
      appPermissions: this.identityApiService.listAppPermissions(),
    }).subscribe({
      next: ({ appPermissions, groups, memberships, users }) => {
        this.users.set(users);
        this.groups.set(groups);
        this.memberships.set(memberships);
        this.appPermissions.set(appPermissions);
        this.isLoading.set(false);
      },
      error: (loadError: { message?: string }) => {
        this.errorMessage.set(loadError.message ?? 'Unable to load identity data.');
        this.isLoading.set(false);
      },
    });
  }

  setCreateUserField(fieldName: keyof ReturnType<typeof this.createUserForm>, value: string): void {
    this.createUserForm.update((currentValue) => ({ ...currentValue, [fieldName]: value }));
  }

  setCreateGroupField(
    fieldName: keyof ReturnType<typeof this.createGroupForm>,
    value: string,
  ): void {
    this.createGroupForm.update((currentValue) => ({ ...currentValue, [fieldName]: value }));
  }

  setMembershipField(
    fieldName: keyof ReturnType<typeof this.membershipForm>,
    value: string,
  ): void {
    this.membershipForm.update((currentValue) => ({ ...currentValue, [fieldName]: value }));
  }

  setPermissionField(
    fieldName: keyof ReturnType<typeof this.permissionForm>,
    value: string | boolean,
  ): void {
    this.permissionForm.update((currentValue) => ({ ...currentValue, [fieldName]: value }));
  }

  setGroupConfigField(
    fieldName: keyof ReturnType<typeof this.groupConfigForm>,
    value: string,
  ): void {
    this.groupConfigForm.update((currentValue) => ({ ...currentValue, [fieldName]: value }));
  }

  createUser(): void {
    const formValue = this.createUserForm();
    this.runMutation(
      this.identityApiService.createUser({
        username: formValue.username,
        email: formValue.email,
        password: formValue.password,
        first_name: formValue.first_name,
        last_name: formValue.last_name,
        role: formValue.role,
        primary_group_id: formValue.primary_group_id === '' ? null : Number(formValue.primary_group_id),
      }),
      'User created successfully.',
      () => {
        this.createUserForm.set({
          username: '',
          email: '',
          password: '',
          first_name: '',
          last_name: '',
          role: 'user',
          primary_group_id: '',
        });
      },
    );
  }

  createGroup(): void {
    const formValue = this.createGroupForm();
    this.runMutation(
      this.identityApiService.createGroup(formValue),
      'Group created successfully.',
      () => {
        this.createGroupForm.set({
          name: '',
          slug: '',
          description: '',
        });
      },
    );
  }

  createMembership(): void {
    const formValue = this.membershipForm();
    this.runMutation(
      this.identityApiService.createMembership({
        user: Number(formValue.user),
        group: Number(formValue.group),
        role_in_group: formValue.role_in_group,
      }),
      'Membership created successfully.',
      () => {
        this.membershipForm.set({ user: '', group: '', role_in_group: 'member' });
      },
    );
  }

  createPermission(): void {
    const formValue = this.permissionForm();
    const targetId = Number(formValue.target_id);

    this.runMutation(
      this.identityApiService.createAppPermission({
        app_name: formValue.app_name,
        group: formValue.target_scope === 'group' ? targetId : null,
        user: formValue.target_scope === 'user' ? targetId : null,
        is_enabled: formValue.is_enabled,
      }),
      'App permission stored successfully.',
    );
  }

  saveGroupConfig(): void {
    const formValue = this.groupConfigForm();
    let parsedConfig: Record<string, unknown>;

    try {
      parsedConfig = JSON.parse(formValue.config_json) as Record<string, unknown>;
    } catch {
      this.errorMessage.set('Group config must be valid JSON.');
      return;
    }

    this.runMutation(
      this.identityApiService.updateGroupAppConfig(
        Number(formValue.group_id),
        formValue.app_name,
        parsedConfig,
      ),
      'Group app config updated successfully.',
    );
  }

  toggleUserStatus(userItem: IdentityUserSummaryView): void {
    this.runMutation(
      this.identityApiService.updateUser(userItem.id, {
        is_active: !userItem.is_active,
        account_status: userItem.is_active ? 'inactive' : 'active',
      }),
      `User ${userItem.username} updated successfully.`,
    );
  }

  changeUserRole(userItem: IdentityUserSummaryView, nextRole: IdentityRoleOption): void {
    this.runMutation(
      this.identityApiService.updateUser(userItem.id, { role: nextRole }),
      `Role updated for ${userItem.username}.`,
    );
  }

  groupName(groupId: number): string {
    return this.groups().find((groupItem) => groupItem.id === groupId)?.name ?? `Group #${groupId}`;
  }

  username(userId: number): string {
    return this.users().find((userItem) => userItem.id === userId)?.username ?? `User #${userId}`;
  }

  canManageGroup(groupId: number): boolean {
    return this.sessionService.hasRootAccess() || this.managedGroupIds().includes(groupId);
  }

  private runMutation(
    request$: { subscribe: (handlers: { next?: () => void; error?: (error: { message?: string }) => void }) => void },
    successMessage: string,
    onSuccess?: () => void,
  ): void {
    this.isSubmitting.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    request$.subscribe({
      next: () => {
        onSuccess?.();
        this.successMessage.set(successMessage);
        this.isSubmitting.set(false);
        this.loadAdminData();
      },
      error: (mutationError: { message?: string }) => {
        this.errorMessage.set(mutationError.message ?? 'Unable to persist the requested change.');
        this.isSubmitting.set(false);
      },
    });
  }
}
