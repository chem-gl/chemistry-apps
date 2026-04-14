// smileit-catalog-workflow.service.spec.ts: Pruebas unitarias del subflujo de catalogo Smileit.
// Cubre carga inicial, borradores, creacion/edicion de catalogo y patrones SMARTS.

import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PatternTypeEnum } from '../../api/generated';
import type {
  SmileitCatalogEntryView,
  SmileitCategoryView,
  SmileitPatternEntryView,
} from '../../api/jobs-api.service';
import { SmileitApiService } from '../../api/smileit-api.service';
import { IdentitySessionService } from '../../auth/identity-session.service';
import { SmileitCatalogWorkflowService } from './smileit-catalog-workflow.service';
import { SmileitWorkflowState } from './smileit-workflow-state.service';

function makeCatalogEntry(
  overrides: Partial<SmileitCatalogEntryView> = {},
): SmileitCatalogEntryView {
  return {
    id: 'catalog-1',
    stable_id: 'aniline',
    version: 1,
    name: 'Aniline',
    smiles: 'Nc1ccccc1',
    anchor_atom_indices: [0],
    categories: ['aromatic'],
    source_reference: 'local-lab',
    provenance_metadata: {},
    ...overrides,
  };
}

function makeCategory(overrides: Partial<SmileitCategoryView> = {}): SmileitCategoryView {
  return {
    id: 'category-1',
    key: 'aromatic',
    version: 1,
    name: 'Aromatic',
    description: 'Aromatic category',
    verification_rule: 'aromatic',
    verification_smarts: '',
    ...overrides,
  };
}

function makePattern(overrides: Partial<SmileitPatternEntryView> = {}): SmileitPatternEntryView {
  return {
    id: 'pattern-1',
    stable_id: 'nitro-alert',
    version: 1,
    name: 'Nitro Alert',
    smarts: '[N+](=O)[O-]',
    pattern_type: PatternTypeEnum.Toxicophore,
    caption: 'Nitro pattern',
    source_reference: 'local-lab',
    provenance_metadata: {},
    ...overrides,
  };
}

describe('SmileitCatalogWorkflowService', () => {
  let state: SmileitWorkflowState;
  let service: SmileitCatalogWorkflowService;

  let smileitApiMock: {
    listSmileitCatalog: ReturnType<typeof vi.fn>;
    listSmileitCategories: ReturnType<typeof vi.fn>;
    listSmileitPatterns: ReturnType<typeof vi.fn>;
    createSmileitCatalogEntry: ReturnType<typeof vi.fn>;
    updateSmileitCatalogEntry: ReturnType<typeof vi.fn>;
    createSmileitPatternEntry: ReturnType<typeof vi.fn>;
    updateSmileitPatternEntry: ReturnType<typeof vi.fn>;
    deleteSmileitPatternEntry: ReturnType<typeof vi.fn>;
  };

  const identitySessionMock = {
    currentUser: vi.fn(() => ({ id: 2 })),
    currentRole: vi.fn(() => 'admin'),
  };

  beforeEach(() => {
    smileitApiMock = {
      listSmileitCatalog: vi.fn(
        (): Observable<SmileitCatalogEntryView[]> => of([makeCatalogEntry()]),
      ),
      listSmileitCategories: vi.fn((): Observable<SmileitCategoryView[]> => of([makeCategory()])),
      listSmileitPatterns: vi.fn((): Observable<SmileitPatternEntryView[]> => of([makePattern()])),
      createSmileitCatalogEntry: vi.fn(
        (): Observable<SmileitCatalogEntryView[]> => of([makeCatalogEntry()]),
      ),
      updateSmileitCatalogEntry: vi.fn(
        (): Observable<SmileitCatalogEntryView[]> => of([makeCatalogEntry()]),
      ),
      createSmileitPatternEntry: vi.fn((): Observable<unknown> => of({ ok: true })),
      updateSmileitPatternEntry: vi.fn((): Observable<unknown> => of({ ok: true })),
      deleteSmileitPatternEntry: vi.fn((): Observable<void> => of(void 0)),
    };

    const injector: Injector = Injector.create({
      providers: [
        SmileitWorkflowState,
        SmileitCatalogWorkflowService,
        {
          provide: SmileitApiService,
          useValue: smileitApiMock,
        },
        {
          provide: IdentitySessionService,
          useValue: identitySessionMock,
        },
      ],
    });

    state = injector.get(SmileitWorkflowState);
    service = runInInjectionContext(injector, () => new SmileitCatalogWorkflowService());
  });

  it('loads catalog, categories and patterns and refreshes block refs to the latest versions', () => {
    state.assignmentBlocks.set([
      {
        id: 'block-1',
        label: 'Block 1',
        siteAtomIndices: [1],
        categoryKeys: [],
        catalogRefs: [makeCatalogEntry({ stable_id: 'aniline', version: 1 })],
        manualSubstituents: [],
        draftManualName: '',
        draftManualSmiles: '',
        draftManualAnchorIndicesText: '',
        draftManualSourceReference: 'manual-ui',
        draftManualCategoryKeys: [],
      },
    ]);
    smileitApiMock.listSmileitCatalog.mockReturnValue(
      of([
        makeCatalogEntry({ stable_id: 'aniline', version: 1, name: 'Aniline v1' }),
        makeCatalogEntry({ stable_id: 'aniline', version: 2, id: 'catalog-2', name: 'Aniline v2' }),
      ]),
    );

    service.loadInitialData();

    expect(state.catalogEntries().map((entry) => entry.version)).toEqual([1, 2]);
    expect(state.assignmentBlocks()[0].catalogRefs[0].version).toBe(2);
    expect(state.categories()).toHaveLength(1);
    expect(state.patterns()).toHaveLength(1);
  });

  it('stores an actionable error when the initial Smileit reference load fails', () => {
    smileitApiMock.listSmileitCatalog.mockReturnValue(
      throwError(() => new Error('catalog unavailable')),
    );

    service.loadInitialData();

    expect(state.errorMessage()).toBe('Unable to load Smileit reference data: catalog unavailable');
  });

  it('fills default catalog draft values only when not editing an entry', () => {
    service.ensureCatalogDraftDefaults();

    expect(state.catalogCreateName()).toBe('Substituent 1');
    expect(state.catalogCreateSourceReference()).toBe('local-lab');

    state.catalogEditingStableId.set('aniline');
    state.catalogCreateName.set('Existing name');
    service.ensureCatalogDraftDefaults();

    expect(state.catalogCreateName()).toBe('Existing name');
  });

  it('toggles selected categories in the catalog draft form', () => {
    service.toggleCatalogCreateCategory('aromatic');
    expect(state.catalogCreateCategoryKeys()).toEqual(['aromatic']);

    service.toggleCatalogCreateCategory('aromatic');
    expect(state.catalogCreateCategoryKeys()).toEqual([]);
  });

  it('loads a queued draft into the form and removes it from the queue', () => {
    state.catalogDraftQueue.set([
      {
        id: 'catalog-draft-1',
        name: 'Queued draft',
        smiles: 'CCO',
        anchorAtomIndices: [2],
        categoryKeys: ['aromatic'],
        categoryNames: ['Aromatic'],
        sourceReference: 'queue-source',
      },
    ]);
    state.errorMessage.set('previous error');

    service.loadQueuedCatalogDraft('catalog-draft-1');

    expect(state.catalogCreateName()).toBe('Queued draft');
    expect(state.catalogCreateSmiles()).toBe('CCO');
    expect(state.catalogCreateAnchorIndicesText()).toBe('2');
    expect(state.catalogDraftQueue()).toEqual([]);
    expect(state.errorMessage()).toBeNull();
  });

  it('rejects invalid catalog draft creation before calling the backend', () => {
    state.catalogCreateName.set('');
    state.catalogCreateSmiles.set('CCO');
    state.catalogCreateAnchorIndicesText.set('0');

    service.createCatalogEntry();

    expect(smileitApiMock.createSmileitCatalogEntry).not.toHaveBeenCalled();
    expect(state.errorMessage()).toBe('Substituent name is required.');
  });

  it('falls back to reloading catalog entries when create returns null', () => {
    smileitApiMock.createSmileitCatalogEntry.mockReturnValue(of(null as never));
    smileitApiMock.listSmileitCatalog.mockReturnValue(
      of([makeCatalogEntry({ id: 'catalog-2', stable_id: 'propyl', name: 'Propyl' })]),
    );
    state.catalogCreateName.set('Propyl');
    state.catalogCreateSmiles.set('CCC');
    state.catalogCreateAnchorIndicesText.set('0');
    state.catalogCreateCategoryKeys.set(['aromatic']);
    state.catalogDraftQueue.set([
      {
        id: 'catalog-draft-1',
        name: 'Queued',
        smiles: 'CC',
        anchorAtomIndices: [0],
        categoryKeys: ['aromatic'],
        categoryNames: ['Aromatic'],
        sourceReference: 'local-lab',
      },
    ]);

    service.createCatalogEntry();

    expect(smileitApiMock.listSmileitCatalog).toHaveBeenCalled();
    expect(state.catalogEntries()[0].name).toBe('Propyl');
    expect(state.catalogDraftQueue()).toEqual([]);
    expect(state.catalogEditingStableId()).toBeNull();
  });

  it('falls back to catalog reload when create returns a single entry object', () => {
    smileitApiMock.createSmileitCatalogEntry.mockReturnValue(
      of(
        makeCatalogEntry({
          id: 'catalog-single',
          stable_id: 'single',
          name: 'Single result',
        }) as never,
      ),
    );
    smileitApiMock.listSmileitCatalog.mockReturnValue(
      of([makeCatalogEntry({ id: 'catalog-3', stable_id: 'uncat', name: 'Uncategorized entry' })]),
    );
    state.catalogCreateName.set('Uncategorized entry');
    state.catalogCreateSmiles.set('CCC');
    state.catalogCreateAnchorIndicesText.set('0');
    state.catalogCreateCategoryKeys.set([]);

    service.createCatalogEntry();

    expect(smileitApiMock.listSmileitCatalog).toHaveBeenCalled();
    expect(state.catalogEntries()[0].name).toBe('Uncategorized entry');
  });

  it('validates anchor indices before updating an existing persistent catalog entry', () => {
    state.catalogEditingStableId.set('aniline');
    state.catalogCreateName.set('Aniline');
    state.catalogCreateSmiles.set('Nc1ccccc1');
    state.catalogCreateAnchorIndicesText.set('');

    service.createCatalogEntry();

    expect(smileitApiMock.updateSmileitCatalogEntry).not.toHaveBeenCalled();
    expect(state.errorMessage()).toBe('Persistent catalog entry requires one anchor atom index.');
  });

  it('rejects editing of seed catalog entries and hydrates editable entries', () => {
    service.beginCatalogEntryEdition(
      makeCatalogEntry({
        stable_id: 'seed-entry',
        source_reference: 'smileit-seed',
      }),
    );
    expect(state.errorMessage()).toContain('read-only');

    service.beginCatalogEntryEdition(
      makeCatalogEntry({
        stable_id: 'editable-entry',
        name: 'Editable',
        smiles: 'CCN',
        source_reference: 'local-lab',
      }),
    );

    expect(state.catalogEditingStableId()).toBe('editable-entry');
    expect(state.catalogCreateName()).toBe('Editable');
    expect(state.catalogCreateSmiles()).toBe('CCN');
  });

  it('cancels catalog edition and restores the default form state', () => {
    state.catalogEditingStableId.set('editable-entry');
    state.catalogCreateName.set('Editable');
    state.catalogCreateSmiles.set('CCN');
    state.catalogCreateAnchorIndicesText.set('1');
    state.catalogCreateCategoryKeys.set(['aromatic']);

    service.cancelCatalogEdition();

    expect(state.catalogEditingStableId()).toBeNull();
    expect(state.catalogCreateSmiles()).toBe('');
    expect(state.catalogCreateAnchorIndicesText()).toBe('');
    expect(state.catalogCreateCategoryKeys()).toEqual([]);
  });

  it('validates required fields before creating a structural pattern', () => {
    service.createPatternEntry();

    expect(smileitApiMock.createSmileitPatternEntry).not.toHaveBeenCalled();
    expect(state.errorMessage()).toBe('Pattern registration requires name, SMARTS and caption.');
  });

  it('creates a structural pattern, refreshes the list and resets the pattern form', () => {
    const onPatternCreated = vi.fn();
    state.patternCreateName.set('Aromatic alert');
    state.patternCreateSmarts.set('c1ccccc1');
    state.patternCreateCaption.set('Aromatic motif');
    state.patternCreateType.set(PatternTypeEnum.Privileged);
    state.patternCreateSourceReference.set('pattern-lab');
    smileitApiMock.listSmileitPatterns.mockReturnValue(
      of([makePattern({ name: 'Aromatic alert', pattern_type: PatternTypeEnum.Privileged })]),
    );

    service.createPatternEntry(onPatternCreated);

    expect(smileitApiMock.createSmileitPatternEntry).toHaveBeenCalledWith({
      name: 'Aromatic alert',
      smarts: 'c1ccccc1',
      patternType: PatternTypeEnum.Privileged,
      caption: 'Aromatic motif',
      sourceReference: 'pattern-lab',
      provenanceMetadata: {},
    });
    expect(state.patterns()[0].name).toBe('Aromatic alert');
    expect(state.patternCreateName()).toBe('');
    expect(state.patternCreateSmarts()).toBe('');
    expect(state.patternCreateCaption()).toBe('');
    expect(state.patternCreateType()).toBe(PatternTypeEnum.Toxicophore);
    expect(onPatternCreated).toHaveBeenCalledTimes(1);
  });

  it('returns false and sets error from stageCurrentCatalogDraft when editing is in progress', () => {
    state.catalogEditingStableId.set('aniline');
    state.catalogCreateName.set('Test');
    state.catalogCreateSmiles.set('CCO');
    state.catalogCreateAnchorIndicesText.set('0');

    const result: boolean = service.stageCurrentCatalogDraft();

    expect(result).toBe(false);
    expect(state.errorMessage()).toContain('Finish the current catalog edition');
    expect(state.catalogDraftQueue()).toHaveLength(0);
  });

  it('returns false and sets error from stageCurrentCatalogDraft when draft preview is not ready', () => {
    state.catalogCreateName.set('');
    state.catalogCreateSmiles.set('');

    const result: boolean = service.stageCurrentCatalogDraft();

    expect(result).toBe(false);
    expect(state.errorMessage()).not.toBeNull();
    expect(state.catalogDraftQueue()).toHaveLength(0);
  });

  it('returns false from stageCurrentCatalogDraftAndPrepareNext when editing is in progress', () => {
    state.catalogEditingStableId.set('aniline');

    const result: boolean = service.stageCurrentCatalogDraftAndPrepareNext();

    expect(result).toBe(false);
    expect(state.errorMessage()).toContain('Finish the current catalog edition');
  });

  it('returns false from stageCurrentCatalogDraftAndPrepareNext when draft is not ready', () => {
    state.catalogCreateName.set('');
    state.catalogCreateSmiles.set('');

    const result: boolean = service.stageCurrentCatalogDraftAndPrepareNext();

    expect(result).toBe(false);
    expect(state.errorMessage()).not.toBeNull();
  });

  it('does nothing when loading a queued draft that does not exist', () => {
    state.catalogDraftQueue.set([
      {
        id: 'catalog-draft-1',
        name: 'Existing draft',
        smiles: 'CCO',
        anchorAtomIndices: [0],
        categoryKeys: [],
        categoryNames: [],
        sourceReference: 'local-lab',
      },
    ]);

    service.loadQueuedCatalogDraft('non-existent-id');

    expect(state.catalogDraftQueue()).toHaveLength(1);
    expect(state.catalogCreateName()).toBe('');
  });

  it('does nothing when cloning a queued draft that does not exist', () => {
    state.catalogDraftQueue.set([]);

    service.cloneQueuedCatalogDraft('non-existent-id');

    expect(state.catalogDraftQueue()).toHaveLength(0);
  });

  it('blocks createCatalogEntryAndPrepareNext when catalog editing is in progress', () => {
    state.catalogEditingStableId.set('aniline');

    service.createCatalogEntryAndPrepareNext();

    expect(smileitApiMock.createSmileitCatalogEntry).not.toHaveBeenCalled();
    expect(state.errorMessage()).toContain('Finish catalog edition');
  });

  it('blocks createCatalogEntryAndPrepareNext when draft preview is not ready', () => {
    state.catalogCreateName.set('');
    state.catalogCreateSmiles.set('');

    service.createCatalogEntryAndPrepareNext();

    expect(smileitApiMock.createSmileitCatalogEntry).not.toHaveBeenCalled();
    expect(state.errorMessage()).not.toBeNull();
  });

  it('creates entry via createCatalogEntryAndPrepareNext and prepares another form with incremented name', () => {
    const onSuccess = vi.fn();
    state.catalogCreateName.set('Substituent 1');
    state.catalogCreateSmiles.set('CCO');
    state.catalogCreateAnchorIndicesText.set('0');
    smileitApiMock.createSmileitCatalogEntry.mockReturnValue(of([makeCatalogEntry()]));

    service.createCatalogEntryAndPrepareNext(onSuccess);

    expect(smileitApiMock.createSmileitCatalogEntry).toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('sets error message when createCatalogEntryAndPrepareNext API call fails', () => {
    state.catalogCreateName.set('Substituent 1');
    state.catalogCreateSmiles.set('CCO');
    state.catalogCreateAnchorIndicesText.set('0');
    smileitApiMock.createSmileitCatalogEntry.mockReturnValue(
      throwError(() => new Error('server error')),
    );

    service.createCatalogEntryAndPrepareNext();

    expect(state.errorMessage()).toContain('Unable to create catalog entry');
    expect(state.errorMessage()).toContain('server error');
  });

  it('sets error message when updating an existing catalog entry fails', () => {
    state.catalogEditingStableId.set('aniline');
    state.catalogCreateName.set('Aniline');
    state.catalogCreateSmiles.set('Nc1ccccc1');
    state.catalogCreateAnchorIndicesText.set('0');
    smileitApiMock.updateSmileitCatalogEntry.mockReturnValue(
      throwError(() => new Error('update conflict')),
    );

    service.createCatalogEntry();

    expect(state.errorMessage()).toContain('Unable to update catalog entry');
    expect(state.errorMessage()).toContain('update conflict');
  });

  it('sets error message when createCatalogEntry API call fails for new entry', () => {
    state.catalogCreateName.set('Propyl');
    state.catalogCreateSmiles.set('CCC');
    state.catalogCreateAnchorIndicesText.set('0');
    smileitApiMock.createSmileitCatalogEntry.mockReturnValue(
      throwError(() => new Error('duplicate smiles')),
    );

    service.createCatalogEntry();

    expect(state.errorMessage()).toContain('Unable to create catalog entry');
    expect(state.errorMessage()).toContain('duplicate smiles');
  });

  it('calls onSuccess callback after successful catalog entry creation', () => {
    const onSuccess = vi.fn();
    state.catalogCreateName.set('Ethanol');
    state.catalogCreateSmiles.set('CCO');
    state.catalogCreateAnchorIndicesText.set('0');
    smileitApiMock.createSmileitCatalogEntry.mockReturnValue(of([makeCatalogEntry()]));

    service.createCatalogEntry(onSuccess);

    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('sets error message when createPatternEntry API call fails', () => {
    state.patternCreateName.set('Alert');
    state.patternCreateSmarts.set('[N+](=O)[O-]');
    state.patternCreateCaption.set('Nitro alert');
    smileitApiMock.createSmileitPatternEntry.mockReturnValue(
      throwError(() => new Error('pattern creation failed')),
    );

    service.createPatternEntry();

    expect(state.errorMessage()).toContain('Unable to create structural pattern');
    expect(state.errorMessage()).toContain('pattern creation failed');
  });

  it('sets error message when pattern list refresh fails after successful creation', () => {
    state.patternCreateName.set('Alert');
    state.patternCreateSmarts.set('[N+](=O)[O-]');
    state.patternCreateCaption.set('Nitro alert');
    smileitApiMock.createSmileitPatternEntry.mockReturnValue(of({ ok: true }));
    smileitApiMock.listSmileitPatterns.mockReturnValue(
      throwError(() => new Error('refresh failed')),
    );

    service.createPatternEntry();

    expect(state.errorMessage()).toContain('Unable to refresh structural patterns');
  });

  it('hydrates pattern form when edition is allowed and blocks seed patterns', () => {
    service.beginPatternEntryEdition(
      makePattern({
        stable_id: 'seed-pattern',
        source_reference: 'smileit-seed',
      }),
    );
    expect(state.errorMessage()).toContain('read-only');

    service.beginPatternEntryEdition(
      makePattern({
        stable_id: 'editable-pattern',
        name: 'Editable pattern',
        smarts: 'CCN',
        caption: 'Editable caption',
        source_reference: 'local-lab',
        provenance_metadata: { owner_user_id: '2' },
      }),
    );

    expect(state.patternEditingStableId()).toBe('editable-pattern');
    expect(state.patternCreateName()).toBe('Editable pattern');
    expect(state.patternCreateSmarts()).toBe('CCN');
  });

  it('updates an existing pattern when editing mode is active', () => {
    state.patternEditingStableId.set('pattern-1');
    state.patternCreateName.set('Updated pattern');
    state.patternCreateSmarts.set('c1ccccc1');
    state.patternCreateCaption.set('Updated caption');

    service.createPatternEntry();

    expect(smileitApiMock.updateSmileitPatternEntry).toHaveBeenCalledWith('pattern-1', {
      name: 'Updated pattern',
      smarts: 'c1ccccc1',
      patternType: PatternTypeEnum.Toxicophore,
      caption: 'Updated caption',
      sourceReference: 'local-lab',
      provenanceMetadata: {},
    });
  });

  it('deletes a pattern when current user has permissions', () => {
    const editablePattern = makePattern({
      stable_id: 'editable-pattern',
      source_reference: 'local-lab',
      provenance_metadata: { owner_user_id: '2' },
    });

    service.deletePatternEntry(editablePattern);

    expect(smileitApiMock.deleteSmileitPatternEntry).toHaveBeenCalledWith('editable-pattern');
  });
});
