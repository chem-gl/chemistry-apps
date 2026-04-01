// smileit-api.service.spec.ts: Pruebas unitarias del wrapper SmileitApiService.
// Cubre mapeos, validaciones, descargas y endpoints auxiliares sin depender del cliente generado real.

import { HttpHeaders, HttpResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { lastValueFrom, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { API_BASE_URL } from '../shared/constants';
import {
  PatternTypeEnum,
  SiteOverlapPolicyEnum,
  SmileitJobResponse,
  SmileitQuickProperties,
  SmileitService,
  SmileitStructureInspectionResponse,
  StatusEnum,
  provideApi,
} from './generated';
import { SmileitApiService } from './smileit-api.service';

type SmileitClientMock = {
  smileitJobsCatalogList: ReturnType<typeof vi.fn>;
  smileitJobsCategoriesList: ReturnType<typeof vi.fn>;
  smileitJobsPatternsList: ReturnType<typeof vi.fn>;
  smileitJobsCatalogCreate: ReturnType<typeof vi.fn>;
  smileitJobsCatalogPartialUpdate: ReturnType<typeof vi.fn>;
  smileitJobsPatternsCreate: ReturnType<typeof vi.fn>;
  smileitJobsInspectStructureCreate: ReturnType<typeof vi.fn>;
  smileitJobsCreate: ReturnType<typeof vi.fn>;
  smileitJobsRetrieve: ReturnType<typeof vi.fn>;
  smileitJobsDerivationsRetrieve: ReturnType<typeof vi.fn>;
  smileitJobsDerivationsSvgRetrieve: ReturnType<typeof vi.fn>;
  smileitJobsReportCsvRetrieve: ReturnType<typeof vi.fn>;
  smileitJobsReportSmilesRetrieve: ReturnType<typeof vi.fn>;
  smileitJobsReportTraceabilityRetrieve: ReturnType<typeof vi.fn>;
  smileitJobsReportLogRetrieve: ReturnType<typeof vi.fn>;
  smileitJobsReportErrorRetrieve: ReturnType<typeof vi.fn>;
  smileitJobsReportImagesZipRetrieve: ReturnType<typeof vi.fn>;
};

type SmileitApiServiceTestAccess = {
  extractErrorMessage: (error: unknown) => string;
};

function createBlobResponse(filename: string): HttpResponse<Blob> {
  return new HttpResponse({
    body: new Blob(['report'], { type: 'text/plain' }),
    headers: new HttpHeaders({ 'content-disposition': `attachment; filename="${filename}"` }),
    status: 200,
  });
}

const inspectionResponse: SmileitStructureInspectionResponse = {
  canonical_smiles: 'CCO',
  atom_count: 3,
  atoms: [
    { index: 0, symbol: 'C', implicit_hydrogens: 3, is_aromatic: false },
    { index: 1, symbol: 'C', implicit_hydrogens: 2, is_aromatic: false },
    { index: 2, symbol: 'O', implicit_hydrogens: 1, is_aromatic: false },
  ],
  svg: '<svg></svg>',
  quick_properties: {
    molecular_weight: 46,
    clogp: -0.1,
    rotatable_bonds: 0,
    hbond_donors: 1,
    hbond_acceptors: 1,
    tpsa: 20,
    aromatic_rings: 0,
  } as SmileitQuickProperties,
  annotations: [],
  active_pattern_refs: [],
};

describe('SmileitApiService', () => {
  let service: SmileitApiService;
  let httpMock: HttpTestingController;
  let smileitClientMock: SmileitClientMock;

  beforeEach(() => {
    smileitClientMock = {
      smileitJobsCatalogList: vi.fn(() => of([{ stableId: 'catalog-1' }])),
      smileitJobsCategoriesList: vi.fn(() => of([{ key: 'cat-1' }])),
      smileitJobsPatternsList: vi.fn(() => of([{ stableId: 'pattern-1' }])),
      smileitJobsCatalogCreate: vi.fn((payload) => of([payload])),
      smileitJobsCatalogPartialUpdate: vi.fn((stableId, payload) => of([{ stableId, ...payload }])),
      smileitJobsPatternsCreate: vi.fn((payload) => of([payload])),
      smileitJobsInspectStructureCreate: vi.fn(),
      smileitJobsCreate: vi.fn(),
      smileitJobsRetrieve: vi.fn(),
      smileitJobsDerivationsRetrieve: vi.fn(),
      smileitJobsDerivationsSvgRetrieve: vi.fn(),
      smileitJobsReportCsvRetrieve: vi.fn(() => of(createBlobResponse('smileit-report.csv'))),
      smileitJobsReportSmilesRetrieve: vi.fn(() =>
        of(createBlobResponse('smileit-structures.smi')),
      ),
      smileitJobsReportTraceabilityRetrieve: vi.fn(() =>
        of(createBlobResponse('smileit-traceability.csv')),
      ),
      smileitJobsReportLogRetrieve: vi.fn(() => of(createBlobResponse('smileit-report.log'))),
      smileitJobsReportErrorRetrieve: vi.fn(() => of(createBlobResponse('smileit-error.txt'))),
      smileitJobsReportImagesZipRetrieve: vi.fn(() =>
        of(createBlobResponse('smileit-job-1-images.zip')),
      ),
    };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideApi(API_BASE_URL),
        SmileitApiService,
        {
          provide: SmileitService,
          useValue: smileitClientMock,
        },
      ],
    });

    service = TestBed.inject(SmileitApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('delegates catalog, categories and patterns listing', async () => {
    await expect(lastValueFrom(service.listSmileitCatalog())).resolves.toEqual([
      { stableId: 'catalog-1' },
    ]);
    await expect(lastValueFrom(service.listSmileitCategories())).resolves.toEqual([
      { key: 'cat-1' },
    ]);
    await expect(lastValueFrom(service.listSmileitPatterns())).resolves.toEqual([
      { stableId: 'pattern-1' },
    ]);
  });

  it('builds catalog and pattern payloads without duplicating mapping logic', async () => {
    const catalogParams = {
      name: 'Aromatic ring',
      smiles: 'c1ccccc1',
      anchorAtomIndices: [1, 2],
      categoryKeys: ['aryl'],
      sourceReference: 'literature',
      provenanceMetadata: { origin: 'manual' },
    };

    const patternParams = {
      name: 'Ring pattern',
      smarts: 'c1ccccc1',
      patternType: PatternTypeEnum.Toxicophore,
      caption: 'Aromatic ring',
      sourceReference: 'literature',
      provenanceMetadata: { origin: 'manual' },
    };

    await lastValueFrom(service.createSmileitCatalogEntry(catalogParams));
    await lastValueFrom(service.updateSmileitCatalogEntry('catalog-1', catalogParams));
    await lastValueFrom(service.createSmileitPatternEntry(patternParams));

    expect(smileitClientMock.smileitJobsCatalogCreate).toHaveBeenCalledWith({
      name: 'Aromatic ring',
      smiles: 'c1ccccc1',
      anchor_atom_indices: [1, 2],
      category_keys: ['aryl'],
      source_reference: 'literature',
      provenance_metadata: { origin: 'manual' },
    });
    expect(smileitClientMock.smileitJobsCatalogPartialUpdate).toHaveBeenCalledWith('catalog-1', {
      name: 'Aromatic ring',
      smiles: 'c1ccccc1',
      anchor_atom_indices: [1, 2],
      category_keys: ['aryl'],
      source_reference: 'literature',
      provenance_metadata: { origin: 'manual' },
    });
    expect(smileitClientMock.smileitJobsPatternsCreate).toHaveBeenCalledWith({
      name: 'Ring pattern',
      smarts: 'c1ccccc1',
      pattern_type: PatternTypeEnum.Toxicophore,
      caption: 'Aromatic ring',
      source_reference: 'literature',
      provenance_metadata: { origin: 'manual' },
    });
  });

  it('maps structure inspection and validation errors', async () => {
    const inspectionResponse: SmileitStructureInspectionResponse = {
      canonical_smiles: 'CCO',
      atom_count: 3,
      atoms: [
        { index: 0, symbol: 'C', implicit_hydrogens: 3, is_aromatic: false },
        { index: 1, symbol: 'C', implicit_hydrogens: 2, is_aromatic: false },
        { index: 2, symbol: 'O', implicit_hydrogens: 1, is_aromatic: false },
      ],
      svg: '<svg></svg>',
      quick_properties: {
        molecular_weight: 46,
        clogp: -0.1,
        rotatable_bonds: 0,
        hbond_donors: 1,
        hbond_acceptors: 1,
        tpsa: 20,
        aromatic_rings: 0,
      } as SmileitQuickProperties,
      annotations: [],
      active_pattern_refs: [],
    };

    vi.mocked(smileitClientMock.smileitJobsInspectStructureCreate).mockImplementation(
      (request: { smiles: string }) => {
        if (request.smiles === 'bad') {
          return throwError(() => ({ error: { detail: 'Unsupported SMILES' } }));
        }
        return of(inspectionResponse);
      },
    );

    await expect(lastValueFrom(service.inspectSmileitStructure('CCO'))).resolves.toEqual({
      canonicalSmiles: 'CCO',
      atomCount: 3,
      atoms: [
        { index: 0, symbol: 'C', implicitHydrogens: 3, isAromatic: false },
        { index: 1, symbol: 'C', implicitHydrogens: 2, isAromatic: false },
        { index: 2, symbol: 'O', implicitHydrogens: 1, isAromatic: false },
      ],
      svg: '<svg></svg>',
      quickProperties: {
        molecular_weight: 46,
        clogp: -0.1,
        rotatable_bonds: 0,
        hbond_donors: 1,
        hbond_acceptors: 1,
        tpsa: 20,
        aromatic_rings: 0,
      },
      annotations: [],
      activePatternRefs: [],
    });

    await expect(
      lastValueFrom(service.validateSmilesCompatibility(['CCO', 'bad'])),
    ).resolves.toEqual({
      compatible: false,
      issues: [
        {
          smiles: 'bad',
          reason: 'Unsupported SMILES',
        },
      ],
    });
  });

  it('dispatches smileit jobs and retrieves status', async () => {
    const response = {
      id: 'job-1',
      status: StatusEnum.Pending,
    } as SmileitJobResponse;

    vi.mocked(smileitClientMock.smileitJobsCreate).mockReturnValue(of(response));
    vi.mocked(smileitClientMock.smileitJobsRetrieve).mockReturnValue(of(response));

    const jobRequest = {
      principalSmiles: 'CCO',
      selectedAtomIndices: [1, 2],
      assignmentBlocks: [
        {
          label: 'A',
          siteAtomIndices: [1],
          categoryKeys: ['alkyl'],
          substituentRefs: [{ stableId: 'ref-1', version: 2 }],
          manualSubstituents: [
            {
              name: 'Manual',
              smiles: 'C',
              anchorAtomIndices: [0],
              categories: ['alkyl'],
              sourceReference: 'manual',
              provenanceMetadata: { origin: 'manual' },
            },
          ],
        },
      ],
      siteOverlapPolicy: SiteOverlapPolicyEnum.LastBlockWins,
      rSubstitutes: 1,
      numBonds: 2,
      maxStructures: 10,
      exportNameBase: 'smileit',
      exportPadding: 3,
    };

    await expect(lastValueFrom(service.dispatchSmileitJob(jobRequest))).resolves.toEqual(response);
    await expect(lastValueFrom(service.getSmileitJobStatus('job-1'))).resolves.toEqual(response);

    expect(smileitClientMock.smileitJobsCreate).toHaveBeenCalledWith({
      version: '2.0.0',
      principal_smiles: 'CCO',
      selected_atom_indices: [1, 2],
      assignment_blocks: [
        {
          label: 'A',
          site_atom_indices: [1],
          category_keys: ['alkyl'],
          substituent_refs: [{ stable_id: 'ref-1', version: 2 }],
          manual_substituents: [
            {
              name: 'Manual',
              smiles: 'C',
              anchor_atom_indices: [0],
              categories: ['alkyl'],
              source_reference: 'manual',
              provenance_metadata: { origin: 'manual' },
            },
          ],
        },
      ],
      site_overlap_policy: SiteOverlapPolicyEnum.LastBlockWins,
      r_substitutes: 1,
      num_bonds: 2,
      max_structures: 10,
      export_name_base: 'smileit',
      export_padding: 3,
    });
  });

  it('maps derivation pages and SVG endpoints', async () => {
    vi.mocked(smileitClientMock.smileitJobsDerivationsRetrieve).mockReturnValue(
      of({
        total_generated: 1,
        offset: 0,
        limit: 20,
        items: [
          {
            structure_index: 4,
            name: 'Derivative',
            smiles: 'CCO',
            placeholder_assignments: [
              {
                placeholder_label: 'R1',
                site_atom_index: 1,
                substituent_name: 'Me',
              },
            ],
            traceability: [],
          },
        ],
      }),
    );
    vi.mocked(smileitClientMock.smileitJobsDerivationsSvgRetrieve).mockReturnValue(
      of('<svg>preview</svg>' as unknown as Blob),
    );

    await expect(lastValueFrom(service.listSmileitDerivations('job-1', 0, 20))).resolves.toEqual({
      totalGenerated: 1,
      offset: 0,
      limit: 20,
      items: [
        {
          structureIndex: 4,
          name: 'Derivative',
          smiles: 'CCO',
          placeholderAssignments: [
            {
              placeholderLabel: 'R1',
              siteAtomIndex: 1,
              substituentName: 'Me',
              substituentSmiles: '',
            },
          ],
          traceability: [],
        },
      ],
    });

    expect(smileitClientMock.smileitJobsDerivationsRetrieve).toHaveBeenCalledWith('job-1', 20, 0);

    await expect(lastValueFrom(service.getSmileitDerivationSvg('job-1', 4, 'thumb'))).resolves.toBe(
      '<svg>preview</svg>',
    );

    expect(smileitClientMock.smileitJobsDerivationsSvgRetrieve).toHaveBeenCalledWith(
      'job-1',
      4,
      'thumb',
    );
  });

  it('downloads reports and image zip files', async () => {
    await expect(lastValueFrom(service.downloadSmileitCsvReport('job-1'))).resolves.toEqual(
      expect.objectContaining({ filename: 'smileit-report.csv' }),
    );
    await expect(lastValueFrom(service.downloadSmileitSmilesReport('job-1'))).resolves.toEqual(
      expect.objectContaining({ filename: 'smileit-structures.smi' }),
    );
    await expect(
      lastValueFrom(service.downloadSmileitTraceabilityReport('job-1')),
    ).resolves.toEqual(expect.objectContaining({ filename: 'smileit-traceability.csv' }));
    await expect(lastValueFrom(service.downloadSmileitLogReport('job-1'))).resolves.toEqual(
      expect.objectContaining({ filename: 'smileit-report.log' }),
    );
    await expect(lastValueFrom(service.downloadSmileitErrorReport('job-1'))).resolves.toEqual(
      expect.objectContaining({ filename: 'smileit-error.txt' }),
    );

    await expect(lastValueFrom(service.downloadSmileitImagesZipServer('job-1'))).resolves.toEqual(
      expect.objectContaining({ filename: 'smileit-job-1-images.zip' }),
    );
    expect(smileitClientMock.smileitJobsReportImagesZipRetrieve).toHaveBeenCalledWith(
      'job-1',
      'response',
    );
  });

  it('extracts error messages from different error formats', () => {
    const testAccess = service as unknown as SmileitApiServiceTestAccess;

    // Test string error
    expect(testAccess.extractErrorMessage('Custom error')).toBe('Custom error');

    // Test object with message
    expect(testAccess.extractErrorMessage({ message: 'Object error' })).toBe('Object error');

    // Test nested error with detail
    expect(testAccess.extractErrorMessage({ error: { detail: 'Nested error' } })).toBe(
      'Nested error',
    );

    // Test unknown error
    expect(testAccess.extractErrorMessage({ unknown: 'value' })).toBe(
      'Unsupported SMILES for chemistry services.',
    );

    // Test null
    expect(testAccess.extractErrorMessage(null)).toBe('Unsupported SMILES for chemistry services.');
  });

  it('validates smiles compatibility with empty list', async () => {
    await expect(lastValueFrom(service.validateSmilesCompatibility([]))).resolves.toEqual({
      compatible: true,
      issues: [],
    });
  });

  it('validates smiles compatibility with whitespace and empty strings', async () => {
    vi.mocked(smileitClientMock.smileitJobsInspectStructureCreate).mockReturnValue(
      of(inspectionResponse),
    );

    await expect(
      lastValueFrom(service.validateSmilesCompatibility(['  CCO  ', '', '   '])),
    ).resolves.toEqual({
      compatible: true,
      issues: [],
    });

    expect(smileitClientMock.smileitJobsInspectStructureCreate).toHaveBeenCalledWith({
      smiles: 'CCO',
    });
    expect(smileitClientMock.smileitJobsInspectStructureCreate).toHaveBeenCalledTimes(1);
  });

  it('handles getSmileitDerivationSvg with string response', async () => {
    vi.mocked(smileitClientMock.smileitJobsDerivationsSvgRetrieve).mockReturnValue(
      of('string svg'),
    );

    await expect(lastValueFrom(service.getSmileitDerivationSvg('job-1', 1))).resolves.toBe(
      'string svg',
    );
  });

  it('handles getSmileitDerivationSvg with HttpResponse', async () => {
    // Se usa un objeto mock en lugar de un Blob real porque JSDOM no expone
    // Blob.prototype.text como propiedad espíable; el servicio sólo llama .text()
    const blobMock = { text: vi.fn().mockResolvedValue('<svg></svg>') } as unknown as Blob;
    const httpResponse = new HttpResponse({ body: blobMock });
    vi.mocked(smileitClientMock.smileitJobsDerivationsSvgRetrieve).mockReturnValue(
      of(httpResponse),
    );

    await expect(lastValueFrom(service.getSmileitDerivationSvg('job-1', 1))).resolves.toBe(
      '<svg></svg>',
    );
  });

  it('handles getSmileitDerivationSvg with null body', async () => {
    const httpResponse = new HttpResponse({ body: null });
    vi.mocked(smileitClientMock.smileitJobsDerivationsSvgRetrieve).mockReturnValue(
      of(httpResponse),
    );

    await expect(lastValueFrom(service.getSmileitDerivationSvg('job-1', 1))).resolves.toBe('');
  });
});
