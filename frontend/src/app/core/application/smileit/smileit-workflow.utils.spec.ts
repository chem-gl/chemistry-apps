// smileit-workflow.utils.spec.ts: Pruebas unitarias de las utilidades puras del workflow Smileit.
// Cubre: extractRequestErrorMessage, parseAtomIndicesInput, detectChemicalNotation,
//        escapeRegExp, toggleString, dedupeVersionedEntries, buildCatalogGroups.

import { describe, expect, it } from 'vitest';

import { VerificationRuleEnum } from '../../api/generated';
import {
  buildCatalogGroups,
  dedupeVersionedEntries,
  detectChemicalNotation,
  escapeRegExp,
  extractRequestErrorMessage,
  parseAtomIndicesInput,
  parseSingleAnchorIndexInput,
  toggleString,
} from './smileit-workflow.utils';

import type { SmileitCatalogEntryView, SmileitCategoryView } from '../../api/jobs-api.service';

// ---------------------------------------------------------------------------
// Fixtures reutilizables
// ---------------------------------------------------------------------------

function makeCatalogEntry(
  overrides: Partial<SmileitCatalogEntryView> = {},
): SmileitCatalogEntryView {
  return {
    id: 'e-1',
    stable_id: 'aniline',
    version: 1,
    name: 'Aniline',
    smiles: '[NH2]c1ccccc1',
    anchor_atom_indices: [0],
    categories: ['aromatic'],
    source_reference: 'seed',
    provenance_metadata: {},
    ...overrides,
  };
}

function makeCategory(key: string, name: string): SmileitCategoryView {
  return {
    id: `cat-${key}`,
    key,
    version: 1,
    name,
    description: '',
    verification_rule: VerificationRuleEnum.Aromatic,
    verification_smarts: '',
  };
}

// ---------------------------------------------------------------------------
// extractRequestErrorMessage
// ---------------------------------------------------------------------------

describe('extractRequestErrorMessage', () => {
  it('extrae el message de un Error nativo', () => {
    expect(extractRequestErrorMessage(new Error('Conexión rechazada'))).toBe('Conexión rechazada');
  });

  it('retorna fallback para valores primitivos no-objeto', () => {
    expect(extractRequestErrorMessage(null)).toBe('Unexpected request failure.');
    expect(extractRequestErrorMessage(undefined)).toBe('Unexpected request failure.');
    expect(extractRequestErrorMessage(42)).toBe('Unexpected request failure.');
  });

  it('extrae mensaje desde error.error como cadena', () => {
    const httpError = { error: 'Token inválido' };
    expect(extractRequestErrorMessage(httpError)).toBe('Token inválido');
  });

  it('extrae y une los mensajes cuando error.error es un array de strings', () => {
    const httpError = { error: ['Campo requerido', 'Formato inválido'] };
    expect(extractRequestErrorMessage(httpError)).toBe('Campo requerido Formato inválido');
  });

  it('extrae mensajes desde un objeto error.error con valores string y array', () => {
    const httpError = {
      error: {
        name: 'SMILES inválido',
        suggestions: ['Verificar paréntesis', 'Revisar aromaticidad'],
      },
    };
    const result = extractRequestErrorMessage(httpError);
    expect(result).toContain('SMILES inválido');
    expect(result).toContain('Verificar paréntesis');
  });

  it('retorna fallback cuando error.error es un objeto sin strings válidos', () => {
    const httpError = { error: { count: 0, valid: false } };
    expect(extractRequestErrorMessage(httpError)).toBe('Unexpected request failure.');
  });

  it('ignora cadenas vacías en arrays', () => {
    const httpError = { error: ['', '  ', 'Error real'] };
    expect(extractRequestErrorMessage(httpError)).toBe('Error real');
  });

  it('retorna fallback cuando error.error es un array vacío', () => {
    const httpError = { error: [] };
    expect(extractRequestErrorMessage(httpError)).toBe('Unexpected request failure.');
  });
});

// ---------------------------------------------------------------------------
// parseAtomIndicesInput / parseSingleAnchorIndexInput
// ---------------------------------------------------------------------------

describe('parseAtomIndicesInput', () => {
  it('parsea índices separados por comas y elimina duplicados', () => {
    expect(parseAtomIndicesInput('3, 1, 3, 0')).toEqual([0, 1, 3]);
  });

  it('ignora tokens no-numéricos y negativos', () => {
    expect(parseAtomIndicesInput('abc, -1, 2')).toEqual([2]);
  });

  it('retorna array vacío para entrada vacía', () => {
    expect(parseAtomIndicesInput('')).toEqual([]);
  });

  it('ordena los índices de menor a mayor', () => {
    expect(parseAtomIndicesInput('5,2,8,1')).toEqual([1, 2, 5, 8]);
  });
});

describe('parseSingleAnchorIndexInput', () => {
  it('retorna como máximo un índice', () => {
    expect(parseSingleAnchorIndexInput('3, 1, 0')).toEqual([0]);
  });

  it('retorna array vacío cuando la entrada es inválida', () => {
    expect(parseSingleAnchorIndexInput('abc')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// escapeRegExp
// ---------------------------------------------------------------------------

describe('escapeRegExp', () => {
  it('escapa caracteres especiales de regex', () => {
    const pattern = 'C(=O)[OH].test*';
    const escaped = escapeRegExp(pattern);
    expect(new RegExp(escaped).test(pattern)).toBe(true);
  });

  it('no modifica strings sin caracteres especiales', () => {
    expect(escapeRegExp('simple')).toBe('simple');
  });
});

// ---------------------------------------------------------------------------
// toggleString
// ---------------------------------------------------------------------------

describe('toggleString', () => {
  it('agrega el valor si no existe, manteniendo orden alfabético', () => {
    expect(toggleString(['b', 'd'], 'a')).toEqual(['a', 'b', 'd']);
  });

  it('elimina el valor si ya existe', () => {
    expect(toggleString(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });
});

// ---------------------------------------------------------------------------
// dedupeVersionedEntries
// ---------------------------------------------------------------------------

describe('dedupeVersionedEntries', () => {
  it('elimina entradas duplicadas conservando la primera aparición', () => {
    const entries = [
      makeCatalogEntry({ stable_id: 'a', version: 1, name: 'First' }),
      makeCatalogEntry({ stable_id: 'a', version: 1, name: 'Duplicate' }),
      makeCatalogEntry({ stable_id: 'b', version: 1, name: 'Unique' }),
    ];
    const result = dedupeVersionedEntries(entries);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('First');
    expect(result[1].name).toBe('Unique');
  });

  it('distingue versiones distintas del mismo stable_id', () => {
    const entries = [
      makeCatalogEntry({ stable_id: 'a', version: 1 }),
      makeCatalogEntry({ stable_id: 'a', version: 2 }),
    ];
    expect(dedupeVersionedEntries(entries)).toHaveLength(2);
  });

  it('retorna array vacío para entrada vacía', () => {
    expect(dedupeVersionedEntries([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// detectChemicalNotation
// ---------------------------------------------------------------------------

describe('detectChemicalNotation', () => {
  it('detecta SMILES válido', () => {
    expect(detectChemicalNotation('c1ccccc1')).toBe('smiles');
    expect(detectChemicalNotation('CC(=O)O')).toBe('smiles');
  });

  it('detecta notación SMARTS por marcadores', () => {
    expect(detectChemicalNotation('[#6]')).toBe('smiles');
    expect(detectChemicalNotation('c1ccccc1*')).toBe('smarts');
    expect(detectChemicalNotation('[$([NH2])]')).toBe('smarts');
  });

  it('retorna empty para cadena vacía o solo espacios', () => {
    expect(detectChemicalNotation('')).toBe('empty');
    expect(detectChemicalNotation('   ')).toBe('empty');
  });
});

// ---------------------------------------------------------------------------
// buildCatalogGroups
// ---------------------------------------------------------------------------

describe('buildCatalogGroups', () => {
  const categories: SmileitCategoryView[] = [
    makeCategory('aromatic', 'Aromatic'),
    makeCategory('polar', 'Polar'),
  ];

  it('agrupa entradas por categoría y ordena nombres de entradas', () => {
    const entries: SmileitCatalogEntryView[] = [
      makeCatalogEntry({ stable_id: 'b', name: 'Beta', categories: ['aromatic'] }),
      makeCatalogEntry({ stable_id: 'a', name: 'Alpha', categories: ['aromatic'] }),
    ];
    const groups = buildCatalogGroups(entries, categories);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('aromatic');
    expect(groups[0].entries[0].name).toBe('Alpha');
    expect(groups[0].entries[1].name).toBe('Beta');
  });

  it('asigna entradas sin categoría al grupo Uncategorized', () => {
    const entries: SmileitCatalogEntryView[] = [
      makeCatalogEntry({ stable_id: 'x', categories: [] }),
    ];
    const groups = buildCatalogGroups(entries, []);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('uncategorized');
    expect(groups[0].name).toBe('Uncategorized');
  });

  it('permite que una entrada pertenezca a múltiples categorías', () => {
    const entries: SmileitCatalogEntryView[] = [
      makeCatalogEntry({ stable_id: 'c', categories: ['aromatic', 'polar'] }),
    ];
    const groups = buildCatalogGroups(entries, categories);
    expect(groups).toHaveLength(2);
  });

  it('retorna array vacío para entradas vacías', () => {
    expect(buildCatalogGroups([], categories)).toEqual([]);
  });
});
