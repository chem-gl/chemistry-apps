// cadma-py-chart.options.spec.ts: Regresiones para las gráficas de CADMA Py.

import { describe, expect, it } from 'vitest';
import {
  buildCadmaMetricChartOptions,
  buildCadmaResultsBoxplotOptionsMap,
  buildCadmaScoreChartOptions,
} from './cadma-py-chart.options';
import { CadmaRankingRowView } from '../core/api/cadma-py-api.service';

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
});
