// public-jobs-api.service.spec.ts: Tests del cliente del modo libre/público.
// Verifica URLs, cuerpos enviados, parseo de respuestas, propagación de errores
// HTTP y descarga de reportes (nombre derivado del header y blob recibido).

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../shared/constants';
import {
  MethodsEnum,
  MolarFractionsJobResponse,
  StatusEnum,
  TunnelJobResponse,
  provideApi,
} from './generated';
import { PublicJobsApiService } from './public-jobs-api.service';

const MOLAR_JOBS_URL: string = `${API_BASE_URL}/api/public/molar-fractions/jobs/`;
const MOLAR_JOB_URL = (id: string): string => `${MOLAR_JOBS_URL}${id}/`;
const MOLAR_REPORT_CSV_URL = (id: string): string => `${MOLAR_JOBS_URL}${id}/report-csv/`;
const TUNNEL_JOBS_URL: string = `${API_BASE_URL}/api/public/tunnel/jobs/`;
const TUNNEL_JOB_URL = (id: string): string => `${TUNNEL_JOBS_URL}${id}/`;
const TUNNEL_REPORT_CSV_URL = (id: string): string => `${TUNNEL_JOBS_URL}${id}/report-csv/`;
const SMILEIT_JOBS_URL: string = `${API_BASE_URL}/api/public/smileit/jobs/`;
const SMILEIT_IMAGES_ZIP_URL = (id: string): string =>
  `${SMILEIT_JOBS_URL}${id}/report-images-zip/`;
const SMILEIT_INSPECT_URL: string = `${SMILEIT_JOBS_URL}inspect-structure/`;
const SMILEIT_DERIVATION_SVG_URL = (id: string, index: number): string =>
  `${SMILEIT_JOBS_URL}${id}/derivations/${index}/svg/`;
const SMILEIT_DERIVATIONS_URL = (id: string): string => `${SMILEIT_JOBS_URL}${id}/derivations/`;
const SA_SCORE_JOBS_URL: string = `${API_BASE_URL}/api/public/sa-score/jobs/`;

/** Respuesta mínima válida de un job de molar-fractions */
function makeMolarJobResponse(
  overrides: Partial<MolarFractionsJobResponse> = {},
): MolarFractionsJobResponse {
  return {
    id: 'molar-job-1',
    job_hash: 'molar-hash',
    plugin_name: 'molar-fractions',
    algorithm_version: '1.0.0',
    status: StatusEnum.Pending,
    cache_hit: false,
    cache_miss: true,
    progress_percentage: 0,
    progress_stage: 'pending',
    progress_message: 'Pendiente',
    progress_event_index: 1,
    parameters: {
      pka_values: [4.76],
      ph_mode: 'single',
      ph_value: 7,
    },
    results: null,
    error_trace: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

/** Respuesta mínima válida de un job de tunnel */
function makeTunnelJobResponse(overrides: Partial<TunnelJobResponse> = {}): TunnelJobResponse {
  return {
    id: 'tunnel-job-1',
    job_hash: 'tunnel-hash',
    plugin_name: 'tunnel-effect',
    algorithm_version: '2.0.0',
    status: StatusEnum.Completed,
    cache_hit: false,
    cache_miss: true,
    progress_percentage: 100,
    progress_stage: 'completed',
    progress_message: 'Completado',
    progress_event_index: 4,
    parameters: {
      reaction_barrier_zpe: 12.5,
      imaginary_frequency: 450.2,
      reaction_energy_zpe: -3.4,
      temperature: 298.15,
      input_change_events: [],
    },
    results: null,
    error_trace: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('PublicJobsApiService', () => {
  let service: PublicJobsApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideApi(API_BASE_URL),
        PublicJobsApiService,
      ],
    });
    service = TestBed.inject(PublicJobsApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('dispatchMolarFractionsJob', () => {
    it('envía POST a /api/public/molar-fractions/jobs/ con el payload de modo single', () => {
      const expectedResponse = makeMolarJobResponse({ id: 'molar-single-1' });
      let receivedId: string | null = null;

      service
        .dispatchMolarFractionsJob({
          pkaValues: [4.76, 9.13],
          initialCharge: 0,
          label: '  ácido  ',
          phMode: 'single',
          phValue: 7.2,
        })
        .subscribe((response) => {
          receivedId = response.id;
        });

      const req = httpMock.expectOne(MOLAR_JOBS_URL);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        version: '1.0.0',
        pka_values: [4.76, 9.13],
        ph_mode: 'single',
        initial_charge: '0',
        label: 'ácido',
        ph_value: 7.2,
      });

      req.flush(expectedResponse);
      expect(receivedId).toBe('molar-single-1');
    });

    it('envía ph_min/ph_max/ph_step en modo range y omite ph_value', () => {
      service
        .dispatchMolarFractionsJob({
          pkaValues: [3.1],
          phMode: 'range',
          phMin: 0,
          phMax: 14,
          phStep: 0.5,
          version: '1.2.0',
        })
        .subscribe();

      const req = httpMock.expectOne(MOLAR_JOBS_URL);
      const body = req.request.body as Record<string, unknown>;
      expect(body['ph_min']).toBe(0);
      expect(body['ph_max']).toBe(14);
      expect(body['ph_step']).toBe(0.5);
      expect(body['version']).toBe('1.2.0');
      expect(body).not.toHaveProperty('ph_value');
      expect(body).not.toHaveProperty('initial_charge');
      expect(body).not.toHaveProperty('label');

      req.flush(makeMolarJobResponse());
    });

    it('rechaza valores pKa fuera del rango 1..6 sin emitir request', () => {
      expect(() =>
        service.dispatchMolarFractionsJob({ pkaValues: [], phMode: 'single', phValue: 7 }),
      ).toThrow('molar-fractions requiere entre 1 y 6 valores pKa.');

      expect(() =>
        service.dispatchMolarFractionsJob({
          pkaValues: [1, 2, 3, 4, 5, 6, 7],
          phMode: 'single',
          phValue: 7,
        }),
      ).toThrow('molar-fractions requiere entre 1 y 6 valores pKa.');

      httpMock.expectNone(MOLAR_JOBS_URL);
    });
  });

  describe('dispatchTunnelJob', () => {
    it('envía POST a /api/public/tunnel/jobs/ normalizando números y eventos', () => {
      service
        .dispatchTunnelJob({
          reactionBarrierZpe: 12.5,
          imaginaryFrequency: 450.2,
          reactionEnergyZpe: -3.4,
          temperature: 298.15,
          inputChangeEvents: [
            {
              fieldName: 'temperature',
              previousValue: 298.15,
              newValue: 310,
              changedAt: '2026-11-02T10:00:00Z',
            },
          ],
        })
        .subscribe();

      const req = httpMock.expectOne(TUNNEL_JOBS_URL);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        version: '2.0.0',
        reaction_barrier_zpe: 12.5,
        imaginary_frequency: 450.2,
        reaction_energy_zpe: -3.4,
        temperature: 298.15,
        input_change_events: [
          {
            field_name: 'temperature',
            previous_value: 298.15,
            new_value: 310,
            changed_at: '2026-11-02T10:00:00Z',
          },
        ],
      });

      req.flush(makeTunnelJobResponse());
    });

    it('envía input_change_events vacío cuando no se informan eventos', () => {
      service
        .dispatchTunnelJob({
          reactionBarrierZpe: 1,
          imaginaryFrequency: 2,
          reactionEnergyZpe: 3,
          temperature: 4,
        })
        .subscribe();

      const req = httpMock.expectOne(TUNNEL_JOBS_URL);
      const body = req.request.body as Record<string, unknown>;
      expect(body['input_change_events']).toEqual([]);

      req.flush(makeTunnelJobResponse());
    });
  });

  describe('consultas de estado', () => {
    it('getMolarFractionsJobStatus consulta la URL pública y devuelve la respuesta parseada', () => {
      const jobId = 'molar-status-1';
      let received: MolarFractionsJobResponse | null = null;

      service.getMolarFractionsJobStatus(jobId).subscribe((response) => {
        received = response;
      });

      const req = httpMock.expectOne(MOLAR_JOB_URL(jobId));
      expect(req.request.method).toBe('GET');
      req.flush(
        makeMolarJobResponse({
          id: jobId,
          status: StatusEnum.Running,
          progress_percentage: 42,
          progress_message: 'Calculando fracciones',
        }),
      );

      expect(received).not.toBeNull();
      expect(received!.id).toBe(jobId);
      expect(received!.status).toBe(StatusEnum.Running);
      expect(received!.progress_percentage).toBe(42);
      expect(received!.progress_message).toBe('Calculando fracciones');
    });

    it('getTunnelJobStatus consulta la URL pública y devuelve la respuesta parseada', () => {
      const jobId = 'tunnel-status-1';
      let receivedStatus: string | null = null;

      service.getTunnelJobStatus(jobId).subscribe((response) => {
        receivedStatus = response.status;
      });

      const req = httpMock.expectOne(TUNNEL_JOB_URL(jobId));
      expect(req.request.method).toBe('GET');
      req.flush(makeTunnelJobResponse({ id: jobId, status: StatusEnum.Completed }));

      expect(receivedStatus).toBe(StatusEnum.Completed);
    });

    it('propaga el 404 de getMolarFractionsJobStatus al observable', () => {
      const jobId = 'molar-missing-1';
      let receivedStatus: number | null = null;

      service.getMolarFractionsJobStatus(jobId).subscribe({
        next: () => {
          throw new Error('No debería emitir valor en un 404.');
        },
        error: (error: { status: number }) => {
          receivedStatus = error.status;
        },
      });

      httpMock
        .expectOne(MOLAR_JOB_URL(jobId))
        .flush({ detail: 'No encontrado' }, { status: 404, statusText: 'Not Found' });

      expect(receivedStatus).toBe(404);
    });

    it('propaga el 429 de dispatchTunnelJob al observable', () => {
      let receivedStatus: number | null = null;

      service
        .dispatchTunnelJob({
          reactionBarrierZpe: 1,
          imaginaryFrequency: 2,
          reactionEnergyZpe: 3,
          temperature: 4,
        })
        .subscribe({
          next: () => {
            throw new Error('No debería emitir valor en un 429.');
          },
          error: (error: { status: number }) => {
            receivedStatus = error.status;
          },
        });

      httpMock
        .expectOne(TUNNEL_JOBS_URL)
        .flush({ detail: 'Demasiadas peticiones' }, { status: 429, statusText: 'Too Many Requests' });

      expect(receivedStatus).toBe(429);
    });
  });

  describe('dispatchSaScoreJob', () => {
    it('envía moléculas y métodos con la versión por defecto', () => {
      service
        .dispatchSaScoreJob({
          molecules: [{ name: 'etanol', smiles: 'CCO' }],
          methods: [MethodsEnum.Rdkit],
        })
        .subscribe();

      const req = httpMock.expectOne(SA_SCORE_JOBS_URL);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        molecules: [{ name: 'etanol', smiles: 'CCO' }],
        methods: ['rdkit'],
        version: '1.0.0',
      });

      req.flush({ id: 'sa-score-job-1' });
    });
  });

  describe('dispatchSmileitJob', () => {
    it('aplana bloques, referencias y sustituyentes manuales al contrato del backend', () => {
      service
        .dispatchSmileitJob({
          principalSmiles: 'c1ccccc1',
          selectedAtomIndices: [0],
          assignmentBlocks: [
            {
              label: 'bloque-1',
              siteAtomIndices: [2],
              categoryKeys: ['donor'],
              substituentRefs: [{ stableId: 'sub-1', version: 3 }],
              manualSubstituents: [
                {
                  name: 'metilo',
                  smiles: 'C',
                  anchorAtomIndices: [2],
                  categories: ['alkyl'],
                  sourceReference: 'paper',
                  provenanceMetadata: { doi: '10.0/x' },
                },
              ],
            },
          ],
          siteOverlapPolicy: 'last_block_wins',
          rSubstitutes: 2,
          numBonds: 1,
          maxStructures: 50,
          exportNameBase: 'serie',
          exportPadding: 5,
        })
        .subscribe();

      const req = httpMock.expectOne(SMILEIT_JOBS_URL);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        version: '2.0.0',
        principal_smiles: 'c1ccccc1',
        selected_atom_indices: [0],
        assignment_blocks: [
          {
            label: 'bloque-1',
            site_atom_indices: [2],
            category_keys: ['donor'],
            substituent_refs: [{ stable_id: 'sub-1', version: 3 }],
            manual_substituents: [
              {
                name: 'metilo',
                smiles: 'C',
                anchor_atom_indices: [2],
                categories: ['alkyl'],
                source_reference: 'paper',
                provenance_metadata: { doi: '10.0/x' },
              },
            ],
          },
        ],
        site_overlap_policy: 'last_block_wins',
        r_substitutes: 2,
        num_bonds: 1,
        max_structures: 50,
        export_name_base: 'serie',
        export_padding: 5,
      });

      req.flush({ id: 'smileit-job-2' });
    });
  });

  describe('listSmileitDerivations', () => {
    it('mapea snake_case, respeta la paginación y normaliza substituent_smiles ausente', () => {
      const jobId = 'smileit-derivations-1';
      let receivedTotal: number | null = null;
      let receivedSubstituentSmiles: string | null = null;

      service.listSmileitDerivations(jobId, 100, 50).subscribe((page) => {
        receivedTotal = page.totalGenerated;
        receivedSubstituentSmiles = page.items[0]?.placeholderAssignments[0]?.substituentSmiles ?? null;
      });

      const req = httpMock.expectOne(
        (candidate) =>
          candidate.url === SMILEIT_DERIVATIONS_URL(jobId) &&
          candidate.params.get('limit') === '50' &&
          candidate.params.get('offset') === '100',
      );
      expect(req.request.method).toBe('GET');

      req.flush({
        total_generated: 87,
        offset: 100,
        limit: 50,
        items: [
          {
            structure_index: 4,
            name: 'derivado-4',
            smiles: 'CCO',
            placeholder_assignments: [
              {
                placeholder_label: 'R1',
                site_atom_index: 2,
                substituent_name: 'metilo',
              },
            ],
            traceability: [],
          },
        ],
      });

      expect(receivedTotal).toBe(87);
      expect(receivedSubstituentSmiles).toBe('');
    });
  });

  describe('descargas de reportes', () => {
    it('downloadMolarFractionsCsvReport descarga el CSV con el nombre del header', () => {
      const jobId = 'molar-report-1';
      let receivedFilename: string | null = null;
      let receivedSize = 0;

      service.downloadMolarFractionsCsvReport(jobId).subscribe((reportFile) => {
        receivedFilename = reportFile.filename;
        receivedSize = reportFile.blob.size;
      });

      const req = httpMock.expectOne(MOLAR_REPORT_CSV_URL(jobId));
      expect(req.request.method).toBe('GET');
      expect(req.request.responseType).toBe('blob');

      req.flush(new Blob(['ph,fraction\n7.0,0.5'], { type: 'text/csv' }), {
        headers: { 'content-disposition': 'attachment; filename="molar_backend.csv"' },
      });

      expect(receivedFilename).toBe('molar_backend.csv');
      expect(receivedSize).toBeGreaterThan(0);
    });

    it('downloadSmileitImagesZipServer decodifica el nombre UTF-8 del header', () => {
      const jobId = 'smileit-report-1';
      let receivedFilename: string | null = null;

      service.downloadSmileitImagesZipServer(jobId).subscribe((reportFile) => {
        receivedFilename = reportFile.filename;
      });

      const req = httpMock.expectOne(SMILEIT_IMAGES_ZIP_URL(jobId));
      expect(req.request.method).toBe('GET');
      expect(req.request.responseType).toBe('blob');

      req.flush(new Blob(['zip-bytes'], { type: 'application/zip' }), {
        headers: {
          'content-disposition': "attachment; filename*=UTF-8''imagenes%20smileit.zip",
        },
      });

      expect(receivedFilename).toBe('imagenes smileit.zip');
    });

    it('downloadTunnelCsvReport usa el nombre de respaldo cuando falta el header', () => {
      const jobId = 'tunnel-report-1';
      let receivedFilename: string | null = null;

      service.downloadTunnelCsvReport(jobId).subscribe((reportFile) => {
        receivedFilename = reportFile.filename;
      });

      httpMock
        .expectOne(TUNNEL_REPORT_CSV_URL(jobId))
        .flush(new Blob(['barrier,value\n12.5,1.0'], { type: 'text/csv' }));

      expect(receivedFilename).toBe(`tunnel_effect_${jobId}_report.csv`);
    });
  });

  describe('smileit (mapeos de vista)', () => {    it('inspectSmileitStructure convierte el payload snake_case al modelo de vista', () => {
      let receivedCanonicalSmiles: string | null = null;
      let receivedAtomSymbol: string | null = null;

      service.inspectSmileitStructure('CCO').subscribe((view) => {
        receivedCanonicalSmiles = view.canonicalSmiles;
        receivedAtomSymbol = view.atoms[1]?.symbol ?? null;
      });

      const req = httpMock.expectOne(SMILEIT_INSPECT_URL);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ smiles: 'CCO' });

      req.flush({
        canonical_smiles: 'CCO',
        atom_count: 2,
        atoms: [
          { index: 0, symbol: 'C', implicit_hydrogens: 3, is_aromatic: false },
          { index: 1, symbol: 'O', implicit_hydrogens: 1, is_aromatic: false },
        ],
        svg: '<svg></svg>',
        quick_properties: {
          molecular_weight: 46.07,
          clogp: -0.1,
          rotatable_bonds: 0,
          hbond_donors: 1,
          hbond_acceptors: 1,
          tpsa: 20.2,
          aromatic_rings: 0,
        },
        annotations: [],
        active_pattern_refs: [],
      });

      expect(receivedCanonicalSmiles).toBe('CCO');
      expect(receivedAtomSymbol).toBe('O');
    });

    it('getSmileitDerivationSvg devuelve el texto del blob recibido', async () => {
      const jobId = 'smileit-job-1';
      const svgPromise = firstValueFrom(service.getSmileitDerivationSvg(jobId, 3));

      const req = httpMock.expectOne(`${SMILEIT_DERIVATION_SVG_URL(jobId, 3)}?variant=detail`);
      expect(req.request.method).toBe('GET');
      expect(req.request.responseType).toBe('blob');

      // jsdom no implementa Blob.text(); se completa el blob para ejercitar el mapeo real.
      const svgBlob = Object.assign(new Blob(['<svg>derivacion</svg>'], { type: 'image/svg+xml' }), {
        text: (): Promise<string> => Promise.resolve('<svg>derivacion</svg>'),
      });
      req.flush(svgBlob);

      await expect(svgPromise).resolves.toBe('<svg>derivacion</svg>');
    });
  });
});
