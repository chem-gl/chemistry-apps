// cadma-py-chart.options.ts: Opciones de ECharts para CADMA Py.
// Genera gráficas de barras, líneas y dispersión con escalas dinámicas y
// referencias visuales alineadas con el CADMA.py original.

import type { BarSeriesOption, BoxplotSeriesOption, LineSeriesOption, ScatterSeriesOption } from 'echarts/charts';
import type { EChartsCoreOption } from 'echarts/core';
import { CadmaMetricChartView, CadmaRankingRowView, CadmaReferenceRowView, CadmaScoreChartView } from '../core/api/cadma-py-api.service';

export type ChartType = 'bar' | 'line' | 'scatter';

type SeriesBuilder<T> = (
  values: number[],
  color: string,
  markLines: BarSeriesOption['markLine'],
  markArea?: LineSeriesOption['markArea'],
) => T;

const SERIES_BUILDERS: Record<
  ChartType,
  SeriesBuilder<BarSeriesOption | LineSeriesOption | ScatterSeriesOption>
> = {
  bar: (values, color, markLines) => buildBarSeries(values, color, markLines),
  line: (values, color, markLines, markArea) => buildLineSeries(values, color, markLines, markArea),
  scatter: (values, color, markLines) => buildScatterSeries(values, color, markLines),
};

function buildCommonGrid(): NonNullable<EChartsCoreOption['grid']> {
  return {
    left: 60,
    right: 28,
    top: 52,
    bottom: 96,
    containLabel: true,
  };
}

function buildBarSeries(
  values: number[],
  color: string,
  markLines: BarSeriesOption['markLine'],
): BarSeriesOption {
  return {
    type: 'bar',
    data: values,
    itemStyle: { color, borderRadius: [8, 8, 0, 0] },
    markLine: markLines,
  };
}

function buildLineSeries(
  values: number[],
  color: string,
  markLines: LineSeriesOption['markLine'],
  markArea?: LineSeriesOption['markArea'],
): LineSeriesOption {
  return {
    type: 'line',
    data: values,
    smooth: false,
    symbol: 'circle',
    symbolSize: 8,
    lineStyle: { color, width: 2 },
    itemStyle: { color },
    markLine: markLines,
    markArea,
  };
}

function buildScatterSeries(
  values: number[],
  color: string,
  markLines: ScatterSeriesOption['markLine'],
): ScatterSeriesOption {
  return {
    type: 'scatter',
    data: values.map((value, index) => [index, value]),
    symbolSize: 10,
    itemStyle: { color },
    markLine: markLines,
  };
}

function buildDynamicValueAxis(values: number[], referenceLines: number[], axisName: string) {
  const numericValues = [...values, ...referenceLines].filter((value) => Number.isFinite(value));

  if (numericValues.length === 0) {
    return {
      type: 'value' as const,
      name: axisName,
      min: 0,
      max: 1,
    };
  }

  let minValue = Math.min(...numericValues);
  let maxValue = Math.max(...numericValues);

  if (minValue === maxValue) {
    const delta = Math.max(Math.abs(minValue) * 0.05, 0.1);
    minValue -= delta;
    maxValue += delta;
  } else {
    const padding = (maxValue - minValue) * 0.08;
    minValue -= padding;
    maxValue += padding;
  }

  return {
    type: 'value' as const,
    name: axisName,
    min: Number(minValue.toFixed(4)),
    max: Number(maxValue.toFixed(4)),
  };
}

function buildScatterSeriesExt(
  data: Array<{ value: [number, number]; name: string; smiles: string; symbolSize: number }>,
  color: string,
  markLines: ScatterSeriesOption['markLine'],
): ScatterSeriesOption {
  return {
    type: 'scatter',
    data,
    symbolSize: 10,
    itemStyle: { color },
    markLine: markLines,
  };
}

export function buildCadmaScoreChartOptions(
  scoreChart: CadmaScoreChartView,
  chartType: ChartType = 'bar',
  rankingRows?: CadmaRankingRowView[],
): EChartsCoreOption {
  const markLines = {
    data: [
      {
        yAxis: scoreChart.reference_line,
        name: 'Reference line',
        lineStyle: { type: 'dashed' as const, color: '#a61b29' },
      },
    ],
  };

  const enrichedValues = chartType === 'scatter' && rankingRows
    ? scoreChart.values.map((v, i) => {
        const row = rankingRows[i];
        return {
          value: [i, v],
          name: row?.name ?? scoreChart.categories[i],
          smiles: row?.smiles ?? '',
          symbolSize: 10,
        };
      })
    : scoreChart.values;

  const series = chartType === 'scatter'
    ? buildScatterSeriesExt(enrichedValues as Array<{ value: [number, number]; name: string; smiles: string; symbolSize: number }>, '#d32f2f', markLines)
    : SERIES_BUILDERS[chartType](scoreChart.values, '#d32f2f', markLines);

  const tooltip: EChartsCoreOption['tooltip'] = chartType === 'scatter'
    ? {
        trigger: 'item',
        formatter: (params: { name?: string; data?: { name?: string; smiles?: string; value?: [number, number] } }) => {
          const data = params.data;
          if (data && typeof data === 'object' && !Array.isArray(data)) {
            return [
              `<b>${data.name || params.name || '—'}</b>`,
              data.smiles ? `<span style="font-family:monospace;font-size:10px;color:#666">${data.smiles}</span>` : '',
              `<hr style="margin:3px 0">`,
              `Score: ${(data.value?.[1] ?? 0).toFixed(2)}`,
              `<em style="font-size:9px;color:#999">Click for 2D structure</em>`,
            ].filter(Boolean).join('<br>');
          }
          return params.name ?? '';
        },
      }
    : { trigger: 'axis' };

  return {
    animationDuration: 300,
    grid: buildCommonGrid(),
    tooltip,
    toolbox: { feature: { saveAsImage: {} } },
    dataZoom: [
      { type: 'inside', xAxisIndex: 0 },
      { type: 'slider', xAxisIndex: 0, height: 18, bottom: 20 },
      { type: 'inside', yAxisIndex: 0 },
    ],
    xAxis: {
      type: 'category',
      data: scoreChart.categories,
      axisLabel: { rotate: 18 },
    },
    yAxis: buildDynamicValueAxis(scoreChart.values, [scoreChart.reference_line], 'Score'),
    series: [series],
  };
}

interface BoxplotStat {
  key: string;
  label: string;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  group: string;
  mean: number;
  stdev: number;
  n: number;
}

const BOXPLOT_METRICS: Array<{ key: keyof CadmaReferenceRowView; label: string; group: string }> = [
  { key: 'MW', label: 'MW', group: 'ADME' },
  { key: 'logP', label: 'LogP', group: 'ADME' },
  { key: 'MR', label: 'MR', group: 'ADME' },
  { key: 'AtX', label: 'AtX', group: 'ADME' },
  { key: 'HBLA', label: 'HBLA', group: 'ADME' },
  { key: 'HBLD', label: 'HBLD', group: 'ADME' },
  { key: 'RB', label: 'RB', group: 'ADME' },
  { key: 'PSA', label: 'PSA', group: 'ADME' },
  { key: 'DT', label: 'DT (T.E.S.T.)', group: 'Toxicity' },
  { key: 'DT_admet', label: 'DT (ADMET-AI)', group: 'Toxicity' },
  { key: 'M', label: 'M (T.E.S.T.)', group: 'Toxicity' },
  { key: 'M_admet', label: 'M (ADMET-AI)', group: 'Toxicity' },
  { key: 'LD50', label: 'LD50 (T.E.S.T.)', group: 'Toxicity' },
  { key: 'LD50_admet', label: 'LD50 (ADMET-AI)', group: 'Toxicity' },
  { key: 'SA_rdkit', label: 'SA (RDKit)', group: 'SA Score' },
  { key: 'SA_brsa', label: 'SA (BRSA)', group: 'SA Score' },
  { key: 'SA_ambit', label: 'SA (AMBIT)', group: 'SA Score' },
];

function computeQuantile(sorted: number[], q: number): number {
  const index = q * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] * (upper - index) + sorted[upper] * (index - lower);
}

function computeBoxplotStats(rows: CadmaReferenceRowView[]): BoxplotStat[] {
  return BOXPLOT_METRICS.map(({ key, label, group }) => {
    const values = rows
      .map((r) => r[key] as number | null | undefined)
      .filter((v): v is number => v != null && !Number.isNaN(v))
      .sort((a, b) => a - b);

    const n = values.length;
    if (n === 0) {
      return { key, label, min: 0, q1: 0, median: 0, q3: 0, max: 0, group, mean: 0, stdev: 0, n: 0 };
    }

    const mean = values.reduce((a, b) => a + b, 0) / n;
    const stdev = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n);

    return {
      key,
      label,
      min: values[0],
      q1: computeQuantile(values, 0.25),
      median: computeQuantile(values, 0.5),
      q3: computeQuantile(values, 0.75),
      max: values[n - 1],
      group,
      mean,
      stdev,
      n,
    };
  });
}

export function buildCadmaBoxplotOptions(
  rows: CadmaReferenceRowView[],
  visibleGroups?: Set<string>,
  hiddenKeys?: Set<string>,
): EChartsCoreOption {
  const allStats = computeBoxplotStats(rows);
  const stats = allStats.filter((s) => {
    if (visibleGroups && !visibleGroups.has(s.group)) return false;
    if (hiddenKeys && hiddenKeys.has(s.key)) return false;
    return true;
  });

  const categories = stats.map((s) => s.label);
  const boxplotData = stats.map((s) => [s.min, s.q1, s.median, s.q3, s.max]);

  const visibleMetrics = BOXPLOT_METRICS.filter((m) => {
    if (visibleGroups && !visibleGroups.has(m.group)) return false;
    if (hiddenKeys && hiddenKeys.has(String(m.key))) return false;
    return true;
  });

  const { scatterData, outlierData } = buildScatterPoints(
    rows,
    visibleMetrics.map((m) => ({ key: String(m.key), label: m.label })),
    (r) => r.name,
    (r) => r.smiles,
    (r, key) => r[key as keyof CadmaReferenceRowView],
  );

  return {
    animationDuration: 300,
    grid: { left: 70, right: 28, top: 44, bottom: 100, containLabel: true },
    legend: {
      data: ['Distribution', 'Values (within IQR)', 'Outliers (±1.5×IQR)'],
      top: 4,
      textStyle: { fontSize: 12 },
      itemWidth: 14,
      itemHeight: 10,
      itemGap: 14,
    },
    tooltip: {
      trigger: 'item',
      formatter: (params: { seriesType?: string; name?: string; data: unknown; dataIndex: number }) => {
        if (params.seriesType === 'boxplot') {
          const s = stats[params.dataIndex];
          if (!s) return params.name ?? '';
          return [
            `<b>${s.label}</b>`,
            `Min: ${s.min.toFixed(2)}`,
            `Q1: ${s.q1.toFixed(2)}`,
            `Median: ${s.median.toFixed(2)}`,
            `Q3: ${s.q3.toFixed(2)}`,
            `Max: ${s.max.toFixed(2)}`,
            `<hr style="margin:4px 0;border-color:#e5e7eb">`,
            `Mean: ${s.mean.toFixed(2)}`,
            `StDev: ${s.stdev.toFixed(2)}`,
            `n: ${s.n}`,
          ].join('<br>');
        }
        if (params.seriesType === 'scatter' && typeof params.data === 'object' && params.data !== null) {
          const d = params.data as { name?: string; smiles?: string; value?: [number, number] };
          return [
            `<b>${d.name || '—'}</b>`,
            d.smiles ? `<span style="font-family:monospace;font-size:10px;color:#666">${d.smiles}</span>` : '',
            d.value ? `<hr style="margin:3px 0">${(d.value[1]).toFixed(2)}` : '',
            `<em style="font-size:9px;color:#999">Click for details</em>`,
          ].filter(Boolean).join('<br>');
        }
        return params.name ?? '';
      },
    },
    toolbox: { feature: { saveAsImage: {} } },
    xAxis: { type: 'category', data: categories, axisLabel: { rotate: 45, interval: 0 } },
    yAxis: { type: 'value', name: 'Value' },
    series: [
      {
        name: 'Distribution',
        type: 'boxplot',
        data: boxplotData,
        itemStyle: { color: '#3b82f6', borderColor: '#1d4ed8' },
      } as BoxplotSeriesOption,
      {
        name: 'Values (within IQR)',
        type: 'scatter',
        data: scatterData,
        symbol: 'circle',
        symbolSize: 5,
        itemStyle: { color: '#64748b', opacity: 0.55 },
      } as ScatterSeriesOption,
      {
        name: 'Outliers (±1.5×IQR)',
        type: 'scatter',
        data: outlierData,
        symbol: 'circle',
        symbolSize: 7,
        itemStyle: { color: '#ef4444', opacity: 0.8, borderColor: '#dc2626', borderWidth: 1 },
      } as ScatterSeriesOption,
    ],
  };
}

interface ScatterPoint {
  value: [number, number];
  name: string;
  smiles: string;
}

function buildScatterPoints<T>(
  rows: T[],
  metrics: Array<{ key: string; label: string }>,
  getName: (row: T) => string,
  getSmiles: (row: T) => string,
  getValue: (row: T, key: string) => unknown,
): { scatterData: ScatterPoint[]; outlierData: ScatterPoint[] } {
  const scatterData: ScatterPoint[] = [];
  const outlierData: ScatterPoint[] = [];

  metrics.forEach((metric, catIndex) => {
    const values = rows
      .map((r) => {
        const raw = getValue(r, metric.key);
        const num = typeof raw === 'number' ? raw : undefined;
        return { name: getName(r), smiles: getSmiles(r), value: num };
      })
      .filter((v) => v.value != null && !Number.isNaN(v.value))
      .sort((a, b) => a.value! - b.value!);

    if (values.length === 0) return;

    const sorted = values.map((v) => v.value!);
    const q1 = computeQuantile(sorted, 0.25);
    const q3 = computeQuantile(sorted, 0.75);
    const iqr = q3 - q1;
    const lowerFence = q1 - 1.5 * iqr;
    const upperFence = q3 + 1.5 * iqr;

    const jitterRange = Math.min(0.3, 0.7 / Math.max(values.length, 1));

    values.forEach((v) => {
      const jitter = (Math.random() - 0.5) * 2 * jitterRange;
      const isOutlier = v.value! < lowerFence || v.value! > upperFence;
      const point: ScatterPoint = {
        value: [catIndex + (isOutlier ? 0 : jitter), v.value!],
        name: v.name,
        smiles: v.smiles,
      };
      if (isOutlier) {
        outlierData.push(point);
      } else {
        scatterData.push(point);
      }
    });
  });

  return { scatterData, outlierData };
}

const REFERENCE_MINI_METRICS: Array<{ key: keyof CadmaReferenceRowView; label: string; group: string }> = [
  { key: 'MW', label: 'MW', group: 'ADME' },
  { key: 'logP', label: 'LogP', group: 'ADME' },
  { key: 'MR', label: 'MR', group: 'ADME' },
  { key: 'AtX', label: 'AtX', group: 'ADME' },
  { key: 'HBLA', label: 'HBLA', group: 'ADME' },
  { key: 'HBLD', label: 'HBLD', group: 'ADME' },
  { key: 'RB', label: 'RB', group: 'ADME' },
  { key: 'PSA', label: 'PSA', group: 'ADME' },
  { key: 'DT', label: 'DT (T.E.S.T.)', group: 'Toxicity' },
  { key: 'DT_admet', label: 'DT (ADMET-AI)', group: 'Toxicity' },
  { key: 'M', label: 'M (T.E.S.T.)', group: 'Toxicity' },
  { key: 'M_admet', label: 'M (ADMET-AI)', group: 'Toxicity' },
  { key: 'LD50', label: 'LD50 (T.E.S.T.)', group: 'Toxicity' },
  { key: 'LD50_admet', label: 'LD50 (ADMET-AI)', group: 'Toxicity' },
  { key: 'SA_rdkit', label: 'SA (RDKit)', group: 'SA Score' },
  { key: 'SA_brsa', label: 'SA (BRSA)', group: 'SA Score' },
  { key: 'SA_ambit', label: 'SA (AMBIT)', group: 'SA Score' },
];

interface RefMiniChartData {
  key: string;
  label: string;
  group: string;
}

export function buildCadmaReferenceMiniBoxplotOptions(
  rows: CadmaReferenceRowView[],
  metricKey: keyof CadmaReferenceRowView,
  metricLabel: string,
): EChartsCoreOption {
  const values = rows
    .map((r) => r[metricKey] as number | null | undefined)
    .filter((v): v is number => v != null && !Number.isNaN(v))
    .sort((a, b) => a - b);

  const n = values.length;
  if (n === 0) {
    return {
      title: { text: metricLabel, left: 'center', textStyle: { fontSize: 11, fontWeight: 600 } },
      series: [],
    };
  }

  const minVal = values[0];
  const q1 = computeQuantile(values, 0.25);
  const median = computeQuantile(values, 0.5);
  const q3 = computeQuantile(values, 0.75);
  const maxVal = values[n - 1];
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const stdev = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n);

  const allRefs = [minVal, q1, median, q3, maxVal, mean];
  const pad = (Math.max(...allRefs) - Math.min(...allRefs)) * 0.12 || Math.abs(mean) * 0.05 || 1;

  return {
    animationDuration: 200,
    grid: { left: 8, right: 8, top: 28, bottom: 14, containLabel: true },
    title: {
      text: metricLabel,
      left: 'center',
      top: 0,
      textStyle: { fontSize: 11, fontWeight: 600, color: '#1d4ed8' },
    },
    tooltip: {
      trigger: 'item',
      formatter: () => {
        return [
          `<b>${metricLabel}</b>`,
          `Min: ${minVal.toFixed(2)}`,
          `Q1: ${q1.toFixed(2)}`,
          `Median: ${median.toFixed(2)}`,
          `Q3: ${q3.toFixed(2)}`,
          `Max: ${maxVal.toFixed(2)}`,
          `<hr style="margin:4px 0;border-color:#e5e7eb">`,
          `Mean: ${mean.toFixed(2)}`,
          `StDev: ${stdev.toFixed(2)}`,
          `n: ${n}`,
        ].join('<br>');
      },
    },
    toolbox: { feature: { saveAsImage: { title: metricLabel } } },
    xAxis: {
      type: 'value',
      min: -0.7,
      max: 0.7,
      show: false,
    },
    yAxis: {
      type: 'value',
      min: Number((Math.min(...allRefs) - pad).toFixed(4)),
      max: Number((Math.max(...allRefs) + pad).toFixed(4)),
      axisLabel: { fontSize: 9 },
      splitLine: { show: false },
    },
    series: [
      {
        type: 'boxplot',
        data: [[minVal, q1, median, q3, maxVal]],
        itemStyle: { color: '#3b82f6', borderColor: '#1d4ed8' },
      } as BoxplotSeriesOption,
    ],
  };
}

export function buildCadmaReferenceBoxplotOptionsMap(
  rows: CadmaReferenceRowView[],
): Record<string, EChartsCoreOption> {
  const optionsMap: Record<string, EChartsCoreOption> = {};
  for (const { key, label } of REFERENCE_MINI_METRICS) {
    optionsMap[key] = buildCadmaReferenceMiniBoxplotOptions(rows, key, label);
  }
  return optionsMap;
}

export function getAllReferenceBoxplotMetrics(): RefMiniChartData[] {
  return REFERENCE_MINI_METRICS.map(({ key, label, group }) => ({ key, label, group }));
}

const RESULTS_BOXPLOT_METRICS: Array<{ key: keyof CadmaRankingRowView; label: string; group: string }> = [
  { key: 'MW', label: 'MW', group: 'ADME' },
  { key: 'logP', label: 'LogP', group: 'ADME' },
  { key: 'MR', label: 'MR', group: 'ADME' },
  { key: 'AtX', label: 'AtX', group: 'ADME' },
  { key: 'HBLA', label: 'HBLA', group: 'ADME' },
  { key: 'HBLD', label: 'HBLD', group: 'ADME' },
  { key: 'RB', label: 'RB', group: 'ADME' },
  { key: 'PSA', label: 'PSA', group: 'ADME' },
  { key: 'DT', label: 'DT', group: 'Toxicity' },
  { key: 'M', label: 'M', group: 'Toxicity' },
  { key: 'LD50', label: 'LD50', group: 'Toxicity' },
  { key: 'SA', label: 'SA', group: 'SA Score' },
];

interface RankedPoint {
  value: [number, number];
  name: string;
  smiles: string;
  symbolSize: number;
  itemStyle: { color: string };
}

export function buildCadmaSingleMetricBoxplotOptions(
  rows: CadmaRankingRowView[],
  metricKey: string,
  metricLabel: string,
): EChartsCoreOption {
  const values = rows
    .map((r, i) => {
      const raw = r[metricKey as keyof CadmaRankingRowView];
      const val = typeof raw === 'number' ? raw : undefined;
      return val !== undefined && !Number.isNaN(val)
        ? { index: i, value: val, name: r.name, smiles: r.smiles }
        : null;
    })
    .filter((v): v is { index: number; value: number; name: string; smiles: string } => v !== null);

  const numericValues = values.map((v) => v.value).sort((a, b) => a - b);

  if (numericValues.length === 0) {
    return {
      title: { text: metricLabel, left: 'center', textStyle: { fontSize: 11, fontWeight: 600 } },
      series: [],
    };
  }

  const minVal = numericValues[0];
  const q1 = computeQuantile(numericValues, 0.25);
  const median = computeQuantile(numericValues, 0.5);
  const q3 = computeQuantile(numericValues, 0.75);
  const maxVal = numericValues[numericValues.length - 1];
  const mean = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;
  const stdev = Math.sqrt(
    numericValues.reduce((a, b) => a + (b - mean) ** 2, 0) / numericValues.length,
  );

  const jitterRange = Math.min(0.25, 0.8 / Math.max(values.length, 1));
  const jitter = () => (Math.random() - 0.5) * 2 * jitterRange;

  const scatterData: RankedPoint[] = values.map((v) => ({
    value: [jitter(), v.value],
    name: v.name,
    smiles: v.smiles,
    symbolSize: 7,
    itemStyle: { color: '#ef4444' },
  }));

  const allRefs = [minVal, q1, median, q3, maxVal, mean];
  const pad = (Math.max(...allRefs) - Math.min(...allRefs)) * 0.12 || Math.abs(mean) * 0.05 || 1;

  return {
    animationDuration: 200,
    grid: { left: 12, right: 12, top: 28, bottom: 16, containLabel: true },
    title: {
      text: metricLabel,
      left: 'center',
      top: 0,
      textStyle: { fontSize: 11, fontWeight: 600, color: '#1d4ed8' },
    },
    tooltip: {
      trigger: 'item',
      formatter: (params: { seriesType?: string; name?: string; data: { value: [number, number]; name?: string; smiles?: string } | number[] }) => {
        if (params.seriesType === 'boxplot' && Array.isArray(params.data)) {
          return [
            `<b>${metricLabel}</b>`,
            `Min: ${minVal.toFixed(2)}`,
            `Q1: ${q1.toFixed(2)}`,
            `Median: ${median.toFixed(2)}`,
            `Q3: ${q3.toFixed(2)}`,
            `Max: ${maxVal.toFixed(2)}`,
            `<hr style="margin:4px 0">`,
            `Mean: ${mean.toFixed(2)}`,
            `StDev: ${stdev.toFixed(2)}`,
            `n: ${numericValues.length}`,
          ].join('<br>');
        }

        if (params.seriesType === 'scatter' && !Array.isArray(params.data)) {
          const scatterDatum = params.data as RankedPoint;
          return [
            `<b>${scatterDatum.name || '—'}</b>`,
            `<span style="font-family:monospace;font-size:10px">${scatterDatum.smiles || '—'}</span>`,
            `<hr style="margin:4px 0">`,
            `${metricLabel}: ${scatterDatum.value[1].toFixed(2)}`,
            `<em style="font-size:10px;color:#999">Click for 2D structure</em>`,
          ].join('<br>');
        }

        return params.name ?? '';
      },
    },
    toolbox: { feature: { saveAsImage: { title: metricLabel } } },
    xAxis: {
      type: 'value',
      min: -0.7,
      max: 0.7,
      show: false,
    },
    yAxis: {
      type: 'value',
      name: metricLabel,
      min: Number((Math.min(...allRefs) - pad).toFixed(4)),
      max: Number((Math.max(...allRefs) + pad).toFixed(4)),
      nameTextStyle: { fontSize: 9, color: '#64748b' },
      axisLabel: { fontSize: 9 },
    },
    series: [
      {
        type: 'boxplot',
        data: [[minVal, q1, median, q3, maxVal]],
        itemStyle: { color: '#3b82f6', borderColor: '#1d4ed8' },
      } as BoxplotSeriesOption,
      {
        type: 'scatter',
        data: scatterData,
        symbol: 'circle',
      } as ScatterSeriesOption,
    ],
  };
}

export function buildCadmaResultsBoxplotSingleChart(
  rows: CadmaRankingRowView[],
  visibleGroups?: Set<string>,
  hiddenKeys?: Set<string>,
): EChartsCoreOption {
  const allStats = RESULTS_BOXPLOT_METRICS.map(({ key, label, group }) => {
    const values = rows
      .map((r) => {
        const raw = r[key as keyof CadmaRankingRowView];
        return typeof raw === 'number' ? raw : undefined;
      })
      .filter((v): v is number => v !== undefined && !Number.isNaN(v))
      .sort((a, b) => a - b);

    const n = values.length;
    if (n === 0) {
      return { key, label, group, min: 0, q1: 0, median: 0, q3: 0, max: 0, mean: 0, stdev: 0, n: 0 };
    }

    const mean = values.reduce((a, b) => a + b, 0) / n;
    const stdev = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n);

    return {
      key,
      label,
      group,
      min: values[0],
      q1: computeQuantile(values, 0.25),
      median: computeQuantile(values, 0.5),
      q3: computeQuantile(values, 0.75),
      max: values[n - 1],
      mean,
      stdev,
      n,
    };
  });

  const stats = allStats.filter((s) => {
    if (visibleGroups && !visibleGroups.has(s.group)) return false;
    if (hiddenKeys && hiddenKeys.has(s.key)) return false;
    return true;
  });

  const categories = stats.map((s) => s.label);
  const boxplotData = stats.map((s) => [s.min, s.q1, s.median, s.q3, s.max]);

  const visibleMetrics = RESULTS_BOXPLOT_METRICS.filter((m) => {
    if (visibleGroups && !visibleGroups.has(m.group)) return false;
    if (hiddenKeys && hiddenKeys.has(String(m.key))) return false;
    return true;
  });

  const { scatterData, outlierData } = buildScatterPoints(
    rows,
    visibleMetrics.map((m) => ({ key: String(m.key), label: m.label })),
    (r) => r.name,
    (r) => r.smiles,
    (r, key) => r[key as keyof CadmaRankingRowView],
  );

  return {
    animationDuration: 300,
    grid: { left: 70, right: 28, top: 44, bottom: 100, containLabel: true },
    legend: {
      data: ['Distribution', 'Values (within IQR)', 'Outliers (±1.5×IQR)'],
      top: 4,
      textStyle: { fontSize: 12 },
      itemWidth: 14,
      itemHeight: 10,
      itemGap: 14,
    },
    tooltip: {
      trigger: 'item',
      formatter: (params: { seriesType?: string; name?: string; data: unknown; dataIndex: number }) => {
        if (params.seriesType === 'boxplot') {
          const s = stats[params.dataIndex];
          if (!s) return params.name ?? '';
          return [
            `<b>${s.label}</b>`,
            `Min: ${s.min.toFixed(2)}`,
            `Q1: ${s.q1.toFixed(2)}`,
            `Median: ${s.median.toFixed(2)}`,
            `Q3: ${s.q3.toFixed(2)}`,
            `Max: ${s.max.toFixed(2)}`,
            `<hr style="margin:4px 0;border-color:#e5e7eb">`,
            `Mean: ${s.mean.toFixed(2)}`,
            `StDev: ${s.stdev.toFixed(2)}`,
            `n: ${s.n}`,
          ].join('<br>');
        }
        if (params.seriesType === 'scatter' && typeof params.data === 'object' && params.data !== null) {
          const d = params.data as { name?: string; smiles?: string; value?: [number, number] };
          return [
            `<b>${d.name || '—'}</b>`,
            d.smiles ? `<span style="font-family:monospace;font-size:10px;color:#666">${d.smiles}</span>` : '',
            d.value ? `<hr style="margin:3px 0">${(d.value[1]).toFixed(2)}` : '',
            `<em style="font-size:9px;color:#999">Click for 2D structure</em>`,
          ].filter(Boolean).join('<br>');
        }
        return params.name ?? '';
      },
    },
    toolbox: { feature: { saveAsImage: {} } },
    xAxis: { type: 'category', data: categories, axisLabel: { rotate: 45, interval: 0 } },
    yAxis: { type: 'value', name: 'Value' },
    series: [
      {
        name: 'Distribution',
        type: 'boxplot',
        data: boxplotData,
        itemStyle: { color: '#3b82f6', borderColor: '#1d4ed8' },
      } as BoxplotSeriesOption,
      {
        name: 'Values (within IQR)',
        type: 'scatter',
        data: scatterData,
        symbol: 'circle',
        symbolSize: 5,
        itemStyle: { color: '#64748b', opacity: 0.55 },
      } as ScatterSeriesOption,
      {
        name: 'Outliers (±1.5×IQR)',
        type: 'scatter',
        data: outlierData,
        symbol: 'circle',
        symbolSize: 7,
        itemStyle: { color: '#ef4444', opacity: 0.8, borderColor: '#dc2626', borderWidth: 1 },
      } as ScatterSeriesOption,
    ],
  };
}

export function buildCadmaResultsBoxplotOptionsMap(
  rows: CadmaRankingRowView[],
): Record<string, EChartsCoreOption> {
  const optionsMap: Record<string, EChartsCoreOption> = {};
  for (const { key, label } of RESULTS_BOXPLOT_METRICS) {
    optionsMap[key] = buildCadmaSingleMetricBoxplotOptions(rows, key, label);
  }
  return optionsMap;
}

export interface BoxplotMetricDef {
  key: string;
  label: string;
  group: string;
}

export function getReferenceBoxplotMetricDefs(): BoxplotMetricDef[] {
  return BOXPLOT_METRICS.map((m) => ({ key: String(m.key), label: m.label, group: m.group }));
}

export function getResultsBoxplotMetricDefs(): BoxplotMetricDef[] {
  return RESULTS_BOXPLOT_METRICS.map((m) => ({ key: String(m.key), label: m.label, group: m.group }));
}

export function buildCadmaMetricChartOptions(
  metricChart: CadmaMetricChartView,
  chartType: ChartType = 'bar',
  rankingRows?: CadmaRankingRowView[],
): EChartsCoreOption {
  const markLines = {
    data: [
      {
        yAxis: metricChart.reference_mean,
        name: 'Mean',
        lineStyle: { type: 'solid' as const, color: '#8b5cf6' },
      },
      {
        yAxis: metricChart.reference_low,
        name: 'Low band',
        lineStyle: { type: 'dashed' as const, color: '#64748b' },
      },
      {
        yAxis: metricChart.reference_high,
        name: 'High band',
        lineStyle: { type: 'dashed' as const, color: '#64748b' },
      },
    ],
  };

  const markArea: NonNullable<LineSeriesOption['markArea']> = {
    itemStyle: {
      color: 'rgba(100, 116, 139, 0.12)',
    },
    data: [[{ yAxis: metricChart.reference_low }, { yAxis: metricChart.reference_high }]],
  };

  const enrichedValues = chartType === 'scatter' && rankingRows
    ? metricChart.values.map((v, i) => {
        const row = rankingRows[i];
        return {
          value: [i, v],
          name: row?.name ?? metricChart.categories[i],
          smiles: row?.smiles ?? '',
          symbolSize: 10,
        };
      })
    : metricChart.values;

  const baseSeries = chartType === 'scatter'
    ? buildScatterSeriesExt(enrichedValues as Array<{ value: [number, number]; name: string; smiles: string; symbolSize: number }>, '#2f5fb8', markLines)
    : SERIES_BUILDERS[chartType](metricChart.values, '#2f5fb8', markLines, markArea);

  const series = chartType === 'bar' ? { ...baseSeries, markArea } : baseSeries;

  const tooltip: EChartsCoreOption['tooltip'] = chartType === 'scatter'
    ? {
        trigger: 'item',
        formatter: (params: { name?: string; data?: { name?: string; smiles?: string; value?: [number, number] } }) => {
          const data = params.data;
          if (data && typeof data === 'object' && !Array.isArray(data)) {
            return [
              `<b>${data.name || params.name || '—'}</b>`,
              data.smiles ? `<span style="font-family:monospace;font-size:10px;color:#666">${data.smiles}</span>` : '',
              `<hr style="margin:3px 0">`,
              `${metricChart.metric}: ${(data.value?.[1] ?? 0).toFixed(2)}`,
              `<em style="font-size:9px;color:#999">Click for 2D structure</em>`,
            ].filter(Boolean).join('<br>');
          }
          return params.name ?? '';
        },
      }
    : { trigger: 'axis' };

  return {
    animationDuration: 300,
    grid: buildCommonGrid(),
    tooltip,
    toolbox: { feature: { saveAsImage: {} } },
    dataZoom: [
      { type: 'inside', xAxisIndex: 0 },
      { type: 'slider', xAxisIndex: 0, height: 18, bottom: 20 },
      { type: 'inside', yAxisIndex: 0 },
    ],
    xAxis: {
      type: 'category',
      data: metricChart.categories,
      axisLabel: { rotate: 18 },
    },
    yAxis: buildDynamicValueAxis(
      metricChart.values,
      [metricChart.reference_mean, metricChart.reference_low, metricChart.reference_high],
      metricChart.metric,
    ),
    series: [series],
  };
}
