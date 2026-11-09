// tunneling-chart-math.ts: Cálculo puro del diagrama científico de túnel de Eckart.
// Reproduce la transmisión del backend (backend/libs/ck_test/calculators.py::_gauss_quadrature_integration)
// y dibuja el potencial asimétrico V(x) junto a una función de onda coherente con P(E).
// Sin DOM ni Angular: todas las funciones se pueden probar de forma aislada.

import type { LineSeriesOption } from 'echarts/charts';
import type { EChartsCoreOption } from 'echarts/core';

const PI = Math.PI;

/** Longitud característica L del potencial de Eckart (coordenada de reacción adimensional).
 *  Pequeña a propósito: la barrera debe verse estrecha, no una joroba ancha.
 *  No se toca: la anchura de la campana está ligada al modelo Eckart, no al dibujo. */
const CHARACTERISTIC_LENGTH = 0.9;
/** Puntos de muestreo del perfil de potencial. 1000 (antes 400): con ~0.6 puntos por
 *  píxel horizontal la polilínea deja de mostrar facetas en los flancos de la campana;
 *  1000 puntos por serie son coste despreciable para el renderer de canvas. */
const POTENTIAL_SAMPLE_COUNT = 1000;
/** Extensión del perfil de potencial en múltiplos de L. ±1.0L (antes ±1.6L): con el
 *  recorte anterior la campana ocupaba solo el 8 % del ancho visible y se leía como una
 *  espina; ahora el FWHM es ~14 % del ancho y el giro en el vértice baja de ~29° a ~5°
 *  medido en las coordenadas del eje. Aun así las colas llegan a ~5·10⁻⁵·V‡ en los
 *  bordes, muy por debajo del 1 % que exige el diagrama. No bajar de 0.5L: ahí xMin
 *  coincidiría con el borde izquierdo de la barrera y el tramo izquierdo de |ψ|²
 *  quedaría degenerado. */
const PROFILE_EXTENT_IN_LENGTHS = 1.0;
/** Semi-anchura de la barrera estilizada en la función de onda, en múltiplos de L. */
const BARRIER_HALF_WIDTH_IN_LENGTHS = 0.5;
// Número de onda elegido para que el borde de la barrera caiga en un máximo de |ψ|²
// (k·edge = π): el empalme entre los tres tramos es continuo y quedan ~1 oscilación
// por lado, como en los diagramas de túnel de libro de texto.
const WAVE_NUMBER = PI / (BARRIER_HALF_WIDTH_IN_LENGTHS * CHARACTERISTIC_LENGTH);
/** Muestreo de |ψ|²: una única malla uniforme sobre la ventana visible. 1200 puntos
 *  (antes 200/40/160 por tramo, con puntos duplicados en los empalmes) dejan ~600
 *  muestras dentro de la barrera, así el decaimiento y los flancos de los nodos se
 *  dibujan sin facetas. */
const DENSITY_SAMPLE_COUNT = 1200;
/** Constante de los gases ideales en kcal/(mol·K). */
const GAS_CONSTANT_KCAL_PER_MOL_K = 0.00198720425864083;
/** Probabilidad mínima como denominador del decaimiento (evita log(0)). */
const MIN_TRANSMISSION_FOR_DECAY = 1e-12;

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
 * α₁ = 2π·V‡/(h c ν̃) (backend) y u = h c ν̃/(k_BT) ⇒ k_BT = 2π·V‡/(α₁·u).
 */
export function resolveThermalEnergyKcalMol(parameters: ValidTunnelingParameters): number {
  if (parameters.temperatureK !== null && Number.isFinite(parameters.temperatureK)) {
    return GAS_CONSTANT_KCAL_PER_MOL_K * parameters.temperatureK;
  }

  return (2 * Math.PI * parameters.barrierKcalMol) / (parameters.alpha1 * parameters.u);
}

function sechSquaredValue(scaledCoordinate: number): number {
  // sech^2 con guarda numérica: cosh desborda para |z| > ~700.
  if (Math.abs(scaledCoordinate) > 40) {
    return 0;
  }
  const hyperbolicCosine = Math.cosh(scaledCoordinate);
  return 1 / (hyperbolicCosine * hyperbolicCosine);
}

/**
 * Potencial de Eckart canónico: campana simétrica V(x) = V₀·sech²(2πx/L).
 * Es la forma que representa el túnel a través de una barrera: máximo V₀ en el
 * TS (x = 0) y colas que tienden a 0 a ambos lados. La energía de reacción ΔE
 * se dibuja como línea de referencia de los productos, no deformando la campana.
 */
export function evaluateEckartPotential(x: number, barrierKcalMol: number): number {
  return barrierKcalMol * sechSquaredValue((2 * PI * x) / CHARACTERISTIC_LENGTH);
}

function buildUniformCoordinates(start: number, end: number, sampleCount: number): number[] {
  const coordinates: number[] = new Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    const ratio = sampleCount === 1 ? 0 : index / (sampleCount - 1);
    coordinates[index] = start + (end - start) * ratio;
  }
  return coordinates;
}

export function buildPotentialProfile(
  barrierKcalMol: number,
  reactionEnergyKcalMol: number,
): ChartPoint[] | null {
  if (
    !Number.isFinite(barrierKcalMol) ||
    !Number.isFinite(reactionEnergyKcalMol) ||
    barrierKcalMol <= 0 ||
    reactionEnergyKcalMol >= barrierKcalMol
  ) {
    // Sin barrera positiva, o productos por encima del TS (no físico en este modelo).
    return null;
  }

  const extent = PROFILE_EXTENT_IN_LENGTHS * CHARACTERISTIC_LENGTH;
  const coordinates = buildUniformCoordinates(-extent, extent, POTENTIAL_SAMPLE_COUNT);
  return coordinates.map((x): ChartPoint => [x, evaluateEckartPotential(x, barrierKcalMol)]);
}

/** Interpolación de Hermite cúbica 3t²-2t³: une 0→1 con derivada nula en los extremos. */
function smoothStep(ratio: number): number {
  return ratio * ratio * (3 - 2 * ratio);
}

/**
 * |ψ|² estilizada pero consistente con P(E): onda incidente y reflejada que interfieren
 * a la izquierda, decaimiento dentro de la barrera y onda transmitida a la derecha. La
 * amplitud reflejada es √(1-P) y la transmitida √P, de modo que |ψ|² coincide con las
 * probabilidades del modelo. Se normaliza para que el máximo valga 1.
 *
 * Los tres tramos se evalúan en una malla uniforme única y el decaimiento de la barrera
 * se interpola con un smoothstep entre el valor del borde izquierdo y P: las dos ondas
 * alcanzan un máximo justo en los bordes (pendiente 0), así que el empalme es C¹ y no se
 * ve el quiebro, sin mover ningún valor físico (extremos y nodos intactos).
 */
export function buildProbabilityDensityProfile(
  transmission: number,
  xMin: number,
  xMax: number,
): ChartPoint[] {
  const safeTransmission = Number.isFinite(transmission) ? transmission : 0;
  const probability = Math.min(Math.max(safeTransmission, 0), 1);
  const reflectionAmplitude = Math.sqrt(1 - probability);
  const barrierEdge = BARRIER_HALF_WIDTH_IN_LENGTHS * CHARACTERISTIC_LENGTH;
  const leftEdge = -barrierEdge;
  const rightEdge = barrierEdge;
  // Amplitud transmitida efectiva: acota el decaimiento y la onda derecha, así el
  // empalme en x = +edge es exacto también cuando P ≈ 0.
  const transmittedDensity = Math.max(probability, MIN_TRANSMISSION_FOR_DECAY);

  const leftDensity = (x: number): number => {
    const reflectedPhase = WAVE_NUMBER * (2 * leftEdge - x);
    const amplitude = Math.cos(WAVE_NUMBER * x) + reflectionAmplitude * Math.cos(reflectedPhase);
    return amplitude * amplitude;
  };

  // Continuidad estricta en los bordes: se evalúa la onda incidente/reflejada en
  // x = leftEdge y se arranca el decaimiento desde ese valor real (no desde un
  // máximo teórico), de modo que no aparecen saltos verticales en la gráfica.
  const leftBoundaryDensity = leftDensity(leftEdge);
  const decayStart = Math.max(leftBoundaryDensity, transmittedDensity);
  const transmittedAmplitude = Math.sqrt(transmittedDensity);

  // Exponente del decaimiento: ln(P / ρ(izquierda)) ≤ 0. Al repartirlo con un smoothstep
  // sobre la barrera, ρ pasa de decayStart a P de forma monótona, con pendiente nula en
  // ambos bordes (que es justo la pendiente de las ondas, que allí tienen un máximo) y
  // sin tocar los valores físicos de los extremos.
  const decayExponent = Math.log(transmittedDensity / decayStart);
  const barrierDensity = (x: number): number =>
    decayStart *
    Math.exp(decayExponent * smoothStep((x - leftEdge) / (rightEdge - leftEdge)));
  const transmittedDensityAt = (x: number): number => {
    const amplitude = transmittedAmplitude * Math.cos(WAVE_NUMBER * (x - rightEdge));
    return amplitude * amplitude;
  };

  const densityAt = (x: number): number => {
    if (x <= leftEdge) {
      return leftDensity(x);
    }
    if (x <= rightEdge) {
      return barrierDensity(x);
    }
    return transmittedDensityAt(x);
  };

  const points = buildUniformCoordinates(xMin, xMax, DENSITY_SAMPLE_COUNT).map(
    (x): ChartPoint => [x, densityAt(x)],
  );

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

  // P(E) se evalúa una sola vez, en E = u, tal como pide la especificación del
  // diagrama. Ojo: en el modelo del backend las energías adimensionales están en
  // unidades de k_BT (v₁ = V‡/k_BT), de modo que la energía térmica estricta sería
  // E = 1; el valor se rotula como "P(E = u)" para no confundirlo con P(k_BT).
  const transmission = transmissionProbability(
    parameters.u,
    parameters.u,
    parameters.alpha1,
    parameters.alpha2,
  );

  const xMin = potential[0][0];
  const xMax = potential.at(-1)?.[0] ?? 0;
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
 * eje derecho y la recta de energía térmica. Sin tooltip; con una transición corta
 * de entrada para que el trazo no aparezca de golpe.
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
    // Solo el potencial se dibuja suavizado: los nodos de |ψ|² son datos físicos y
    // un spline los desplazaría. smoothMonotone evita que el spline se salga del
    // rango (sobrepasar V₀ en el TS o hundirse bajo 0 en las colas).
    smooth: true,
    smoothMonotone: 'x',
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
      data: [
        { name: 'barrier', coord: [series.barrierPeak[0], series.barrierPeak[1]] },
        {
          name: 'reactants',
          coord: [series.xMin, 0],
          symbolSize: 7,
          label: {
            show: true,
            position: 'bottom',
            formatter: 'R (0)',
            color: '#6a4c93',
            fontSize: 11,
            fontWeight: 700,
          },
        },
        {
          name: 'products',
          coord: [series.xMax, parameters.reactionEnergyKcalMol],
          symbolSize: 7,
          label: {
            show: true,
            position: 'top',
            formatter: `P (${formatFixed(parameters.reactionEnergyKcalMol, 1)})`,
            color: '#6a4c93',
            fontSize: 11,
            fontWeight: 700,
          },
        },
      ],
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
    z: 5,
  };

  const temperatureCaption =
    parameters.temperatureK !== null && Number.isFinite(parameters.temperatureK)
      ? ` · T = ${formatFixed(parameters.temperatureK, 2)} K`
      : '';
  const caption =
    `P(E = u) = ${formatFixed(series.transmissionProbability, 3)}` +
    ` · k_BT ≈ ${formatFixed(series.thermalEnergyKcalMol, 2)} kcal/mol` +
    temperatureCaption;

  return {
    // Transición corta y sobria de entrada (antes estaba desactivada): el trazo se
    // dibuja progresivamente sin que el usuario lo perciba como una animación.
    animation: true,
    animationDuration: 300,
    animationEasing: 'cubicOut',
    // Umbral alto a propósito: con el muestreo nuevo (~1000-1200 puntos por serie)
    // ECharts desactivaría la animación al acercarse a su umbral por defecto (2000).
    animationThreshold: 10_000,
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
        right: 30,
        top: 34,
        silent: true,
        style: {
          text: 'V(x) = V₀·sech²(2πx/L)',
          fill: '#6a4c93',
          fontSize: 11,
          fontWeight: 600,
        },
      },
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
    grid: { top: 64, right: 28, bottom: 30, left: 58, containLabel: true },
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
        nameGap: 76,
        // Rango explícito: la campana (0..V‡) y la referencia de productos (ΔE).
        min: Math.min(0, parameters.reactionEnergyKcalMol) - 0.4,
        max: parameters.barrierKcalMol + 0.6,
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
        // Techo holgado: la onda no debe dominar visualmente el potencial.
        max: 1.35,
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
