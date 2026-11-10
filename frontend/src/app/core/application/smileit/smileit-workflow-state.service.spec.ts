// smileit-workflow-state.service.spec.ts: Pruebas del estimador combinatorio y avisos/límites.
// Cubre: estimatedDerivatives, showsCombinatorialWarning, exceedsHardLimit y canDispatch.

import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { SmileitWorkflowState } from './smileit-workflow-state.service';
import type {
  SmileitAssignmentBlockDraft,
  SmileitManualSubstituentDraft,
} from './smileit-workflow.types';

function makeManualSubstituents(count: number): SmileitManualSubstituentDraft[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `Manual ${index + 1}`,
    smiles: 'C',
    anchorAtomIndices: [0],
    categories: [],
    sourceReference: 'manual-ui',
    provenanceMetadata: {},
  }));
}

function makeBlock(
  siteAtomIndices: number[],
  manualCount: number,
): SmileitAssignmentBlockDraft {
  return {
    id: `block-${siteAtomIndices.join('-')}`,
    label: 'Combinatorial block',
    siteAtomIndices,
    categoryKeys: [],
    catalogRefs: [],
    manualSubstituents: makeManualSubstituents(manualCount),
    draftManualName: '',
    draftManualSmiles: '',
    draftManualAnchorIndicesText: '0',
    draftManualSourceReference: 'manual-ui',
    draftManualCategoryKeys: [],
  };
}

describe('SmileitWorkflowState estimación combinatoria', () => {
  let state: SmileitWorkflowState;

  beforeEach(() => {
    const injector: Injector = Injector.create({
      providers: [SmileitWorkflowState],
    });
    state = runInInjectionContext(injector, () => new SmileitWorkflowState());
  });

  it('estima 0 sin bloques y no avisa ni bloquea', () => {
    state.selectedAtomIndices.set([0]);
    state.assignmentBlocks.set([]);

    expect(state.estimatedDerivatives()).toBe(0);
    expect(state.showsCombinatorialWarning()).toBe(false);
    expect(state.exceedsHardLimit()).toBe(false);
  });

  it('estima la cota de moléculas distintas y avisa sobre 1000 sin bloquear', () => {
    state.selectedAtomIndices.set([0, 1]);
    state.assignmentBlocks.set([makeBlock([0, 1], 40)]);
    state.rSubstitutes.set(2);

    // e1 = 80, e2 = 1600 → 80 + 1600 = 1680 moléculas distintas (sin k!).
    expect(state.estimatedDerivatives()).toBe(1680);
    expect(state.showsCombinatorialWarning()).toBe(true);
    expect(state.exceedsHardLimit()).toBe(false);
  });

  it('marca exceedsHardLimit y bloquea dispatch sobre 1e6', () => {
    state.principalSmiles.set('c1ccccc1');
    state.inspectedPrincipalSmiles.set('c1ccccc1');
    state.selectedAtomIndices.set([0, 1, 2]);
    state.assignmentBlocks.set([makeBlock([0, 1, 2], 200)]);
    state.rSubstitutes.set(3);

    expect(state.exceedsHardLimit()).toBe(true);
    expect(state.canDispatch()).toBe(false);
  });

  it('permite dispatch con cobertura completa bajo el tope', () => {
    state.principalSmiles.set('c1ccccc1');
    state.inspectedPrincipalSmiles.set('c1ccccc1');
    state.selectedAtomIndices.set([0]);
    state.assignmentBlocks.set([makeBlock([0], 2)]);
    state.rSubstitutes.set(1);

    expect(state.estimatedDerivatives()).toBe(2);
    expect(state.showsCombinatorialWarning()).toBe(false);
    expect(state.exceedsHardLimit()).toBe(false);
    expect(state.canDispatch()).toBe(true);
  });
});
