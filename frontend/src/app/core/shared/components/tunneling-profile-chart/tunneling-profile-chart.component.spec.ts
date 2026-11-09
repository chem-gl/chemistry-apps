// tunneling-profile-chart.component.spec.ts: Pruebas del diagrama científico de túnel.
// Cubre la matemática pura (P(E), potencial y asíntotas), los casos inválidos y el render.

import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { EChartsCoreOption } from 'echarts/core';
import { ScientificChartComponent } from '../scientific-chart/scientific-chart.component';
import { TunnelingProfileChartComponent } from './tunneling-profile-chart.component';
import {
  buildPotentialProfile,
  buildTunnelingChartOptions,
  buildTunnelingSeries,
  isValidTunnelingParameters,
  transmissionProbability,
  type ChartPoint,
  type TunnelingParameters,
} from './tunneling-chart-math';

/** Ejemplo del manual: barrera 3.5 kcal/mol, ν̃ 625 cm⁻¹, ΔE -8.2 kcal/mol, 298.15 K. */
const EXAMPLE_U = 3.016;
const EXAMPLE_ALPHA1 = 12.306;
const EXAMPLE_ALPHA2 = 41.139;

const validParameters: TunnelingParameters = {
  barrierKcalMol: 3.5,
  reactionEnergyKcalMol: -8.2,
  u: EXAMPLE_U,
  alpha1: EXAMPLE_ALPHA1,
  alpha2: EXAMPLE_ALPHA2,
  temperatureK: 298.15,
};

/** Sustituto del chart real: ECharts necesita canvas, no disponible en jsdom. */
@Component({
  selector: 'app-scientific-chart',
  standalone: true,
  template: '<div class="chart-stub"></div>',
})
class ScientificChartStubComponent {
  readonly options = input.required<EChartsCoreOption>();
  readonly ariaLabel = input.required<string>();
  readonly chartHeight = input<string>('360px');
}

/** Misma fórmula que el backend, escrita en forma directa para contrastar el rearreglo. */
function referenceTransmissionProbability(
  energy: number,
  u: number,
  alpha1: number,
  alpha2: number,
): number {
  const c = 0.125 * Math.PI * u * Math.pow(1 / Math.sqrt(alpha1) + 1 / Math.sqrt(alpha2), 2);
  const v1 = (u / (2 * Math.PI)) * alpha1;
  const v2 = (u / (2 * Math.PI)) * alpha2;
  const discriminant = 4 * alpha1 * alpha2 - Math.PI * Math.PI;
  const df =
    discriminant > 0
      ? Math.cosh(Math.sqrt(discriminant))
      : Math.cos(Math.sqrt(-discriminant));
  const a1 = Math.PI * Math.sqrt((energy + v1) / c);
  const a2 = Math.PI * Math.sqrt((energy + v2) / c);
  return (Math.cosh(a1 + a2) - Math.cosh(a1 - a2)) / (Math.cosh(a1 + a2) + df);
}

/** Ángulo interior (grados) entre los dos segmentos que concurren en un vértice de la
 *  polilínea. x se normaliza al ancho total de la serie e y al rango vertical del eje
 *  real, así el ángulo refleja lo que se ve en pantalla y no la escala de los datos. */
function interiorAngleAt(points: readonly ChartPoint[], index: number, ySpan: number): number {
  const [previousX, previousY] = points[index - 1];
  const [currentX, currentY] = points[index];
  const [nextX, nextY] = points[index + 1];
  const xSpan = points[points.length - 1][0] - points[0][0];
  const incoming: ChartPoint = [
    (previousX - currentX) / xSpan,
    (previousY - currentY) / ySpan,
  ];
  const outgoing: ChartPoint = [(nextX - currentX) / xSpan, (nextY - currentY) / ySpan];
  const dot = incoming[0] * outgoing[0] + incoming[1] * outgoing[1];
  const scale = Math.hypot(incoming[0], incoming[1]) * Math.hypot(outgoing[0], outgoing[1]);
  const cosine = Math.min(Math.max(dot / scale, -1), 1);
  return (Math.acos(cosine) * 180) / Math.PI;
}

/** Mayor giro (180° - ángulo interior) de una serie: mide cuán "quebrada" se ve. */
function sharpestTurn(points: readonly ChartPoint[], ySpan: number): number {
  let sharpest = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    sharpest = Math.max(sharpest, 180 - interiorAngleAt(points, index, ySpan));
  }
  return sharpest;
}

describe('transmissionProbability', () => {
  it('devuelve probabilidades en [0, 1] monótonas crecientes con la energía', () => {
    const energies: readonly number[] = [0, 0.5, 1, 2, EXAMPLE_U, 5, 8];
    const probabilities = energies.map((energy) =>
      transmissionProbability(energy, EXAMPLE_U, EXAMPLE_ALPHA1, EXAMPLE_ALPHA2),
    );

    for (const probability of probabilities) {
      expect(Number.isFinite(probability)).toBe(true);
      expect(probability).toBeGreaterThanOrEqual(0);
      expect(probability).toBeLessThanOrEqual(1);
    }

    for (let index = 1; index < probabilities.length; index += 1) {
      expect(probabilities[index]).toBeGreaterThan(probabilities[index - 1]);
    }
  });

  it('coincide con la fórmula directa de referencia (sin desbordar cosh)', () => {
    const energies: readonly number[] = [0, 0.25, 1, EXAMPLE_U, 4];
    for (const energy of energies) {
      const stable = transmissionProbability(energy, EXAMPLE_U, EXAMPLE_ALPHA1, EXAMPLE_ALPHA2);
      const reference = referenceTransmissionProbability(
        energy,
        EXAMPLE_U,
        EXAMPLE_ALPHA1,
        EXAMPLE_ALPHA2,
      );
      expect(Math.abs(stable - reference)).toBeLessThan(1e-9);
    }
  });

  it('degrada a 0 con parámetros no positivos', () => {
    expect(transmissionProbability(1, 0, EXAMPLE_ALPHA1, EXAMPLE_ALPHA2)).toBe(0);
    expect(transmissionProbability(1, EXAMPLE_U, 0, EXAMPLE_ALPHA2)).toBe(0);
    expect(transmissionProbability(1, EXAMPLE_U, EXAMPLE_ALPHA1, -1)).toBe(0);
  });
});

describe('buildPotentialProfile', () => {
  it('alcanza la barrera pedida en su máximo (±0.01 kcal/mol)', () => {
    const profile = buildPotentialProfile(3.5, -8.2);
    expect(profile).not.toBeNull();
    const values = (profile ?? []).map((point) => point[1]);
    const maximum = Math.max(...values);

    // 1000 muestras (antes 400): resolución de dibujo, no de física.
    expect(profile?.length).toBe(1000);
    expect(Math.abs(maximum - 3.5)).toBeLessThanOrEqual(0.01);
  });

  it('se dibuja sin facetas: el vértice gira menos de 20° respecto a V₀', () => {
    const profile = buildPotentialProfile(3.5, -8.2) ?? [];
    // Normalizado por 0..V₀, el spline suavizado no necesita giros cerrados; antes de
    // ampliar la ventana y subir el muestreo el vértice giraba ~64°.
    expect(sharpestTurn(profile, 3.5)).toBeLessThan(20);
  });

  it('es una campana sech² simétrica: colas a 0 y máximo V₀ en el TS', () => {
    const profile = buildPotentialProfile(3.5, -8.2);
    expect(profile).not.toBeNull();
    const points = profile ?? [];
    const firstValue = points[0][1];
    const lastValue = points[points.length - 1][1];
    const peakIndex = points.reduce(
      (best, point, index) => (point[1] > points[best][1] ? index : best),
      0,
    );

    // Colas a ambos lados tienden a 0 (campana centrada en x = 0). Con la ventana
    // ±1.0L el borde vale ~5·10⁻⁵·V‡, tres órdenes por debajo del 1 % exigido.
    expect(firstValue).toBeLessThanOrEqual(0.01);
    expect(lastValue).toBeLessThanOrEqual(0.01);
    expect(Math.abs(points[peakIndex][0])).toBeLessThanOrEqual(0.01);
    // Simetría: V(-x) == V(x).
    expect(Math.abs(points[0][1] - points[points.length - 1][1])).toBeLessThanOrEqual(1e-9);
  });

  it('cubre un rango simétrico alrededor de x = 0 y devuelve null sin barrera positiva', () => {
    const profile = buildPotentialProfile(3.5, -8.2);
    const points = profile ?? [];
    const firstX = points[0]?.[0] ?? 0;
    const lastX = points[points.length - 1]?.[0] ?? 0;
    // Ventana ±1.0L (0.9): simétrica y lo bastante ancha para ver las colas planas,
    // pero sin el recorte extra que dejaba la campana en el 8 % del ancho visible.
    expect(firstX).toBeLessThan(-0.85);
    expect(lastX).toBeGreaterThan(0.85);
    expect(firstX).toBeCloseTo(-lastX, 10);

    // La campana ocupa al menos el 13 % del ancho visible a media altura (antes 8.3 %).
    const halfMaximumWidth = lastX - firstX;
    const aboveHalfMaximum = points.filter((point) => point[1] >= 1.75);
    const fullWidthHalfMaximum =
      aboveHalfMaximum[aboveHalfMaximum.length - 1][0] - aboveHalfMaximum[0][0];
    expect(fullWidthHalfMaximum / halfMaximumWidth).toBeGreaterThanOrEqual(0.13);

    expect(buildPotentialProfile(0, -8.2)).toBeNull();
    expect(buildPotentialProfile(3.5, 4)).toBeNull();
  });
});

describe('buildTunnelingSeries', () => {
  it('normaliza |ψ|² a un máximo de 1 y conserva la energía térmica en kcal/mol', () => {
    const series = buildTunnelingSeries(validParameters);
    expect(series).not.toBeNull();
    if (series === null) {
      return;
    }

    const densityMaximum = Math.max(...series.probabilityDensity.map((point) => point[1]));
    expect(densityMaximum).toBeCloseTo(1, 10);
    expect(series.probabilityDensity.length).toBeGreaterThan(300);
    // R·T con R = 1.98720425864083e-3 kcal/(mol·K)
    expect(series.thermalEnergyKcalMol).toBeCloseTo(0.5925, 3);
    expect(series.transmissionProbability).toBeGreaterThan(0.9);
  });

  it('muestrea |ψ|² en una malla estrictamente creciente (sin duplicados en los empalmes)', () => {
    const series = buildTunnelingSeries(validParameters);
    const density = series?.probabilityDensity ?? [];
    // 1200 puntos repartidos en una sola malla: ~600 caen dentro de la barrera.
    expect(density.length).toBe(1200);
    const strictlyIncreasing = density.every(
      (point, index) => index === 0 || point[0] > density[index - 1][0],
    );
    expect(strictlyIncreasing).toBe(true);
  });

  it('arranca y cierra el decaimiento tangente a las ondas (empalme C¹)', () => {
    const density = buildTunnelingSeries(validParameters)?.probabilityDensity ?? [];
    const peakIndex = density.findIndex((point) => point[0] >= -0.45);
    const endIndex = density.findIndex((point) => point[0] >= 0.45);
    // Cinco muestras ≈ 0.008 en la coordenada de reacción.
    const step = 5;

    const peak = density[peakIndex][1];
    const barrierEnd = density[endIndex][1];
    const barrierDrop = peak - barrierEnd;

    // El decaimiento es monótono y tangente en ambos bordes: en el primer y en el último
    // tramo apenas cae, porque las ondas tienen allí un máximo (pendiente 0). Un empalme
    // C⁰ (exponencial pura) caía ~0.8 % de la barrera ya en esas cinco muestras.
    expect(barrierDrop).toBeGreaterThan(0);
    expect(peak - density[peakIndex + step][1]).toBeLessThan(barrierDrop * 0.002);
    expect(density[endIndex - step][1] - barrierEnd).toBeLessThan(barrierDrop * 0.002);
  });

  it('deriva k_BT del modelo cuando no hay temperatura', () => {
    const series = buildTunnelingSeries({ ...validParameters, temperatureK: null });
    // k_BT = 2π·V‡/(α₁·u); con el ejemplo coincide con R·T a 298.15 K.
    expect(series?.thermalEnergyKcalMol).toBeCloseTo(
      (2 * Math.PI * 3.5) / (EXAMPLE_ALPHA1 * EXAMPLE_U),
      10,
    );
    expect(series?.thermalEnergyKcalMol).toBeCloseTo(0.5925, 3);
  });
});

describe('buildTunnelingChartOptions', () => {
  it('devuelve opciones válidas con datos completos', () => {
    const options = buildTunnelingChartOptions(validParameters);
    expect(options).not.toBeNull();
    expect(Array.isArray(options?.['series'])).toBe(true);
  });

  it('anima la entrada con una transición corta en lugar de aparecer de golpe', () => {
    const options = buildTunnelingChartOptions(validParameters);
    expect(options?.animation).toBe(true);
    expect(options?.animationDuration).toBe(300);
    expect(options?.animationEasing).toBe('cubicOut');
    // Umbral alto: con ~1000-1200 puntos por serie ECharts desactivaría la animación.
    expect(options?.animationThreshold).toBe(10_000);
  });

  it('suaviza solo el potencial: los nodos de |ψ|² son datos físicos', () => {
    const options = buildTunnelingChartOptions(validParameters);
    const series = (options?.['series'] ?? []) as Array<{
      name?: string;
      smooth?: boolean;
      smoothMonotone?: string;
    }>;
    const potential = series.find((entry) => entry.name === 'V(x)');
    const density = series.find((entry) => entry.name === '|ψ|²');

    expect(potential?.smooth).toBe(true);
    expect(potential?.smoothMonotone).toBe('x');
    expect(density?.smooth).toBeUndefined();
  });

  it('devuelve null con entradas inválidas', () => {
    expect(isValidTunnelingParameters(validParameters)).toBe(true);
    expect(isValidTunnelingParameters({ ...validParameters, u: null })).toBe(false);
    expect(buildTunnelingChartOptions({ ...validParameters, u: 0 })).toBeNull();
    expect(buildTunnelingChartOptions({ ...validParameters, u: null })).toBeNull();
    expect(buildTunnelingChartOptions({ ...validParameters, alpha1: null })).toBeNull();
    expect(buildTunnelingChartOptions({ ...validParameters, alpha2: 0 })).toBeNull();
    expect(buildTunnelingChartOptions({ ...validParameters, barrierKcalMol: 0 })).toBeNull();
    expect(buildTunnelingChartOptions({ ...validParameters, barrierKcalMol: -2 })).toBeNull();
  });
});

describe('TunnelingProfileChartComponent', () => {
  let fixture: ComponentFixture<TunnelingProfileChartComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TunnelingProfileChartComponent] })
      .overrideComponent(TunnelingProfileChartComponent, {
        remove: { imports: [ScientificChartComponent] },
        add: { imports: [ScientificChartStubComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(TunnelingProfileChartComponent);
  });

  function setValidInputs(): void {
    fixture.componentRef.setInput('barrierKcalMol', validParameters.barrierKcalMol);
    fixture.componentRef.setInput('reactionEnergyKcalMol', validParameters.reactionEnergyKcalMol);
    fixture.componentRef.setInput('u', validParameters.u);
    fixture.componentRef.setInput('alpha1', validParameters.alpha1);
    fixture.componentRef.setInput('alpha2', validParameters.alpha2);
    fixture.componentRef.setInput('temperatureK', validParameters.temperatureK);
    fixture.componentRef.setInput('ariaLabel', 'Diagrama de prueba');
  }

  it('renderiza el gráfico con datos válidos sin lanzar', () => {
    setValidInputs();
    expect(() => fixture.detectChanges()).not.toThrow();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('app-scientific-chart')).not.toBeNull();
    expect(element.querySelector('.chart-stub')).not.toBeNull();
    expect(fixture.componentInstance.chartOptions()).not.toBeNull();
  });

  it('no renderiza nada y devuelve null con entradas inválidas', () => {
    setValidInputs();
    fixture.componentRef.setInput('u', null);
    fixture.componentRef.setInput('alpha1', null);

    expect(() => fixture.detectChanges()).not.toThrow();
    const element = fixture.nativeElement as HTMLElement;
    expect(fixture.componentInstance.chartOptions()).toBeNull();
    expect(element.querySelector('app-scientific-chart')).toBeNull();
  });

  it('usa la etiqueta accesible de reserva cuando no se proporciona', () => {
    setValidInputs();
    fixture.componentRef.setInput('ariaLabel', '   ');
    fixture.detectChanges();

    expect(fixture.componentInstance.resolvedAriaLabel()).toContain('Tunneling diagram');
  });
});
