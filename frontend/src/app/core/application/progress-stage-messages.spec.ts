// progress-stage-messages.spec.ts: Reglas puras del texto de progreso (stage traducible vs backend).

import { describe, expect, it } from 'vitest';
import type { JobProgressSnapshotView } from '../api/jobs-api.service';
import {
  KNOWN_PROGRESS_STAGES,
  normalizeProgressStage,
  PROGRESS_STAGE_TRANSLATION_PREFIX,
  progressStageTranslationKey,
  resolveProgressMessage,
  UNTRANSLATED_PROGRESS_TEXT,
} from './progress-stage-messages';

function makeSnapshot(overrides: Partial<JobProgressSnapshotView> = {}): JobProgressSnapshotView {
  return {
    job_id: 'job-1',
    status: 'running',
    progress_percentage: 40,
    progress_stage: 'running',
    progress_message: 'Ejecutando plugin científico.',
    progress_event_index: 1,
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('progress-stage-messages', () => {
  it('reconoce los stages que el backend publica en progress_stage', () => {
    expect([...KNOWN_PROGRESS_STAGES]).toEqual([
      'pending',
      'queued',
      'running',
      'paused',
      'recovering',
      'caching',
      'completed',
      'failed',
      'cancelled',
    ]);
    expect(normalizeProgressStage('  Running ')).toBe('running');
    expect(normalizeProgressStage('etapa-del-plugin')).toBeNull();
    expect(normalizeProgressStage(undefined)).toBeNull();
    expect(normalizeProgressStage(null)).toBeNull();
  });

  it('deriva la clave i18n del stage conocido y devuelve null si no lo es', () => {
    expect(progressStageTranslationKey('caching')).toBe(
      `${PROGRESS_STAGE_TRANSLATION_PREFIX}.caching`,
    );
    expect(progressStageTranslationKey('desconocido')).toBeNull();
    expect(progressStageTranslationKey(undefined)).toBeNull();
  });

  it('prioriza el texto traducido del stage sobre el mensaje en español del backend', () => {
    const message: string = resolveProgressMessage({
      stage: 'running',
      backendMessage: 'Ejecutando plugin científico.',
      fallbackMessage: 'Preparing job...',
      activeLanguage: 'en',
      translate: (translationKey: string) =>
        translationKey === 'progress.stage.running' ? 'Running…' : null,
    });

    expect(message).toBe('Running…');
  });

  it('no pinta la clave cruda cuando el catálogo todavía no tiene la entrada', () => {
    const requestWithoutCatalog = {
      stage: 'queued',
      backendMessage: 'Job en ejecución por worker asíncrono.',
      fallbackMessage: 'Preparing job...',
      translate: (translationKey: string) => translationKey,
    };

    expect(
      resolveProgressMessage({ ...requestWithoutCatalog, activeLanguage: 'en' }),
    ).toBe('Preparing job...');
    expect(
      resolveProgressMessage({ ...requestWithoutCatalog, activeLanguage: 'es' }),
    ).toBe('Job en ejecución por worker asíncrono.');
  });

  it('muestra el texto del backend solo cuando la UI está en su idioma', () => {
    const request = {
      stage: 'etapa-del-plugin',
      backendMessage: 'Ejecutando plugin científico.',
      fallbackMessage: 'Preparing job...',
      translate: () => null,
    };

    expect(resolveProgressMessage({ ...request, activeLanguage: 'es' })).toBe(
      'Ejecutando plugin científico.',
    );
    expect(resolveProgressMessage({ ...request, activeLanguage: 'de' })).toBe('Preparing job...');
  });

  it('usa el fallback cuando no hay mensaje utilizable', () => {
    expect(
      resolveProgressMessage({
        stage: undefined,
        backendMessage: '   ',
        fallbackMessage: 'Preparing job...',
        activeLanguage: 'ja',
        translate: () => null,
      }),
    ).toBe('Preparing job...');
  });

  it('degrada al comportamiento previo cuando no hay i18n disponible', () => {
    expect(UNTRANSLATED_PROGRESS_TEXT.resolve(makeSnapshot(), 'Preparing job...')).toBe(
      'Ejecutando plugin científico.',
    );
    expect(
      UNTRANSLATED_PROGRESS_TEXT.resolve(
        makeSnapshot({ progress_message: '   ' }),
        'Preparing job...',
      ),
    ).toBe('Preparing job...');
    expect(UNTRANSLATED_PROGRESS_TEXT.resolve(null, 'Preparing job...')).toBe('Preparing job...');
  });
});
