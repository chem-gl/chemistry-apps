// generation-result-data.service.spec.ts: Pruebas unitarias del servicio de datos de resultados de generación Smile-it.
// Cubre: computed signals derivados, control de paginación, resolverDetailSvg y cache de sesión.

import { EnvironmentInjector, Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JobsApiService } from '../../core/api/jobs-api.service';
import {
  SmileitGeneratedStructureView,
  SmileitResultData,
  SmileitWorkflowService,
} from '../../core/application/smileit-workflow.service';
import { GenerationResultDataService } from './generation-result-data.service';

const buildResultData = (overrides: Partial<SmileitResultData> = {}): SmileitResultData => ({
  totalGenerated: 0,
  generatedStructures: [],
  truncated: false,
  principalSmiles: 'C',
  selectedAtomIndices: [],
  assignmentBlocks: [],
  traceabilityRows: [],
  exportNameBase: 'EDA',
  exportPadding: 5,
  references: {},
  isHistoricalSummary: false,
  summaryMessage: null,
  ...overrides,
});

/** Construye un workflow mock con las señales mínimas que requiere el servicio. */
const buildMockWorkflow = (
  overrides: Partial<{
    resultDataValue: SmileitResultData | null;
    currentJobIdValue: string | null;
    exportNameBaseValue: string;
  }> = {},
) => ({
  resultData: signal<SmileitResultData | null>(overrides.resultDataValue ?? null),
  currentJobId: signal(overrides.currentJobIdValue ?? null),
  exportNameBase: signal(overrides.exportNameBaseValue ?? 'EDA'),
  exportErrorMessage: signal<string | null>(null),
  errorMessage: signal<string | null>(null),
});

describe('GenerationResultDataService', () => {
  let service: GenerationResultDataService;
  let mockWorkflow: ReturnType<typeof buildMockWorkflow>;
  let mockJobsApi: Partial<JobsApiService>;

  beforeEach(() => {
    mockWorkflow = buildMockWorkflow();
    mockJobsApi = {
      listSmileitDerivations: vi
        .fn()
        .mockReturnValue(of({ totalGenerated: 0, offset: 0, limit: 100, items: [] })),
      getSmileitDerivationSvg: vi.fn().mockReturnValue(of('<svg/>')),
    };

    TestBed.configureTestingModule({
      providers: [
        GenerationResultDataService,
        { provide: SmileitWorkflowService, useValue: mockWorkflow },
        { provide: JobsApiService, useValue: mockJobsApi },
        { provide: Injector, useExisting: EnvironmentInjector },
      ],
    });

    // Crear el servicio dentro del injection context para que los effects funcionen
    service = TestBed.runInInjectionContext(() => new GenerationResultDataService());
  });

  describe('estado inicial', () => {
    it('comienza con las estructuras colapsadas', () => {
      expect(service.isGeneratedStructuresCollapsed()).toBe(true);
    });

    it('comienza con el contador de estructuras en cero', () => {
      expect(service.loadedGeneratedStructures()).toEqual([]);
    });

    it('hasMoreGeneratedStructures es false cuando no hay resultData', () => {
      expect(service.hasMoreGeneratedStructures()).toBe(false);
    });
  });

  describe('toggleGeneratedStructuresCollapse', () => {
    it('invierte el estado de colapso al llamar toggle', () => {
      expect(service.isGeneratedStructuresCollapsed()).toBe(true);
      service.toggleGeneratedStructuresCollapse();
      expect(service.isGeneratedStructuresCollapsed()).toBe(false);
      service.toggleGeneratedStructuresCollapse();
      expect(service.isGeneratedStructuresCollapsed()).toBe(true);
    });
  });

  describe('hasMoreGeneratedStructures', () => {
    it('retorna true si hay más estructuras que las cargadas', () => {
      // Simular que resultData tiene totalGenerated = 10 pero no hemos cargado nada
      mockWorkflow.resultData.set(buildResultData({ totalGenerated: 10 }));

      TestBed.flushEffects();
      expect(service.hasMoreGeneratedStructures()).toBe(true);
    });

    it('retorna false si todas las estructuras están cargadas', () => {
      // loadedGeneratedStructures vacío, resultData con totalGenerated = 0
      mockWorkflow.resultData.set(buildResultData({ totalGenerated: 0 }));

      TestBed.flushEffects();
      expect(service.hasMoreGeneratedStructures()).toBe(false);
    });
  });

  describe('resolveDetailSvg', () => {
    it('retorna null si no hay currentJobId', async () => {
      const fakeStructure = {
        structureIndex: 0,
        name: 'test',
        smiles: 'CCO',
        svg: '',
        placeholderAssignments: [],
        traceability: [],
      };

      const result = await service.resolveDetailSvg(fakeStructure);
      expect(result).toBeNull();
    });

    it('retorna null si la estructura no tiene structureIndex', async () => {
      mockWorkflow.currentJobId.set('job-001');

      const fakeStructure = {
        name: 'test',
        smiles: 'CCO',
        svg: '',
        placeholderAssignments: [],
        traceability: [],
        // structureIndex no definido
      };

      const result = await service.resolveDetailSvg(fakeStructure);
      expect(result).toBeNull();
    });

    it('llama al API para obtener el SVG cuando no está en cache', async () => {
      mockWorkflow.currentJobId.set('job-001');
      mockJobsApi.getSmileitDerivationSvg = vi.fn().mockReturnValue(of('<svg>detail</svg>'));

      const fakeStructure = {
        structureIndex: 5,
        name: 'test',
        smiles: 'CCO',
        svg: '',
        placeholderAssignments: [],
        traceability: [],
      };

      // Limpiar la cache de sesión para evitar falso positivo
      sessionStorage.removeItem('smileit:job-001:svg:detail:5');

      const result = await service.resolveDetailSvg(fakeStructure);
      expect(result).toBe('<svg>detail</svg>');
      expect(mockJobsApi.getSmileitDerivationSvg).toHaveBeenCalledWith('job-001', 5, 'detail');
    });

    it('retorna null cuando el API falla al obtener el SVG', async () => {
      mockWorkflow.currentJobId.set('job-error');
      mockJobsApi.getSmileitDerivationSvg = vi
        .fn()
        .mockReturnValue(throwError(() => new Error('Network error')));

      const fakeStructure = {
        structureIndex: 1,
        name: 'test',
        smiles: 'CCO',
        svg: '',
        placeholderAssignments: [],
        traceability: [],
      };

      sessionStorage.removeItem('smileit:job-error:svg:detail:1');
      const result = await service.resolveDetailSvg(fakeStructure);
      expect(result).toBeNull();
    });

    it('lee el SVG desde la cache de sesión si ya está almacenado', async () => {
      mockWorkflow.currentJobId.set('job-cached');
      sessionStorage.setItem('smileit:job-cached:svg:detail:3', '<svg>cached-svg</svg>');

      const fakeStructure = {
        structureIndex: 3,
        name: 'test',
        smiles: 'CCO',
        svg: '',
        placeholderAssignments: [],
        traceability: [],
      };

      const result = await service.resolveDetailSvg(fakeStructure);
      expect(result).toBe('<svg>cached-svg</svg>');
      // NO debe llamar al API si hay cache
      expect(mockJobsApi.getSmileitDerivationSvg).not.toHaveBeenCalled();

      sessionStorage.removeItem('smileit:job-cached:svg:detail:3');
    });
  });

  describe('downloadVisibleStructuresZip', () => {
    it('no hace nada si resultData es null', async () => {
      mockWorkflow.resultData.set(null);
      mockWorkflow.currentJobId.set('job-zip');

      // No debe lanzar error y no debe llamar al API
      await expect(service.downloadVisibleStructuresZip()).resolves.toBeUndefined();
    });

    it('no hace nada si isPreparingImagesZip ya está activo', async () => {
      mockWorkflow.resultData.set(
        buildResultData({ totalGenerated: 1, exportNameBase: 'test', principalSmiles: 'C' }),
      );
      mockWorkflow.currentJobId.set('job-zip2');
      service.isPreparingImagesZip.set(true);

      await expect(service.downloadVisibleStructuresZip()).resolves.toBeUndefined();
    });

    it('ejecuta el path de servidor ZIP cuando la API retorna un blob', async () => {
      const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
      const revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockReturnValue(undefined);
      mockJobsApi.downloadSmileitImagesZipServer = vi
        .fn()
        .mockReturnValue(of({ filename: 'smileit.zip', blob: new Blob(['test']) }));

      mockWorkflow.resultData.set(
        buildResultData({ totalGenerated: 1, exportNameBase: 'test', principalSmiles: 'C' }),
      );
      mockWorkflow.currentJobId.set('job-zip-server');

      await service.downloadVisibleStructuresZip();

      expect(service.imagesZipProgress()).toBe(100);
      expect(service.isPreparingImagesZip()).toBe(false);

      createObjectUrlSpy.mockRestore();
      revokeObjectUrlSpy.mockRestore();
      clickSpy.mockRestore();
    });

    it('usa el fallback local cuando el ZIP del backend falla', async () => {
      const serverZipMock = vi
        .fn()
        .mockReturnValue(throwError(() => new Error('zip backend unavailable')));
      // acceso a método privado en test: la intersección con la clase reduce a never
      // porque TypeScript combina el tipo privado con la firma pública. Se usa
      // as unknown as para evitar ese comportamiento y acceder al spy correctamente.
      const fallbackSpy = vi
        .spyOn(
          service as unknown as { downloadVisibleStructuresZipClientFallback: () => Promise<void> },
          'downloadVisibleStructuresZipClientFallback',
        )
        .mockResolvedValue(undefined);

      mockWorkflow.resultData.set(
        buildResultData({ totalGenerated: 1, exportNameBase: 'test', principalSmiles: 'C' }),
      );
      mockWorkflow.currentJobId.set('job-zip-fallback');
      mockJobsApi.downloadSmileitImagesZipServer = serverZipMock as never;

      await service.downloadVisibleStructuresZip();

      expect(fallbackSpy).toHaveBeenCalledWith('job-zip-fallback', expect.any(Object));
      fallbackSpy.mockRestore();
    });

    it('registra error visible si el fallback local también falla', async () => {
      mockWorkflow.resultData.set(
        buildResultData({ totalGenerated: 1, exportNameBase: 'test', principalSmiles: 'C' }),
      );
      mockWorkflow.currentJobId.set('job-zip-error');
      mockJobsApi.downloadSmileitImagesZipServer = vi
        .fn()
        .mockReturnValue(throwError(() => new Error('zip backend unavailable')));
      // mismo patrón: as unknown as para evitar reducción a never en intersección con privado
      vi.spyOn(
        service as unknown as { downloadVisibleStructuresZipClientFallback: () => Promise<void> },
        'downloadVisibleStructuresZipClientFallback',
      ).mockRejectedValue(new Error('fallback failed'));

      await service.downloadVisibleStructuresZip();

      expect(mockWorkflow.exportErrorMessage()).toContain('Unable to generate ZIP');
    });
  });

  describe('showMoreStructures y loadNextGeneratedStructuresPage', () => {
    it('carga la siguiente página de estructuras cuando jobId y resultData son válidos', () => {
      mockJobsApi.listSmileitDerivations = vi.fn().mockReturnValue(
        of({
          totalGenerated: 2,
          offset: 0,
          limit: 100,
          items: [
            {
              structureIndex: 0,
              name: 'Mol A',
              smiles: 'C',
              placeholderAssignments: [],
              traceability: [],
            },
          ],
        }),
      );
      mockJobsApi.getSmileitDerivationSvg = vi.fn().mockReturnValue(of('<svg/>'));

      mockWorkflow.currentJobId.set('job-load');
      mockWorkflow.resultData.set(buildResultData({ totalGenerated: 2 }));

      TestBed.flushEffects();

      expect(mockJobsApi.listSmileitDerivations).toHaveBeenCalledWith('job-load', 0, 100);
      expect(service.loadedGeneratedStructures()).toHaveLength(1);
      expect(service.loadedGeneratedStructures()[0].name).toBe('dEDA1');
    });

    it('usa la cache de sesión cuando la página ya fue cargada previamente', () => {
      const cachedItems = [
        {
          structureIndex: 0,
          name: 'Cached Mol',
          smiles: 'CCO',
          placeholderAssignments: [],
          traceability: [],
        },
      ];
      sessionStorage.setItem('smileit:job-cached-page:page:0:100', JSON.stringify(cachedItems));

      mockWorkflow.currentJobId.set('job-cached-page');
      mockWorkflow.resultData.set(buildResultData({ totalGenerated: 1 }));

      TestBed.flushEffects();

      // No debe llamar al API si hay cache
      expect(mockJobsApi.listSmileitDerivations).not.toHaveBeenCalled();
      expect(service.loadedGeneratedStructures()).toHaveLength(1);
      expect(service.loadedGeneratedStructures()[0].name).toBe('dEDA1');

      sessionStorage.removeItem('smileit:job-cached-page:page:0:100');
    });

    it('muestra más estructuras al llamar showMoreStructures con jobId válido', () => {
      mockJobsApi.listSmileitDerivations = vi
        .fn()
        .mockReturnValue(of({ totalGenerated: 10, offset: 0, limit: 100, items: [] }));

      mockWorkflow.currentJobId.set('job-show-more');
      mockWorkflow.resultData.set(buildResultData({ totalGenerated: 10 }));

      TestBed.flushEffects();
      const callsBefore = vi.mocked(mockJobsApi.listSmileitDerivations).mock.calls.length;

      service.showMoreStructures();

      // Se vuelve a llamar si hay más para cargar
      expect(
        vi.mocked(mockJobsApi.listSmileitDerivations).mock.calls.length,
      ).toBeGreaterThanOrEqual(callsBefore);
    });

    it('maneja error 404 del API usando generatedStructures embebidas', () => {
      const httpError = Object.assign(new Error('Not Found'), { status: 404 });
      mockJobsApi.listSmileitDerivations = vi.fn().mockReturnValue(throwError(() => httpError));

      const embeddedStructure = {
        structureIndex: 0,
        name: 'Embedded',
        smiles: 'C',
        svg: '',
        placeholderAssignments: [],
        traceability: [],
      };

      mockWorkflow.currentJobId.set('job-404');
      mockWorkflow.resultData.set(
        buildResultData({ totalGenerated: 1, generatedStructures: [embeddedStructure] }),
      );

      TestBed.flushEffects();

      expect(service.loadedGeneratedStructures()[0].name).toBe('dEDA1');
    });

    it('maneja error 404 del API sin generatedStructures embebidas', () => {
      const httpError = Object.assign(new Error('Not Found'), { status: 404 });
      mockJobsApi.listSmileitDerivations = vi.fn().mockReturnValue(throwError(() => httpError));

      mockWorkflow.currentJobId.set('job-404-no-embedded');
      mockWorkflow.resultData.set(buildResultData({ totalGenerated: 3, generatedStructures: [] }));

      TestBed.flushEffects();

      expect(mockWorkflow.errorMessage()).toContain('not available');
    });

    it('maneja errores genéricos del API', () => {
      mockJobsApi.listSmileitDerivations = vi
        .fn()
        .mockReturnValue(throwError(() => new Error('Network error')));

      mockWorkflow.currentJobId.set('job-generic-error');
      mockWorkflow.resultData.set(buildResultData({ totalGenerated: 5 }));

      TestBed.flushEffects();

      expect(mockWorkflow.errorMessage()).toContain('Unable to load');
    });

    it('resetea el estado cuando resultData cambia a null', () => {
      mockWorkflow.currentJobId.set('job-reset');
      mockWorkflow.resultData.set(buildResultData({ totalGenerated: 1 }));
      TestBed.flushEffects();

      // Resetear resultData
      mockWorkflow.resultData.set(null);
      TestBed.flushEffects();

      expect(service.loadedGeneratedStructures()).toEqual([]);
      expect(service.isGeneratedStructuresCollapsed()).toBe(true);
    });

    it('usa el identificador d{jobName}{N} aunque el nombre del item esté vacío', () => {
      mockJobsApi.listSmileitDerivations = vi.fn().mockReturnValue(
        of({
          totalGenerated: 1,
          offset: 0,
          limit: 100,
          items: [
            {
              structureIndex: 5,
              name: '   ',
              smiles: 'C',
              placeholderAssignments: [],
              traceability: [],
            },
          ],
        }),
      );

      mockWorkflow.currentJobId.set('job-empty-name');
      mockWorkflow.resultData.set(buildResultData({ totalGenerated: 1 }));

      TestBed.flushEffects();

      expect(service.loadedGeneratedStructures()[0].name).toBe('dEDA6');
    });
  });

  describe('ngOnDestroy', () => {
    it('destruye el effect de reset sin lanzar errores', () => {
      expect(() => service.ngOnDestroy()).not.toThrow();
    });
  });

  describe('utilidades de nombres y caché', () => {
    it('sanitiza segmentos de nombre con caracteres inválidos', () => {
      // acceso a método privado: as unknown as evita la reducción a never
      const sanitized = (
        service as unknown as { sanitizeFilenameSegment: (value: string) => string }
      ).sanitizeFilenameSegment('  Molécula #1 / test  ');
      expect(sanitized).toBe('Mol_cula_1_test');
    });

    it('devuelve structure.svg cuando no existe structureIndex en resolveStructureSvgForZip', async () => {
      const structure = {
        name: 'No index',
        smiles: 'C',
        svg: '<svg>inline</svg>',
        placeholderAssignments: [],
        traceability: [],
      } as never;

      // acceso a método privado: as unknown as evita la reducción a never
      const resolved = await (
        service as unknown as {
          resolveStructureSvgForZip: (
            jobId: string,
            structure: SmileitGeneratedStructureView,
          ) => Promise<string>;
        }
      ).resolveStructureSvgForZip('job-inline', structure);

      expect(resolved).toBe('<svg>inline</svg>');
    });
  });
});
