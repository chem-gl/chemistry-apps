// progress-stage-messages.ts: Reglas puras para elegir el texto de progreso visible de un job.
// El backend redacta `progress_message` solo en español, por lo que pintar ese campo tal cual
// muestra texto en español cuando la UI está en otro idioma. La alternativa estable es el campo
// machine-readable `progress_stage`, que se traduce con las claves i18n `progress.stage.<stage>`.

/** Stages conocidos por el backend y con texto propio en el catálogo i18n. */
export const KNOWN_PROGRESS_STAGES = [
  'pending',
  'queued',
  'running',
  'paused',
  'recovering',
  'caching',
  'completed',
  'failed',
  'cancelled',
] as const;

export type KnownProgressStage = (typeof KNOWN_PROGRESS_STAGES)[number];

/** Prefijo de las claves i18n agregadas en `public/i18n/*.json`. */
export const PROGRESS_STAGE_TRANSLATION_PREFIX = 'progress.stage';

/** Idioma en el que el backend escribe sus `progress_message`. */
export const PROGRESS_BACKEND_LANGUAGE = 'es';

/**
 * Normaliza el stage del snapshot al vocabulario conocido; `null` si no es utilizable.
 * Acepta `unknown` porque el reader del job público recibe el payload sin tipar.
 */
export function normalizeProgressStage(rawStage: unknown): KnownProgressStage | null {
  if (typeof rawStage !== 'string') {
    return null;
  }
  const normalizedStage: string = rawStage.trim().toLowerCase();
  return (
    KNOWN_PROGRESS_STAGES.find((knownStage: KnownProgressStage) => knownStage === normalizedStage) ??
    null
  );
}

/** Clave i18n del stage (`progress.stage.running`) o `null` si el stage no es conocido. */
export function progressStageTranslationKey(rawStage: unknown): string | null {
  const normalizedStage: KnownProgressStage | null = normalizeProgressStage(rawStage);
  return normalizedStage === null
    ? null
    : `${PROGRESS_STAGE_TRANSLATION_PREFIX}.${normalizedStage}`;
}

/** Entradas del resolutor: todos los textos posibles que llegan al componente de progreso. */
export interface ProgressMessageRequest {
  /** Stage machine-readable del snapshot (`progress_stage`). */
  readonly stage: string | null | undefined;
  /** Texto crudo que envía el backend (`progress_message`). */
  readonly backendMessage: string | null | undefined;
  /** Mensaje propio de la app cuando no hay nada traducible que mostrar. */
  readonly fallbackMessage: string;
  /** Código del idioma activo de la UI (`null` si todavía no se conoce). */
  readonly activeLanguage: string | null;
  /** Traduce una clave; `null`/`undefined` cuando no hay servicio i18n disponible. */
  readonly translate: (translationKey: string) => string | null | undefined;
}

/**
 * Elige el mensaje de progreso sin exponer texto sin traducir.
 *
 * Prioridades:
 * 1. Stage conocido y traducido → texto del catálogo i18n.
 * 2. Sin stage utilizable (o catálogo aún no cargado) → texto del backend solo si la UI
 *    está en español, que es el idioma en el que el backend lo escribe.
 * 3. En cualquier otro caso → `fallbackMessage` de la app.
 */
export function resolveProgressMessage(request: ProgressMessageRequest): string {
  const translationKey: string | null = progressStageTranslationKey(request.stage);
  if (translationKey !== null) {
    const translatedMessage: string | null | undefined = request.translate(translationKey);
    // Transloco devuelve la propia clave cuando no existe entrada: nunca se pinta cruda.
    if (
      typeof translatedMessage === 'string' &&
      translatedMessage.trim() !== '' &&
      translatedMessage !== translationKey
    ) {
      return translatedMessage;
    }
  }

  const backendMessage: string = (request.backendMessage ?? '').trim();
  const backendLanguageIsActive: boolean =
    request.activeLanguage === null || request.activeLanguage === PROGRESS_BACKEND_LANGUAGE;
  if (backendMessage !== '' && backendLanguageIsActive) {
    return backendMessage;
  }

  return request.fallbackMessage;
}

/** Campos del snapshot que interesan para elegir el texto de progreso. */
export interface ProgressSnapshotText {
  readonly progress_stage?: string | null;
  readonly progress_message?: string | null;
}

/** Contrato mínimo para resolver el texto de progreso desde un workflow service. */
export interface ProgressTextSource {
  /** Mensaje legible del snapshot, priorizando el stage traducible. */
  resolve(snapshot: ProgressSnapshotText | null, fallbackMessage: string): string;
}

/** Resolutor sin i18n (SSR o inyectores de prueba planos): mantiene el comportamiento previo. */
export const UNTRANSLATED_PROGRESS_TEXT: ProgressTextSource = {
  resolve: (snapshot: ProgressSnapshotText | null, fallbackMessage: string): string => {
    const backendMessage: string = (snapshot?.progress_message ?? '').trim();
    return backendMessage === '' ? fallbackMessage : backendMessage;
  },
};
