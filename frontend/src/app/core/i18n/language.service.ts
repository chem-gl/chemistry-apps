// language.service.ts: Servicio reactivo para idioma activo con persistencia local y sincronización Transloco.

import { Injectable, computed, inject, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGE_CODES,
  SUPPORTED_LANGUAGE_OPTIONS,
  SupportedLanguageCode,
} from './supported-languages';

const LANGUAGE_STORAGE_KEY = 'chemistry-apps.language-preference';

@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly translocoService = inject(TranslocoService);
  private readonly activeLanguageCodeSignal = signal<SupportedLanguageCode>(DEFAULT_LANGUAGE);

  readonly activeLanguageCode = computed<SupportedLanguageCode>(() =>
    this.activeLanguageCodeSignal(),
  );
  readonly languageOptions = SUPPORTED_LANGUAGE_OPTIONS;

  initializeLanguage(): void {
    const savedLanguageCode = this.readLanguageFromStorage();
    this.setLanguage(savedLanguageCode ?? DEFAULT_LANGUAGE);
  }

  setLanguage(nextLanguageCode: SupportedLanguageCode): void {
    this.activeLanguageCodeSignal.set(nextLanguageCode);
    this.translocoService.setActiveLang(nextLanguageCode);
    this.writeLanguageToStorage(nextLanguageCode);
  }

  private readLanguageFromStorage(): SupportedLanguageCode | null {
    const persistedLanguageCode = globalThis.localStorage?.getItem(LANGUAGE_STORAGE_KEY) ?? null;
    if (persistedLanguageCode === null) {
      return null;
    }

    const matchedLanguageCode = SUPPORTED_LANGUAGE_CODES.find(
      (supportedLanguageCode) => supportedLanguageCode === persistedLanguageCode,
    );

    return matchedLanguageCode ?? null;
  }

  private writeLanguageToStorage(languageCode: SupportedLanguageCode): void {
    globalThis.localStorage?.setItem(LANGUAGE_STORAGE_KEY, languageCode);
  }
}
