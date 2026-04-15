// group-manager.component.ts: Página de administración de grupos científicos.
// Permite ver, crear y gestionar grupos, así como sus miembros y permisos de apps.

import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { forkJoin, switchMap } from 'rxjs';
import {
  AppPermissionView,
  GroupMembershipView,
  IdentityApiService,
  IdentityUserSummaryView,
  ScientificAppCatalogItemView,
  WorkGroupView,
} from '../core/api/identity-api.service';
import { IdentitySessionService } from '../core/auth/identity-session.service';
import {
  findScientificAppRouteItemByRouteKey,
  type ScientificAppRouteItem,
} from '../core/shared/scientific-apps.config';

type GroupRoleOption = 'admin' | 'member';

interface CreateGroupForm {
  name: string;
  slug: string;
  description: string;
}

interface AddMemberForm {
  userId: string;
  roleInGroup: GroupRoleOption;
}

@Component({
  selector: 'app-group-manager',
  imports: [CommonModule, FormsModule, TranslocoPipe],
  templateUrl: './group-manager.component.html',
  styleUrl: './group-manager.component.scss',
})
export class GroupManagerComponent implements OnInit {
  readonly sessionService = inject(IdentitySessionService);
  private readonly identityApiService = inject(IdentityApiService);

  readonly isLoading = signal<boolean>(true);
  readonly isSubmitting = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly groups = signal<WorkGroupView[]>([]);
  readonly users = signal<IdentityUserSummaryView[]>([]);
  readonly memberships = signal<GroupMembershipView[]>([]);
  readonly appPermissions = signal<AppPermissionView[]>([]);
  readonly scientificApps = signal<ScientificAppCatalogItemView[]>([]);
  readonly expandedGroupId = signal<number | null>(null);
  readonly groupFilterId = signal<string>('');
  readonly groupSearchQuery = signal<string>('');
  readonly memberSearchQuery = signal<string>('');

  /** IDs de grupos que el usuario actual puede administrar. */
  readonly managedGroupIds = computed<number[]>(() => {
    return this.sessionService.resolveManagedGroupIds(this.groups(), this.memberships());
  });

  /** Grupos visibles para el usuario (root ve todos, admin ve los suyos). */
  readonly visibleGroups = computed<WorkGroupView[]>(() => {
    return this.sessionService.resolveVisibleGroups(this.groups(), this.managedGroupIds());
  });

  /** Grupos visibles tras aplicar filtro rápido y selector de contexto administrativo. */
  readonly filteredGroups = computed<WorkGroupView[]>(() => {
    const normalizedSearch = this.groupSearchQuery().trim().toLocaleLowerCase();
    const selectedGroupId = this.groupFilterId();

    return this.visibleGroups().filter((groupItem) => {
      const matchesSelectedGroup =
        selectedGroupId === '' || groupItem.id === Number.parseInt(selectedGroupId, 10);
      if (!matchesSelectedGroup) {
        return false;
      }

      if (normalizedSearch === '') {
        return true;
      }

      return this._groupMatchesSearch(groupItem, normalizedSearch);
    });
  });

  readonly createGroupForm = signal<CreateGroupForm>({ name: '', slug: '', description: '' });
  readonly addMemberForm = signal<AddMemberForm>({ userId: '', roleInGroup: 'member' });

  ngOnInit(): void {
    this.loadData();
  }

  loadData(): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);
    forkJoin({
      groups: this.identityApiService.listGroups(),
      users: this.identityApiService.listUsers(),
      memberships: this.identityApiService.listMemberships(),
      appPermissions: this.identityApiService.listAppPermissions(),
      scientificApps: this.identityApiService.listScientificApps(),
    }).subscribe({
      next: ({ groups, users, memberships, appPermissions, scientificApps }) => {
        this.groups.set(groups);
        this.users.set(users);
        this.memberships.set(memberships);
        this.appPermissions.set(appPermissions);
        this.scientificApps.set(scientificApps);
        this.sessionService.setKnownGroups(groups);
        this.isLoading.set(false);
      },
      error: () => {
        this.errorMessage.set('Error al cargar los grupos. Intente nuevamente.');
        this.isLoading.set(false);
      },
    });
  }

  toggleExpand(groupId: number): void {
    this.memberSearchQuery.set('');
    this.expandedGroupId.update((current) => (current === groupId ? null : groupId));
  }

  membershipsForGroup(groupId: number): GroupMembershipView[] {
    return this.memberships().filter((m) => m.group === groupId);
  }

  visibleMembershipsForGroup(groupId: number): GroupMembershipView[] {
    const normalizedSearch = this.memberSearchQuery().trim().toLocaleLowerCase();
    const membershipsForGroup = this.membershipsForGroup(groupId);

    if (normalizedSearch === '') {
      return membershipsForGroup;
    }

    return membershipsForGroup.filter((membershipItem) => {
      const userItem = this.users().find((candidate) => candidate.id === membershipItem.user);
      return userItem !== undefined && this._userMatchesSearch(userItem, normalizedSearch);
    });
  }

  permissionsForGroup(groupId: number): AppPermissionView[] {
    return this.appPermissions().filter((p) => p.group === groupId && p.user === null);
  }

  userName(userId: number): string {
    return this.users().find((u) => u.id === userId)?.username ?? String(userId);
  }

  availableUsersForGroup(groupId: number): IdentityUserSummaryView[] {
    const normalizedSearch = this.memberSearchQuery().trim().toLocaleLowerCase();
    const assignedUserIds = new Set(
      this.membershipsForGroup(groupId).map((membership) => membership.user),
    );

    return this.users().filter((userItem) => {
      if (assignedUserIds.has(userItem.id)) {
        return false;
      }

      if (normalizedSearch === '') {
        return true;
      }

      return this._userMatchesSearch(userItem, normalizedSearch);
    });
  }

  appPermissionEnabled(groupId: number, pluginName: string): boolean {
    const perm = this.appPermissions().find(
      (p) => p.group === groupId && p.app_name === pluginName && p.user === null,
    );
    // Sin regla explícita: denegado por defecto hasta que exista una regla del grupo.
    return perm?.is_enabled ?? false;
  }

  appLabel(appItem: ScientificAppCatalogItemView): string {
    return this._resolvePresentationApp(appItem)?.title ?? appItem.route_key;
  }

  appTestIdKey(appItem: ScientificAppCatalogItemView): string {
    return appItem.route_key;
  }

  submitCreateGroup(): void {
    const form = this.createGroupForm();
    if (!form.name.trim() || !form.slug.trim()) return;
    this.isSubmitting.set(true);
    this.identityApiService.createGroup(form).subscribe({
      next: (newGroup) => {
        this.createGroupForm.set({ name: '', slug: '', description: '' });
        this.successMessage.set(`Grupo "${newGroup.name}" creado correctamente.`);
        this.loadData();
        this.isSubmitting.set(false);
      },
      error: () => {
        this.errorMessage.set('Error al crear el grupo. Verifique que el slug sea único.');
        this.isSubmitting.set(false);
      },
    });
  }

  addMember(groupId: number): void {
    const form = this.addMemberForm();
    if (!form.userId) return;
    this.isSubmitting.set(true);
    this.identityApiService
      .createMembership({
        user: Number(form.userId),
        group: groupId,
        role_in_group: form.roleInGroup,
      })
      .subscribe({
        next: (created) => {
          this.memberships.update((list) => [...list, created]);
          this.addMemberForm.set({ userId: '', roleInGroup: 'member' });
          this.successMessage.set('Miembro añadido correctamente.');
          this.isSubmitting.set(false);
        },
        error: () => {
          this.errorMessage.set('Error al añadir miembro. Puede que ya pertenezca al grupo.');
          this.isSubmitting.set(false);
        },
      });
  }

  removeMember(membershipId: number): void {
    this.isSubmitting.set(true);
    this.identityApiService.deleteMembership(membershipId).subscribe({
      next: () => {
        this.memberships.update((list) => list.filter((m) => m.id !== membershipId));
        this.successMessage.set('Miembro eliminado del grupo.');
        this.isSubmitting.set(false);
      },
      error: (err: { error?: { detail?: string } }) => {
        this.errorMessage.set(err?.error?.detail ?? 'Error al eliminar miembro.');
        this.isSubmitting.set(false);
      },
    });
  }

  updateMemberRole(membershipId: number, role: GroupRoleOption): void {
    this.identityApiService.updateMembership(membershipId, { role_in_group: role }).subscribe({
      next: (updated) => {
        this.memberships.update((list) => list.map((m) => (m.id === membershipId ? updated : m)));
      },
    });
  }

  toggleAppPermission(groupId: number, pluginName: string): void {
    const existing = this.appPermissions().find(
      (p) => p.group === groupId && p.app_name === pluginName && p.user === null,
    );
    if (existing === undefined) {
      this.identityApiService
        .createAppPermission({ app_name: pluginName, group: groupId, is_enabled: true })
        .subscribe({
          next: (created) => {
            this.appPermissions.update((list) => [...list, created]);
          },
          error: (err: { error?: { detail?: string } }) => {
            this.errorMessage.set(err?.error?.detail ?? 'Error al crear el permiso de app.');
          },
        });
    } else {
      this.identityApiService
        .updateAppPermission(existing.id, { is_enabled: !existing.is_enabled })
        .subscribe({
          next: (updated) => {
            this.appPermissions.update((list) =>
              list.map((p) => (p.id === existing.id ? updated : p)),
            );
          },
          error: (err: { error?: { detail?: string } }) => {
            this.errorMessage.set(err?.error?.detail ?? 'Error al actualizar el permiso de app.');
          },
        });
    }
  }

  private _resolvePresentationApp(
    appItem: ScientificAppCatalogItemView,
  ): ScientificAppRouteItem | undefined {
    return findScientificAppRouteItemByRouteKey(appItem.route_key);
  }

  deleteGroup(groupId: number): void {
    if (!confirm('¿Seguro que deseas eliminar este grupo? Esta acción es irreversible.')) return;
    this.isSubmitting.set(true);
    this.identityApiService
      .deleteGroup(groupId)
      .pipe(switchMap(() => this.sessionService.reloadSessionData()))
      .subscribe({
        next: () => {
          if (this.expandedGroupId() === groupId) this.expandedGroupId.set(null);
          this.successMessage.set('Grupo eliminado correctamente.');
          this.loadData();
          this.isSubmitting.set(false);
        },
        error: (err: { error?: { detail?: string } }) => {
          this.errorMessage.set(err?.error?.detail ?? 'Error al eliminar el grupo.');
          this.isSubmitting.set(false);
        },
      });
  }

  private _groupMatchesSearch(group: WorkGroupView, normalizedSearch: string): boolean {
    return [group.name, group.slug, group.description]
      .join(' ')
      .toLocaleLowerCase()
      .includes(normalizedSearch);
  }

  private _userMatchesSearch(userItem: IdentityUserSummaryView, normalizedSearch: string): boolean {
    return [userItem.username, userItem.email, userItem.first_name, userItem.last_name]
      .join(' ')
      .toLocaleLowerCase()
      .includes(normalizedSearch);
  }
}
