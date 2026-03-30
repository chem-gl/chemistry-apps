// smileit-atom-selection.utils.spec.ts: Pruebas unitarias de utilidades puras de selección atómica en Smileit.

import { describe, expect, it } from 'vitest';
import { SmileitStructureInspectionView } from '../core/api/jobs-api.service';

import {
  formatAtomIndices,
  hasSameNumberSet,
  normalizeAnchorIndices,
  parseAtomIndicesInput,
  resolveDefaultAnchorIndices,
  resolveSingleValidAnchorSelection,
  resolveValidAnchorSelection,
  toggleAtomSelection,
} from './smileit-atom-selection.utils';

describe('smileit-atom-selection.utils', () => {
  const inspectionFixture: SmileitStructureInspectionView = {
    canonicalSmiles: 'C[H]ON',
    atomCount: 4,
    atoms: [
      { index: 0, symbol: 'C', implicitHydrogens: 0, isAromatic: false },
      { index: 1, symbol: 'H', implicitHydrogens: 0, isAromatic: false },
      { index: 2, symbol: 'O', implicitHydrogens: 0, isAromatic: false },
      { index: 3, symbol: 'N', implicitHydrogens: 0, isAromatic: false },
    ],
    svg: '<svg></svg>',
    quickProperties: {
      molecular_weight: 58.08,
      clogp: 0.12,
      rotatable_bonds: 0,
      hbond_donors: 1,
      hbond_acceptors: 2,
      tpsa: 26.0,
      aromatic_rings: 0,
    },
    annotations: [],
    activePatternRefs: [],
  };

  it('normalizes anchor indices by sorting and deduplicating', () => {
    expect(normalizeAnchorIndices([3, 1, 3, 0])).toEqual([0, 1, 3]);
  });

  it('parses atom indices input ignoring invalid tokens', () => {
    expect(parseAtomIndicesInput('3, 1, foo, -1, 3')).toEqual([1, 3]);
  });

  it('formats atom indices as csv', () => {
    expect(formatAtomIndices([1, 2, 4])).toBe('1,2,4');
  });

  it('compares number sets preserving order semantics', () => {
    expect(hasSameNumberSet([1, 2], [1, 2])).toBe(true);
    expect(hasSameNumberSet([1, 2], [2, 1])).toBe(false);
  });

  it('resolves valid anchor selection and falls back to defaults', () => {
    expect(resolveValidAnchorSelection([2, 3], inspectionFixture)).toEqual([2, 3]);
    expect(resolveValidAnchorSelection([8], inspectionFixture)).toEqual([0, 2, 3]);
  });

  it('resolves single valid anchor selection', () => {
    expect(resolveSingleValidAnchorSelection([3, 0], inspectionFixture)).toEqual([0]);
  });

  it('toggles atom selection and keeps normalized ordering', () => {
    expect(toggleAtomSelection([1, 3], 1)).toEqual([3]);
    expect(toggleAtomSelection([3], 2)).toEqual([2, 3]);
  });

  it('resolves default anchors prioritizing non-hydrogen atoms', () => {
    expect(resolveDefaultAnchorIndices(inspectionFixture)).toEqual([0, 2, 3]);
  });
});
