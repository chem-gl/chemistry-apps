// smileit-workflow-open-mode.spec.ts: Historial y progreso de Smile-it en modo abierto.
// Un invitado no puede consultar `GET /api/jobs/?plugin_name=smileit` (responde 401), así que el
// panel histórico se alimenta del almacén local; y el texto de progreso se deriva del stage
// traducible en lugar del `progress_message` en español que envía el backend.

import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { Observable, of } from 'rxjs';
import { TranslocoService } from '@jsverse/transloco';
import { describe, expect, it, vi } from 'vitest';
import { SiteOverlapPolicyEnum } from '../api/generated';
import type {
  JobLogsPageView,
  ScientificJobView,
  SmileitCatalogEntryView,
  SmileitCategoryView,
  SmileitJobResponseView,
  SmileitPatternEntryView,
} from '../api/jobs-api.service';
import { JobsApiService } from '../api/jobs-api.service';
import { SmileitApiService } from '../api/smileit-api.service';
import { JobAccessModeService } from '../auth/job-access-mode.service';
import { IdentitySessionService } from '../auth/identity-session.service';
import { LocalResultsStore } from '../shared/local-results.store';
import { JobProgressTextService } from './job-progress-text.service';
import { SmileitBlockWorkflowService } from './smileit/smileit-block-workflow.service';
import { SmileitCatalogWorkflowService } from './smileit/smileit-catalog-workflow.service';
import { SMILEIT_PLUGIN_NAME } from './smileit/smileit-local-history';
import { SmileitWorkflowState } from './smileit/smileit-workflow-state.service';
import type { SmileitAssignmentBlockDraft } from './smileit/smileit-workflow.types';
import { SmileitWorkflowService } from './smileit-workflow.service';

const SPANISH_BACKEND_MESSAGE = 'Ejecutando plugin científico.';

const identitySessionMock = {
  currentUser: vi.fn(() => ({ id: 2 })),
  currentRole: vi.fn(() => 'user'),
};

function makeCatalogEntry(): SmileitCatalogEntryView {
  return {
    id: 'catalog-1',
    stable_id: 'aniline',
    version: 3,
    name: 'Aniline',
    smiles: '[NH2]c1ccccc1',
    anchor_atom_indices: [0],
    categories: ['aromatic'],
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
    manualSubstituents: [],
    draftManualName: '',
    draftManualSmiles: '',
    draftManualAnchorIndicesText: '0',
    draftManualSourceReference: 'manual-ui',
    draftManualCategoryKeys: [],
  };
}

function makeSmileitJob(overrides: Partial<SmileitJobResponseView> = {}): SmileitJobResponseView {
  return {
    id: 'smileit-open-1',
    job_hash: 'hash-open-1',
    plugin_name: SMILEIT_PLUGIN_NAME,
    algorithm_version: '2.0.1',
    status: 'completed',
    cache_hit: false,
    cache_miss: true,
    progress_percentage: 100,
    progress_stage: 'completed',
    progress_message: SPANISH_BACKEND_MESSAGE,
    progress_event_index: 4,
    parameters: {
      principal_smiles: 'c1ccccc1',
      selected_atom_indices: [1],
      assignment_blocks: [],
      r_substitutes: 1,
      num_bonds: 1,
      max_structures: 300,
      site_overlap_policy: SiteOverlapPolicyEnum.LastBlockWins,
      export_name_base: 'open_run',
      export_padding: 5,
      references: { catalog: [], patterns: [] },
    },
    results: {
      total_generated: 1,
      generated_structures: [
        {
          name: 'open_run_00001',
          smiles: 'Nc1ccccc1',
          svg: '<svg></svg>',
          placeholder_assignments: [],
          traceability: [],
        },
      ],
      traceability_rows: [],
      truncated: false,
      principal_smiles: 'c1ccccc1',
      selected_atom_indices: [1],
      export_name_base: 'open_run',
      export_padding: 5,
      references: { catalog: [], patterns: [] },
    },
    error_trace: '',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-02-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeRemoteJob(id: string): ScientificJobView {
  return {
    id,
    plugin_name: SMILEIT_PLUGIN_NAME,
    status: 'completed',
    progress_percentage: 100,
    progress_stage: 'completed',
    progress_message: SPANISH_BACKEND_MESSAGE,
    parameters: { principal_smiles: 'c1ccccc1' },
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-02-01T00:00:00.000Z',
  } as ScientificJobView;
}

interface SmileitApiMock {
  listSmileitCatalog: ReturnType<typeof vi.fn>;
  listSmileitCategories: ReturnType<typeof vi.fn>;
  listSmileitPatterns: ReturnType<typeof vi.fn>;
  inspectSmileitStructure: ReturnType<typeof vi.fn>;
  dispatchSmileitJob: ReturnType<typeof vi.fn>;
  getSmileitJobStatus: ReturnType<typeof vi.fn>;
  streamJobEvents: ReturnType<typeof vi.fn>;
  streamJobLogEvents: ReturnType<typeof vi.fn>;
  pollJobUntilCompleted: ReturnType<typeof vi.fn>;
  getJobLogs: ReturnType<typeof vi.fn>;
  listJobs: ReturnType<typeof vi.fn>;
  deleteJob: ReturnType<typeof vi.fn>;
}

/** Catálogo i18n mínimo: solo los stages que ejercitan estas pruebas. */
function makeTranslocoStub(activeLanguage: string): {
  translate: ReturnType<typeof vi.fn>;
  activeLang: ReturnType<typeof vi.fn>;
} {
  const stageTextsByLanguage: Record<string, Record<string, string>> = {
    en: { 'progress.stage.running': 'Running…', 'progress.stage.completed': 'Completed' },
    es: { 'progress.stage.running': 'Ejecutando…', 'progress.stage.completed': 'Completado' },
  };

  return {
    translate: vi.fn((translationKey: string) => {
      const languageCatalog: Record<string, string> = stageTextsByLanguage[activeLanguage] ?? {};
      return languageCatalog[translationKey] ?? translationKey;
    }),
    activeLang: vi.fn(() => activeLanguage),
  };
}

function createWorkflow(
  accessModeIsOpen: boolean,
  activeLanguage: string = 'en',
): { workflow: SmileitWorkflowService; apiMock: SmileitApiMock; store: LocalResultsStore } {
  const apiMock: SmileitApiMock = {
    listSmileitCatalog: vi.fn((): Observable<SmileitCatalogEntryView[]> => of([])),
    listSmileitCategories: vi.fn((): Observable<SmileitCategoryView[]> => of([])),
    listSmileitPatterns: vi.fn((): Observable<SmileitPatternEntryView[]> => of([])),
    inspectSmileitStructure: vi.fn(),
    dispatchSmileitJob: vi.fn((): Observable<SmileitJobResponseView> => of(makeSmileitJob())),
    getSmileitJobStatus: vi.fn((): Observable<SmileitJobResponseView> => of(makeSmileitJob())),
    streamJobEvents: vi.fn(),
    streamJobLogEvents: vi.fn(),
    pollJobUntilCompleted: vi.fn(),
    getJobLogs: vi.fn(
      (): Observable<JobLogsPageView> =>
        of({ jobId: 'job', count: 0, nextAfterEventIndex: 0, results: [] }),
    ),
    listJobs: vi.fn(() => of([])),
    deleteJob: vi.fn(() => of({ detail: 'ok' })),
  };

  const injector: Injector = Injector.create({
    providers: [
      { provide: JobsApiService, useValue: apiMock },
      { provide: SmileitApiService, useValue: apiMock },
      { provide: IdentitySessionService, useValue: identitySessionMock },
      { provide: JobAccessModeService, useValue: { isOpenMode: () => accessModeIsOpen } },
      { provide: TranslocoService, useValue: makeTranslocoStub(activeLanguage) },
      // El almacén real se usa tal cual: en jsdom persiste en localStorage (ida y vuelta).
      LocalResultsStore,
      JobProgressTextService,
      SmileitWorkflowState,
      SmileitCatalogWorkflowService,
      SmileitBlockWorkflowService,
    ],
  });

  const store: LocalResultsStore = injector.get(LocalResultsStore);
  store.clear(SMILEIT_PLUGIN_NAME);

  const workflow: SmileitWorkflowService = runInInjectionContext(
    injector,
    () => new SmileitWorkflowService(),
  );
  return { workflow, apiMock, store };
}

describe('SmileitWorkflowService en modo abierto', () => {
  it('no consulta el endpoint privado de historial y muestra los registros locales', () => {
    const { workflow, apiMock, store } = createWorkflow(true);
    store.upsert({
      pluginName: SMILEIT_PLUGIN_NAME,
      jobId: 'local-1',
      status: 'completed',
      progressPercentage: 100,
      parameters: { principal_smiles: 'c1ccccc1', export_name_base: 'local_run' },
      resultSummary: { totalGenerated: 1 },
    });

    workflow.loadHistory();

    expect(apiMock.listJobs).not.toHaveBeenCalled();
    expect(workflow.historyJobs().map((job) => job.id)).toEqual(['local-1']);
    expect(workflow.historyJobs()[0].parameters['export_name_base']).toBe('local_run');
    expect(workflow.isHistoryLoading()).toBe(false);
  });

  it('registra el job despachado en el almacén local sin pedir el historial privado', () => {
    const { workflow, apiMock, store } = createWorkflow(true);
    workflow.principalSmiles.set('c1ccccc1');
    workflow.selectedAtomIndices.set([1]);
    workflow.assignmentBlocks.set([makeAssignmentBlock()]);

    workflow.dispatch();

    expect(apiMock.listJobs).not.toHaveBeenCalled();
    const localRecords = store.list(SMILEIT_PLUGIN_NAME);
    expect(localRecords.map((record) => record.jobId)).toEqual(['smileit-open-1']);
    expect(localRecords[0].status).toBe('completed');
    expect(localRecords[0].parameters['export_name_base']).toBe('open_run');
    expect(localRecords[0].resultSummary).not.toBeNull();
    expect(workflow.historyJobs().map((job) => job.id)).toEqual(['smileit-open-1']);
  });

  it('elimina del almacén local sin llamar al borrado privado', () => {
    const { workflow, apiMock, store } = createWorkflow(true);
    store.upsert({
      pluginName: SMILEIT_PLUGIN_NAME,
      jobId: 'local-2',
      status: 'completed',
      progressPercentage: 100,
      parameters: {},
    });
    workflow.loadHistory();

    workflow.deleteHistoryJob('local-2');

    expect(apiMock.deleteJob).not.toHaveBeenCalled();
    expect(store.list(SMILEIT_PLUGIN_NAME)).toEqual([]);
    expect(workflow.historyJobs()).toEqual([]);
  });

  it('deriva el texto de progreso del stage y no pinta el mensaje español del backend', () => {
    const { workflow } = createWorkflow(true);

    workflow.progressSnapshot.set({
      job_id: 'smileit-open-1',
      status: 'running',
      progress_percentage: 45,
      progress_stage: 'running',
      progress_message: SPANISH_BACKEND_MESSAGE,
      progress_event_index: 2,
      updated_at: '2026-02-01T00:00:00.000Z',
    });

    expect(workflow.progressMessage()).toBe('Running…');
  });
});

describe('SmileitWorkflowService con sesión de cuenta', () => {
  it('mantiene la consulta de historial y el borrado en el endpoint privado', () => {
    const { workflow, apiMock, store } = createWorkflow(false);
    apiMock.listJobs.mockReturnValue(of([makeRemoteJob('remote-1')]));

    workflow.loadHistory();

    expect(apiMock.listJobs).toHaveBeenCalledWith({ pluginName: SMILEIT_PLUGIN_NAME });
    expect(workflow.historyJobs().map((job) => job.id)).toEqual(['remote-1']);

    workflow.deleteHistoryJob('remote-1');
    expect(apiMock.deleteJob).toHaveBeenCalledWith('remote-1');
    // Con sesión no se escribe historial local: el almacén del invitado sigue intacto.
    expect(store.list(SMILEIT_PLUGIN_NAME)).toEqual([]);
  });
});
