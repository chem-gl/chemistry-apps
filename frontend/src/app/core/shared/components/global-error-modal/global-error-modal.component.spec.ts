// global-error-modal.component.spec.ts: Pruebas unitarias del modal global de errores compartido.

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { provideTestingTransloco } from '../../../i18n/testing-transloco.provider';
import { GlobalErrorModalService } from '../../../application/errors/global-error-modal.service';
import { GlobalErrorModalComponent } from './global-error-modal.component';

describe('GlobalErrorModalComponent', () => {
  let fixture: ComponentFixture<GlobalErrorModalComponent>;
  let service: GlobalErrorModalService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GlobalErrorModalComponent],
      providers: [provideTestingTransloco()],
    }).compileComponents();

    fixture = TestBed.createComponent(GlobalErrorModalComponent);
    service = TestBed.inject(GlobalErrorModalService);
  });

  afterEach(() => {
    service.dismiss();
    fixture.detectChanges();
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
  });

  it('renders modal content when an error exists', () => {
    service.showMessage('Backend unavailable', 'Request failed');
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Request failed');
    expect(element.textContent).toContain('Backend unavailable');
  });

  it('muestra título y mensaje traducidos por clave sin filtrar claves crudas', () => {
    service.showHttpError(new HttpErrorResponse({ status: 400, error: 'Bad input' }));
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Request failed');
    expect(text).toContain('The request is invalid. Please verify the submitted data.');
    expect(text).not.toContain('errorModal.');
  });

  it('traba el scroll del documento mientras el modal está abierto', () => {
    service.showMessage('Boom');
    fixture.detectChanges();

    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(document.body.style.overflow).toBe('hidden');

    service.dismiss();
    fixture.detectChanges();
    TestBed.flushEffects();

    expect(document.documentElement.style.overflow).toBe('');
    expect(document.body.style.overflow).toBe('');
  });

  it('closes modal when close button is clicked', () => {
    service.showMessage('Temporary issue');
    fixture.detectChanges();

    const closeButton = fixture.nativeElement.querySelector(
      '.error-modal-close-button',
    ) as HTMLButtonElement;
    closeButton.click();
    fixture.detectChanges();

    expect(service.currentError()).toBeNull();
  });

  it('closes modal when escape key is pressed and error exists', () => {
    service.showMessage('Escape key test');
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.closeOnEscapeKey();

    expect(service.currentError()).toBeNull();
  });

  it('does not throw when escape key is pressed with no error', () => {
    service.dismiss(); // Asegura que no hay error
    const component = fixture.componentInstance;
    expect(() => component.closeOnEscapeKey()).not.toThrow();
  });
});
