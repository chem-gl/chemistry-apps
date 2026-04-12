// global-error-modal.service.spec.ts: Pruebas unitarias del servicio global para mostrar errores en modal reutilizable.

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { GlobalErrorModalService } from './global-error-modal.service';

describe('GlobalErrorModalService', () => {
  let service: GlobalErrorModalService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [],
    });
    service = TestBed.inject(GlobalErrorModalService);
  });

  it('stores a message and clears it on dismiss', () => {
    service.showMessage('Backend unavailable', 'Request failed');

    expect(service.currentError()).toEqual({
      title: 'Request failed',
      message: 'Backend unavailable',
      details: null,
    });

    service.dismiss();
    expect(service.currentError()).toBeNull();
  });

  it('maps HttpErrorResponse detail payload into modal view model', () => {
    const response = new HttpErrorResponse({
      status: 500,
      error: { detail: 'Server exploded' },
      statusText: 'Internal Server Error',
      url: '/api/jobs',
    });

    service.showHttpError(response);

    const currentError = service.currentError();
    expect(currentError).not.toBeNull();
    expect(currentError?.title).toBe('Request failed');
    expect(currentError?.message).toBe(
      'The server reported an internal error. Please try again later.',
    );
    expect(currentError?.details).toContain('Server exploded');
  });

  it('showError almacena el view model directamente', () => {
    service.showError({ title: 'Error de red', message: 'Timeout', details: null });

    expect(service.currentError()).toEqual({
      title: 'Error de red',
      message: 'Timeout',
      details: null,
    });
  });

  it('mapea errores 400 a un mensaje de validación legible', () => {
    const response = new HttpErrorResponse({
      status: 400,
      error: 'Bad SMILES input',
    });

    service.showHttpError(response);

    expect(service.currentError()?.message).toBe(
      'The request is invalid. Please verify the submitted data.',
    );
  });

  it('mapea errores 5xx al mensaje de servidor', () => {
    const response = new HttpErrorResponse({
      status: 503,
      error: null,
      statusText: 'Service Unavailable',
    });

    service.showHttpError(response);

    expect(service.currentError()?.message).toBe(
      'The server reported an internal error. Please try again later.',
    );
  });

  it('extractHttpDetails retorna null cuando el error no es un objeto', () => {
    const response = new HttpErrorResponse({
      status: 400,
      error: 'plain string error',
    });

    service.showHttpError(response);

    // El error es un string, no objeto → details debe ser null
    expect(service.currentError()?.details).toBeNull();
  });
});
