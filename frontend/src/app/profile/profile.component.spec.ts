// profile.component.spec.ts: Pruebas del formulario de perfil de usuario.
// Verifica inicialización de datos, validación de contraseña y actualización del perfil.

import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { IdentityApiService } from '../core/api/identity-api.service';
import { IdentitySessionService } from '../core/auth/identity-session.service';
import { ProfileComponent } from './profile.component';

describe('ProfileComponent', () => {
  const currentUser = {
    id: 7,
    username: 'alice',
    email: 'alice@test.local',
    first_name: 'Alice',
    last_name: 'Doe',
  };

  const identityApiServiceMock = {
    updateUser: vi.fn(),
  };

  const sessionServiceMock = {
    initializeSession: vi.fn(),
    currentUser: vi.fn(),
    reloadSessionData: vi.fn(),
  };

  const translocoServiceMock = {
    translate: vi.fn((key: string) => key),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    identityApiServiceMock.updateUser.mockReturnValue(of(currentUser));
    sessionServiceMock.initializeSession.mockReturnValue(of(true));
    sessionServiceMock.currentUser.mockReturnValue(currentUser);
    sessionServiceMock.reloadSessionData.mockReturnValue(of(void 0));

    await TestBed.configureTestingModule({
      imports: [ProfileComponent],
      providers: [
        { provide: IdentityApiService, useValue: identityApiServiceMock },
        { provide: IdentitySessionService, useValue: sessionServiceMock },
        { provide: TranslocoService, useValue: translocoServiceMock },
      ],
    }).compileComponents();
  });

  it('inicializa el formulario con los datos del usuario autenticado', () => {
    // Verifica que la pantalla arranque desde el estado persistido de sesión.
    const fixture = TestBed.createComponent(ProfileComponent);
    const component = fixture.componentInstance;

    component.ngOnInit();

    expect(component.formState()).toMatchObject({
      first_name: 'Alice',
      last_name: 'Doe',
      email: 'alice@test.local',
    });
  });

  it('expone hasPasswordInput y setField para edición incremental del formulario', () => {
    // Verifica helpers del formulario usados por la UI reactiva.
    const fixture = TestBed.createComponent(ProfileComponent);
    const component = fixture.componentInstance;

    component.setField('password', 'new-secret');

    expect(component.formState().password).toBe('new-secret');
    expect(component.hasPasswordInput()).toBe(true);
  });

  it('rechaza guardar si no hay usuario autenticado', () => {
    // Verifica la protección contra submits sin contexto de sesión.
    sessionServiceMock.currentUser.mockReturnValue(null);
    const fixture = TestBed.createComponent(ProfileComponent);
    const component = fixture.componentInstance;

    component.saveProfile();

    expect(component.errorMessage()).toBe('profile.errors.mustBeSignedIn');
    expect(identityApiServiceMock.updateUser).not.toHaveBeenCalled();
  });

  it('rechaza guardar cuando la confirmación de contraseña no coincide', () => {
    // Verifica validación local antes de tocar la API.
    const fixture = TestBed.createComponent(ProfileComponent);
    const component = fixture.componentInstance;
    component.formState.set({
      first_name: 'Alice',
      last_name: 'Doe',
      email: 'alice@test.local',
      password: 'one',
      password_confirmation: 'two',
    });

    component.saveProfile();

    expect(component.errorMessage()).toBe('profile.errors.passwordMismatch');
    expect(identityApiServiceMock.updateUser).not.toHaveBeenCalled();
  });

  it('actualiza el perfil y limpia contraseñas cuando la mutación es exitosa', () => {
    // Verifica el payload enviado, la recarga de sesión y el reseteo de campos sensibles.
    const fixture = TestBed.createComponent(ProfileComponent);
    const component = fixture.componentInstance;
    component.formState.set({
      first_name: 'Alice',
      last_name: 'Smith',
      email: 'alice+updated@test.local',
      password: 'new-secret',
      password_confirmation: 'new-secret',
    });

    component.saveProfile();

    expect(identityApiServiceMock.updateUser).toHaveBeenCalledWith(7, {
      first_name: 'Alice',
      last_name: 'Smith',
      email: 'alice+updated@test.local',
      password: 'new-secret',
    });
    expect(sessionServiceMock.reloadSessionData).toHaveBeenCalled();
    expect(component.successMessage()).toBe('profile.messages.updatedSuccessfully');
    expect(component.formState().password).toBe('');
    expect(component.formState().password_confirmation).toBe('');
  });

  it('muestra error traducido o del observable cuando la actualización falla', () => {
    // Verifica la rama de error para no dejar el formulario en silencio ante fallos.
    identityApiServiceMock.updateUser.mockReturnValue(
      throwError(() => ({ message: 'Profile update failed' })),
    );
    const fixture = TestBed.createComponent(ProfileComponent);
    const component = fixture.componentInstance;

    component.saveProfile();

    expect(component.errorMessage()).toBe('Profile update failed');
    expect(component.isSubmitting()).toBe(false);
  });
});
