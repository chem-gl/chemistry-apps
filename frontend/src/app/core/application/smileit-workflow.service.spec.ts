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
      maxStructures: 300,
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
});
