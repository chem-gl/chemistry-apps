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

    expect(profile?.length).toBe(400);
    expect(Math.abs(maximum - 3.5)).toBeLessThanOrEqual(0.01);
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

    // Colas a ambos lados tienden a 0 (campana centrada en x = 0).
    expect(firstValue).toBeLessThanOrEqual(0.01);
    expect(lastValue).toBeLessThanOrEqual(0.01);
    expect(Math.abs(points[peakIndex][0])).toBeLessThanOrEqual(0.01);
    // Simetría: V(-x) == V(x).
    expect(Math.abs(points[0][1] - points[points.length - 1][1])).toBeLessThanOrEqual(1e-9);
  });

  it('cubre un rango simétrico alrededor de x = 0 y devuelve null sin barrera positiva', () => {
    const profile = buildPotentialProfile(3.5, -8.2);
    const firstX = profile?.[0][0] ?? 0;
    const lastX = profile?.[(profile?.length ?? 1) - 1][0] ?? 0;
    // Simétrico y suficientemente ancho para ver las colas planas de la barrera.
    expect(firstX).toBeLessThan(-1);
    expect(lastX).toBeGreaterThan(1);
    expect(firstX).toBeCloseTo(-lastX, 10);
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
    expect(options?.animation).toBe(false);
    expect(Array.isArray(options?.['series'])).toBe(true);
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
