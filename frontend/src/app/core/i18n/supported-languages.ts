// supported-languages.ts: Registro tipado de idiomas soportados y metadatos visuales para selector global.

export const SUPPORTED_LANGUAGE_CODES = [
  'en',
  'es',
  'fr',
  'ru',
  'zh-CN',
  'hi',
  'de',
  'ja',
] as const;

export type SupportedLanguageCode = (typeof SUPPORTED_LANGUAGE_CODES)[number];

export interface SupportedLanguageOption {
  code: SupportedLanguageCode;
  name: string;
  nativeName: string;
  flagEmoji: string;
}

export const SUPPORTED_LANGUAGE_OPTIONS: ReadonlyArray<SupportedLanguageOption> = [
  { code: 'en', name: 'English', nativeName: 'English', flagEmoji: '🇺🇸' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', flagEmoji: '🇪🇸' },
  { code: 'fr', name: 'French', nativeName: 'Français', flagEmoji: '🇫🇷' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', flagEmoji: '🇷🇺' },
  { code: 'zh-CN', name: 'Mandarin Chinese', nativeName: '中文（简体）', flagEmoji: '🇨🇳' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', flagEmoji: '🇮🇳' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', flagEmoji: '🇩🇪' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', flagEmoji: '🇯🇵' },
];

export const DEFAULT_LANGUAGE: SupportedLanguageCode = 'en';
