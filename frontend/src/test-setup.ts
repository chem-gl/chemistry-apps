// test-setup.ts: Configuración global de pruebas en todos los TestBed sin necesidad de repetirlo en cada spec file.

import { TestBed, TestModuleMetadata } from '@angular/core/testing';
import { provideTestingTransloco } from './app/core/i18n/testing-transloco.provider';

// Guardamos la referencia original para no romper encadenamiento interno de Angular
const originalConfigureTestingModule = TestBed.configureTestingModule.bind(TestBed);
const originalConsoleError = console.error.bind(console);

function isKnownJsdomCssNoise(logArguments: unknown[]): boolean {
  return logArguments.some((argumentValue: unknown) => {
    if (typeof argumentValue === 'string') {
      return argumentValue.includes('Could not parse CSS stylesheet');
    }

    if (argumentValue instanceof Error) {
      return argumentValue.message.includes('Could not parse CSS stylesheet');
    }

    return false;
  });
}

// Este warning es ruido conocido de jsdom con CSS avanzado de librerías externas.
// Se filtra para mantener logs limpios sin ocultar errores reales.
console.error = (...logArguments: unknown[]): void => {
  if (isKnownJsdomCssNoise(logArguments)) {
    return;
  }

  originalConsoleError(...logArguments);
};

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
