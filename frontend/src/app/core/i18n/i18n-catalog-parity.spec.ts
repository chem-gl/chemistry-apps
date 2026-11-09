// i18n-catalog-parity.spec.ts: Paridad estructural de los catálogos i18n de los ocho idiomas.
// Transloco resuelve cada clave contra el JSON del idioma activo: si un idioma pierde una
// clave, la UI muestra la ruta cruda; si declara otro nombre de placeholder (`{{ name }}`
// frente a `{{n}}`), la interpolación deja de sustituir el valor. El catálogo base es
// `en.json` y la convención del proyecto es la forma compacta `{{name}}`.

import { describe, expect, it } from 'vitest';
import deCatalog from '../../../../public/i18n/de.json';
import enCatalog from '../../../../public/i18n/en.json';
import esCatalog from '../../../../public/i18n/es.json';
import frCatalog from '../../../../public/i18n/fr.json';
import hiCatalog from '../../../../public/i18n/hi.json';
import jaCatalog from '../../../../public/i18n/ja.json';
import ruCatalog from '../../../../public/i18n/ru.json';
import zhCatalog from '../../../../public/i18n/zh-CN.json';
import { SUPPORTED_LANGUAGE_CODES, SupportedLanguageCode } from './supported-languages';

/** Hoja del catálogo: ruta separada por puntos (`cadmaPy.step2.showingFirst`) y su texto. */
interface CatalogLeaf {
  readonly path: string;
  readonly value: string;
}

/**
 * Claves hoja del catálogo base. Al añadir o quitar texto visible hay que actualizar el
 * umbral a conciencia: es el tripwire de que los ocho idiomas siguen en paridad
 * (normalizador: `scripts/normalize_i18n_placeholders.py`).
 */
const BASE_CATALOG_LEAVES = 1669;

const PLACEHOLDER_PATTERN = /\{\{([^{}]*)\}\}/g;
const SPACED_PLACEHOLDER_PATTERN = /\{\{\s|\s\}\}/;

const LANGUAGE_CATALOGS: ReadonlyArray<readonly [SupportedLanguageCode, unknown]> = [
  ['en', enCatalog],
  ['es', esCatalog],
  ['fr', frCatalog],
  ['ru', ruCatalog],
  ['zh-CN', zhCatalog],
  ['hi', hiCatalog],
  ['de', deCatalog],
  ['ja', jaCatalog],
];

/** Recorre el JSON importado y devuelve sus hojas string en orden de aparición. */
function collectLeaves(node: unknown, prefix = ''): CatalogLeaf[] {
  if (typeof node === 'string') {
    return prefix ? [{ path: prefix, value: node }] : [];
  }
  if (Array.isArray(node)) {
    return node.flatMap((item: unknown, index: number) =>
      collectLeaves(item, `${prefix}[${index}]`),
    );
  }
  if (node !== null && typeof node === 'object') {
    return Object.entries(node as Record<string, unknown>).flatMap(
      ([key, value]: [string, unknown]) => collectLeaves(value, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [];
}

function leavesByPath(catalog: unknown): Map<string, string> {
  return new Map(
    collectLeaves(catalog).map((leaf: CatalogLeaf) => [leaf.path, leaf.value] as const),
  );
}

/** Nombres de placeholder declarados en un texto, sin espacios y en orden de aparición. */
function placeholdersOf(value: string): string[] {
  return [...value.matchAll(PLACEHOLDER_PATTERN)].map((match: RegExpMatchArray) => match[1].trim());
}

/** Placeholders escritos con espacios internos (`{{ name }}`), que violan la convención. */
function spacedPlaceholdersOf(path: string, value: string): string[] {
  return [...value.matchAll(PLACEHOLDER_PATTERN)]
    .map((match: RegExpMatchArray) => match[0])
    .filter((token: string) => SPACED_PLACEHOLDER_PATTERN.test(token))
    .map((token: string) => `${path}: ${token}`);
}

const textsByLanguage: ReadonlyArray<readonly [SupportedLanguageCode, Map<string, string>]> =
  LANGUAGE_CATALOGS.map(([code, catalog]) => [code, leavesByPath(catalog)] as const);
const referenceLanguage: SupportedLanguageCode = 'en';
const referenceTexts: Map<string, string> =
  textsByLanguage.find(([code]) => code === referenceLanguage)?.[1] ?? new Map();
const referencePaths: string[] = [...referenceTexts.keys()];

describe('paridad de los catálogos i18n', () => {
  it('cubre exactamente los ocho idiomas soportados', () => {
    const catalogued: string[] = LANGUAGE_CATALOGS.map(([code]) => code);
    expect([...catalogued].sort()).toEqual([...SUPPORTED_LANGUAGE_CODES].sort());
  });

  it('mantiene el recuento de claves del catálogo base', () => {
    expect(referencePaths).toHaveLength(BASE_CATALOG_LEAVES);
  });

  it.each(textsByLanguage.map(([code]) => code))(
    '%s declara las mismas claves que en.json',
    (code: SupportedLanguageCode) => {
      const texts: Map<string, string> =
        textsByLanguage.find(([candidate]) => candidate === code)?.[1] ?? new Map();
      expect([...texts.keys()].sort()).toEqual([...referencePaths].sort());
    },
  );

  it.each(textsByLanguage.map(([code]) => code))(
    '%s usa la forma compacta {{name}}',
    (code: SupportedLanguageCode) => {
      const texts: Map<string, string> =
        textsByLanguage.find(([candidate]) => candidate === code)?.[1] ?? new Map();
      const offenders: string[] = [...texts].flatMap(([path, value]) =>
        spacedPlaceholdersOf(path, value),
      );
      expect(offenders).toEqual([]);
    },
  );

  it('declara los mismos placeholders por clave en todos los idiomas', () => {
    const mismatches: string[] = textsByLanguage.flatMap(([code, texts]) =>
      referencePaths.flatMap((path: string) => {
        const expected: string[] = placeholdersOf(referenceTexts.get(path) ?? '');
        const actual: string[] = placeholdersOf(texts.get(path) ?? '');
        return actual.join('|') === expected.join('|')
          ? []
          : [`${code} ${path}: [${actual.join(', ')}] ≠ en [${expected.join(', ')}]`];
      }),
    );
    expect(mismatches).toEqual([]);
  });
});
