// progress-stage-catalog.spec.ts: Paridad del catálogo i18n de los stages de progreso.
// `progress-stage-messages` deriva claves `progress.stage.<stage>` para los stages que publica el
// backend; si un idioma pierde una entrada, la UI volvería a pintar el mensaje en español.

import { describe, expect, it } from 'vitest';
import deCatalog from '../../../../public/i18n/de.json';
import enCatalog from '../../../../public/i18n/en.json';
import esCatalog from '../../../../public/i18n/es.json';
import frCatalog from '../../../../public/i18n/fr.json';
import hiCatalog from '../../../../public/i18n/hi.json';
import jaCatalog from '../../../../public/i18n/ja.json';
import ruCatalog from '../../../../public/i18n/ru.json';
import zhCatalog from '../../../../public/i18n/zh-CN.json';
import { KNOWN_PROGRESS_STAGES, resolveProgressMessage } from '../application/progress-stage-messages';
import { SUPPORTED_LANGUAGE_CODES, SupportedLanguageCode } from './supported-languages';

interface ProgressStageCatalog {
  readonly progress: { readonly stage: Record<string, string> };
}

const LANGUAGE_CATALOGS: ReadonlyArray<readonly [SupportedLanguageCode, ProgressStageCatalog]> = [
  ['en', enCatalog],
  ['es', esCatalog],
  ['fr', frCatalog],
  ['de', deCatalog],
  ['ru', ruCatalog],
  ['zh-CN', zhCatalog],
  ['hi', hiCatalog],
  ['ja', jaCatalog],
];

const SPANISH_BACKEND_MESSAGE = 'Ejecutando plugin científico.';

describe('catálogo i18n de stages de progreso', () => {
  it('cubre los ocho idiomas soportados', () => {
    const cataloguedLanguages: string[] = LANGUAGE_CATALOGS.map(([code]) => code);
    expect([...cataloguedLanguages].sort()).toEqual([...SUPPORTED_LANGUAGE_CODES].sort());
  });

  it.each(KNOWN_PROGRESS_STAGES)(
    'define progress.stage.%s en todos los idiomas con texto no vacío',
    (stage: string) => {
      LANGUAGE_CATALOGS.forEach(([languageCode, catalog]) => {
        const stageText: string | undefined = catalog.progress.stage[stage];
        expect(stageText, `falta progress.stage.${stage} en ${languageCode}.json`).toBeTruthy();
        expect((stageText ?? '').trim().length).toBeGreaterThan(0);
      });
    },
  );

  it.each(KNOWN_PROGRESS_STAGES)(
    'resuelve progress.stage.%s sin exponer el mensaje español con la UI en inglés',
    (stage: string) => {
      const englishCatalog: ProgressStageCatalog = LANGUAGE_CATALOGS[0][1];

      const resolvedMessage: string = resolveProgressMessage({
        stage,
        backendMessage: SPANISH_BACKEND_MESSAGE,
        fallbackMessage: 'Preparing job...',
        activeLanguage: 'en',
        translate: (translationKey: string) =>
          englishCatalog.progress.stage[translationKey.replace('progress.stage.', '')],
      });

      expect(resolvedMessage).toBe(englishCatalog.progress.stage[stage]);
      expect(resolvedMessage).not.toContain('Ejecutando');
    },
  );
});
