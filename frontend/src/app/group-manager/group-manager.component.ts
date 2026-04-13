// group-manager.component.ts: Página de administración de grupos científicos.
// Permite ver, crear y gestionar grupos, así como sus miembros y permisos de apps.

import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
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
  readonly expandedGroupId = signal<number | null>(null);

  /** Todas las keys de apps científicas disponibles en el sistema. */
  readonly availableAppKeys = SCIENTIFIC_APP_ROUTE_ITEMS.map((item) => item.key);

  /** IDs de grupos que el usuario actual puede administrar. */
  readonly managedGroupIds = computed<number[]>(() => {
    if (this.sessionService.hasRootAccess()) {
      return this.groups().map((g) => g.id);
    }
    const currentUser = this.sessionService.currentUser();
    if (currentUser === null) return [];
    return this.memberships()
      .filter((m) => m.user === currentUser.id && m.role_in_group === 'admin')
      .map((m) => m.group);
  });

  /** Grupos visibles para el usuario (root ve todos, admin ve los suyos). */
  readonly visibleGroups = computed<WorkGroupView[]>(() => {
    if (this.sessionService.hasRootAccess()) return this.groups();
    const managed = this.managedGroupIds();
    return this.groups().filter((g) => managed.includes(g.id));
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
    }).subscribe({
      next: ({ groups, users, memberships, appPermissions }) => {
        this.groups.set(groups);
        this.users.set(users);
        this.memberships.set(memberships);
        this.appPermissions.set(appPermissions);
        this.isLoading.set(false);
      },
      error: () => {
        this.errorMessage.set('Error al cargar los grupos. Intente nuevamente.');
        this.isLoading.set(false);
      },
    });
  }

  toggleExpand(groupId: number): void {
    this.expandedGroupId.update((current) => (current === groupId ? null : groupId));
  }

  membershipsForGroup(groupId: number): GroupMembershipView[] {
    return this.memberships().filter((m) => m.group === groupId);
  }

  permissionsForGroup(groupId: number): AppPermissionView[] {
    return this.appPermissions().filter((p) => p.group === groupId && p.user === null);
  }

  userName(userId: number): string {
    return this.users().find((u) => u.id === userId)?.username ?? String(userId);
  }

  appPermissionEnabled(groupId: number, appKey: string): boolean {
    const perm = this.appPermissions().find(
      (p) => p.group === groupId && p.app_name === appKey && p.user === null,
    );
    // Sin regla explícita: habilitado por defecto (comportamiento de autorización_service.py)
    return perm?.is_enabled ?? true;
  }

  submitCreateGroup(): void {
    const form = this.createGroupForm();
    if (!form.name.trim() || !form.slug.trim()) return;
    this.isSubmitting.set(true);
    this.identityApiService.createGroup(form).subscribe({
      next: (newGroup) => {
        this.groups.update((list) => [...list, newGroup]);
        this.createGroupForm.set({ name: '', slug: '', description: '' });
        this.successMessage.set(`Grupo "${newGroup.name}" creado correctamente.`);
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

  toggleAppPermission(groupId: number, appKey: string): void {
    const existing = this.appPermissions().find(
      (p) => p.group === groupId && p.app_name === appKey && p.user === null,
    );
    if (existing === undefined) {
      this.identityApiService
        .createAppPermission({ app_name: appKey, group: groupId, is_enabled: true })
        .subscribe({
          next: (created) => {
            this.appPermissions.update((list) => [...list, created]);
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
        });
    }
  }

  deleteGroup(groupId: number): void {
    if (!confirm('¿Seguro que deseas eliminar este grupo? Esta acción es irreversible.')) return;
    this.identityApiService.deleteGroup(groupId).subscribe({
      next: () => {
        this.groups.update((list) => list.filter((g) => g.id !== groupId));
        if (this.expandedGroupId() === groupId) this.expandedGroupId.set(null);
        this.successMessage.set('Grupo eliminado correctamente.');
      },
      error: () => this.errorMessage.set('Error al eliminar el grupo.'),
    });
  }
}
