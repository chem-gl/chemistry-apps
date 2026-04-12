// profile.component.ts: Gestión de perfil personal para usuario, admin y root.
// Permite actualizar nombre, email y contraseña usando el endpoint de identidad.

import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { IdentityApiService } from '../core/api/identity-api.service';
import { IdentitySessionService } from '../core/auth/identity-session.service';

@Component({
  selector: 'app-profile',
  imports: [CommonModule, FormsModule, TranslocoPipe],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.scss',
})
export class ProfileComponent implements OnInit {
  private readonly identityApiService = inject(IdentityApiService);
  private readonly translocoService = inject(TranslocoService);
  readonly sessionService = inject(IdentitySessionService);

  readonly isSubmitting = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  readonly formState = signal({
    first_name: '',
    last_name: '',
    email: '',
    password: '',
    password_confirmation: '',
  });

  readonly hasPasswordInput = computed(() => this.formState().password.trim() !== '');

  ngOnInit(): void {
    this.sessionService.initializeSession().subscribe({
      next: () => {
        const currentUser = this.sessionService.currentUser();
        if (currentUser === null) {
          return;
        }

        this.formState.set({
          first_name: currentUser.first_name,
          last_name: currentUser.last_name,
          email: currentUser.email,
          password: '',
          password_confirmation: '',
        });
      },
      error: () => {
        this.errorMessage.set(
          this.translocoService.translate('profile.errors.unableToInitializeProfile'),
        );
      },
    });
  }

  setField(fieldName: keyof ReturnType<typeof this.formState>, nextValue: string): void {
    this.formState.update((currentValue) => ({ ...currentValue, [fieldName]: nextValue }));
  }

  saveProfile(): void {
    const currentUser = this.sessionService.currentUser();
    if (currentUser === null) {
      this.errorMessage.set(this.translocoService.translate('profile.errors.mustBeSignedIn'));
      return;
    }

    const profileForm = this.formState();
    if (
      profileForm.password.trim() !== '' &&
      profileForm.password !== profileForm.password_confirmation
    ) {
      this.errorMessage.set(this.translocoService.translate('profile.errors.passwordMismatch'));
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    this.identityApiService
      .updateUser(currentUser.id, {
        first_name: profileForm.first_name,
        last_name: profileForm.last_name,
        email: profileForm.email,
        ...(profileForm.password.trim() === '' ? {} : { password: profileForm.password }),
      })
      .subscribe({
        next: () => {
          this.sessionService.reloadSessionData().subscribe();
          this.successMessage.set(
            this.translocoService.translate('profile.messages.updatedSuccessfully'),
          );
          this.isSubmitting.set(false);
          this.formState.update((currentValue) => ({
            ...currentValue,
            password: '',
            password_confirmation: '',
          }));
        },
        error: (mutationError: { message?: string }) => {
          this.errorMessage.set(
            mutationError.message ??
              this.translocoService.translate('profile.errors.unableToUpdateProfile'),
          );
          this.isSubmitting.set(false);
        },
      });
  }
}
