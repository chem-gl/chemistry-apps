// tunneling-profile-chart.component.ts: Diagrama científico de túnel de Eckart.
// Dibuja el potencial asimétrico V(x) y una función de onda |ψ|² coherente con P(E),
// reutilizando app-scientific-chart. Todos los cálculos viven en tunneling-chart-math.

import { Component, computed, input } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { ScientificChartComponent } from '../scientific-chart/scientific-chart.component';
import {
  buildTunnelingChartOptions,
  type TunnelingParameters,
} from './tunneling-chart-math';

/** Etiqueta accesible de reserva cuando el contenedor no aporta una traducción. */
export const DEFAULT_TUNNELING_CHART_ARIA_LABEL =
  'Tunneling diagram: Eckart barrier, wavefunction and thermal energy';

/** Alto fijo del gráfico: evita saltos de layout entre estados. */
export const TUNNELING_CHART_HEIGHT = '380px';

@Component({
  selector: 'app-tunneling-profile-chart',
  standalone: true,
  imports: [ScientificChartComponent],
  templateUrl: './tunneling-profile-chart.component.html',
  styleUrl: './tunneling-profile-chart.component.scss',
})
export class TunnelingProfileChartComponent {
  readonly barrierKcalMol = input.required<number>();
  readonly reactionEnergyKcalMol = input.required<number>();
  readonly u = input.required<number | null>();
  readonly alpha1 = input.required<number | null>();
  readonly alpha2 = input.required<number | null>();
  /** Solo se usa en el subtítulo del gráfico; no interviene en los cálculos. */
  readonly temperatureK = input<number | null>(null);
  readonly ariaLabel = input<string>('');

  readonly chartHeight = TUNNELING_CHART_HEIGHT;

  readonly chartOptions = computed<EChartsCoreOption | null>(() =>
    buildTunnelingChartOptions(this.currentParameters()),
  );

  readonly resolvedAriaLabel = computed<string>(() => {
    const providedLabel = this.ariaLabel().trim();
    return providedLabel.length > 0 ? providedLabel : DEFAULT_TUNNELING_CHART_ARIA_LABEL;
  });

  private currentParameters(): TunnelingParameters {
    return {
      barrierKcalMol: this.barrierKcalMol(),
      reactionEnergyKcalMol: this.reactionEnergyKcalMol(),
      u: this.u(),
      alpha1: this.alpha1(),
      alpha2: this.alpha2(),
      temperatureK: this.temperatureK(),
    };
  }
}
