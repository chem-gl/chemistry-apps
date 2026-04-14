// login.component.spec.ts: Pruebas del formulario de inicio de sesión.
// Verifica navegación post-login y mensajes de error ante autenticación fallida.

import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { IdentitySessionService } from '../core/auth/identity-session.service';
import { LoginComponent } from './login.component';

describe('LoginComponent', () => {
  const sessionServiceMock = {
    login: vi.fn(),
    lastAuthenticationError: vi.fn(),
  };

  const translocoServiceMock = {
    translate: vi.fn((key: string) => key),
  };

  const activatedRouteMock = {
    snapshot: {
      queryParamMap: convertToParamMap({ redirectTo: '/smileit' }),
    },
  };

  const routerMock = {
    navigateByUrl: vi.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    sessionServiceMock.login.mockReturnValue(of(true));
    sessionServiceMock.lastAuthenticationError.mockReturnValue('Credenciales inválidas');

    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideRouter([]),
        { provide: Router, useValue: routerMock },
        { provide: ActivatedRoute, useValue: activatedRouteMock },
        { provide: IdentitySessionService, useValue: sessionServiceMock },
        { provide: TranslocoService, useValue: translocoServiceMock },
      ],
    }).compileComponents();
  });

  it('navega al redirect solicitado cuando el login es exitoso', () => {
    // Verifica la rama feliz para preservar el flujo de retorno a la pantalla original.
    const fixture = TestBed.createComponent(LoginComponent);
    const component = fixture.componentInstance;
    component.username.set('alice');
    component.password.set('secret');

    component.submit();

    expect(sessionServiceMock.login).toHaveBeenCalledWith('alice', 'secret');
    expect(routerMock.navigateByUrl).toHaveBeenCalledWith('/smileit');
    expect(component.localErrorMessage()).toBeNull();
  });

  it('muestra el error de autenticación cuando el backend rechaza credenciales', () => {
    // Verifica la rama `next(false)` para dar feedback de login inválido sin lanzar excepción.
    sessionServiceMock.login.mockReturnValue(of(false));
    const fixture = TestBed.createComponent(LoginComponent);
    const component = fixture.componentInstance;

    component.submit();

    expect(component.localErrorMessage()).toBe('Credenciales inválidas');
    expect(routerMock.navigateByUrl).not.toHaveBeenCalled();
  });

  it('usa el mensaje traducido cuando no hay error específico de autenticación', () => {
    // Verifica el fallback de UX para respuestas ambiguas del backend.
    sessionServiceMock.login.mockReturnValue(of(false));
    sessionServiceMock.lastAuthenticationError.mockReturnValue(null);
    const fixture = TestBed.createComponent(LoginComponent);
    const component = fixture.componentInstance;

    component.submit();

    expect(component.localErrorMessage()).toBe('login.errors.unableToAuthenticate');
  });

  it('muestra el mensaje del error observable cuando la petición falla', () => {
    // Verifica la rama `error` del subscribe para errores de red o servidor.
    sessionServiceMock.login.mockReturnValue(throwError(() => ({ message: 'Network down' })));
    const fixture = TestBed.createComponent(LoginComponent);
    const component = fixture.componentInstance;

    component.submit();

    expect(component.localErrorMessage()).toBe('Network down');
  });
});
