import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApiService } from '../core/api/auth-api.service';
import { IdentitySessionService } from '../core/auth/identity-session.service';
import { RegisterComponent } from './register.component';

describe('RegisterComponent', () => {
  const auth = { register: vi.fn() };
  const session = { isAuthenticated: vi.fn(() => false), initializeFromRegistration: vi.fn(() => of(true)) };
  const router = { navigateByUrl: vi.fn() };
  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({ imports: [RegisterComponent], providers: [
      { provide: AuthApiService, useValue: auth }, { provide: IdentitySessionService, useValue: session },
      { provide: Router, useValue: router }, { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => 'invite' } } } },
      { provide: TranslocoService, useValue: { translate: (key: string) => key } },
    ] });
  });
  it('validates fields and pre-fills invitation token', () => {
    const component = TestBed.createComponent(RegisterComponent).componentInstance;
    component.ngOnInit();
    expect(component.invitationToken()).toBe('invite');
    component.submit();
    expect(component.localErrorMessage()).toContain('usernameRequired');
    component.username.set('user'); component.email.set('a@b'); component.password.set('short'); component.confirmPassword.set('short'); component.submit();
    expect(component.localErrorMessage()).toContain('passwordTooShort');
    component.password.set('password'); component.confirmPassword.set('different'); component.submit();
    expect(component.localErrorMessage()).toContain('passwordMismatch');
  });

  it('valida email y contraseña requeridos antes de llamar al backend', () => {
    const component = TestBed.createComponent(RegisterComponent).componentInstance;
    component.username.set('user');
    component.ngOnInit();

    component.submit();
    expect(component.localErrorMessage()).toContain('emailRequired');

    component.email.set('user@example.test');
    component.submit();
    expect(component.localErrorMessage()).toContain('passwordRequired');
    expect(auth.register).not.toHaveBeenCalled();
  });

  it('redirige a apps si ya existe una sesión', () => {
    session.isAuthenticated.mockReturnValueOnce(true);

    TestBed.createComponent(RegisterComponent).componentInstance.ngOnInit();

    expect(router.navigateByUrl).toHaveBeenCalledWith('/apps');
  });
  it('registers with token and redirects after auto-login', () => {
    auth.register.mockReturnValue(of({ access: 'a', refresh: 'r' }));
    const component = TestBed.createComponent(RegisterComponent).componentInstance;
    component.username.set(' user '); component.email.set(' e@x '); component.password.set('password'); component.confirmPassword.set('password'); component.ngOnInit(); component.submit();
    expect(auth.register).toHaveBeenCalledWith({ username: 'user', email: 'e@x', password: 'password', registration_token: 'invite' });
    expect(session.initializeFromRegistration).toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/apps');
  });
  it('shows backend errors and supports registration without auto-login', () => {
    auth.register.mockReturnValueOnce(throwError(() => ({ error: { email: ['Already used'] } })));
    const component = TestBed.createComponent(RegisterComponent).componentInstance;
    component.username.set('user'); component.email.set('e@x'); component.password.set('password'); component.confirmPassword.set('password'); component.ngOnInit(); component.submit();
    expect(component.localErrorMessage()).toBe('Already used');
    auth.register.mockReturnValueOnce(of({})); component.submit();
    expect(component.registrationSuccess()).toBe(true);
    expect(component.isSubmitting()).toBe(false);
  });

  it('redirige aunque falle la carga de sesión después del registro con tokens', () => {
    auth.register.mockReturnValue(of({ access: 'a', refresh: 'r' }));
    session.initializeFromRegistration.mockReturnValueOnce(
      throwError(() => new Error('session unavailable')),
    );
    const component = TestBed.createComponent(RegisterComponent).componentInstance;
    component.username.set('user');
    component.email.set('e@x');
    component.password.set('password');
    component.confirmPassword.set('password');

    component.submit();

    expect(router.navigateByUrl).toHaveBeenCalledWith('/apps');
  });

  it('muestra el mensaje de error genérico del backend', () => {
    auth.register.mockReturnValueOnce(throwError(() => ({ message: 'Registration unavailable' })));
    const component = TestBed.createComponent(RegisterComponent).componentInstance;
    component.username.set('user');
    component.email.set('e@x');
    component.password.set('password');
    component.confirmPassword.set('password');

    component.submit();

    expect(component.localErrorMessage()).toBe('Registration unavailable');
    expect(component.isSubmitting()).toBe(false);
  });
});
