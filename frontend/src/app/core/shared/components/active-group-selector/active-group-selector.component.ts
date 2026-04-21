// active-group-selector.component.ts: Selector de grupo activo para la barra de navegación.
// Permite al usuario elegir con qué grupo está trabajando en este momento.

import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { UserMembershipSummary } from '../../../api/auth-api.service';
import { IdentitySessionService } from '../../../auth/identity-session.service';

/** Opción de grupo en el selector, incluyendo la opción especial de modo root. */
interface GroupSelectorOption {
  id: number | null;
  label: string;
  sublabel: string;
  isRootOption: boolean;
}

@Component({
  selector: 'app-active-group-selector',
  imports: [CommonModule],
  templateUrl: './active-group-selector.component.html',
  styleUrl: './active-group-selector.component.scss',
})
export class ActiveGroupSelectorComponent {
  readonly sessionService = inject(IdentitySessionService);

  private readonly _isOpen = signal<boolean>(false);
  readonly isDropdownOpen = this._isOpen.asReadonly();

  /** El selector solo es visible si hay más de un grupo o si el usuario es root. */
  readonly isVisible = computed(() => {
    if (!this.sessionService.isAuthenticated()) {
      return false;
    }

    if (this.sessionService.hasRootAccess()) {
      return true;
    }

    return this.sessionService.userMemberships().length > 1;
  });

  /** Opciones de grupo disponibles para el usuario. Root tiene opción extra "Modo root". */
  readonly groupOptions = computed<GroupSelectorOption[]>(() => {
    const memberships = this.sessionService.userMemberships();
    const baseOptions: GroupSelectorOption[] = memberships.map((m: UserMembershipSummary) => ({
      id: m.group_id,
      label: m.group_name,
      sublabel: m.role_in_group === 'admin' ? 'Administrador' : 'Miembro',
      isRootOption: false,
    }));

    if (this.sessionService.hasRootAccess()) {
      const knownGroups = this.sessionService.knownGroups();
      return [
        {
          id: null,
          label: 'Modo root',
          sublabel: 'Ver y crear en todos los grupos',
          isRootOption: true,
        },
        ...knownGroups.map((groupItem) => {
          const explicitMembership = memberships.find((item) => item.group_id === groupItem.id);

          return {
            id: groupItem.id,
            label: groupItem.name,
            sublabel: this._resolveRootGroupSublabel(explicitMembership),
            isRootOption: false,
          };
        }),
      ];
    }

    return baseOptions;
  });

  /** Etiqueta del grupo activo para mostrar en el botón del selector. */
  readonly activeGroupLabel = computed(() => {
    if (this.sessionService.hasRootAccess() && this.sessionService.isRootViewContext()) {
      return 'Root';
    }

    const context = this.sessionService.activeGroupContext();
    if (context === null) {
      return 'Sin grupo';
    }

    return context.groupName;
  });

  toggleDropdown(): void {
    this._isOpen.update((current) => !current);
  }

  closeDropdown(): void {
    this._isOpen.set(false);
  }

  selectOption(option: GroupSelectorOption): void {
    if (option.isRootOption) {
      this.sessionService.setRootViewContext(true);
      this.sessionService.setActiveGroup(null);
    } else {
      this.sessionService.setRootViewContext(false);
      if (option.id !== null) {
        this.sessionService.setActiveGroup(option.id);
      }
    }

    this.closeDropdown();
  }

  isSelected(option: GroupSelectorOption): boolean {
    if (option.isRootOption) {
      return this.sessionService.hasRootAccess() && this.sessionService.isRootViewContext();
    }

    return option.id === this.sessionService.activeGroupId();
  }

  private _resolveRootGroupSublabel(membership: UserMembershipSummary | undefined): string {
    if (membership?.role_in_group === 'admin') {
      return 'Administrador explícito';
    }

    if (membership?.role_in_group === 'member') {
      return 'Miembro explícito';
    }

    return 'Administración root';
  }
}
