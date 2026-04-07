// smileit-workflow.service.spec.ts: Pruebas unitarias del flujo Smile-it con bloques, cobertura y trazabilidad.

import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { Observable, Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SiteOverlapPolicyEnum } from '../api/generated';
import {
    JobLogsPageView,
    JobsApiService,
    SmileitCatalogEntryView,
    SmileitCategoryView,
    SmileitJobResponseView,
    SmileitPatternEntryView,
    SmileitStructureInspectionView,
} from '../api/jobs-api.service';
import { SmileitApiService } from '../api/smileit-api.service';
import { SmileitAssignmentBlockDraft, SmileitWorkflowService } from './smileit-workflow.service';
import { SmileitBlockWorkflowService } from './smileit/smileit-block-workflow.service';
import { SmileitCatalogWorkflowService } from './smileit/smileit-catalog-workflow.service';
import { SmileitWorkflowState } from './smileit/smileit-workflow-state.service';

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
          placeholder_assignments: [],
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
    error_trace: '',
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
    downloadSmileitCsvReport: ReturnType<typeof vi.fn>;
    downloadSmileitSmilesReport: ReturnType<typeof vi.fn>;
    downloadSmileitTraceabilityReport: ReturnType<typeof vi.fn>;
    downloadSmileitLogReport: ReturnType<typeof vi.fn>;
    downloadSmileitErrorReport: ReturnType<typeof vi.fn>;
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
      downloadSmileitCsvReport: vi.fn(),
      downloadSmileitSmilesReport: vi.fn(),
      downloadSmileitTraceabilityReport: vi.fn(),
      downloadSmileitLogReport: vi.fn(),
      downloadSmileitErrorReport: vi.fn(),
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
        {
          provide: SmileitApiService,
          useValue: jobsApiServiceMock,
        },
        SmileitWorkflowState,
        SmileitCatalogWorkflowService,
        SmileitBlockWorkflowService,
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
      maxStructures: 0,
      exportNameBase: 'smileit_run',
      exportPadding: 5,
      version: '2.0.1',
    });

    expect(workflowService.activeSection()).toBe('result');
    expect(workflowService.resultData()?.generatedStructures.length).toBe(1);
    expect(workflowService.resultData()?.traceabilityRows.length).toBe(1);
  });

  it('loads catalog, categories and patterns together for the Smile-it workspace', () => {
    workflowService.catalog.loadInitialData();

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

    workflowService.blocks.addAssignmentBlock();

    expect(workflowService.assignmentBlocks()).toHaveLength(2);
    expect(workflowService.assignmentBlocks()[1].label).toBe('Block 2');
    expect(workflowService.assignmentBlocks()[1].siteAtomIndices).toEqual([1, 2]);
  });

  it('initializes manual draft anchors as empty in newly created blocks', () => {
    workflowService.selectedAtomIndices.set([1, 2]);

    workflowService.blocks.addAssignmentBlock();

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

    workflowService.catalog.loadInitialData();
    workflowService.catalog.beginCatalogEntryEdition(editableEntry);
    workflowService.catalogCreateName.set('Editable catalog v2');
    workflowService.catalogCreateSmiles.set('CC1CC1');
    workflowService.catalogCreateAnchorIndicesText.set('0');
    workflowService.catalogCreateCategoryKeys.set(['hydrophobic']);
    workflowService.catalogCreateSourceReference.set('local-lab');

    workflowService.catalog.createCatalogEntry();

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

    workflowService.blocks.applyCatalogEntryToManualDraft('block-1', catalogEntry);

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

    workflowService.catalog.stageCurrentCatalogDraft();

    expect(workflowService.catalogDraftQueue()).toHaveLength(1);
    expect(workflowService.catalogDraftQueue()[0].smiles).toBe('CCC');
    expect(workflowService.catalogDraftQueue()[0].anchorAtomIndices).toEqual([2]);
    expect(workflowService.catalogCreateName()).toBe('Substituent 1');
    expect(workflowService.catalogCreateSmiles()).toBe('');
    expect(workflowService.catalogCreateAnchorIndicesText()).toBe('');
    expect(workflowService.catalogCreateCategoryKeys()).toEqual([]);
    expect(workflowService.catalogCreateSourceReference()).toBe('local-lab');
  });

  it('keeps smiles metadata and increments the name when staging and preparing another draft', () => {
    workflowService.catalogCreateName.set('Propyl');
    workflowService.catalogCreateSmiles.set('CCC');
    workflowService.catalogCreateAnchorIndicesText.set('2');
    workflowService.catalogCreateCategoryKeys.set(['aromatic']);
    workflowService.catalogCreateSourceReference.set('local-lab');

    workflowService.catalog.stageCurrentCatalogDraftAndPrepareNext();

    expect(workflowService.catalogDraftQueue()).toHaveLength(1);
    expect(workflowService.catalogDraftQueue()[0].name).toBe('Propyl');
    expect(workflowService.catalogCreateName()).toBe('Propyl 2');
    expect(workflowService.catalogCreateSmiles()).toBe('CCC');
    expect(workflowService.catalogCreateAnchorIndicesText()).toBe('');
    expect(workflowService.catalogCreateCategoryKeys()).toEqual(['aromatic']);
    expect(workflowService.catalogCreateSourceReference()).toBe('local-lab');
  });

  it('keeps the draft ready when defaults provide the next name after staging', () => {
    workflowService.categories.set([makeCategory()]);
    workflowService.catalogCreateName.set('Propyl');
    workflowService.catalogCreateSmiles.set('CCC');
    workflowService.catalogCreateAnchorIndicesText.set('2');
    workflowService.catalogCreateCategoryKeys.set(['aromatic']);
    workflowService.catalogCreateSourceReference.set('local-lab');

    workflowService.catalog.stageCurrentCatalogDraft();
    workflowService.catalogCreateSmiles.set('NON');
    workflowService.catalogCreateAnchorIndicesText.set('1');

    expect(workflowService.catalogCreateName()).toBe('Substituent 1');
    expect(workflowService.catalogDraftPreview().isReady).toBe(true);
    expect(workflowService.catalogDraftPreview().warnings).not.toContain(
      'Select at least one chemistry category.',
    );
  });

  it('shows missing-name error when staging a substituent without name', () => {
    workflowService.catalogCreateSmiles.set('CCC');
    workflowService.catalogCreateAnchorIndicesText.set('2');

    workflowService.catalog.stageCurrentCatalogDraft();

    expect(workflowService.errorMessage()).toBe('Substituent name is required.');
    expect(workflowService.catalogDraftQueue()).toHaveLength(0);
  });

  it('allows saving catalog draft without selecting a chemistry category', () => {
    workflowService.catalogCreateName.set('No category substituent');
    workflowService.catalogCreateSmiles.set('CCO');
    workflowService.catalogCreateAnchorIndicesText.set('1');

    const currentPreview = workflowService.catalogDraftPreview();

    expect(currentPreview.isReady).toBe(true);
    expect(currentPreview.categoryKeys).toEqual([]);
    expect(currentPreview.categoryNames).toEqual(['Uncategorized']);
  });

  it('clones queued metadata creating a new queued draft with incremental susN suffix', () => {
    workflowService.catalogDraftQueue.set([
      {
        id: 'catalog-draft-1',
        name: 'Propyl',
        smiles: 'CCC',
        anchorAtomIndices: [2],
        categoryKeys: ['aromatic'],
        categoryNames: ['Aromatic'],
        sourceReference: 'local-lab',
      },
    ]);

    workflowService.catalog.cloneQueuedCatalogDraft('catalog-draft-1');

    expect(workflowService.catalogDraftQueue()).toHaveLength(2);
    expect(workflowService.catalogDraftQueue()[1].name).toBe('Propyl_sus2');
    expect(workflowService.catalogCreateName()).toBe('Propyl_sus2');
    expect(workflowService.catalogCreateSmiles()).toBe('CCC');
    expect(workflowService.catalogCreateAnchorIndicesText()).toBe('2');
    expect(workflowService.catalogCreateCategoryKeys()).toEqual(['aromatic']);
  });

  it('increments susN suffix when cloning a draft that already has clone variants', () => {
    workflowService.catalogDraftQueue.set([
      {
        id: 'catalog-draft-1',
        name: 'Catecol',
        smiles: 'CCC',
        anchorAtomIndices: [2],
        categoryKeys: ['aromatic'],
        categoryNames: ['Aromatic'],
        sourceReference: 'local-lab',
      },
      {
        id: 'catalog-draft-2',
        name: 'Catecol_sus2',
        smiles: 'CCC',
        anchorAtomIndices: [3],
        categoryKeys: ['aromatic'],
        categoryNames: ['Aromatic'],
        sourceReference: 'local-lab',
      },
    ]);

    workflowService.catalog.cloneQueuedCatalogDraft('catalog-draft-2');

    expect(workflowService.catalogDraftQueue()).toHaveLength(3);
    expect(workflowService.catalogDraftQueue()[2].name).toBe('Catecol_sus3');
    expect(workflowService.catalogCreateName()).toBe('Catecol_sus3');
  });

  it('saves only the current catalog draft in immediate-save mode', () => {
    const creationResponse: SmileitCatalogEntryView[] = [
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

    jobsApiServiceMock.createSmileitCatalogEntry.mockReturnValueOnce(of(creationResponse));

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

    workflowService.catalog.createCatalogEntry();

    expect(jobsApiServiceMock.createSmileitCatalogEntry).toHaveBeenCalledTimes(1);
    expect(jobsApiServiceMock.createSmileitCatalogEntry).toHaveBeenCalledWith({
      name: 'Propyl',
      smiles: 'CCC',
      anchorAtomIndices: [2],
      categoryKeys: ['aromatic'],
      sourceReference: 'local-lab',
      provenanceMetadata: {},
    });
    expect(workflowService.catalogDraftQueue()).toEqual([]);
    expect(workflowService.catalogEntries()).toEqual(creationResponse);
  });

  it('builds deduplicated selectable catalog candidates for a block', () => {
    const catalogEntry: SmileitCatalogEntryView = makeCatalogEntry();
    workflowService.catalogEntries.set([catalogEntry]);

    const blockDraft: SmileitAssignmentBlockDraft = {
      ...makeAssignmentBlock(),
      catalogRefs: [catalogEntry],
      categoryKeys: ['aromatic'],
    };

    const selectableEntries =
      workflowService.blocks.getSelectableCatalogEntriesForBlock(blockDraft);

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
    const summary = workflowService.blocks.getBlockCollapsedSummary(makeAssignmentBlock());

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

    workflowService.blocks.addManualSubstituentToBlock('block-1');

    expect(workflowService.assignmentBlocks()[0].manualSubstituents).toHaveLength(1);
    expect(workflowService.assignmentBlocks()[0].manualSubstituents[0].categories).toEqual([
      'aromatic',
    ]);
    expect(workflowService.assignmentBlocks()[0].draftManualAnchorIndicesText).toBe('');
    expect(workflowService.errorMessage()).toBeNull();
  });

  it('reconstructs a historical summary when the historical Smileit job has no final structures', () => {
    jobsApiServiceMock.getSmileitJobStatus.mockReturnValue(
      of(
        makeSmileitJob({
          id: 'smileit-running-1',
          status: 'running',
          results: null,
        }),
      ),
    );

    workflowService.openHistoricalJob('smileit-running-1');

    expect(workflowService.activeSection()).toBe('result');
    expect(workflowService.resultData()?.isHistoricalSummary).toBe(true);
    expect(workflowService.resultData()?.summaryMessage).toContain('Historical job status: running');
    expect(jobsApiServiceMock.getJobLogs).toHaveBeenCalledWith('smileit-running-1', {
      limit: 250,
    });
  });

  it('falls back to polling, de-duplicates log events and resolves the final Smileit result', () => {
    const progressEvents$ = new Subject<{
      progress_percentage: number;
      progress_message: string;
    }>();
    const logEvents$ = new Subject<{
      eventIndex: number;
      level: 'info' | 'warning' | 'error' | 'debug';
      message: string;
      createdAt: string;
    }>();

    jobsApiServiceMock.dispatchSmileitJob.mockReturnValue(
      of(
        makeSmileitJob({
          id: 'smileit-progress-1',
          status: 'running',
          results: null,
        }),
      ),
    );
    jobsApiServiceMock.streamJobEvents.mockReturnValue(progressEvents$.asObservable());
    jobsApiServiceMock.streamJobLogEvents.mockReturnValue(logEvents$.asObservable());
    jobsApiServiceMock.pollJobUntilCompleted.mockReturnValue(
      of({
        progress_percentage: 100,
        progress_message: 'Completed by polling',
        progress_stage: 'completed',
        status: 'completed',
      }),
    );
    jobsApiServiceMock.getSmileitJobStatus.mockReturnValue(
      of(makeSmileitJob({ id: 'smileit-progress-1' })),
    );

    workflowService.principalSmiles.set('c1ccccc1');
    workflowService.selectedAtomIndices.set([1]);
    workflowService.assignmentBlocks.set([makeAssignmentBlock()]);

    workflowService.dispatch();

    logEvents$.next({
      eventIndex: 2,
      level: 'info',
      message: 'second log',
      createdAt: new Date().toISOString(),
    });
    logEvents$.next({
      eventIndex: 1,
      level: 'debug',
      message: 'first log',
      createdAt: new Date().toISOString(),
    });
    logEvents$.next({
      eventIndex: 2,
      level: 'info',
      message: 'duplicate second log',
      createdAt: new Date().toISOString(),
    });

    expect(workflowService.jobLogs().map((entry) => entry.eventIndex)).toEqual([1, 2]);

    progressEvents$.error(new Error('sse offline'));

    expect(jobsApiServiceMock.pollJobUntilCompleted).toHaveBeenCalledWith('smileit-progress-1', 1000);
    expect(jobsApiServiceMock.getSmileitJobStatus).toHaveBeenCalledWith('smileit-progress-1');
    expect(workflowService.activeSection()).toBe('result');
    expect(workflowService.resultData()?.generatedStructures).toHaveLength(1);
    expect(workflowService.progressPercentage()).toBe(100);
  });

  it('surfaces final result retrieval errors after the Smileit progress stream completes', () => {
    const progressEvents$ = new Subject<{
      progress_percentage: number;
      progress_message: string;
    }>();

    jobsApiServiceMock.dispatchSmileitJob.mockReturnValue(
      of(
        makeSmileitJob({
          id: 'smileit-progress-error-1',
          status: 'running',
          results: null,
        }),
      ),
    );
    jobsApiServiceMock.streamJobEvents.mockReturnValue(progressEvents$.asObservable());
    jobsApiServiceMock.streamJobLogEvents.mockReturnValue(of());
    jobsApiServiceMock.getSmileitJobStatus.mockReturnValue(
      throwError(() => new Error('gateway timeout')),
    );

    workflowService.principalSmiles.set('c1ccccc1');
    workflowService.selectedAtomIndices.set([1]);
    workflowService.assignmentBlocks.set([makeAssignmentBlock()]);

    workflowService.dispatch();
    progressEvents$.complete();

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toBe(
      'Unable to retrieve Smileit final result: gateway timeout',
    );
  });

  it('downloads the Smileit traceability report for the selected job', () => {
    const downloadedFile = {
      filename: 'smileit-traceability.csv',
      blob: new Blob(['traceability'], { type: 'text/csv' }),
    };
    jobsApiServiceMock.downloadSmileitTraceabilityReport.mockReturnValue(of(downloadedFile));
    workflowService.currentJobId.set('smileit-export-1');

    workflowService.downloadTraceabilityReport().subscribe((file) => {
      expect(file.filename).toBe('smileit-traceability.csv');
    });

    expect(jobsApiServiceMock.downloadSmileitTraceabilityReport).toHaveBeenCalledWith(
      'smileit-export-1',
    );
    expect(workflowService.exportErrorMessage()).toBeNull();
    expect(workflowService.isExporting()).toBe(false);
  });

  it('stores export errors when the Smileit error report download fails', () => {
    jobsApiServiceMock.downloadSmileitErrorReport.mockReturnValue(
      throwError(() => new Error('error report forbidden')),
    );
    workflowService.currentJobId.set('smileit-export-error-1');

    workflowService.downloadErrorReport().subscribe({
      error: () => {
        expect(workflowService.exportErrorMessage()).toBe(
          'Unable to download error report: error report forbidden',
        );
        expect(workflowService.isExporting()).toBe(false);
      },
    });
  });

  it('sets error section when principal structure SMILES is empty before inspection', () => {
    workflowService.state.principalSmiles.set('');

    workflowService.inspectPrincipalStructure();

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('Principal SMILES is required');
  });

  it('updates inspection and filters out-of-range atom selections on successful inspection', () => {
    const inspectionResult: SmileitStructureInspectionView = {
      canonicalSmiles: 'c1ccccc1',
      atomCount: 6,
      atoms: [
        { index: 0, symbol: 'C', implicitHydrogens: 1, isAromatic: true },
        { index: 1, symbol: 'C', implicitHydrogens: 1, isAromatic: true },
        { index: 2, symbol: 'C', implicitHydrogens: 1, isAromatic: true },
        { index: 3, symbol: 'C', implicitHydrogens: 1, isAromatic: true },
        { index: 4, symbol: 'C', implicitHydrogens: 1, isAromatic: true },
        { index: 5, symbol: 'C', implicitHydrogens: 1, isAromatic: true },
      ],
      svg: '<svg></svg>',
      quickProperties: {
        molecular_weight: 78,
        clogp: 1.6,
        rotatable_bonds: 0,
        hbond_donors: 0,
        hbond_acceptors: 0,
        tpsa: 0,
        aromatic_rings: 1,
      },
      annotations: [],
      activePatternRefs: [],
    };
    jobsApiServiceMock.inspectSmileitStructure.mockReturnValue(of(inspectionResult));
    workflowService.state.principalSmiles.set('c1ccccc1');
    workflowService.state.selectedAtomIndices.set([0, 5, 7, 10]);

    workflowService.inspectPrincipalStructure();

    expect(workflowService.activeSection()).toBe('idle');
    expect(workflowService.inspection()?.atomCount).toBe(6);
    expect(workflowService.selectedAtomIndices().every((idx) => idx < 6)).toBe(true);
    expect(workflowService.selectedAtomIndices()).not.toContain(7);
    expect(workflowService.selectedAtomIndices()).not.toContain(10);
  });

  it('sets error section when principal structure inspection fails with backend error', () => {
    jobsApiServiceMock.inspectSmileitStructure.mockReturnValue(
      throwError(() => new Error('backend unreachable')),
    );
    workflowService.state.principalSmiles.set('c1ccccc1');

    workflowService.inspectPrincipalStructure();

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('Unable to inspect principal structure');
    expect(workflowService.errorMessage()).toContain('backend unreachable');
  });

  it('rejects dispatch when selected sites are not covered by any assignment block', () => {
    workflowService.state.selectedAtomIndices.set([1]);
    workflowService.state.assignmentBlocks.set([]);

    workflowService.dispatch();

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('covered by at least one effective');
  });

  it('sets error section when Smileit job dispatch request fails', () => {
    workflowService.state.selectedAtomIndices.set([1]);
    workflowService.state.assignmentBlocks.set([makeAssignmentBlock()]);
    workflowService.state.principalSmiles.set('c1ccccc1');
    jobsApiServiceMock.dispatchSmileitJob.mockReturnValue(
      throwError(() => new Error('service unavailable')),
    );

    workflowService.dispatch();

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('Unable to create Smileit job');
    expect(workflowService.errorMessage()).toContain('service unavailable');
  });

  it('clamps rSubstitutes to the max allowed by selected positions', () => {
    workflowService.state.selectedAtomIndices.set([1]);
    workflowService.state.assignmentBlocks.set([makeAssignmentBlock()]);

    workflowService.setRSubstitutes(9999);

    const max: number = workflowService.maxRSubstitutesByPositions();
    expect(workflowService.rSubstitutes()).toBeLessThanOrEqual(max);
    expect(workflowService.rSubstitutes()).toBeGreaterThanOrEqual(1);
  });

  it('clamps rSubstitutes to minimum of 1 when value below minimum', () => {
    workflowService.state.selectedAtomIndices.set([1, 2, 3]);

    workflowService.setRSubstitutes(0);

    expect(workflowService.rSubstitutes()).toBe(1);
  });

  it('sets maxStructures to non-negative truncated value', () => {
    workflowService.setMaxStructures(150.7);
    expect(workflowService.maxStructures()).toBe(150);

    workflowService.setMaxStructures(-5);
    expect(workflowService.maxStructures()).toBe(0);
  });

  it('re-inspects principal structure after creating a pattern entry when SMILES is set', () => {
    workflowService.state.principalSmiles.set('c1ccccc1');
    workflowService.state.patternCreateName.set('Nitro alert');
    workflowService.state.patternCreateSmarts.set('[N+](=O)[O-]');
    workflowService.state.patternCreateCaption.set('Nitro');

    const inspectionResult: SmileitStructureInspectionView = {
      canonicalSmiles: 'c1ccccc1',
      atomCount: 6,
      atoms: [{ index: 0, symbol: 'C', implicitHydrogens: 1, isAromatic: true }],
      svg: '<svg></svg>',
      quickProperties: {
        molecular_weight: 78,
        clogp: 1.6,
        rotatable_bonds: 0,
        hbond_donors: 0,
        hbond_acceptors: 0,
        tpsa: 0,
        aromatic_rings: 1,
      },
      annotations: [],
      activePatternRefs: [],
    };
    const createPatternMock = vi.fn(() => of({ ok: true }));
    const refreshPatternsMock = vi.fn(() => of([makePattern()]));
    (jobsApiServiceMock as Record<string, unknown>)['createSmileitPatternEntry'] =
      createPatternMock;
    jobsApiServiceMock.listSmileitPatterns.mockReturnValue(refreshPatternsMock());
    jobsApiServiceMock.inspectSmileitStructure.mockReturnValue(of(inspectionResult));

    workflowService.createPatternEntry();

    expect(createPatternMock).toHaveBeenCalled();
    expect(jobsApiServiceMock.inspectSmileitStructure).toHaveBeenCalledWith('c1ccccc1');
  });

  it('dispatches completed Smileit job with invalid null result payload and sets error', () => {
    workflowService.state.selectedAtomIndices.set([1]);
    workflowService.state.assignmentBlocks.set([makeAssignmentBlock()]);
    workflowService.state.principalSmiles.set('c1ccccc1');
    jobsApiServiceMock.dispatchSmileitJob.mockReturnValue(
      of(
        makeSmileitJob({
          id: 'smileit-completed-null-results',
          status: 'completed',
          results: null as never,
        }),
      ),
    );

    workflowService.dispatch();

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('Completed job payload is invalid');
  });

  it('resets all transient state when reset() is called', () => {
    workflowService.activeSection.set('error');
    workflowService.currentJobId.set('smileit-reset-1');
    workflowService.errorMessage.set('something broke');
    workflowService.progressSnapshot.set({
      progress_percentage: 50,
      progress_message: 'half',
      progress_stage: 'running',
      status: 'running',
    } as never);
    workflowService.jobLogs.set([]);
    workflowService.resultData.set(null);

    workflowService.reset();

    expect(workflowService.activeSection()).toBe('idle');
    expect(workflowService.currentJobId()).toBeNull();
    expect(workflowService.errorMessage()).toBeNull();
    expect(workflowService.progressSnapshot()).toBeNull();
    expect(workflowService.resultData()).toBeNull();
  });

  it('sets numBonds to fixed constant when setNumBonds() is called', () => {
    workflowService.setNumBonds();
    expect(workflowService.numBonds()).toBe(1);
  });

  it('sets exportPadding to fixed constant when setExportPadding() is called', () => {
    workflowService.setExportPadding();
    expect(workflowService.exportPadding()).toBe(5);
  });

  it('sets error when openHistoricalJob returns a failed job with error trace', () => {
    jobsApiServiceMock.getSmileitJobStatus.mockReturnValue(
      of(makeSmileitJob({ id: 'smileit-failed-1', status: 'failed', error_trace: 'kernel died' })),
    );

    workflowService.openHistoricalJob('smileit-failed-1');

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('kernel died');
    expect(jobsApiServiceMock.getJobLogs).toHaveBeenCalledWith('smileit-failed-1', { limit: 250 });
  });

  it('sets error when both extractors return null in openHistoricalJob', () => {
    jobsApiServiceMock.getSmileitJobStatus.mockReturnValue(
      of(
        makeSmileitJob({
          id: 'smileit-null-params-1',
          status: 'running',
          results: null as never,
          parameters: null as never,
        }),
      ),
    );

    workflowService.openHistoricalJob('smileit-null-params-1');

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain(
      'Unable to reconstruct historical Smileit result',
    );
  });

  it('sets error when openHistoricalJob status request throws', () => {
    jobsApiServiceMock.getSmileitJobStatus.mockReturnValue(
      throwError(() => new Error('network failure')),
    );

    workflowService.openHistoricalJob('smileit-net-fail-1');

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('Unable to recover Smileit historical job');
    expect(workflowService.errorMessage()).toContain('network failure');
  });

  it('loads and sorts history by updated_at descending', () => {
    jobsApiServiceMock.listJobs.mockReturnValue(
      of([
        makeSmileitJob({ id: 'smileit-old', updated_at: '2024-01-01T00:00:00.000Z' }),
        makeSmileitJob({ id: 'smileit-new', updated_at: '2024-06-01T00:00:00.000Z' }),
      ]),
    );

    workflowService.loadHistory();

    expect(workflowService.historyJobs()[0]?.id).toBe('smileit-new');
    expect(workflowService.historyJobs()[1]?.id).toBe('smileit-old');
    expect(workflowService.isHistoryLoading()).toBe(false);
  });

  it('deduplicates history jobs by id and keeps the latest snapshot', () => {
    jobsApiServiceMock.listJobs.mockReturnValue(
      of([
        makeSmileitJob({
          id: 'smileit-dup',
          status: 'running',
          updated_at: '2024-06-01T00:00:00.000Z',
        }),
        makeSmileitJob({
          id: 'smileit-dup',
          status: 'completed',
          updated_at: '2024-07-01T00:00:00.000Z',
        }),
        makeSmileitJob({
          id: 'smileit-other',
          updated_at: '2024-05-01T00:00:00.000Z',
        }),
      ]),
    );

    workflowService.loadHistory();

    expect(workflowService.historyJobs().length).toBe(2);
    expect(workflowService.historyJobs().map((job) => job.id)).toEqual([
      'smileit-dup',
      'smileit-other',
    ]);
    expect(workflowService.historyJobs()[0]?.status).toBe('completed');
    expect(workflowService.isHistoryLoading()).toBe(false);
  });

  it('sets isHistoryLoading to false even when loadHistory fails', () => {
    jobsApiServiceMock.listJobs.mockReturnValue(throwError(() => new Error('forbidden')));

    workflowService.loadHistory();

    expect(workflowService.isHistoryLoading()).toBe(false);
  });

  it('sets error when fetchFinalResult receives a failed smileit job after stream completes', () => {
    const progressEvents$ = new Subject<{
      progress_percentage: number;
      progress_message: string;
    }>();

    workflowService.principalSmiles.set('c1ccccc1');
    workflowService.selectedAtomIndices.set([1]);
    workflowService.assignmentBlocks.set([makeAssignmentBlock()]);

    jobsApiServiceMock.dispatchSmileitJob.mockReturnValue(
      of(makeSmileitJob({ id: 'smileit-fail-final-1', status: 'running', results: null })),
    );
    jobsApiServiceMock.streamJobEvents.mockReturnValue(progressEvents$.asObservable());
    jobsApiServiceMock.streamJobLogEvents.mockReturnValue(of());
    jobsApiServiceMock.getSmileitJobStatus.mockReturnValue(
      of(
        makeSmileitJob({
          id: 'smileit-fail-final-1',
          status: 'failed',
          error_trace: 'crash on server',
        }),
      ),
    );

    workflowService.dispatch();
    progressEvents$.complete();

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain('crash on server');
  });

  it('sets error when fetchFinalResult result data is null (both extractors fail)', () => {
    const progressEvents$ = new Subject<{
      progress_percentage: number;
      progress_message: string;
    }>();

    workflowService.principalSmiles.set('c1ccccc1');
    workflowService.selectedAtomIndices.set([1]);
    workflowService.assignmentBlocks.set([makeAssignmentBlock()]);

    jobsApiServiceMock.dispatchSmileitJob.mockReturnValue(
      of(makeSmileitJob({ id: 'smileit-null-final-1', status: 'running', results: null })),
    );
    jobsApiServiceMock.streamJobEvents.mockReturnValue(progressEvents$.asObservable());
    jobsApiServiceMock.streamJobLogEvents.mockReturnValue(of());
    jobsApiServiceMock.getSmileitJobStatus.mockReturnValue(
      of(
        makeSmileitJob({
          id: 'smileit-null-final-1',
          status: 'completed',
          results: null as never,
          parameters: null as never,
        }),
      ),
    );

    workflowService.dispatch();
    progressEvents$.complete();

    expect(workflowService.activeSection()).toBe('error');
    expect(workflowService.errorMessage()).toContain(
      'Unable to parse Smileit final result payload',
    );
  });

  it('downloads the Smileit CSV report for the selected job', () => {
    const blob = new Blob(['smiles,prop'], { type: 'text/csv' });
    jobsApiServiceMock.downloadSmileitCsvReport.mockReturnValue(
      of({ filename: 'smileit.csv', blob }),
    );
    workflowService.currentJobId.set('smileit-csv-dl-1');

    workflowService.downloadCsvReport().subscribe((file) => {
      expect(file.filename).toBe('smileit.csv');
    });

    expect(jobsApiServiceMock.downloadSmileitCsvReport).toHaveBeenCalledWith('smileit-csv-dl-1');
  });

  it('downloads the Smileit SMILES report for the selected job', () => {
    const blob = new Blob(['c1ccccc1'], { type: 'text/plain' });
    jobsApiServiceMock.downloadSmileitSmilesReport.mockReturnValue(
      of({ filename: 'smileit.smi', blob }),
    );
    workflowService.currentJobId.set('smileit-smi-dl-1');

    workflowService.downloadSmilesReport().subscribe((file) => {
      expect(file.filename).toBe('smileit.smi');
    });

    expect(jobsApiServiceMock.downloadSmileitSmilesReport).toHaveBeenCalledWith('smileit-smi-dl-1');
  });

  it('downloads the Smileit LOG report for the selected job', () => {
    const blob = new Blob(['log line 1\nlog line 2'], { type: 'text/plain' });
    jobsApiServiceMock.downloadSmileitLogReport.mockReturnValue(
      of({ filename: 'smileit.log', blob }),
    );
    workflowService.currentJobId.set('smileit-log-dl-1');

    workflowService.downloadLogReport().subscribe((file) => {
      expect(file.filename).toBe('smileit.log');
    });

    expect(jobsApiServiceMock.downloadSmileitLogReport).toHaveBeenCalledWith('smileit-log-dl-1');
  });

  it('throws when attempting to download a report without a selected job', () => {
    workflowService.currentJobId.set(null);
    expect(() => workflowService.downloadCsvReport()).toThrow('No Smileit job selected');
  });
});
