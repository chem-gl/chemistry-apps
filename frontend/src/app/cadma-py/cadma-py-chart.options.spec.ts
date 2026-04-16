// cadma-py-chart.options.spec.ts: Regresiones para las gráficas de CADMA Py.

import { describe, expect, it } from 'vitest';
import {
  buildCadmaMetricChartOptions,
  buildCadmaScoreChartOptions,
} from './cadma-py-chart.options';

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
});
