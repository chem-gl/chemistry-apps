// tunneling-chart-math.ts: Cálculo puro del diagrama científico de túnel de Eckart.
// Reproduce la transmisión del backend (backend/libs/ck_test/calculators.py::_gauss_quadrature_integration)
// y dibuja el potencial asimétrico V(x) junto a una función de onda coherente con P(E).
// Sin DOM ni Angular: todas las funciones se pueden probar de forma aislada.

import type { LineSeriesOption } from 'echarts/charts';
import type { EChartsCoreOption } from 'echarts/core';

const PI = Math.PI;

/** Longitud característica L del potencial de Eckart (coordenada de reacción adimensional). */
const CHARACTERISTIC_LENGTH = 1;
/** Puntos de muestreo del perfil de potencial (~400 como pide la especificación). */
const POTENTIAL_SAMPLE_COUNT = 400;
/** Extensión del perfil de potencial en múltiplos de L (±2.5L). */
const PROFILE_EXTENT_IN_LENGTHS = 2.5;
/** Semi-anchura de la barrera estilizada en la función de onda, en múltiplos de L. */
const BARRIER_HALF_WIDTH_IN_LENGTHS = 0.5;
// Número de onda estilizado: con 4π/L y bordes en ±0.5L la onda llega a un máximo de
// interferencia justo en x = ±0.5L, así los tres tramos empalman sin saltos visibles.
const WAVE_NUMBER = 4 * PI;
/** Muestreo por tramo de la función de onda (izquierda, barrera, derecha). */
const LEFT_SEGMENT_SAMPLE_COUNT = 200;
const BARRIER_SEGMENT_SAMPLE_COUNT = 40;
const RIGHT_SEGMENT_SAMPLE_COUNT = 160;
/** Constante de los gases ideales en kcal/(mol·K). */
const GAS_CONSTANT_KCAL_PER_MOL_K = 0.00198720425864083;
/** Probabilidad mínima como denominador del decaimiento (evita log(0)). */
const MIN_TRANSMISSION_FOR_DECAY = 1e-12;
/** Iteraciones de bisección para resolver la amplitud del término sech². */
const AMPLITUDE_SOLVE_ITERATIONS = 80;

/** Punto de una serie ECharts: [coordenada de reacción, valor]. */
export type ChartPoint = [number, number];

/** Entradas del diagrama de túnel, tomadas del resultado del job. */
export interface TunnelingParameters {
  readonly barrierKcalMol: number;
  readonly reactionEnergyKcalMol: number;
  readonly u: number | null;
  readonly alpha1: number | null;
  readonly alpha2: number | null;
  readonly temperatureK: number | null;
}

/** Parámetros ya validados: los usados para dibujar (u, α₁ y α₂ son números). */
export interface ValidTunnelingParameters {
  readonly barrierKcalMol: number;
  readonly reactionEnergyKcalMol: number;
  readonly u: number;
  readonly alpha1: number;
  readonly alpha2: number;
  readonly temperatureK: number | null;
}

/** Series listas para dibujar, más los escalares anotados en el gráfico. */
export interface TunnelingProfileSeries {
  readonly potential: ChartPoint[];
  readonly probabilityDensity: ChartPoint[];
  readonly thermalEnergyKcalMol: number;
  readonly transmissionProbability: number;
  readonly barrierPeak: ChartPoint;
  readonly xMin: number;
  readonly xMax: number;
}

function isFinitePositive(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

/**
 * Normaliza las entradas del resultado: null si falta algún parámetro, si no es finito
 * o si la barrera/α/u no son estrictamente positivos (no hay diagrama que dibujar).
 */
export function toValidTunnelingParameters(
  parameters: TunnelingParameters,
): ValidTunnelingParameters | null {
  if (
    !Number.isFinite(parameters.barrierKcalMol) ||
    parameters.barrierKcalMol <= 0 ||
    !Number.isFinite(parameters.reactionEnergyKcalMol) ||
    !isFinitePositive(parameters.u) ||
    !isFinitePositive(parameters.alpha1) ||
    !isFinitePositive(parameters.alpha2)
  ) {
    return null;
  }

  return {
    barrierKcalMol: parameters.barrierKcalMol,
    reactionEnergyKcalMol: parameters.reactionEnergyKcalMol,
    u: parameters.u,
    alpha1: parameters.alpha1,
    alpha2: parameters.alpha2,
    temperatureK: parameters.temperatureK,
  };
}

/** ¿Hay parámetros suficientes y finitos para dibujar el diagrama? */
export function isValidTunnelingParameters(parameters: TunnelingParameters): boolean {
  return toValidTunnelingParameters(parameters) !== null;
}

/**
 * Probabilidad de transmisión de Eckart P(E) para energías adimensionales.
 * Fórmula de referencia: P = (cosh(a1+a2) - cosh(a1-a2)) / (cosh(a1+a2) + df).
 * Se usa el rearreglo algebraico equivalente (multiplicar numerador y denominador
 * por 2·exp(-(a1+a2))) para no desbordar cosh cuando a1+a2 es grande.
 */
export function transmissionProbability(
  energy: number,
  u: number,
  alpha1: number,
  alpha2: number,
): number {
  if (u <= 0 || alpha1 <= 0 || alpha2 <= 0 || !Number.isFinite(energy)) {
    return 0;
  }

  const c = 0.125 * PI * u * Math.pow(1 / Math.sqrt(alpha1) + 1 / Math.sqrt(alpha2), 2);
  const v1 = (u / (2 * PI)) * alpha1;
  const v2 = (u / (2 * PI)) * alpha2;
  const discriminant = 4 * alpha1 * alpha2 - PI * PI;
  const df =
    discriminant > 0
      ? Math.cosh(Math.sqrt(discriminant))
      : Math.cos(Math.sqrt(-discriminant));

  if (!Number.isFinite(c) || c <= 0) {
    return 0;
  }

  const shiftedEnergy1 = energy + v1;
  const shiftedEnergy2 = energy + v2;
  if (shiftedEnergy1 <= 0 || shiftedEnergy2 <= 0) {
    return 0;
  }

  const a1 = PI * Math.sqrt(shiftedEnergy1 / c);
  const a2 = PI * Math.sqrt(shiftedEnergy2 / c);
  const exponentSum = a1 + a2;

  const numerator =
    1 + Math.exp(-2 * exponentSum) - Math.exp(-2 * a1) - Math.exp(-2 * a2);
  const denominator = 1 + Math.exp(-2 * exponentSum) + 2 * df * Math.exp(-exponentSum);

  const probability = numerator / denominator;
  if (!Number.isFinite(probability)) {
    return 0;
  }

  return Math.min(Math.max(probability, 0), 1);
}

/**
 * Energía térmica en kcal/mol de la línea horizontal del gráfico.
 * Si el job trae temperatura se usa k_BT = R·T; si no, se deriva del propio modelo:
 * α₁ = V‡/(h c ν̃) y u = h c ν̃/(k_BT) ⇒ k_BT = V‡/(α₁·u).
 */
export function resolveThermalEnergyKcalMol(parameters: ValidTunnelingParameters): number {
  if (parameters.temperatureK !== null && Number.isFinite(parameters.temperatureK)) {
    return GAS_CONSTANT_KCAL_PER_MOL_K * parameters.temperatureK;
  }

  return parameters.barrierKcalMol / (parameters.alpha1 * parameters.u);
}

function logisticValue(scaledCoordinate: number): number {
  // Sigmoide s(x) = 1/(1+exp(-2πx/L)); se evita el desbordamiento del exponencial.
  if (scaledCoordinate > 700) {
    return 1;
  }
  if (scaledCoordinate < -700) {
    return 0;
  }
  return 1 / (1 + Math.exp(-scaledCoordinate));
}

function sechSquaredValue(scaledCoordinate: number): number {
  if (Math.abs(scaledCoordinate) > 350) {
    return 0;
  }
  const hyperbolicCosine = Math.cosh(scaledCoordinate);
  return 1 / (hyperbolicCosine * hyperbolicCosine);
}

/**
 * Potencial asimétrico de Eckart: V(x) = ΔE·s(x) + A·sech²(2πx/L).
 * A es la amplitud del término sech² resuelta para que max(V) coincida con la barrera.
 */
export function evaluateEckartPotential(
  x: number,
  reactionEnergyKcalMol: number,
  sechAmplitudeKcalMol: number,
): number {
  const scaledCoordinate = (2 * PI * x) / CHARACTERISTIC_LENGTH;
  return (
    reactionEnergyKcalMol * logisticValue(scaledCoordinate) +
    sechAmplitudeKcalMol * sechSquaredValue(scaledCoordinate)
  );
}

function buildUniformCoordinates(start: number, end: number, sampleCount: number): number[] {
  const coordinates: number[] = new Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    const ratio = sampleCount === 1 ? 0 : index / (sampleCount - 1);
    coordinates[index] = start + (end - start) * ratio;
  }
  return coordinates;
}

function maxPotentialOnGrid(
  coordinates: ReadonlyArray<number>,
  reactionEnergyKcalMol: number,
  sechAmplitudeKcalMol: number,
): number {
  let maximum = -Infinity;
  for (const x of coordinates) {
    const value = evaluateEckartPotential(x, reactionEnergyKcalMol, sechAmplitudeKcalMol);
    if (value > maximum) {
      maximum = value;
    }
  }
  return maximum;
}

/**
 * Resuelve la amplitud A del término sech² tal que max(V(x)) == barrera.
 * El máximo crece de forma monótona con A (A no es negativo), así que basta una
 * bisección sobre [0, A_alto]; A_alto se duplica hasta sobrepasar la barrera.
 * Devuelve null si no existe solución (p. ej. ΔE por encima de la barrera).
 */
function solveSechAmplitude(
  reactionEnergyKcalMol: number,
  barrierKcalMol: number,
  coordinates: ReadonlyArray<number>,
): number | null {
  if (
    maxPotentialOnGrid(coordinates, reactionEnergyKcalMol, 0) >= barrierKcalMol ||
    maxPotentialOnGrid(coordinates, reactionEnergyKcalMol, 0) === -Infinity
  ) {
    return null;
  }

  let low = 0;
  let high = Math.max(barrierKcalMol, 1);
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (maxPotentialOnGrid(coordinates, reactionEnergyKcalMol, high) >= barrierKcalMol) {
      break;
    }
    high *= 2;
  }

  for (let iteration = 0; iteration < AMPLITUDE_SOLVE_ITERATIONS; iteration += 1) {
    const middle = (low + high) / 2;
    if (maxPotentialOnGrid(coordinates, reactionEnergyKcalMol, middle) >= barrierKcalMol) {
      high = middle;
    } else {
      low = middle;
    }
  }

  const amplitude = (low + high) / 2;
  return Number.isFinite(amplitude) && amplitude > 0 ? amplitude : null;
}

/**
 * Perfil de potencial V(x) en x ∈ [-2.5L, 2.5L] con ~400 puntos.
 * Devuelve null si la barrera no es positiva o si la forma no admite el ajuste.
 */
export function buildPotentialProfile(
  barrierKcalMol: number,
  reactionEnergyKcalMol: number,
): ChartPoint[] | null {
  if (
    !Number.isFinite(barrierKcalMol) ||
    !Number.isFinite(reactionEnergyKcalMol) ||
    barrierKcalMol <= 0
  ) {
    return null;
  }

  const extent = PROFILE_EXTENT_IN_LENGTHS * CHARACTERISTIC_LENGTH;
  const coordinates = buildUniformCoordinates(-extent, extent, POTENTIAL_SAMPLE_COUNT);
  const sechAmplitude = solveSechAmplitude(
    reactionEnergyKcalMol,
    barrierKcalMol,
    coordinates,
  );
  if (sechAmplitude === null) {
    return null;
  }

  return coordinates.map((x): ChartPoint => [
    x,
    evaluateEckartPotential(x, reactionEnergyKcalMol, sechAmplitude),
  ]);
}

/**
 * |ψ|² estilizada pero consistente con P(E): onda incidente y reflejada que interfieren
 * a la izquierda, decaimiento exponencial dentro de la barrera y onda transmitida a la
 * derecha. La amplitud reflejada es √(1-P) y la transmitida √P, de modo que |ψ|²
 * coincide con las probabilidades del modelo. Se normaliza para que el máximo valga 1.
 */
export function buildProbabilityDensityProfile(
  transmission: number,
  xMin: number,
  xMax: number,
): ChartPoint[] {
  const probability = Math.min(Math.max(transmission, 0), 1);
  const reflectionAmplitude = Math.sqrt(1 - probability);
  const transmittedAmplitude = Math.sqrt(probability);
  const barrierEdge = BARRIER_HALF_WIDTH_IN_LENGTHS * CHARACTERISTIC_LENGTH;
  const leftEdge = -barrierEdge;
  const rightEdge = barrierEdge;
  // Con k = 4π/L los bordes caen en un máximo (cos = 1): el empalme es continuo.
  const leftCrest = Math.pow(1 + reflectionAmplitude, 2);
  const decayConstant =
    Math.log(leftCrest / Math.max(probability, MIN_TRANSMISSION_FOR_DECAY)) /
    (2 * (rightEdge - leftEdge));

  const points: ChartPoint[] = [];
  const leftCoordinates = buildUniformCoordinates(
    xMin,
    leftEdge,
    LEFT_SEGMENT_SAMPLE_COUNT,
  );
  for (const x of leftCoordinates) {
    const reflectedPhase = WAVE_NUMBER * (2 * leftEdge - x);
    const amplitude = Math.cos(WAVE_NUMBER * x) + reflectionAmplitude * Math.cos(reflectedPhase);
    points.push([x, amplitude * amplitude]);
  }

  const barrierCoordinates = buildUniformCoordinates(
    leftEdge,
    rightEdge,
    BARRIER_SEGMENT_SAMPLE_COUNT,
  );
  for (const x of barrierCoordinates) {
    const decayed = leftCrest * Math.exp(-2 * decayConstant * (x - leftEdge));
    points.push([x, decayed]);
  }

  const rightCoordinates = buildUniformCoordinates(
    rightEdge,
    xMax,
    RIGHT_SEGMENT_SAMPLE_COUNT,
  );
  for (const x of rightCoordinates) {
    const amplitude = transmittedAmplitude * Math.cos(WAVE_NUMBER * (x - rightEdge));
    points.push([x, amplitude * amplitude]);
  }

  const maximum = points.reduce((currentMax, point) => Math.max(currentMax, point[1]), 0);
  if (maximum <= 0) {
    return points;
  }

  return points.map((point): ChartPoint => [point[0], point[1] / maximum]);
}

/** Construye las series del diagrama; devuelve null si los parámetros no son válidos. */
export function buildTunnelingSeries(
  rawParameters: TunnelingParameters,
): TunnelingProfileSeries | null {
  const parameters = toValidTunnelingParameters(rawParameters);
  if (parameters === null) {
    return null;
  }

  const potential = buildPotentialProfile(
    parameters.barrierKcalMol,
    parameters.reactionEnergyKcalMol,
  );
  if (potential === null || potential.length === 0) {
    return null;
  }

  // Energía térmica adimensional del modelo reducido: E = u. Es la convención del
  // backend, donde las energías se expresan en unidades de la energía del modo
  // imaginario (u = h c ν̃ / k_BT); con E = u se evalúa P(E) una sola vez.
  const transmission = transmissionProbability(
    parameters.u,
    parameters.u,
    parameters.alpha1,
    parameters.alpha2,
  );

  const xMin = potential[0][0];
  const xMax = potential[potential.length - 1][0];
  const probabilityDensity = buildProbabilityDensityProfile(transmission, xMin, xMax);

  const barrierPeak = potential.reduce(
    (currentPeak, point) => (point[1] > currentPeak[1] ? point : currentPeak),
    potential[0],
  );

  return {
    potential,
    probabilityDensity,
    thermalEnergyKcalMol: resolveThermalEnergyKcalMol(parameters),
    transmissionProbability: transmission,
    barrierPeak: [barrierPeak[0], barrierPeak[1]],
    xMin,
    xMax,
  };
}

function formatFixed(value: number, digits: number): string {
  return value.toFixed(digits);
}

/**
 * Opciones ECharts del diagrama: potencial en kcal/mol (eje izquierdo), |ψ|² en el
 * eje derecho y la recta de energía térmica. Sin tooltip ni animación (es ilustrativa).
 */
export function buildTunnelingChartOptions(
  parameters: TunnelingParameters,
): EChartsCoreOption | null {
  const series = buildTunnelingSeries(parameters);
  if (series === null) {
    return null;
  }

  const potentialSeries: LineSeriesOption = {
    name: 'V(x)',
    type: 'line',
    yAxisIndex: 0,
    data: series.potential,
    showSymbol: false,
    lineStyle: { width: 3, color: '#6a4c93' },
    itemStyle: { color: '#6a4c93' },
    z: 4,
    markPoint: {
      silent: true,
      symbol: 'circle',
      symbolSize: 8,
      itemStyle: { color: '#6a4c93' },
      label: {
        show: true,
        position: 'top',
        formatter: `V‡ = ${formatFixed(parameters.barrierKcalMol, 2)} kcal/mol`,
        color: '#6a4c93',
        fontWeight: 700,
        backgroundColor: 'rgba(250, 248, 252, 0.92)',
        borderColor: 'rgba(106, 76, 147, 0.22)',
        borderWidth: 1,
        borderRadius: 10,
        padding: [4, 8],
      },
      data: [{ name: 'barrier', coord: [series.barrierPeak[0], series.barrierPeak[1]] }],
    },
    markLine: {
      silent: true,
      symbol: 'none',
      lineStyle: { color: '#6a4c93', type: 'dashed', width: 1.4, opacity: 0.8 },
      label: {
        show: true,
        position: 'insideStartTop',
        formatter: `ΔE = ${formatFixed(parameters.reactionEnergyKcalMol, 2)} kcal/mol`,
        color: '#6a4c93',
        fontSize: 11,
      },
      data: [{ yAxis: parameters.reactionEnergyKcalMol, name: 'reaction-energy' }],
    },
  };

  const densitySeries: LineSeriesOption = {
    name: '|ψ|²',
    type: 'line',
    yAxisIndex: 1,
    data: series.probabilityDensity,
    showSymbol: false,
    lineStyle: { width: 1.8, color: '#0277bd' },
    itemStyle: { color: '#0277bd' },
    areaStyle: { color: 'rgba(2, 119, 189, 0.12)' },
    z: 3,
  };

  const thermalSeries: LineSeriesOption = {
    name: 'Thermal energy',
    type: 'line',
    yAxisIndex: 0,
    data: [
      [series.xMin, series.thermalEnergyKcalMol],
      [series.xMax, series.thermalEnergyKcalMol],
    ],
    silent: true,
    showSymbol: false,
    lineStyle: { color: '#d97706', type: 'dashed', width: 1.6 },
    markPoint: {
      silent: true,
      symbol: 'circle',
      symbolSize: 1,
      label: {
        show: true,
        position: 'right',
        formatter: `k_BT ≈ ${formatFixed(series.thermalEnergyKcalMol, 2)} kcal/mol`,
        color: '#d97706',
        fontSize: 11,
      },
      itemStyle: { color: '#d97706' },
      data: [{ name: 'thermal', coord: [series.xMin, series.thermalEnergyKcalMol] }],
    },
    z: 5,
  };

  const temperatureCaption =
    parameters.temperatureK !== null && Number.isFinite(parameters.temperatureK)
      ? ` · T = ${formatFixed(parameters.temperatureK, 2)} K`
      : '';
  const caption = `P(E) = ${formatFixed(series.transmissionProbability, 3)}${temperatureCaption}`;

  return {
    animation: false,
    aria: { enabled: true },
    tooltip: { show: false },
    legend: {
      top: 8,
      left: 'center',
      itemWidth: 18,
      itemHeight: 10,
      textStyle: { color: '#5a5163', fontSize: 12, fontWeight: 600 },
      data: ['V(x)', '|ψ|²', 'Thermal energy'],
    },
    graphic: [
      {
        type: 'text',
        left: 16,
        top: 34,
        silent: true,
        style: {
          text: caption,
          fill: '#5a5163',
          fontSize: 12,
          fontWeight: 600,
        },
      },
    ],
    grid: { top: 64, right: 24, bottom: 30, left: 24, containLabel: true },
    xAxis: {
      type: 'value',
      name: 'Reaction coordinate',
      min: series.xMin,
      max: series.xMax,
      nameLocation: 'middle',
      nameGap: 30,
      nameTextStyle: { color: '#5a5163', fontSize: 13, fontWeight: 700 },
      axisLabel: {
        formatter: (axisValue: number) => formatFixed(axisValue, 1),
        color: '#5a5163',
        fontSize: 12,
      },
      splitLine: { show: false },
    },
    yAxis: [
      {
        type: 'value',
        name: 'V (kcal/mol)',
        nameLocation: 'middle',
        nameGap: 52,
        scale: true,
        nameTextStyle: { color: '#5a5163', fontSize: 13, fontWeight: 700 },
        axisLabel: {
          formatter: (axisValue: number) => formatFixed(axisValue, 1),
          color: '#5a5163',
          fontSize: 12,
        },
        splitLine: { lineStyle: { color: 'rgba(90, 81, 99, 0.12)' } },
      },
      {
        type: 'value',
        name: '|ψ|²',
        nameLocation: 'middle',
        nameGap: 40,
        min: 0,
        max: 1.05,
        nameTextStyle: { color: '#0277bd', fontSize: 13, fontWeight: 700 },
        axisLabel: {
          formatter: (axisValue: number) => formatFixed(axisValue, 2),
          color: '#0277bd',
          fontSize: 12,
        },
        splitLine: { show: false },
      },
    ],
    series: [potentialSeries, densitySeries, thermalSeries],
  };
}
