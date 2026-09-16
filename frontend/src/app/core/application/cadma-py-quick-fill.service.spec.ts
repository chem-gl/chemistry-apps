// cadma-py-quick-fill.service.spec.ts: Verifica el auto-relleno rápido de CADMA Py y la normalización de etiquetas SMILES.

import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JobsApiService } from '../api/jobs-api.service';
import { CadmaPyQuickFillService } from './cadma-py-quick-fill.service';
import {
  extractRequestedSaMethods,
  inspectCadmaSourceConfigs,
  normalizeSmilesGuideCsv,
  pickPreferredHistoricalJobId,
  previewCadmaSourceConfigs,
  resolveScientificJobLabel,
  type CadmaQuickFillSources,
} from './cadma-py-quick-fill.service';

describe('CadmaPyQuickFill helpers', () => {
  it('normalizes a raw SMI guide into a CSV with a visible name column', () => {
    const rawGuide = ['CCO', 'CCN Candidate_B'].join('\n');

    const normalizedCsv = normalizeSmilesGuideCsv(rawGuide);

    expect(normalizedCsv).toContain('smiles,name');
    expect(normalizedCsv).toContain('CCO,CCO');
    expect(normalizedCsv).toContain('CCN,Candidate_B');
  });

  it('preserves Smile-it generated names when the CSV uses generated_smiles', () => {
    const rawGuide = ['name,generated_smiles', 'principal,CCO', 'dprincipal1,CCN'].join('\n');

    const normalizedCsv = normalizeSmilesGuideCsv(rawGuide);

    expect(normalizedCsv).toContain('smiles,name');
    expect(normalizedCsv).toContain('CCO,principal');
    expect(normalizedCsv).toContain('CCN,dprincipal1');
  });

  it('extracts only supported SA methods from historical parameters', () => {
    const methods = extractRequestedSaMethods({
      methods: ['brsa', 'rdkit', 'unsupported'],
    });

    expect(methods).toEqual(['brsa', 'rdkit']);
  });

  it('builds a readable label from the job parameters and updated date', () => {
    const label = resolveScientificJobLabel({
      id: '12345678-aaaa-bbbb-cccc-1234567890ab',
      updated_at: '2026-04-16T20:00:00.000Z',
      parameters: {
        project_label: 'Lead quinones',
      },
    });

    expect(label).toContain('Lead quinones');
    expect(label).toContain('2026');
  });

  it('inspects the current CADMA source configs and detects guide plus missing metrics', () => {
    const summary = inspectCadmaSourceConfigs(
      JSON.stringify([
        {
          filename: 'candidate-guide.csv',
          content_text: 'smiles,name\nCCO,Lead A\nCCN,Lead B',
          delimiter: ',',
          has_header: true,
          skip_lines: 0,
          smiles_column: 'smiles',
          name_column: 'name',
          dt_column: '',
          m_column: '',
          ld50_column: '',
          sa_column: '',
        },
      ]),
    );

    expect(summary.hasGuide).toBe(true);
    expect(summary.moleculeCount).toBe(2);
    expect(summary.hasNamedCandidates).toBe(true);
    expect(summary.hasToxicityData).toBe(false);
    expect(summary.hasSaData).toBe(false);
  });

  it('uses the first named molecule when a historical job has no explicit title', () => {
    const label = resolveScientificJobLabel({
      id: 'abcdef12-aaaa-bbbb-cccc-1234567890ab',
      updated_at: '2026-04-16T20:00:00.000Z',
      parameters: {
        molecules: [
          { name: 'Candidate Alpha', smiles: 'CCO' },
          { name: 'Candidate Beta', smiles: 'CCN' },
        ],
      },
    });

    expect(label).toContain('Candidate Alpha');
  });

  it('prefers the first Smile-it molecule name over the principal smiles for the default label', () => {
    const label = resolveScientificJobLabel({
      id: 'aaaa1111-aaaa-bbbb-cccc-1234567890ab',
      updated_at: '2026-04-16T20:00:00.000Z',
      parameters: {
        principal_smiles: 'C1=CC=CC=C1',
        molecules: [{ name: 'dprincipal1', smiles: 'CCN' }],
      },
    });

    expect(label).toContain('dprincipal1');
  });

  it('falls back to the first smiles when a CSV has no explicit candidate names', () => {
    const preview = previewCadmaSourceConfigs(
      JSON.stringify([
        {
          filename: 'manual.csv',
          content_text: 'CCO\nCCN',
          delimiter: ',',
          has_header: false,
          skip_lines: 0,
          smiles_column: '',
          name_column: '',
          dt_column: '',
          m_column: '',
          ld50_column: '',
          sa_column: '',
        },
      ]),
      1,
    );

    expect(preview.rows[0]?.name).toBe('CCO');
  });

  it('shows merged toxicity and SA values in the candidate payload preview', () => {
    const preview = previewCadmaSourceConfigs(
      JSON.stringify([
        {
          filename: 'smileit-guide.csv',
          content_text: 'name,generated_smiles\nprincipal,CCO\ndprincipal1,CCN',
          delimiter: ',',
          has_header: true,
          skip_lines: 0,
          smiles_column: 'generated_smiles',
          name_column: 'name',
          dt_column: '',
          m_column: '',
          ld50_column: '',
          sa_column: '',
        },
        {
          filename: 'toxicity.csv',
          content_text: 'smiles,DT,M,LD50\nCCO,0.11,0.22,320\nCCN,0.33,0.44,280',
          delimiter: ',',
          has_header: true,
          skip_lines: 0,
          smiles_column: 'smiles',
          name_column: '',
          dt_column: 'DT',
          m_column: 'M',
          ld50_column: 'LD50',
          sa_column: '',
        },
        {
          filename: 'sa.csv',
          content_text: 'smiles,SA\nCCO,87\nCCN,76',
          delimiter: ',',
          has_header: true,
          skip_lines: 0,
          smiles_column: 'smiles',
          name_column: '',
          dt_column: '',
          m_column: '',
          ld50_column: '',
          sa_column: 'SA',
        },
      ]),
    );

    expect(preview.rows[0]).toMatchObject({
      name: 'principal',
      smiles: 'CCO',
      dt: 0.11,
      m: 0.22,
      ld50: 320,
      sa: 87,
    });
  });

  it('maps boolean-like toxicity outputs so DT and M are not lost in the preview', () => {
    const preview = previewCadmaSourceConfigs(
      JSON.stringify([
        {
          filename: 'smileit-guide.csv',
          content_text: 'name,generated_smiles\nprincipal,CCO',
          delimiter: ',',
          has_header: true,
          skip_lines: 0,
          smiles_column: 'generated_smiles',
          name_column: 'name',
          dt_column: '',
          m_column: '',
          ld50_column: '',
          sa_column: '',
        },
        {
          filename: 'toxicity.csv',
          content_text:
            'smiles,LD50_mgkg,mutagenicity,ames_score,DevTox,devtox_score\nCCO,430.2,Negative,0.14,Positive,0.88',
          delimiter: ',',
          has_header: true,
          skip_lines: 0,
          smiles_column: 'smiles',
          name_column: '',
          dt_column: '',
          m_column: '',
          ld50_column: '',
          sa_column: '',
        },
      ]),
    );

    expect(preview.rows[0]).toMatchObject({
      name: 'principal',
      smiles: 'CCO',
      dt: 1,
      m: 0,
      ld50: 430.2,
    });
  });

  it('keeps the historical selector empty when there are multiple possible jobs', () => {
    const selectedJobId = pickPreferredHistoricalJobId('', [{ id: 'job-1' }, { id: 'job-2' }]);

    expect(selectedJobId).toBe('');
  });

  it('reuses the only available historical job automatically when there is a single choice', () => {
    const selectedJobId = pickPreferredHistoricalJobId('', [{ id: 'job-1' }], true);

    expect(selectedJobId).toBe('job-1');
  });

  it('uses default SA methods for malformed, empty, or unsupported selections', () => {
    expect(extractRequestedSaMethods(null)).toEqual(['ambit', 'brsa', 'rdkit']);
    expect(extractRequestedSaMethods({ methods: [] })).toEqual(['ambit', 'brsa', 'rdkit']);
    expect(extractRequestedSaMethods({ methods: ['unsupported'] })).toEqual([
      'ambit',
      'brsa',
      'rdkit',
    ]);
  });

  it('returns safe empty results for malformed source configuration JSON', () => {
    expect(inspectCadmaSourceConfigs('{not-json')).toEqual({
      hasGuide: false,
      guideFilename: 'candidate_guide.csv',
      moleculeCount: 0,
      hasNamedCandidates: false,
      hasToxicityData: false,
      hasSaData: false,
    });
    expect(previewCadmaSourceConfigs('')).toMatchObject({
      hasGuide: false,
      guideFilename: 'candidate_guide.csv',
      rows: [],
    });
  });

  it('escapes names and normalizes empty guides without producing data rows', () => {
    expect(normalizeSmilesGuideCsv('')).toBe('smiles,name');
    expect(normalizeSmilesGuideCsv('smiles,name\nCCO,"Lead, one"')).toBe(
      'smiles,name\nCCO,"Lead, one"',
    );
  });

  it('falls back to the job id for an invalid date and truncates long labels', () => {
    const label = resolveScientificJobLabel({
      id: '12345678-rest',
      updated_at: 'invalid-date',
      parameters: { title: '123456789012345678901234567890123456' },
    });

    expect(label).toBe('12345678901234567890123456789...');
  });
});

describe('CadmaPyQuickFillService', () => {
  const jobsApiMock = {
    listJobs: vi.fn(),
    downloadSmileitCsvReport: vi.fn(),
    downloadToxicityPropertiesCsvReport: vi.fn(),
    downloadSaScoreCsvMethodReport: vi.fn(),
    validateSmilesCompatibility: vi.fn(),
    dispatchToxicityPropertiesJob: vi.fn(),
    dispatchSaScoreJob: vi.fn(),
    pollJobUntilCompleted: vi.fn(),
    getToxicityPropertiesJobStatus: vi.fn(),
    getSaScoreJobStatus: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    jobsApiMock.listJobs.mockReturnValue(of([]));
    TestBed.configureTestingModule({
      providers: [CadmaPyQuickFillService, { provide: JobsApiService, useValue: jobsApiMock }],
    });
  });

  it('carga y ordena los tres tipos de jobs históricos', () => {
    jobsApiMock.listJobs
      .mockReturnValueOnce(of([{ id: 'old', updated_at: '2025-01-01' }, { id: 'new', updated_at: '2026-01-01' }]))
      .mockReturnValueOnce(of([{ id: 'tox', updated_at: '2026-02-01' }]))
      .mockReturnValueOnce(of([{ id: 'sa', updated_at: '2026-03-01' }]));

    let result: CadmaQuickFillSources | undefined;
    service().loadSourceJobs().subscribe((value) => (result = value));

    expect(result?.smileitJobs.map((job) => job.id)).toEqual(['new', 'old']);
    expect(jobsApiMock.listJobs).toHaveBeenCalledWith({ pluginName: 'sa-score', status: 'completed' });
  });

  it('rechaza construir payload sin job Smile-it', () => {
    let errorMessage = '';
    service()
      .buildAutoFillPayload({ smileitJobId: ' ', saMethod: 'rdkit' })
      .subscribe({ error: (error: Error) => (errorMessage = error.message) });

    expect(errorMessage).toContain('Select a Smile-it job');
    expect(jobsApiMock.downloadSmileitCsvReport).not.toHaveBeenCalled();
  });

  it('construye payload descargando guía y reportes opcionales', async () => {
    jobsApiMock.downloadSmileitCsvReport.mockReturnValue(
      of({ blob: { text: vi.fn().mockResolvedValue('name,smiles\nLead,CCO') } }),
    );
    jobsApiMock.downloadToxicityPropertiesCsvReport.mockReturnValue(
      of({ blob: { text: vi.fn().mockResolvedValue('smiles,DT\nCCO,0.2') } }),
    );
    jobsApiMock.downloadSaScoreCsvMethodReport.mockReturnValue(
      of({ blob: { text: vi.fn().mockResolvedValue('smiles,SA\nCCO,80') } }),
    );

    const payload = await firstValueFrom(service()
      .buildAutoFillPayload({
        smileitJobId: 'smile-1',
        toxicityJobId: 'tox-1',
        saScoreJobId: 'sa-1',
        saMethod: 'rdkit',
      }));

    expect(payload?.totalFiles).toBe(3);
    expect(payload?.sourceConfigsJson).toContain('toxicity_tox-1_report.csv');
    expect(jobsApiMock.downloadSaScoreCsvMethodReport).toHaveBeenCalledWith('sa-1', 'rdkit');
  });

  it('construye una guía usando solo el reporte Smile-it cuando no se seleccionan reportes', async () => {
    jobsApiMock.downloadSmileitCsvReport.mockReturnValue(
      of({ blob: { text: vi.fn().mockResolvedValue('smiles\nCCO') } }),
    );

    const payload = await firstValueFrom(
      service().buildAutoFillPayload({ smileitJobId: 'smile-2', saMethod: 'ambit' }),
    );

    expect(payload).toMatchObject({
      filenames: ['smileit_smile-2_guide.csv'],
      totalFiles: 1,
      totalUsableRows: 1,
    });
    expect(jobsApiMock.downloadToxicityPropertiesCsvReport).not.toHaveBeenCalled();
    expect(jobsApiMock.downloadSaScoreCsvMethodReport).not.toHaveBeenCalled();
  });

  it('devuelve error cuando la compatibilidad de la guía falla', async () => {
    jobsApiMock.downloadSmileitCsvReport.mockReturnValue(
      of({ blob: { text: vi.fn().mockResolvedValue('name,smiles\nLead,invalid') } }),
    );
    jobsApiMock.validateSmilesCompatibility.mockReturnValue(of({ compatible: false }));
    let errorMessage = '';

    await firstValueFrom(service().launchAutoFillFromSmileitJob('smile-1', 'rdkit')).catch(
      (error: Error) => (errorMessage = error.message),
    );

    expect(errorMessage).toContain('unsupported SMILES');
    expect(jobsApiMock.dispatchSaScoreJob).not.toHaveBeenCalled();
  });

  it('rechaza lanzar desde una guía vacía o con métricas completas', async () => {
    const emptyError = await firstValueFrom(
      service().launchAutoFillFromCurrentGuide('[]', 'rdkit'),
    ).catch((error: Error) => error.message);
    expect(emptyError).toContain('Upload a candidate guide');

    const completeGuide = JSON.stringify([
      {
        filename: 'complete.csv',
        content_text: 'smiles,name,DT,M,LD50,SA\nCCO,Lead,0.1,0.2,300,80',
        has_header: true,
        smiles_column: 'smiles',
        name_column: 'name',
        dt_column: 'DT',
        m_column: 'M',
        ld50_column: 'LD50',
        sa_column: 'SA',
      },
    ]);
    const completeError = await firstValueFrom(
      service().launchAutoFillFromCurrentGuide(completeGuide, 'rdkit'),
    ).catch((error: Error) => error.message);
    expect(completeError).toContain('already includes toxicity and SA');
    expect(jobsApiMock.validateSmilesCompatibility).not.toHaveBeenCalled();
  });

  it('lanza ambos predictores y descarga reportes cuando el job ya está completado', async () => {
    jobsApiMock.downloadSmileitCsvReport.mockReturnValue(
      of({ blob: { text: vi.fn().mockResolvedValue('name,smiles\nLead,CCO') } }),
    );
    jobsApiMock.validateSmilesCompatibility.mockReturnValue(of({ compatible: true }));
    jobsApiMock.dispatchToxicityPropertiesJob.mockReturnValue(of({ id: 'tox-4', status: 'completed' }));
    jobsApiMock.dispatchSaScoreJob.mockReturnValue(of({ id: 'sa-4', status: 'completed' }));
    jobsApiMock.downloadToxicityPropertiesCsvReport.mockReturnValue(
      of({ blob: { text: vi.fn().mockResolvedValue('smiles,DT\nCCO,positive') } }),
    );
    jobsApiMock.downloadSaScoreCsvMethodReport.mockReturnValue(
      of({ blob: { text: vi.fn().mockResolvedValue('smiles,SA\nCCO,75') } }),
    );

    const payload = await firstValueFrom(service().launchAutoFillFromSmileitJob(' smile-4 ', 'brsa'));

    expect(payload).toMatchObject({
      launchedToxicityJobId: 'tox-4',
      launchedSaScoreJobId: 'sa-4',
      totalFiles: 3,
    });
    expect(jobsApiMock.dispatchSaScoreJob).toHaveBeenCalledWith({
      molecules: [{ name: 'Lead', smiles: 'CCO' }],
      methods: ['brsa'],
      version: '1.0.0',
    });
    expect(jobsApiMock.pollJobUntilCompleted).not.toHaveBeenCalled();
  });

  it('rechaza iniciar desde Smile-it sin moléculas utilizables y valida un id vacío', async () => {
    const emptyIdError = await firstValueFrom(
      service().launchAutoFillFromSmileitJob(' ', 'rdkit'),
    ).catch((error: Error) => error.message);
    expect(emptyIdError).toContain('Select a Smile-it job');

    jobsApiMock.downloadSmileitCsvReport.mockReturnValue(
      of({ blob: { text: vi.fn().mockResolvedValue('smiles,name\n,') } }),
    );
    const noMoleculesError = await firstValueFrom(
      service().launchAutoFillFromSmileitJob('smile-empty', 'rdkit'),
    ).catch((error: Error) => error.message);
    expect(noMoleculesError).toContain('does not expose usable named molecules');
    expect(jobsApiMock.validateSmilesCompatibility).not.toHaveBeenCalled();
  });

  it('lanza solo los predictores faltantes de una guía existente', async () => {
    const guide = JSON.stringify([
      {
        filename: 'guide.csv', content_text: 'smiles,name\nCCO,Lead', delimiter: ',',
        has_header: true, smiles_column: 'smiles', name_column: 'name',
        dt_column: '', m_column: '', ld50_column: '', sa_column: 'sa',
      },
    ]);
    jobsApiMock.validateSmilesCompatibility.mockReturnValue(of({ compatible: true }));
    jobsApiMock.dispatchToxicityPropertiesJob.mockReturnValue(of({ id: 'tox-2', status: 'completed' }));
    jobsApiMock.downloadToxicityPropertiesCsvReport.mockReturnValue(
      of({ blob: { text: vi.fn().mockResolvedValue('smiles,DT\nCCO,0.2') } }),
    );

    const payload = await firstValueFrom(service().launchAutoFillFromCurrentGuide(guide, 'rdkit'));

    expect(payload).toMatchObject({ launchedToxicityJobId: 'tox-2', launchedSaScoreJobId: '' });
    expect(jobsApiMock.dispatchSaScoreJob).not.toHaveBeenCalled();
  });

  it('propaga fallo del predictor al esperar un estado no completado', async () => {
    jobsApiMock.validateSmilesCompatibility.mockReturnValue(of({ compatible: true }));
    jobsApiMock.dispatchToxicityPropertiesJob.mockReturnValue(of({ id: 'tox-3', status: 'pending' }));
    jobsApiMock.dispatchSaScoreJob.mockReturnValue(of({ id: 'sa-3', status: 'pending' }));
    jobsApiMock.pollJobUntilCompleted.mockReturnValue(of({ status: 'failed' }));
    jobsApiMock.getToxicityPropertiesJobStatus.mockReturnValue(of({ status: 'failed' }));
    jobsApiMock.getSaScoreJobStatus.mockReturnValue(of({ status: 'failed' }));
    let errorMessage = '';

    await firstValueFrom(service()
      .launchAutoFillFromCurrentGuide(
        JSON.stringify([{ filename: 'guide.csv', content_text: 'smiles,name\nCCO,Lead', has_header: true, smiles_column: 'smiles', name_column: 'name' }]),
        'rdkit',
      )).catch((error: Error) => (errorMessage = error.message));

    expect(errorMessage).toContain('finished with status failed');
  });

  function service(): CadmaPyQuickFillService {
    return TestBed.inject(CadmaPyQuickFillService);
  }
});
