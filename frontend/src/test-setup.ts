// test-setup.ts: Configuración global de pruebas en todos los TestBed sin necesidad de repetirlo en cada spec file.

import { TestBed, TestModuleMetadata } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { provideTestingTransloco } from './app/core/i18n/testing-transloco.provider';

// Guardamos la referencia original para no romper encadenamiento interno de Angular
const originalConfigureTestingModule = TestBed.configureTestingModule.bind(TestBed);
const originalConsoleError = console.error.bind(console);

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch {
  // El entorno puede venir inicializado por Angular CLI; en ejecución directa con Vitest
  // esta llamada asegura que TestBed quede operativo sin romper el flujo existente.
}

// El jsdom del builder expone window/navigator pero no localStorage en este
// entorno (30 specs lo usan: sesión, drafts, open-mode). Polyfill en memoria
// solo para tests; el código productivo no cambia.
if (globalThis.localStorage === undefined) {
  const memoryStore = new Map<string, string>();
  globalThis.localStorage = {
    get length(): number {
      return memoryStore.size;
    },
    clear(): void {
      memoryStore.clear();
    },
    getItem(key: string): string | null {
      return memoryStore.has(key) ? (memoryStore.get(key) as string) : null;
    },
    key(index: number): string | null {
      return Array.from(memoryStore.keys())[index] ?? null;
    },
    removeItem(key: string): void {
      memoryStore.delete(key);
    },
    setItem(key: string, value: string): void {
      memoryStore.set(String(key), String(value));
    },
  } as Storage;
}

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
