// cadma-py-chart.options.ts: Opciones de ECharts para CADMA Py.
// Genera gráficas de barras, líneas y dispersión con escalas dinámicas y
// referencias visuales alineadas con el CADMA.py original.

import type { BarSeriesOption, LineSeriesOption, ScatterSeriesOption } from 'echarts/charts';
import type { EChartsCoreOption } from 'echarts/core';
import { CadmaMetricChartView, CadmaScoreChartView } from '../core/api/cadma-py-api.service';

export type ChartType = 'bar' | 'line' | 'scatter';

function buildCommonGrid(): NonNullable<EChartsCoreOption['grid']> {
  return {
    left: 56,
    right: 24,
    top: 44,
    bottom: 72,
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

export function buildCadmaScoreChartOptions(
  scoreChart: CadmaScoreChartView,
  chartType: ChartType = 'bar',
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

  const series =
    chartType === 'scatter'
      ? buildScatterSeries(scoreChart.values, '#1f7a4c', markLines)
      : chartType === 'line'
        ? buildLineSeries(scoreChart.values, '#1f7a4c', markLines)
        : buildBarSeries(scoreChart.values, '#1f7a4c', markLines);

  return {
    animationDuration: 300,
    grid: buildCommonGrid(),
    tooltip: { trigger: chartType === 'scatter' ? 'item' : 'axis' },
    toolbox: { feature: { saveAsImage: {} } },
    xAxis: {
      type: 'category',
      data: scoreChart.categories,
      axisLabel: { rotate: 18 },
    },
    yAxis: buildDynamicValueAxis(scoreChart.values, [scoreChart.reference_line], 'Score'),
    series: [series],
  };
}

export function buildCadmaMetricChartOptions(
  metricChart: CadmaMetricChartView,
  chartType: ChartType = 'bar',
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

  const series =
    chartType === 'scatter'
      ? buildScatterSeries(metricChart.values, '#2f5fb8', markLines)
      : chartType === 'line'
        ? buildLineSeries(metricChart.values, '#2f5fb8', markLines, markArea)
        : {
            ...buildBarSeries(metricChart.values, '#2f5fb8', markLines),
            markArea,
          };

  return {
    animationDuration: 300,
    grid: buildCommonGrid(),
    tooltip: { trigger: chartType === 'scatter' ? 'item' : 'axis' },
    toolbox: { feature: { saveAsImage: {} } },
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
