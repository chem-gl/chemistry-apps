// generation-result-data.service.spec.ts: Pruebas unitarias del servicio de datos de resultados de generación Smile-it.
// Cubre: computed signals derivados, control de paginación, resolverDetailSvg y cache de sesión.

import { EnvironmentInjector, Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JobsApiService } from '../../core/api/jobs-api.service';
import { SmileitWorkflowService } from '../../core/application/smileit-workflow.service';
import { GenerationResultDataService } from './generation-result-data.service';

/** Construye un workflow mock con las señales mínimas que requiere el servicio. */
const buildMockWorkflow = (
  overrides: Partial<{
    resultDataValue: ReturnType<SmileitWorkflowService['resultData']> | null;
    currentJobIdValue: string | null;
  }> = {},
) => ({
  resultData: signal(overrides.resultDataValue ?? null),
  currentJobId: signal(overrides.currentJobIdValue ?? null),
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
      (mockWorkflow.resultData as ReturnType<typeof signal<unknown>>).set({
        totalGenerated: 10,
        isHistoricalSummary: false,
      });

      TestBed.flushEffects();
      expect(service.hasMoreGeneratedStructures()).toBe(true);
    });

    it('retorna false si todas las estructuras están cargadas', () => {
      // loadedGeneratedStructures vacío, resultData con totalGenerated = 0
      (mockWorkflow.resultData as ReturnType<typeof signal<unknown>>).set({
        totalGenerated: 0,
        isHistoricalSummary: false,
      });

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
      mockWorkflow.resultData.set({
        totalGenerated: 1,
        exportNameBase: 'test',
        principalSmiles: 'C',
        isHistoricalSummary: false,
      } as unknown as ReturnType<SmileitWorkflowService['resultData']>);
      mockWorkflow.currentJobId.set('job-zip2');
      service.isPreparingImagesZip.set(true);

      await expect(service.downloadVisibleStructuresZip()).resolves.toBeUndefined();
    });
  });

  describe('ngOnDestroy', () => {
    it('destruye el effect de reset sin lanzar errores', () => {
      expect(() => service.ngOnDestroy()).not.toThrow();
    });
  });
});
