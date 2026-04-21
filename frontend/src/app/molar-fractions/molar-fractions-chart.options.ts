// molar-fractions-chart.options.ts: Construye la configuracion de curvas y lecturas interpoladas para Molar Fractions.
// Se importa desde el componente para mantener la transformacion de datos separada de la UI.

import type { LineSeriesOption } from 'echarts/charts';
import type { EChartsCoreOption } from 'echarts/core';
import { MolarFractionsResultData } from '../core/application/molar-fractions-workflow.service';

const DEFAULT_PROBE_PH = 7.4;
const INTERPOLATION_SAMPLES_PER_PH_UNIT = 24;
const MIN_INTERPOLATION_SAMPLES_PER_SEGMENT = 24;
const MAX_INTERPOLATION_SAMPLES_PER_SEGMENT = 120;

interface CurveDefinition {
  readonly speciesLabel: string;
  readonly xValues: number[];
  readonly yValues: number[];
  readonly slopes: number[];
}

interface TooltipParameter {
  readonly axisValue?: number | string;
  readonly marker?: string;
  readonly seriesName?: string;
  readonly value?: unknown;
}

export interface ProbeSpeciesReading {
  readonly speciesLabel: string;
  readonly fraction: number;
}

const CHART_COLORS: readonly string[] = [
  '#d32f2f',
  '#7b5a9e',
  '#0277bd',
  '#2e7d32',
  '#ef6c00',
  '#6d4c41',
  '#00838f',
  '#c2185b',
];

function formatAxisValue(value: number): string {
  return value.toFixed(2);
}

function formatFractionValue(value: number): string {
  return value.toExponential(3).toUpperCase();
}

function clampValue(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function sanitizeFraction(value: number): number {
  return clampValue(value, 0, 1);
}

function buildCurveDefinitions(resultData: MolarFractionsResultData): CurveDefinition[] {
  const xValues: number[] = resultData.rows.map((row) => row.ph);

  return resultData.speciesLabels.map((speciesLabel, fractionIndex) => {
    const yValues: number[] = resultData.rows.map((row) => row.fractions[fractionIndex] ?? 0);

    return {
      speciesLabel,
      xValues,
      yValues,
      slopes: buildMonotoneSlopes(xValues, yValues),
    };
  });
}

function buildMonotoneSlopes(xValues: number[], yValues: number[]): number[] {
  const pointCount = xValues.length;
  if (pointCount <= 1) {
    return [0];
  }

  const deltaX: number[] = [];
  const secants: number[] = [];
  for (let index = 0; index < pointCount - 1; index += 1) {
    const currentDeltaX = xValues[index + 1] - xValues[index];
    deltaX.push(currentDeltaX);
    secants.push(currentDeltaX === 0 ? 0 : (yValues[index + 1] - yValues[index]) / currentDeltaX);
  }

  const slopes: number[] = new Array(pointCount).fill(0);
  slopes[0] = secants[0] ?? 0;
  slopes[pointCount - 1] = secants.at(-1) ?? 0;

  for (let index = 1; index < pointCount - 1; index += 1) {
    const previousSecant = secants[index - 1] ?? 0;
    const nextSecant = secants[index] ?? 0;

    if (previousSecant === 0 || nextSecant === 0 || previousSecant * nextSecant < 0) {
      slopes[index] = 0;
      continue;
    }

    const previousDeltaX = deltaX[index - 1] ?? 1;
    const nextDeltaX = deltaX[index] ?? 1;
    const weightA = 2 * nextDeltaX + previousDeltaX;
    const weightB = nextDeltaX + 2 * previousDeltaX;

    slopes[index] = (weightA + weightB) / (weightA / previousSecant + weightB / nextSecant);
  }

  return slopes;
}

function evaluateCurveAtPh(curve: CurveDefinition, phValue: number): number {
  const { xValues, yValues, slopes } = curve;
  if (xValues.length === 0) {
    return 0;
  }
  if (xValues.length === 1) {
    return sanitizeFraction(yValues[0] ?? 0);
  }

  const minPh = xValues[0] ?? phValue;
  const maxPh = xValues.at(-1) ?? phValue;
  const clampedPh = clampValue(phValue, minPh, maxPh);
  let segmentIndex = xValues.findIndex((currentValue, index) => {
    const nextValue = xValues[index + 1];
    return nextValue !== undefined && clampedPh >= currentValue && clampedPh <= nextValue;
  });

  if (segmentIndex === -1) {
    segmentIndex = xValues.length - 2;
  }

  const x0 = xValues[segmentIndex] ?? clampedPh;
  const x1 = xValues[segmentIndex + 1] ?? clampedPh;
  const y0 = yValues[segmentIndex] ?? 0;
  const y1 = yValues[segmentIndex + 1] ?? y0;
  const m0 = slopes[segmentIndex] ?? 0;
  const m1 = slopes[segmentIndex + 1] ?? 0;
  const segmentWidth = x1 - x0;
  if (segmentWidth === 0) {
    return sanitizeFraction(y0);
  }

  const t = (clampedPh - x0) / segmentWidth;
  const t2 = t * t;
  const t3 = t2 * t;
  const interpolatedValue =
    (2 * t3 - 3 * t2 + 1) * y0 +
    (t3 - 2 * t2 + t) * segmentWidth * m0 +
    (-2 * t3 + 3 * t2) * y1 +
    (t3 - t2) * segmentWidth * m1;

  return sanitizeFraction(interpolatedValue);
}

function resolveSegmentSampleCount(segmentStart: number, segmentEnd: number): number {
  const phSpan = Math.abs(segmentEnd - segmentStart);
  const requestedSamples = Math.ceil(phSpan * INTERPOLATION_SAMPLES_PER_PH_UNIT);

  return Math.round(
    clampValue(
      requestedSamples,
      MIN_INTERPOLATION_SAMPLES_PER_SEGMENT,
      MAX_INTERPOLATION_SAMPLES_PER_SEGMENT,
    ),
  );
}

function buildInterpolatedSeriesData(curve: CurveDefinition): Array<[number, number]> {
  const densePoints: Array<[number, number]> = [];
  const { xValues } = curve;

  for (let index = 0; index < xValues.length - 1; index += 1) {
    const segmentStart = xValues[index] ?? 0;
    const segmentEnd = xValues[index + 1] ?? segmentStart;
    const segmentSamples = Math.max(resolveSegmentSampleCount(segmentStart, segmentEnd), 2);

    for (let sampleIndex = 0; sampleIndex < segmentSamples; sampleIndex += 1) {
      const ratio = sampleIndex / segmentSamples;
      const interpolatedPh = segmentStart + (segmentEnd - segmentStart) * ratio;
      densePoints.push([interpolatedPh, evaluateCurveAtPh(curve, interpolatedPh)]);
    }
  }

  const lastPh = xValues.at(-1);
  if (lastPh !== undefined) {
    densePoints.push([lastPh, evaluateCurveAtPh(curve, lastPh)]);
  }

  return densePoints;
}

export function shouldRenderMolarFractionsChart(
  resultData: MolarFractionsResultData | null,
): boolean {
  return (
    resultData !== null &&
    resultData.metadata.phMode === 'range' &&
    resultData.rows.length > 5 &&
    resultData.speciesLabels.length > 0
  );
}

export function clampProbePh(resultData: MolarFractionsResultData | null, rawPh: number): number {
  if (resultData === null || !Number.isFinite(rawPh)) {
    return DEFAULT_PROBE_PH;
  }

  return clampValue(rawPh, resultData.metadata.phMin, resultData.metadata.phMax);
}

export function buildProbeReadings(
  resultData: MolarFractionsResultData,
  probePh: number,
): ProbeSpeciesReading[] {
  const curveDefinitions = buildCurveDefinitions(resultData);

  return curveDefinitions.map((curve) => ({
    speciesLabel: curve.speciesLabel,
    fraction: evaluateCurveAtPh(curve, probePh),
  }));
}

export function buildMolarFractionsChartOptions(
  resultData: MolarFractionsResultData,
  probePh: number,
): EChartsCoreOption {
  const curveDefinitions = buildCurveDefinitions(resultData);

  const speciesSeries: LineSeriesOption[] = curveDefinitions.map((curve) => ({
    name: curve.speciesLabel,
    type: 'line',
    data: buildInterpolatedSeriesData(curve),
    smooth: 0.28,
    smoothMonotone: 'x',
    showSymbol: false,
    lineStyle: {
      width: 2.6,
    },
    emphasis: {
      focus: 'series',
    },
  }));

  const probeSeries: LineSeriesOption = {
    name: '__probe__',
    type: 'line',
    data: [
      [probePh, 0],
      [probePh, 1],
    ],
    silent: true,
    showSymbol: false,
    symbol: 'none',
    animation: false,
    tooltip: {
      show: false,
    },
    lineStyle: {
      color: '#0277bd',
      width: 2.4,
      type: 'dashed',
      opacity: 0.95,
    },
    z: 50,
    zlevel: 1,
    markPoint: {
      symbol: 'circle',
      symbolSize: 1,
      silent: true,
      label: {
        show: true,
        formatter: `pH ${formatAxisValue(probePh)}`,
        color: '#0277bd',
        fontWeight: 700,
        backgroundColor: 'rgba(250, 248, 252, 0.92)',
        borderColor: 'rgba(2, 119, 189, 0.22)',
        borderWidth: 1,
        borderRadius: 10,
        padding: [4, 8],
      },
      itemStyle: {
        color: '#0277bd',
      },
      data: [{ name: 'probe-label', coord: [probePh, 1] }],
    },
  };

  const series: LineSeriesOption[] = [...speciesSeries, probeSeries];

  return {
    animation: resultData.rows.length <= 240,
    aria: {
      enabled: true,
    },
    color: [...CHART_COLORS],
    dataZoom: [
      {
        type: 'inside',
        xAxisIndex: 0,
        filterMode: 'none',
      },
      {
        type: 'slider',
        xAxisIndex: 0,
        filterMode: 'none',
        bottom: 16,
      },
    ],
    grid: {
      top: 86,
      right: 32,
      bottom: 92,
      left: 66,
      containLabel: true,
    },
    legend: {
      type: 'scroll',
      top: 12,
      left: 'center',
      itemGap: 14,
      itemWidth: 18,
      itemHeight: 10,
      textStyle: {
        color: '#5a5163',
        fontSize: 13,
        fontWeight: 700,
      },
      data: [...resultData.speciesLabels],
    },
    toolbox: {
      top: 10,
      right: 8,
      itemSize: 18,
      feature: {
        dataZoom: {
          yAxisIndex: 'none',
        },
        restore: {},
        saveAsImage: {
          name: 'molar-fractions-chart',
        },
      },
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'line',
      },
      formatter: (params: TooltipParameter | TooltipParameter[]) => {
        const parameterList = Array.isArray(params) ? params : [params];
        const axisValue =
          typeof parameterList[0]?.axisValue === 'number' ? parameterList[0].axisValue : probePh;

        const rows = parameterList
          .map((parameter) => {
            const seriesName =
              typeof parameter.seriesName === 'string' ? parameter.seriesName : '-';
            const seriesValue = Array.isArray(parameter.value)
              ? parameter.value[1]
              : parameter.value;
            const formattedValue =
              typeof seriesValue === 'number'
                ? formatFractionValue(seriesValue)
                : String(seriesValue);
            const marker = typeof parameter.marker === 'string' ? parameter.marker : '';

            return `${marker}${seriesName}: ${formattedValue}`;
          })
          .join('<br/>');

        return `pH ${formatAxisValue(axisValue)}<br/>${rows}`;
      },
    },
    xAxis: {
      type: 'value',
      name: 'pH',
      min: resultData.metadata.phMin,
      max: resultData.metadata.phMax,
      nameLocation: 'middle',
      nameGap: 42,
      nameTextStyle: {
        color: '#5a5163',
        fontSize: 14,
        fontWeight: 700,
        padding: [14, 0, 0, 0],
      },
      axisLabel: {
        formatter: (axisValue: number) => formatAxisValue(axisValue),
        color: '#5a5163',
        fontSize: 13,
        margin: 12,
      },
      axisPointer: {
        show: true,
        value: probePh,
        snap: false,
      },
    },
    yAxis: {
      type: 'value',
      name: 'Fraction',
      min: 0,
      max: 1,
      nameLocation: 'middle',
      nameGap: 56,
      nameTextStyle: {
        color: '#5a5163',
        fontSize: 14,
        fontWeight: 700,
        padding: [0, 0, 12, 0],
      },
      axisLabel: {
        formatter: (axisValue: number) => formatAxisValue(axisValue),
        color: '#5a5163',
        fontSize: 13,
        margin: 12,
      },
    },
    series,
  };
}

export { DEFAULT_PROBE_PH, formatFractionValue };
