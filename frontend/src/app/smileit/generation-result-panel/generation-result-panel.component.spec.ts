// generation-result-panel.component.spec.ts: Pruebas unitarias del panel de resultados de generación de Smile-it.
// Cubre: métodos de ayuda puros, delimitadores de display, estado histórico y manipulación de estructuras.

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScientificJobView } from '../../core/api/jobs-api.service';
import { SmileitWorkflowService } from '../../core/application/smileit-workflow.service';
import { SmileitGeneratedStructureView } from '../../core/application/smileit/smileit-workflow.types';
import { GenerationResultDataService } from './generation-result-data.service';
import { GenerationResultPanelComponent } from './generation-result-panel.component';

// Estructura generada mínima para testing
const buildMockStructure = (
  name: string,
  overrides: Partial<SmileitGeneratedStructureView> = {},
): SmileitGeneratedStructureView => ({
  name,
  smiles: 'CCO',
  svg: '<svg/>',
  placeholderAssignments: [],
  traceability: [],
  ...overrides,
});

describe('GenerationResultPanelComponent - métodos de ayuda puros', () => {
  let component: GenerationResultPanelComponent;

  beforeEach(async () => {
    const mockWorkflow = {
      dispatch: vi.fn(),
      reset: vi.fn(),
      openHistoricalJob: vi.fn(),
      downloadCsvReport: vi.fn(),
      downloadSmilesReport: vi.fn(),
      downloadLogReport: vi.fn(),
      exportNameBase: signal('EDA'),
      resultData: signal(null),
      currentJobId: signal(null),
      selectedHistoricalJobId: signal<string | null>(null),
      historyJobs: signal<ScientificJobView[]>([]),
    };

    const mockDataService = {
      isGeneratedStructuresCollapsed: signal(true),
      visibleGeneratedStructures: vi.fn().mockReturnValue([]),
      hasMoreGeneratedStructures: signal(false),
      isLoadingGeneratedStructures: signal(false),
      isPreparingImagesZip: signal(false),
      imagesZipProgress: signal(0),
      toggleGeneratedStructuresCollapse: vi.fn(),
      showMoreStructures: vi.fn(),
      downloadVisibleStructuresZip: vi.fn().mockResolvedValue(undefined),
      resolveDetailSvg: vi.fn().mockResolvedValue(null),
    };

    await TestBed.configureTestingModule({
      imports: [GenerationResultPanelComponent],
      providers: [
        { provide: SmileitWorkflowService, useValue: mockWorkflow },
        { provide: GenerationResultDataService, useValue: mockDataService },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(GenerationResultPanelComponent);
    component = fixture.componentInstance;
  });

  describe('historicalStatusClass', () => {
    it('construye la clase CSS correctamente para estado completed', () => {
      const cssClass = component.historicalStatusClass('completed' as ScientificJobView['status']);
      expect(cssClass).toBe('history-status history-completed');
    });

    it('construye la clase CSS correctamente para estado running', () => {
      const cssClass = component.historicalStatusClass('running' as ScientificJobView['status']);
      expect(cssClass).toBe('history-status history-running');
    });
  });

  describe('historicalJobDisplayName', () => {
    it('retorna export_name_base con el id del job para mantener unicidad visible', () => {
      const job = {
        id: 'abc-12345678',
        parameters: { export_name_base: 'Mi experimento' },
      } as unknown as ScientificJobView;
      expect(component.historicalJobDisplayName(job)).toBe('Mi experimento_abc-12345678');
    });

    it('retorna un fallback basado en job cuando no hay export_name_base', () => {
      const job = {
        id: 'abc12345-extra',
        parameters: {},
      } as unknown as ScientificJobView;
      expect(component.historicalJobDisplayName(job)).toBe('job_abc12345-extra');
    });
  });

  describe('historicalJobPrincipalSmiles', () => {
    it('retorna el principal_smiles si está presente', () => {
      const job = {
        parameters: { principal_smiles: 'c1ccccc1' },
      } as unknown as ScientificJobView;
      expect(component.historicalJobPrincipalSmiles(job)).toBe('c1ccccc1');
    });

    it('retorna mensaje de fallback si principal_smiles no está en parameters', () => {
      const job = {
        parameters: {},
      } as unknown as ScientificJobView;
      expect(component.historicalJobPrincipalSmiles(job)).toBe('Principal SMILES not available');
    });

    it('retorna mensaje de fallback si parameters es null', () => {
      const job = {
        parameters: null,
      } as unknown as ScientificJobView;
      expect(component.historicalJobPrincipalSmiles(job)).toBe('Principal SMILES not available');
    });
  });

  describe('historicalJobBlockSummaries', () => {
    it('retorna array vacío si no hay assignment_blocks en los parámetros', () => {
      const job = { parameters: {} } as unknown as ScientificJobView;
      expect(component.historicalJobBlockSummaries(job)).toEqual([]);
    });

    it('retorna array vacío si parameters es null', () => {
      const job = { parameters: null } as unknown as ScientificJobView;
      expect(component.historicalJobBlockSummaries(job)).toEqual([]);
    });

    it('mapea correctamente un bloque con label y positions', () => {
      const job = {
        parameters: {
          assignment_blocks: [
            {
              label: 'Bloque R1',
              site_atom_indices: [1, 2, 3],
              resolved_substituents: [{ smiles: 'CCO' }, { smiles: 'CN' }],
            },
          ],
        },
      } as unknown as ScientificJobView;

      const summaries = component.historicalJobBlockSummaries(job);
      expect(summaries).toHaveLength(1);
      expect(summaries[0].label).toBe('Bloque R1');
      expect(summaries[0].positions).toBe('1, 2, 3');
      expect(summaries[0].smiles).toContain('CCO');
      expect(summaries[0].smiles).toContain('CN');
    });

    it('usa nombre genérico Block N cuando label es vacío', () => {
      const job = {
        parameters: {
          assignment_blocks: [{ label: '', site_atom_indices: [], resolved_substituents: [] }],
        },
      } as unknown as ScientificJobView;

      const summaries = component.historicalJobBlockSummaries(job);
      expect(summaries[0].label).toBe('Block 1');
    });

    it('retorna Not assigned si site_atom_indices no es array', () => {
      const job = {
        parameters: {
          assignment_blocks: [{ label: 'A', site_atom_indices: null, resolved_substituents: [] }],
        },
      } as unknown as ScientificJobView;

      const summaries = component.historicalJobBlockSummaries(job);
      expect(summaries[0].positions).toBe('Not assigned');
    });
  });

  describe('visibleHistoryJobs', () => {
    it('oculta el job actual cuando el panel inferior muestra el resultado recién generado', () => {
      const currentJob = { id: 'current-job', status: 'completed' } as ScientificJobView;
      const oldJob = { id: 'older-job', status: 'completed' } as ScientificJobView;

      component.workflow.currentJobId.set('current-job');
      component.workflow.selectedHistoricalJobId.set(null);
      component.workflow.historyJobs.set([currentJob, oldJob]);

      expect(component.visibleHistoryJobs().map((job) => job.id)).toEqual(['older-job']);
    });

    it('mantiene visible el job seleccionado cuando fue abierto desde el historial', () => {
      const selectedJob = { id: 'historic-job', status: 'completed' } as ScientificJobView;
      const oldJob = { id: 'older-job', status: 'completed' } as ScientificJobView;

      component.workflow.currentJobId.set('historic-job');
      component.workflow.selectedHistoricalJobId.set('historic-job');
      component.workflow.historyJobs.set([selectedJob, oldJob]);

      expect(component.visibleHistoryJobs().map((job) => job.id)).toEqual([
        'historic-job',
        'older-job',
      ]);
    });
  });

  describe('historical job view state', () => {
    it('marca la fila como visible abajo cuando coincide con el histórico seleccionado', () => {
      component.workflow.selectedHistoricalJobId.set('historic-job');

      expect(component.isHistoricalJobSelected('historic-job')).toBe(true);
      expect(component.historicalJobViewStateLabel('historic-job')).toBe('Viewing below');
      expect(component.historicalJobViewStateClass('historic-job')).toBe(
        'job-view-state is-viewing',
      );
    });

    it('muestra el estado available cuando la fila no es la seleccionada', () => {
      component.workflow.selectedHistoricalJobId.set('another-job');

      expect(component.isHistoricalJobSelected('historic-job')).toBe(false);
      expect(component.historicalJobViewStateLabel('historic-job')).toBe('Available');
      expect(component.historicalJobViewStateClass('historic-job')).toBe(
        'job-view-state is-available',
      );
    });
  });

  describe('structureDisplayName', () => {
    it('retorna el identificador d{jobName}{N} usando el índice de la estructura', () => {
      const structure = buildMockStructure('smileit_run_42');
      expect(component.structureDisplayName(structure, 0)).toBe('dEDA1');
    });

    it('respeta structureIndex cuando está disponible', () => {
      const structure = buildMockStructure('irrelevant', { structureIndex: 4 });
      expect(component.structureDisplayName(structure, 0)).toBe('dEDA5');
    });

    it('construye un nombre canónico aunque el nombre original esté vacío', () => {
      const structure = buildMockStructure('   ');
      expect(component.structureDisplayName(structure, 3)).toBe('dEDA4');
    });
  });

  describe('structurePlaceholderSummary', () => {
    it('retorna mensaje vacío si no hay placeholder assignments', () => {
      const structure = buildMockStructure('test', { placeholderAssignments: [] });
      expect(component.structurePlaceholderSummary(structure)).toBe(
        'No placeholder assignments available',
      );
    });

    it('combina múltiples assignments con separador pipe', () => {
      const structure = buildMockStructure('test', {
        placeholderAssignments: [
          {
            placeholderLabel: 'R1',
            siteAtomIndex: 1,
            substituentName: 'Ethanol',
            substituentSmiles: 'CCO',
          },
          {
            placeholderLabel: 'R2',
            siteAtomIndex: 2,
            substituentName: 'Methane',
            substituentSmiles: 'C',
          },
        ],
      });

      const summary = component.structurePlaceholderSummary(structure);
      expect(summary).toContain('R1');
      expect(summary).toContain('R2');
      expect(summary).toContain(' | ');
    });
  });

  describe('getUniqueSubstituentsForStructure', () => {
    it('retorna hasta 4 nombres de sustituyentes únicos', () => {
      const structure = buildMockStructure('test', {
        traceability: [
          {
            round_index: 0,
            site_atom_index: 1,
            block_label: 'R1',
            block_priority: 1,
            substituent_name: 'Ethanol',
            substituent_stable_id: 'e1',
            substituent_version: 1,
            source_kind: 'catalog',
            bond_order: 1,
          },
          {
            round_index: 0,
            site_atom_index: 2,
            block_label: 'R2',
            block_priority: 1,
            substituent_name: 'Methane',
            substituent_stable_id: 'm1',
            substituent_version: 1,
            source_kind: 'catalog',
            bond_order: 1,
          },
          {
            round_index: 0,
            site_atom_index: 1,
            block_label: 'R1',
            block_priority: 1,
            substituent_name: 'Ethanol',
            substituent_stable_id: 'e1',
            substituent_version: 1,
            source_kind: 'catalog',
            bond_order: 1,
          },
          {
            round_index: 0,
            site_atom_index: 3,
            block_label: 'R3',
            block_priority: 1,
            substituent_name: 'Propanol',
            substituent_stable_id: 'p1',
            substituent_version: 1,
            source_kind: 'catalog',
            bond_order: 1,
          },
          {
            round_index: 0,
            site_atom_index: 4,
            block_label: 'R4',
            block_priority: 1,
            substituent_name: 'Butane',
            substituent_stable_id: 'b1',
            substituent_version: 1,
            source_kind: 'catalog',
            bond_order: 1,
          },
          {
            round_index: 0,
            site_atom_index: 5,
            block_label: 'R5',
            block_priority: 1,
            substituent_name: 'Hexane',
            substituent_stable_id: 'h1',
            substituent_version: 1,
            source_kind: 'catalog',
            bond_order: 1,
          },
        ],
      });

      const substituents = component.getUniqueSubstituentsForStructure(structure);
      expect(substituents.length).toBeLessThanOrEqual(4);
      // Los nombres deben ser únicos
      expect(new Set(substituents).size).toBe(substituents.length);
    });
  });

  describe('toTrustedSvg', () => {
    it('transforma el string SVG en un SafeHtml', () => {
      const sanitizer = TestBed.inject(DomSanitizer);
      const spy = vi.spyOn(sanitizer, 'bypassSecurityTrustHtml');
      component.toTrustedSvg('<svg><circle/></svg>');
      expect(spy).toHaveBeenCalledWith('<svg><circle/></svg>');
    });
  });
});
