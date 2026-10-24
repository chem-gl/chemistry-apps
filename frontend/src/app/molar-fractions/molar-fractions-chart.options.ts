// molar-fractions-chart.options.ts: Construye la configuracion de curvas y lecturas interpoladas para Molar Fractions.
// Se importa desde el componente para mantener la transformacion de datos separada de la UI.

import type { LineSeriesOption } from 'echarts/charts';
import type { EChartsCoreOption } from 'echarts/core';
import { MolarFractionsResultData } from '../core/application/molar-fractions-workflow.service';

const DEFAULT_PROBE_PH = 7.4;
// Muestreo de la curva analítica exacta: denso para un polígono indistinguible
// de la sigmoide continua (la forma ya es exacta, los puntos solo la dibujan).
const ANALYTIC_POINTS_PER_PH_UNIT = 32;

/**
 * Fracciones molares exactas para un ácido con los pKa dados.
 * α₀ = hⁿ/D (totalmente protonado) … αᵢ = (Πⱼ≤ᵢ Kⱼ)·hⁿ⁻ⁱ/D,
 * con h = 10⁻ᵖᴴ, Kⱼ = 10^(−pKaⱼ) y D la suma de los n+1 términos.
 * Es la misma fórmula analítica del backend: coincide con la tabla y es
 * infinitamente suave (sin codos de interpolación por tramos).
 */
function evaluateExactFractions(pKaValues: number[], phValue: number): number[] {
  const speciesCount = pKaValues.length + 1;
  if (speciesCount === 1) {
    return [1];
  }

  const h = Math.pow(10, -phValue);
  const terms: number[] = new Array(speciesCount);
  let term = Math.pow(h, pKaValues.length);
  terms[0] = term;
  for (let index = 0; index < pKaValues.length; index += 1) {
    term = (term * Math.pow(10, -pKaValues[index])) / h;
    terms[index + 1] = term;
  }

  const total = terms.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) {
    return terms.map(() => 0);
  }
  return terms.map((value) => sanitizeFraction(value / total));
}

function buildAnalyticSeriesData(
  pKaValues: number[],
  speciesIndex: number,
  phMin: number,
  phMax: number,
): Array<[number, number]> {
  const span = Math.max(phMax - phMin, 0);
  const pointCount = Math.max(Math.ceil(span * ANALYTIC_POINTS_PER_PH_UNIT) + 1, 2);
  const points: Array<[number, number]> = new Array(pointCount);
  for (let index = 0; index < pointCount; index += 1) {
    const phValue = pointCount === 1 ? phMin : phMin + (span * index) / (pointCount - 1);
    points[index] = [phValue, evaluateExactFractions(pKaValues, phValue)[speciesIndex] ?? 0];
  }
  return points;
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
  const fractions = evaluateExactFractions(resultData.metadata.pkaValues, probePh);

  return resultData.speciesLabels.map((speciesLabel, speciesIndex) => ({
    speciesLabel,
    fraction: fractions[speciesIndex] ?? 0,
  }));
}

export function buildMolarFractionsChartOptions(
  resultData: MolarFractionsResultData,
  probePh: number,
): EChartsCoreOption {
  const speciesSeries: LineSeriesOption[] = resultData.speciesLabels.map((speciesLabel, speciesIndex) => ({
    name: speciesLabel,
    type: 'line',
    data: buildAnalyticSeriesData(
      resultData.metadata.pkaValues,
      speciesIndex,
      resultData.metadata.phMin,
      resultData.metadata.phMax,
    ),
    smooth: 0.35,
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
    // Eje X oculto propio: la sonda no contamina el preview del dataZoom
    // (antes pintaba una barra vertical fantasma en el slider).
    xAxisIndex: 1,
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
      top: 76,
      right: 32,
      bottom: 92,
      left: 66,
      containLabel: true,
    },
    legend: {
      type: 'scroll',
      top: 12,
      left: 'center',
      right: 92,
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
    xAxis: [
      {
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
      },
      // Eje fantasma para la sonda: comparte escala, sin dibujo.
      {
        type: 'value',
        show: false,
        min: resultData.metadata.phMin,
        max: resultData.metadata.phMax,
      },
    ],
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
