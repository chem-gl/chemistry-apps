// transloco.loader.ts: Loader HTTP para catálogos i18n almacenados en public/i18n.

import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Translation, TranslocoLoader } from '@jsverse/transloco';
import { Observable } from 'rxjs';
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGE_CODES,
  SupportedLanguageCode,
} from './supported-languages';

@Injectable({ providedIn: 'root' })
export class TranslocoHttpLoader implements TranslocoLoader {
  private readonly httpClient = inject(HttpClient);

  getTranslation(languageCode: string): Observable<Translation> {
    const safeLanguageCode = this.resolveSupportedLanguageCode(languageCode);
    return this.httpClient.get<Translation>(`/i18n/${safeLanguageCode}.json`);
  }

  private resolveSupportedLanguageCode(languageCode: string): SupportedLanguageCode {
    const matchedLanguageCode = SUPPORTED_LANGUAGE_CODES.find(
      (supportedLanguageCode) => supportedLanguageCode === languageCode,
    );

    return matchedLanguageCode ?? DEFAULT_LANGUAGE;
  }
}
