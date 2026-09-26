// change-password.component.spec.ts: Pruebas del formulario de cambio obligatorio.

import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IdentitySessionService } from '../core/auth/identity-session.service';
import { ChangePasswordComponent } from './change-password.component';

describe('ChangePasswordComponent', () => {
  const session = { changePassword: vi.fn(() => of(true)) };
  const router = { navigateByUrl: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      imports: [
        ChangePasswordComponent,
        TranslocoTestingModule.forRoot({ langs: { en: {} } }),
      ],
      providers: [
        { provide: IdentitySessionService, useValue: session },
        { provide: Router, useValue: router },
      ],
    });
  });

  it('renderiza el formulario con sus tres campos', () => {
    const fixture = TestBed.createComponent(ChangePasswordComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('input[name="currentPassword"]')).not.toBeNull();
    expect(compiled.querySelector('input[name="newPassword"]')).not.toBeNull();
    expect(compiled.querySelector('input[name="confirmPassword"]')).not.toBeNull();
  });

  it('rechaza confirmación distinta sin llamar al servicio', () => {
    const component = TestBed.createComponent(ChangePasswordComponent).componentInstance;
    component.currentPassword.set('old-password');
    component.newPassword.set('new-password-1');
    component.confirmPassword.set('new-password-2');
    component.submit();
    expect(component.localErrorMessage()).toContain('mismatch');
    expect(session.changePassword).not.toHaveBeenCalled();
  });

  it('rechaza contraseña nueva igual a la actual o demasiado corta', () => {
    const component = TestBed.createComponent(ChangePasswordComponent).componentInstance;
    component.currentPassword.set('same-password');
    component.newPassword.set('same-password');
    component.confirmPassword.set('same-password');
    component.submit();
    expect(component.localErrorMessage()).toContain('sameAsCurrent');

    component.newPassword.set('short');
    component.confirmPassword.set('short');
    component.submit();
    expect(component.localErrorMessage()).toContain('tooShort');
    expect(session.changePassword).not.toHaveBeenCalled();
  });

  it('envía el cambio válido y navega a apps', () => {
    const component = TestBed.createComponent(ChangePasswordComponent).componentInstance;
    component.currentPassword.set('old-password');
    component.newPassword.set('new-password-1');
    component.confirmPassword.set('new-password-1');
    component.submit();
    expect(session.changePassword).toHaveBeenCalledWith('old-password', 'new-password-1');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/apps');
  });
});
