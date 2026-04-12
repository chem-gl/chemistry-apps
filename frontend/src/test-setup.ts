// test-setup.ts: Configuración global de pruebas. Inyecta automáticamente proveedores
// comunes (Transloco) en todos los TestBed sin necesidad de repetirlo en cada spec file.

import { TestBed, TestModuleMetadata } from '@angular/core/testing';
import { provideTestingTransloco } from './app/core/i18n/testing-transloco.provider';

// Guardamos la referencia original para no romper encadenamiento interno de Angular
const originalConfigureTestingModule = TestBed.configureTestingModule.bind(TestBed);

/**
 * Parche global: añade automáticamente provideTestingTransloco() a cada
 * TestBed.configureTestingModule(), evitando duplicación en todos los spec files.
 */
TestBed.configureTestingModule = (moduleDef: TestModuleMetadata) => {
  const providers = moduleDef.providers ?? [];
  return originalConfigureTestingModule({
    ...moduleDef,
    providers: [provideTestingTransloco(), ...providers],
  });
};
