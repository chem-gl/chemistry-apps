// user-manager.component.ts: Página de administración de usuarios y membresías.
// Permite listar, crear y gestionar cuentas de usuario y sus asignaciones a grupos.

import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { forkJoin } from 'rxjs';
import {
  CreateIdentityUserPayload,
  GroupMembershipView,
  IdentityApiService,
  IdentityRole,
  IdentityUserSummaryView,
  WorkGroupView,
} from '../core/api/identity-api.service';
import { IdentitySessionService } from '../core/auth/identity-session.service';

interface CreateUserForm {
  username: string;
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  role: IdentityRole;
  primary_group_id: string;
}

interface AddMembershipForm {
  userId: string;
  groupId: string;
  roleInGroup: 'admin' | 'member';
}

@Component({
  selector: 'app-user-manager',
  imports: [CommonModule, FormsModule, TranslocoPipe],
  templateUrl: './user-manager.component.html',
  styleUrl: './user-manager.component.scss',
})
export class UserManagerComponent implements OnInit {
  readonly sessionService = inject(IdentitySessionService);
  private readonly identityApiService = inject(IdentityApiService);

  readonly isLoading = signal<boolean>(true);
  readonly isSubmitting = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly users = signal<IdentityUserSummaryView[]>([]);
  readonly groups = signal<WorkGroupView[]>([]);
  readonly memberships = signal<GroupMembershipView[]>([]);
  readonly filterGroupId = signal<string>('');

  /** IDs de grupos manejados por el usuario actual (root ve todos). */
  readonly managedGroupIds = computed<number[]>(() => {
    return this.sessionService.resolveManagedGroupIds(this.groups(), this.memberships());
  });

  /** Grupos visibles para el selector de filtro. */
  readonly visibleGroups = computed<WorkGroupView[]>(() => {
    return this.sessionService.resolveVisibleGroups(this.groups(), this.managedGroupIds());
  });

  /** Usuarios visibles según rol y filtro de grupo activo. */
  readonly visibleUsers = computed<IdentityUserSummaryView[]>(() => {
    const groupFilter = this.filterGroupId();

    // Root y admin ven todos los usuarios cuando no aplican filtro explícito.
    if (this.sessionService.hasAdminAccess() && groupFilter === '') {
      return this.users();
    }

    const targetGroupIds = groupFilter ? [Number(groupFilter)] : this.managedGroupIds();
    if (targetGroupIds.length === 0) {
      return this.users();
    }

    const usersInGroups = new Set(
      this.memberships()
        .filter((membershipItem) => targetGroupIds.includes(membershipItem.group))
        .map((membershipItem) => membershipItem.user),
    );

    return this.users().filter((userItem) => usersInGroups.has(userItem.id));
  });

  readonly createUserForm = signal<CreateUserForm>({
    username: '',
    email: '',
    password: '',
    first_name: '',
    last_name: '',
    role: 'user',
    primary_group_id: '',
  });

  readonly addMembershipForm = signal<AddMembershipForm>({
    userId: '',
    groupId: '',
    roleInGroup: 'member',
  });

  ngOnInit(): void {
    this.loadData();
  }

  loadData(): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);
    forkJoin({
      users: this.identityApiService.listUsers(),
      groups: this.identityApiService.listGroups(),
      memberships: this.identityApiService.listMemberships(),
    }).subscribe({
      next: ({ users, groups, memberships }) => {
        this.users.set(users);
        this.groups.set(groups);
        this.memberships.set(memberships);
        this.isLoading.set(false);
      },
      error: () => {
        this.errorMessage.set('Error al cargar los datos de usuarios.');
        this.isLoading.set(false);
      },
    });
  }

  groupName(groupId: number): string {
    return this.groups().find((g) => g.id === groupId)?.name ?? String(groupId);
  }

  membershipsForUser(userId: number): GroupMembershipView[] {
    return this.memberships().filter((m) => m.user === userId);
  }

  submitCreateUser(): void {
    const form = this.createUserForm();
    if (
      !form.username.trim() ||
      !form.email.trim() ||
      !form.password.trim() ||
      !form.primary_group_id
    ) {
      this.errorMessage.set('Debe seleccionar un grupo primario para el usuario.');
      return;
    }
    this.isSubmitting.set(true);
    const payload: CreateIdentityUserPayload = {
      username: form.username,
      email: form.email,
      password: form.password,
      first_name: form.first_name,
      last_name: form.last_name,
      role: form.role,
      primary_group_id: form.primary_group_id ? Number(form.primary_group_id) : null,
    };
    this.identityApiService.createUser(payload).subscribe({
      next: (newUser) => {
        this.createUserForm.set({
          username: '',
          email: '',
          password: '',
          first_name: '',
          last_name: '',
          role: 'user',
          primary_group_id: '',
        });
        this.successMessage.set(`Usuario "${newUser.username}" creado correctamente.`);
        this.loadData();
        this.isSubmitting.set(false);
      },
      error: (err: { error?: { detail?: string; username?: string[] } }) => {
        const detail =
          err?.error?.detail ?? err?.error?.username?.[0] ?? 'Error al crear el usuario.';
        this.errorMessage.set(detail);
        this.isSubmitting.set(false);
      },
    });
  }

  toggleUserStatus(user: IdentityUserSummaryView): void {
    this.identityApiService.updateUser(user.id, { is_active: !user.is_active }).subscribe({
      next: (updated) => {
        this.users.update((list) => list.map((u) => (u.id === updated.id ? updated : u)));
      },
    });
  }

  changeUserRole(user: IdentityUserSummaryView, role: IdentityRole): void {
    this.identityApiService.updateUser(user.id, { role }).subscribe({
      next: (updated) => {
        this.users.update((list) => list.map((u) => (u.id === updated.id ? updated : u)));
      },
    });
  }

  submitAddMembership(): void {
    const form = this.addMembershipForm();
    if (!form.userId || !form.groupId) return;
    this.isSubmitting.set(true);
    this.identityApiService
      .createMembership({
        user: Number(form.userId),
        group: Number(form.groupId),
        role_in_group: form.roleInGroup,
      })
      .subscribe({
        next: (created) => {
          this.memberships.update((list) => [...list, created]);
          this.addMembershipForm.set({ userId: '', groupId: '', roleInGroup: 'member' });
          this.successMessage.set('Membresía añadida correctamente.');
          this.loadData();
          this.isSubmitting.set(false);
        },
        error: () => {
          this.errorMessage.set('Error al añadir membresía. Puede que ya exista.');
          this.isSubmitting.set(false);
        },
      });
  }

  removeMembership(membershipId: number): void {
    this.identityApiService.deleteMembership(membershipId).subscribe({
      next: () => {
        this.memberships.update((list) => list.filter((m) => m.id !== membershipId));
        this.successMessage.set('Membresía eliminada.');
        this.loadData();
      },
      error: (err: { error?: { detail?: string } }) => {
        this.errorMessage.set(err?.error?.detail ?? 'Error al eliminar membresía.');
      },
    });
  }
}
