// testing-transloco.provider.ts: Proveedor reutilizable de Transloco para pruebas unitarias con Vitest.
// Carga el catálogo real de en.json para que los tests siempre estén sincronizados con las traducciones.

import { Injectable } from '@angular/core';
import { Translation, TranslocoLoader, provideTransloco } from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import enTranslations from '../../../../public/i18n/en.json';

@Injectable({ providedIn: 'root' })
class TestingTranslocoLoader implements TranslocoLoader {
  getTranslation(): Observable<Translation> {
    return of(enTranslations as Translation);
  }
}

export function provideTestingTransloco() {
  return provideTransloco({
    config: {
      availableLangs: ['en'],
      defaultLang: 'en',
      fallbackLang: 'en',
      reRenderOnLangChange: true,
      prodMode: true,
    },
    loader: TestingTranslocoLoader,
  });
}
