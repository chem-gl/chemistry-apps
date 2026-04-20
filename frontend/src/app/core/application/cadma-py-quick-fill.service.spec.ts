// cadma-py-quick-fill.service.spec.ts: Verifica el auto-relleno rápido de CADMA Py y la normalización de etiquetas SMILES.

import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import {
  extractRequestedSaMethods,
  inspectCadmaSourceConfigs,
  normalizeSmilesGuideCsv,
  pickPreferredHistoricalJobId,
  previewCadmaSourceConfigs,
  resolveScientificJobLabel,
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
});
