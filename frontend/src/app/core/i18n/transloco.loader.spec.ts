// transloco.loader.spec.ts: Pruebas del loader HTTP de catálogos i18n.
// Verifica resolución de idioma soportado y fallback al idioma por defecto.

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TranslocoHttpLoader } from './transloco.loader';

describe('TranslocoHttpLoader', () => {
  let loader: TranslocoHttpLoader;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    loader = TestBed.inject(TranslocoHttpLoader);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('carga el archivo del idioma soportado solicitado', () => {
    // Verifica la ruta nominal para idiomas válidos disponibles en el selector.
    let payload: object | null = null;

    loader.getTranslation('es').subscribe((translation) => {
      payload = translation;
    });

    const request = httpMock.expectOne('/i18n/es.json');
    expect(request.request.method).toBe('GET');
    request.flush({ hello: 'hola' });

    expect(payload).toEqual({ hello: 'hola' });
  });

  it('usa el idioma por defecto cuando el idioma solicitado no es soportado', () => {
    // Verifica el fallback para evitar 404 al pedir idiomas fuera del catálogo soportado.
    loader.getTranslation('pt-BR').subscribe();

    const request = httpMock.expectOne('/i18n/en.json');
    expect(request.request.method).toBe('GET');
    request.flush({ hello: 'hello' });
  });
});
