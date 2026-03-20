// smileit-workflow.service.spec.ts: Pruebas unitarias del flujo Smile-it con bloques, cobertura y trazabilidad.

import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { Observable, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SiteOverlapPolicyEnum } from '../api/generated';
import {
  JobLogsPageView,
  JobsApiService,
  SmileitCatalogEntryView,
  SmileitCategoryView,
  SmileitJobResponseView,
  SmileitPatternEntryView,
} from '../api/jobs-api.service';
import { SmileitAssignmentBlockDraft, SmileitWorkflowService } from './smileit-workflow.service';

function makeCatalogEntry(): SmileitCatalogEntryView {
  return {
    id: 'catalog-1',
    stable_id: 'aniline',
    version: 3,
    name: 'Aniline',
    smiles: '[NH2]c1ccccc1',
    anchor_atom_indices: [0],
    categories: ['aromatic', 'hbond_donor'],
    source_reference: 'seed',
    provenance_metadata: {},
  };
}

function makeEditableCatalogEntry(): SmileitCatalogEntryView {
  return {
    ...makeCatalogEntry(),
    id: 'catalog-custom-1',
    stable_id: 'custom-1',
    source_reference: 'local-lab',
    provenance_metadata: {},
  };
}

function makeCategory(): SmileitCategoryView {
  return {
    id: 'category-1',
    key: 'aromatic',
    version: 1,
    name: 'Aromatic',
    description: 'Contains aromatic contribution',
    verification_rule: 'aromatic',
    verification_smarts: '',
  };
}

function makePattern(): SmileitPatternEntryView {
  return {
    id: 'pattern-1',
    stable_id: 'nitro-alert',
    version: 1,
    name: 'Nitro Alert',
    smarts: '[N+](=O)[O-]',
    pattern_type: 'toxicophore',
    caption: 'Potential nitro alert',
    source_reference: 'seed',
    provenance_metadata: {},
  };
}

function makeAssignmentBlock(): SmileitAssignmentBlockDraft {
  return {
    id: 'block-1',
    label: 'Aromatic sweep',
    siteAtomIndices: [1],
    categoryKeys: ['aromatic'],
    catalogRefs: [makeCatalogEntry()],
    manualSubstituents: [
      {
        name: 'Manual amino',
        smiles: '[NH2]',
        anchorAtomIndices: [0],
        categories: ['hbond_donor'],
        sourceReference: 'manual-ui',
        provenanceMetadata: {},
      },
    ],
    draftManualName: '',
    draftManualSmiles: '',
    draftManualAnchorIndicesText: '0',
    draftManualSourceReference: 'manual-ui',
    draftManualCategoryKeys: [],
  };
}

function makeSmileitJob(overrides: Partial<SmileitJobResponseView> = {}): SmileitJobResponseView {
  return {
    id: 'smileit-job-1',
    job_hash: 'hash-1',
    plugin_name: 'smileit',
    algorithm_version: '2.0.0',
    status: 'completed',
    cache_hit: false,
    cache_miss: true,
    progress_percentage: 100,
    progress_stage: 'completed',
    progress_message: 'Completed',
    progress_event_index: 4,
    parameters: {
      principal_smiles: 'c1ccccc1',
      selected_atom_indices: [1],
      assignment_blocks: [
        {
          label: 'Aromatic sweep',
          priority: 1,
          site_atom_indices: [1],
          resolved_substituents: [
            {
              source_kind: 'catalog',
              stable_id: 'aniline',
              version: 3,
              name: 'Aniline',
              smiles: '[NH2]c1ccccc1',
              selected_atom_index: 0,
              categories: ['aromatic', 'hbond_donor'],
            },
          ],
        },
      ],
      r_substitutes: 1,
      num_bonds: 1,
      allow_repeated: false,
      max_structures: 300,
      site_overlap_policy: SiteOverlapPolicyEnum.LastBlockWins,
      export_name_base: 'smileit_run',
      export_padding: 5,
      references: {
        catalog: [],
        patterns: [],
      },
    },
    results: {
      total_generated: 1,
      generated_structures: [
        {
          name: 'smileit_run_00001',
          smiles: 'Nc1ccccc1',
          svg: '<svg></svg>',
          traceability: [
            {
              round_index: 1,
              site_atom_index: 1,
              block_label: 'Aromatic sweep',
              block_priority: 1,
              substituent_name: 'Aniline',
              substituent_stable_id: 'aniline',
              substituent_version: 3,
              source_kind: 'catalog',
              bond_order: 1,
            },
          ],
        },
      ],
      traceability_rows: [
        {
          derivative_name: 'smileit_run_00001',
          derivative_smiles: 'Nc1ccccc1',
          round_index: 1,
          site_atom_index: 1,
          block_label: 'Aromatic sweep',
          block_priority: 1,
          substituent_name: 'Aniline',
          substituent_stable_id: 'aniline',
          substituent_version: 3,
          source_kind: 'catalog',
          bond_order: 1,
        },
      ],
      truncated: false,
      principal_smiles: 'c1ccccc1',
      selected_atom_indices: [1],
      export_name_base: 'smileit_run',
      export_padding: 5,
      references: {
        catalog: [],
        patterns: [],
      },
    },
    error_trace: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('SmileitWorkflowService', () => {
  let workflowService: SmileitWorkflowService;
  const emptyLogsPage: JobLogsPageView = {
    jobId: 'smileit-job-1',
    count: 0,
    nextAfterEventIndex: 0,
    results: [],
  };

  let jobsApiServiceMock: {
    listSmileitCatalog: ReturnType<typeof vi.fn>;
    listSmileitCategories: ReturnType<typeof vi.fn>;
    listSmileitPatterns: ReturnType<typeof vi.fn>;
    inspectSmileitStructure: ReturnType<typeof vi.fn>;
    createSmileitCatalogEntry: ReturnType<typeof vi.fn>;
    updateSmileitCatalogEntry: ReturnType<typeof vi.fn>;
    dispatchSmileitJob: ReturnType<typeof vi.fn>;
    streamJobEvents: ReturnType<typeof vi.fn>;
    streamJobLogEvents: ReturnType<typeof vi.fn>;
    pollJobUntilCompleted: ReturnType<typeof vi.fn>;
    getSmileitJobStatus: ReturnType<typeof vi.fn>;
    getJobLogs: ReturnType<typeof vi.fn>;
    listJobs: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    jobsApiServiceMock = {
      listSmileitCatalog: vi.fn(
        (): Observable<SmileitCatalogEntryView[]> => of([makeCatalogEntry()]),
      ),
      listSmileitCategories: vi.fn((): Observable<SmileitCategoryView[]> => of([makeCategory()])),
      listSmileitPatterns: vi.fn((): Observable<SmileitPatternEntryView[]> => of([makePattern()])),
      inspectSmileitStructure: vi.fn(),
      createSmileitCatalogEntry: vi.fn(
        (): Observable<SmileitCatalogEntryView[]> => of([makeCatalogEntry()]),
      ),
      updateSmileitCatalogEntry: vi.fn(),
      dispatchSmileitJob: vi.fn((): Observable<SmileitJobResponseView> => of(makeSmileitJob())),
      streamJobEvents: vi.fn(),
      streamJobLogEvents: vi.fn(),
      pollJobUntilCompleted: vi.fn(),
      getSmileitJobStatus: vi.fn(),
      getJobLogs: vi.fn((): Observable<JobLogsPageView> => of(emptyLogsPage)),
      listJobs: vi.fn(() => of([])),
    };

    const injector: Injector = Injector.create({
      providers: [
        {
          provide: JobsApiService,
          useValue: jobsApiServiceMock,
        },
      ],
    });

    workflowService = runInInjectionContext(injector, () => new SmileitWorkflowService());
  });

  it('marks selected atoms as uncovered until an effective block covers all sites', () => {
    workflowService.selectedAtomIndices.set([1, 2]);
    workflowService.assignmentBlocks.set([
      {
        ...makeAssignmentBlock(),
        siteAtomIndices: [1],
      },
    ]);

    expect(workflowService.uncoveredSelectedSites()).toEqual([2]);
    expect(workflowService.canDispatch()).toBe(false);
  });

  it('dispatches Smile-it using assignment blocks, immutable refs and manual substituents', () => {
    workflowService.principalSmiles.set('c1ccccc1');
    workflowService.selectedAtomIndices.set([1]);
    workflowService.assignmentBlocks.set([makeAssignmentBlock()]);

    workflowService.dispatch();

    expect(jobsApiServiceMock.dispatchSmileitJob).toHaveBeenCalledWith({
      principalSmiles: 'c1ccccc1',
      selectedAtomIndices: [1],
      assignmentBlocks: [
        {
          label: 'Aromatic sweep',
          siteAtomIndices: [1],
          categoryKeys: ['aromatic'],
          substituentRefs: [
            {
              stableId: 'aniline',
              version: 3,
            },
          ],
          manualSubstituents: [
            {
              name: 'Manual amino',
              smiles: '[NH2]',
              anchorAtomIndices: [0],
              categories: ['hbond_donor'],
              sourceReference: 'manual-ui',
              provenanceMetadata: {},
            },
          ],
        },
      ],
      siteOverlapPolicy: 'last_block_wins',
      rSubstitutes: 1,
      numBonds: 1,
      allowRepeated: false,
      maxStructures: 0,
      exportNameBase: 'smileit_run',
      exportPadding: 5,
      version: '2.0.0',
    });

    expect(workflowService.activeSection()).toBe('result');
    expect(workflowService.resultData()?.generatedStructures.length).toBe(1);
    expect(workflowService.resultData()?.traceabilityRows.length).toBe(1);
  });

  it('loads catalog, categories and patterns together for the Smile-it workspace', () => {
    workflowService.loadInitialData();

    expect(jobsApiServiceMock.listSmileitCatalog).toHaveBeenCalledTimes(1);
    expect(jobsApiServiceMock.listSmileitCategories).toHaveBeenCalledTimes(1);
    expect(jobsApiServiceMock.listSmileitPatterns).toHaveBeenCalledTimes(1);
    expect(workflowService.catalogEntries()).toHaveLength(1);
    expect(workflowService.categories()).toHaveLength(1);
    expect(workflowService.patterns()).toHaveLength(1);
  });

  it('prunes obsolete block sites and blocks dispatch when selection expands without coverage', () => {
    workflowService.selectedAtomIndices.set([0, 1]);
    workflowService.assignmentBlocks.set([
      {
        ...makeAssignmentBlock(),
        siteAtomIndices: [0, 1],
        manualSubstituents: [],
      },
    ]);

    workflowService.toggleSelectedAtom(1);

    expect(workflowService.assignmentBlocks()[0].siteAtomIndices).toEqual([0]);
    expect(workflowService.uncoveredSelectedSites()).toEqual([]);
    expect(workflowService.canDispatch()).toBe(true);

    workflowService.toggleSelectedAtom(2);

    expect(workflowService.selectedAtomIndices()).toEqual([0, 2]);
    expect(workflowService.assignmentBlocks()[0].siteAtomIndices).toEqual([0]);
    expect(workflowService.uncoveredSelectedSites()).toEqual([2]);
    expect(workflowService.canDispatch()).toBe(false);
  });

  it('creates a new block focused on currently uncovered sites', () => {
    workflowService.selectedAtomIndices.set([0, 1, 2]);
    workflowService.assignmentBlocks.set([
      {
        ...makeAssignmentBlock(),
        siteAtomIndices: [0],
        manualSubstituents: [],
      },
    ]);

    workflowService.addAssignmentBlock();

    expect(workflowService.assignmentBlocks()).toHaveLength(2);
    expect(workflowService.assignmentBlocks()[1].label).toBe('Block 2');
    expect(workflowService.assignmentBlocks()[1].siteAtomIndices).toEqual([1, 2]);
  });

  it('initializes manual draft anchors as empty in newly created blocks', () => {
    workflowService.selectedAtomIndices.set([1, 2]);

    workflowService.addAssignmentBlock();

    expect(workflowService.assignmentBlocks()).toHaveLength(1);
    expect(workflowService.assignmentBlocks()[0].draftManualAnchorIndicesText).toBe('');
  });

  it('updates editable catalog entries using versioned endpoint', () => {
    const editableEntry: SmileitCatalogEntryView = makeEditableCatalogEntry();
    const updatedEntry: SmileitCatalogEntryView = {
      ...editableEntry,
      id: 'catalog-custom-2',
      version: 2,
      name: 'Editable catalog v2',
      smiles: 'CC1CC1',
    };

    jobsApiServiceMock.listSmileitCatalog.mockReturnValueOnce(of([editableEntry]));
    jobsApiServiceMock.updateSmileitCatalogEntry.mockReturnValueOnce(of([updatedEntry]));

    workflowService.loadInitialData();
    workflowService.beginCatalogEntryEdition(editableEntry);
    workflowService.catalogCreateName.set('Editable catalog v2');
    workflowService.catalogCreateSmiles.set('CC1CC1');
    workflowService.catalogCreateAnchorIndicesText.set('0');
    workflowService.catalogCreateCategoryKeys.set(['hydrophobic']);
    workflowService.catalogCreateSourceReference.set('local-lab');

    workflowService.createCatalogEntry();

    expect(jobsApiServiceMock.updateSmileitCatalogEntry).toHaveBeenCalledWith(
      editableEntry.stable_id,
      {
        name: 'Editable catalog v2',
        smiles: 'CC1CC1',
        anchorAtomIndices: [0],
        categoryKeys: ['hydrophobic'],
        sourceReference: 'local-lab',
        provenanceMetadata: {},
      },
    );
    expect(workflowService.isCatalogEditing()).toBe(false);
    expect(workflowService.catalogEntries()[0].version).toBe(2);
  });

  it('loads a catalog molecule into manual draft for visual atom selection', () => {
    const catalogEntry: SmileitCatalogEntryView = makeCatalogEntry();
    workflowService.assignmentBlocks.set([
      {
        ...makeAssignmentBlock(),
        draftManualName: '',
        draftManualSmiles: '',
        draftManualAnchorIndicesText: '',
        draftManualCategoryKeys: [],
      },
    ]);

    workflowService.applyCatalogEntryToManualDraft('block-1', catalogEntry);

    expect(workflowService.assignmentBlocks()[0].draftManualName).toBe(catalogEntry.name);
    expect(workflowService.assignmentBlocks()[0].draftManualSmiles).toBe(catalogEntry.smiles);
    expect(workflowService.assignmentBlocks()[0].draftManualAnchorIndicesText).toBe(
      catalogEntry.anchor_atom_indices.join(','),
    );
    expect(workflowService.assignmentBlocks()[0].draftManualCategoryKeys).toEqual(
      catalogEntry.categories,
    );
  });

  it('stages catalog SMILES drafts with independent anchors for batch save', () => {
    workflowService.categories.set([makeCategory()]);
    workflowService.catalogCreateName.set('Propyl');
    workflowService.catalogCreateSmiles.set('CCC');
    workflowService.catalogCreateAnchorIndicesText.set('2');
    workflowService.catalogCreateCategoryKeys.set(['aromatic']);

    workflowService.stageCurrentCatalogDraft();

    expect(workflowService.catalogDraftQueue()).toHaveLength(1);
    expect(workflowService.catalogDraftQueue()[0].smiles).toBe('CCC');
    expect(workflowService.catalogDraftQueue()[0].anchorAtomIndices).toEqual([2]);
    expect(workflowService.catalogCreateName()).toBe('Propyl');
    expect(workflowService.catalogCreateSmiles()).toBe('');
    expect(workflowService.catalogCreateAnchorIndicesText()).toBe('');
    expect(workflowService.catalogCreateCategoryKeys()).toEqual(['aromatic']);
    expect(workflowService.catalogCreateSourceReference()).toBe('local-lab');
  });

  it('keeps batch defaults after staging so another SMILES can be queued immediately', () => {
    workflowService.categories.set([makeCategory()]);
    workflowService.catalogCreateName.set('Propyl');
    workflowService.catalogCreateSmiles.set('CCC');
    workflowService.catalogCreateAnchorIndicesText.set('2');
    workflowService.catalogCreateCategoryKeys.set(['aromatic']);
    workflowService.catalogCreateSourceReference.set('local-lab');

    workflowService.stageCurrentCatalogDraft();
    workflowService.catalogCreateName.set('Nitroso');
    workflowService.catalogCreateSmiles.set('NON');
    workflowService.catalogCreateAnchorIndicesText.set('1');

    expect(workflowService.catalogDraftPreview().isReady).toBe(true);
  });

  it('saves queued catalog SMILES drafts sequentially', () => {
    const firstResponse: SmileitCatalogEntryView[] = [makeCatalogEntry()];
    const secondResponse: SmileitCatalogEntryView[] = [
      makeCatalogEntry(),
      {
        ...makeCatalogEntry(),
        id: 'catalog-2',
        stable_id: 'propyl',
        name: 'Propyl',
        smiles: 'CCC',
        anchor_atom_indices: [2],
        version: 1,
      },
    ];

    jobsApiServiceMock.createSmileitCatalogEntry
      .mockReturnValueOnce(of(firstResponse))
      .mockReturnValueOnce(of(secondResponse));

    workflowService.catalogDraftQueue.set([
      {
        id: 'catalog-draft-1',
        name: 'Ethyl',
        smiles: 'CC',
        anchorAtomIndices: [0],
        categoryKeys: ['aromatic'],
        categoryNames: ['Aromatic'],
        sourceReference: 'local-lab',
      },
    ]);
    workflowService.catalogCreateName.set('Propyl');
    workflowService.catalogCreateSmiles.set('CCC');
    workflowService.catalogCreateAnchorIndicesText.set('2');
    workflowService.catalogCreateCategoryKeys.set(['aromatic']);
    workflowService.catalogCreateSourceReference.set('local-lab');

    workflowService.createCatalogEntry();

    expect(jobsApiServiceMock.createSmileitCatalogEntry).toHaveBeenCalledTimes(2);
    expect(jobsApiServiceMock.createSmileitCatalogEntry).toHaveBeenNthCalledWith(1, {
      name: 'Ethyl',
      smiles: 'CC',
      anchorAtomIndices: [0],
      categoryKeys: ['aromatic'],
      sourceReference: 'local-lab',
      provenanceMetadata: {},
    });
    expect(jobsApiServiceMock.createSmileitCatalogEntry).toHaveBeenNthCalledWith(2, {
      name: 'Propyl',
      smiles: 'CCC',
      anchorAtomIndices: [2],
      categoryKeys: ['aromatic'],
      sourceReference: 'local-lab',
      provenanceMetadata: {},
    });
    expect(workflowService.catalogDraftQueue()).toEqual([]);
    expect(workflowService.catalogEntries()).toEqual(secondResponse);
  });

  it('builds deduplicated selectable catalog candidates for a block', () => {
    const catalogEntry: SmileitCatalogEntryView = makeCatalogEntry();
    workflowService.catalogEntries.set([catalogEntry]);

    const blockDraft: SmileitAssignmentBlockDraft = {
      ...makeAssignmentBlock(),
      catalogRefs: [catalogEntry],
      categoryKeys: ['aromatic'],
    };

    const selectableEntries = workflowService.getSelectableCatalogEntriesForBlock(blockDraft);

    expect(selectableEntries).toHaveLength(1);
    expect(selectableEntries[0].stable_id).toBe(catalogEntry.stable_id);
  });

  it('warns when catalog draft looks like SMARTS instead of SMILES', () => {
    workflowService.catalogCreateName.set('Potential SMARTS Draft');
    workflowService.catalogCreateSmiles.set('[#6]-[*]');
    workflowService.catalogCreateAnchorIndicesText.set('0');
    workflowService.catalogCreateCategoryKeys.set(['aromatic']);

    const catalogPreview = workflowService.catalogDraftPreview();

    expect(catalogPreview.notationKind).toBe('smarts');
    expect(catalogPreview.isReady).toBe(false);
    expect(catalogPreview.warnings[0]).toContain('SMILES');
  });

  it('keeps only one catalog anchor index even if several are provided in state', () => {
    workflowService.categories.set([makeCategory()]);
    workflowService.catalogCreateName.set('Propyl');
    workflowService.catalogCreateSmiles.set('CCC');
    workflowService.catalogCreateAnchorIndicesText.set('0,2,5');
    workflowService.catalogCreateCategoryKeys.set(['aromatic']);

    const catalogPreview = workflowService.catalogDraftPreview();

    expect(catalogPreview.anchorAtomIndices).toEqual([0]);
    expect(catalogPreview.isReady).toBe(true);
  });

  it('builds collapsed summary with selected sites and rendered structure counters', () => {
    const summary = workflowService.getBlockCollapsedSummary(makeAssignmentBlock());

    expect(summary.selectedSitesLabel).toBe('1');
    expect(summary.categoriesLabel).toContain('aromatic');
    expect(summary.catalogSmilesLabel).toBe('1 rendered structure');
    expect(summary.manualSmilesLabel).toBe('1 rendered structure');
    expect(summary.sourceCount).toBe(3);
  });

  it('adds manual substituents using block categories when draft categories are empty', () => {
    workflowService.categories.set([makeCategory()]);
    workflowService.assignmentBlocks.set([
      {
        ...makeAssignmentBlock(),
        manualSubstituents: [],
        categoryKeys: ['aromatic'],
        draftManualName: 'Current amino',
        draftManualSmiles: 'CCNO',
        draftManualAnchorIndicesText: '0',
        draftManualCategoryKeys: [],
      },
    ]);

    workflowService.addManualSubstituentToBlock('block-1');

    expect(workflowService.assignmentBlocks()[0].manualSubstituents).toHaveLength(1);
    expect(workflowService.assignmentBlocks()[0].manualSubstituents[0].categories).toEqual([
      'aromatic',
    ]);
    expect(workflowService.assignmentBlocks()[0].draftManualAnchorIndicesText).toBe('');
    expect(workflowService.errorMessage()).toBeNull();
  });

  it('restores legacy historical jobs even when assignment blocks are missing', () => {
    const legacyJob: SmileitJobResponseView = {
      ...makeSmileitJob(),
      status: 'completed',
      results: null,
      parameters: {
        principal_smiles: 'c1ccccc1',
        selected_atom_indices: [1],
        r_substitutes: 1,
        num_bonds: 1,
        allow_repeated: false,
        max_structures: 100,
      } as unknown as SmileitJobResponseView['parameters'],
    };

    jobsApiServiceMock.getSmileitJobStatus.mockReturnValueOnce(of(legacyJob));

    workflowService.openHistoricalJob('legacy-job-1');

    expect(workflowService.activeSection()).toBe('result');
    expect(workflowService.resultData()?.assignmentBlocks).toEqual([]);
    expect(workflowService.resultData()?.exportNameBase).toBe('SMILEIT');
    expect(workflowService.resultData()?.isHistoricalSummary).toBe(true);
  });
});
