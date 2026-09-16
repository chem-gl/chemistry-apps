// cadma-py-chart.options.spec.ts: Regresiones para las gráficas de CADMA Py.

import { describe, expect, it } from 'vitest';
import {
  buildCadmaBoxplotOptions,
  buildCadmaReferenceBoxplotOptionsMap,
  buildCadmaReferenceMiniBoxplotOptions,
  buildCadmaMetricChartOptions,
  buildCadmaResultsBoxplotOptionsMap,
  buildCadmaResultsBoxplotSingleChart,
  buildCadmaScoreChartOptions,
  getAllReferenceBoxplotMetrics,
  getReferenceBoxplotMetricDefs,
  getResultsBoxplotMetricDefs,
  buildCadmaSingleMetricBoxplotOptions,
} from './cadma-py-chart.options';
import { CadmaRankingRowView, CadmaReferenceRowView } from '../core/api/cadma-py-api.service';

const mockRow = (overrides: Partial<CadmaRankingRowView> = {}): CadmaRankingRowView => ({
  name: 'Mol A',
  smiles: 'CCO',
  selection_score: 0.85,
  adme_alignment: 0.9,
  toxicity_alignment: 0.8,
  sa_alignment: 0.7,
  adme_hits_in_band: 5,
  MW: 180,
  logP: 1.2,
  MR: 45,
  AtX: 12,
  HBLA: 3,
  HBLD: 1,
  RB: 4,
  PSA: 52,
  DT: 0.15,
  M: 0.08,
  LD50: 320,
  SA: 3.2,
  metrics_in_band: ['MW', 'logP'],
  best_fit_summary: 'good',
  ...overrides,
});

const mockReferenceRow = (overrides: Partial<CadmaReferenceRowView> = {}): CadmaReferenceRowView => ({
  ...mockRow(), paper_authors: '', paper_reference: '', paper_url: '', evidence_note: '',
  MW: 180, logP: 1.2, MR: 45, AtX: 12, HBLA: 3, HBLD: 1, RB: 4, PSA: 52,
  DT: 0.15, M: 0.08, LD50: 320, SA: 3.2,
  ...overrides,
} as unknown as CadmaReferenceRowView);

describe('cadma-py-chart.options', () => {
  it('builds the score chart with dynamic scale and explicit line support', () => {
    const options = buildCadmaScoreChartOptions(
      {
        categories: ['Mol A', 'Mol B'],
        values: [0.82, 0.44],
        reference_line: 1,
      },
      'line',
    );

    const series = Array.isArray(options['series']) ? options['series'][0] : options['series'];
    const yAxis = Array.isArray(options['yAxis']) ? options['yAxis'][0] : options['yAxis'];

    expect(series?.type).toBe('line');
    expect(yAxis?.max).toBeLessThan(2);
    expect(yAxis?.min).toBeLessThan(0.44);
  });

  it('adds the reference band area for metric charts', () => {
    const options = buildCadmaMetricChartOptions(
      {
        metric: 'MW',
        label: 'Molecular Weight',
        categories: ['Mol A', 'Mol B'],
        values: [320, 280],
        reference_mean: 300,
        reference_low: 260,
        reference_high: 340,
        better_direction: 'balanced',
      },
      'line',
    );

    const series = Array.isArray(options['series']) ? options['series'][0] : options['series'];
    expect(series?.type).toBe('line');
    expect(series?.markArea).toBeDefined();
  });

  describe('buildCadmaResultsBoxplotOptionsMap', () => {
    it('returns 12 metric entries for non-empty ranking', () => {
      const rows = [
        mockRow({ MW: 200, name: 'A' }),
        mockRow({ MW: 300, name: 'B' }),
        mockRow({ MW: 400, name: 'C' }),
      ];
      const map = buildCadmaResultsBoxplotOptionsMap(rows);

      expect(Object.keys(map)).toHaveLength(12);
      expect(map['MW']).toBeDefined();
      expect(map['SA']).toBeDefined();
    });

    it('includes boxplot and scatter series per metric', () => {
      const rows = [mockRow({ MW: 250 }), mockRow({ MW: 350 })];
      const map = buildCadmaResultsBoxplotOptionsMap(rows);
      const mwOptions = map['MW'];
      const series = Array.isArray(mwOptions['series']) ? mwOptions['series'] : [mwOptions['series']];

      const types = series.map((s: Record<string, unknown>) => s['type']);
      expect(types).toContain('boxplot');
      expect(types).toContain('scatter');
    });

    it('handles molecules with partial missing metrics', () => {
      const rows = [
        mockRow({ MW: 250, logP: undefined }),
        mockRow({ MW: 350, logP: 2.0 }),
      ];
      const map = buildCadmaResultsBoxplotOptionsMap(rows);

      const mwSeries = Array.isArray(map['MW']['series']) ? map['MW']['series'] : [map['MW']['series']];
      expect(mwSeries.length).toBeGreaterThan(0);

      const logpSeries = Array.isArray(map['logP']['series']) ? map['logP']['series'] : [map['logP']['series']];
      expect(logpSeries.length).toBeGreaterThan(0);
    });

    it('includes a title for each metric chart', () => {
      const rows = [mockRow()];
      const map = buildCadmaResultsBoxplotOptionsMap(rows);

      for (const key of ['MW', 'logP', 'SA']) {
        const options = map[key];
        expect(options['title']).toBeDefined();
      }
    });
  });

  it('covers score bar/scatter series, ranking metadata and tooltip fallbacks', () => {
    const score = { categories: ['A'], values: [1], reference_line: 0.5 };
    const bar = buildCadmaScoreChartOptions(score, 'bar');
    const scatter = buildCadmaScoreChartOptions(score, 'scatter', [mockRow({ name: 'Named', smiles: 'CO' })]);
    const barSeries = (bar['series'] as Array<Record<string, unknown>>)[0];
    const scatterSeries = (scatter['series'] as Array<Record<string, unknown>>)[0];
    expect(barSeries['type']).toBe('bar');
    expect(scatterSeries['data']).toEqual([{ value: [0, 1], name: 'Named', smiles: 'CO', symbolSize: 10 }]);
    const formatter = (scatter['tooltip'] as { formatter: (p: unknown) => string })['formatter'];
    expect(formatter({ data: { name: 'A', smiles: 'CO', value: [0, 1] } })).toContain('Score: 1.00');
    expect(formatter({ name: 'fallback' })).toBe('fallback');
  });

  it('handles empty and constant reference mini boxplots', () => {
    const empty = buildCadmaReferenceMiniBoxplotOptions([], 'MW', 'Molecular Weight');
    expect(empty['series']).toEqual([]);
    const options = buildCadmaReferenceMiniBoxplotOptions([mockReferenceRow({ MW: 10 })], 'MW', 'MW');
    const series = (options['series'] as Array<Record<string, unknown>>)[0];
    expect(series['data']).toEqual([[10, 10, 10, 10, 10]]);
    const formatter = (options['tooltip'] as { formatter: () => string })['formatter'];
    expect(formatter()).toContain('n: 1');
  });

  it('filters reference boxplots and separates outliers deterministically', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const rows = [mockReferenceRow({ MW: 1, name: 'small' }), mockReferenceRow({ MW: 2 }), mockReferenceRow({ MW: 3 }), mockReferenceRow({ MW: 100, name: 'outlier' })];
    const options = buildCadmaBoxplotOptions(rows, new Set(['ADME']), new Set(['logP']));
    const categories = (options['xAxis'] as { data: string[] })['data'];
    const series = options['series'] as Array<{ data: unknown[] }>;
    expect(categories).toContain('MW');
    expect(categories).not.toContain('LogP');
    expect(series[2].data).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'outlier' })]));
    const tooltip = (options['tooltip'] as { formatter: (p: unknown) => string })['formatter'];
    expect(tooltip({ seriesType: 'boxplot', dataIndex: 0, data: [] })).toContain('Median');
    expect(tooltip({ seriesType: 'scatter', dataIndex: 0, data: { name: 'x', value: [0, 2], smiles: 'CC' } })).toContain('2.00');
    expect(tooltip({ name: 'plain', seriesType: 'line', data: 1, dataIndex: 0 })).toBe('plain');
    vi.restoreAllMocks();
  });

  it('exposes metric definitions and supports empty/result metric charts', () => {
    expect(getAllReferenceBoxplotMetrics().length).toBe(17);
    expect(getReferenceBoxplotMetricDefs().some((metric) => metric.group === 'Toxicity')).toBe(true);
    expect(getResultsBoxplotMetricDefs()).toHaveLength(12);
    expect(buildCadmaReferenceBoxplotOptionsMap([])['MW']['series']).toEqual([]);
    expect(buildCadmaSingleMetricBoxplotOptions([], 'MW', 'MW')['series']).toEqual([]);
    const options = buildCadmaSingleMetricBoxplotOptions([mockRow({ MW: 10 })], 'MW', 'MW');
    const formatter = (options['tooltip'] as { formatter: (p: unknown) => string })['formatter'];
    expect(formatter({ seriesType: 'boxplot', data: [10], name: 'MW' })).toContain('Mean');
    expect(formatter({ seriesType: 'scatter', data: { value: [0, 10], name: 'A', smiles: 'CC' } })).toContain('A');
    expect(formatter({ seriesType: 'line', data: [10], name: 'other' })).toBe('other');
  });

  it('builds metric scatter metadata and dynamic empty axes', () => {
    const options = buildCadmaMetricChartOptions({ metric: 'MW', label: 'MW', categories: ['A'], values: [1], reference_mean: 1, reference_low: 1, reference_high: 1, better_direction: 'higher' }, 'scatter', [mockRow()]);
    const series = (options['series'] as Array<Record<string, unknown>>)[0];
    expect(series['type']).toBe('scatter');
    expect((series['data'] as Array<Record<string, unknown>>)[0]['smiles']).toBe('CCO');
    const empty = buildCadmaScoreChartOptions({ categories: [], values: [], reference_line: Number.NaN });
    expect((empty['yAxis'] as { min: number; max: number })['max']).toBe(1);
  });

  it('uses fallback names and empty series for missing scatter ranking rows', () => {
    const score = buildCadmaScoreChartOptions(
      { categories: ['A', 'B'], values: [1, 2], reference_line: 0.5 },
      'scatter',
      [mockRow({ name: 'First' })],
    );
    const scoreData = ((score['series'] as Array<Record<string, unknown>>)[0]['data']) as Array<Record<string, unknown>>;
    expect(scoreData[1]).toEqual({ value: [1, 2], name: 'B', smiles: '', symbolSize: 10 });

    const metric = buildCadmaMetricChartOptions(
      { metric: 'MW', label: 'MW', categories: ['A'], values: [1], reference_mean: 1, reference_low: 0, reference_high: 2, better_direction: 'balanced' },
      'bar',
    );
    const metricSeries = (metric['series'] as Array<Record<string, unknown>>)[0];
    expect(metricSeries['type']).toBe('bar');
    expect(metricSeries['markArea']).toBeDefined();
  });

  it('returns tooltip fallbacks when boxplot indices or scatter values are absent', () => {
    const options = buildCadmaBoxplotOptions([], new Set(['ADME']), new Set(['MW']));
    const formatter = (options['tooltip'] as { formatter: (params: unknown) => string })['formatter'];
    expect(formatter({ seriesType: 'boxplot', dataIndex: 999, data: [] })).toBe('');
    expect(formatter({ seriesType: 'scatter', dataIndex: 0, data: { name: '', smiles: '', value: undefined } })).toContain('—');
    expect(formatter({ seriesType: 'line', dataIndex: 0, data: 1, name: undefined })).toBe('');

    const results = buildCadmaResultsBoxplotSingleChart([], new Set(['ADME']), new Set(['MW']));
    const resultsFormatter = (results['tooltip'] as { formatter: (params: unknown) => string })['formatter'];
    expect(resultsFormatter({ seriesType: 'boxplot', dataIndex: 999, data: [] })).toBe('');
    expect(resultsFormatter({ seriesType: 'line', dataIndex: 0, data: 1, name: undefined })).toBe('');
  });

  it('handles all-missing result metrics and metric tooltip fallbacks', () => {
    const missing = mockRow({ MW: undefined, logP: undefined, SA: undefined });
    const options = buildCadmaSingleMetricBoxplotOptions([missing], 'MW', 'MW');
    expect(options['series']).toEqual([]);
    const populated = buildCadmaSingleMetricBoxplotOptions([mockRow({ MW: 0, name: '', smiles: '' })], 'MW', 'MW');
    const formatter = (populated['tooltip'] as { formatter: (params: unknown) => string })['formatter'];
    expect(formatter({ seriesType: 'scatter', data: { value: [0, 0], name: '', smiles: '' } })).toContain('—');
    expect(formatter({ seriesType: 'line', data: [0], name: undefined })).toBe('');
  });
});
