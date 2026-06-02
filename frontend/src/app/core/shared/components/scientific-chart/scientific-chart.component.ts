// scientific-chart.component.ts: Renderiza graficas ECharts reutilizables para las apps cientificas.
// Se usa desde componentes de features para encapsular la integracion Angular + ECharts.

import { Component, input, output } from '@angular/core';
import { BarChart, BoxplotChart, LineChart, ScatterChart } from 'echarts/charts';
import {
  AriaComponent,
  DataZoomComponent,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  ToolboxComponent,
  TooltipComponent,
} from 'echarts/components';
import type { EChartsCoreOption, ECharts } from 'echarts/core';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { NgxEchartsDirective, provideEchartsCore } from 'ngx-echarts';

echarts.use([
  AriaComponent,
  BarChart,
  BoxplotChart,
  CanvasRenderer,
  DataZoomComponent,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  LineChart,
  ScatterChart,
  ToolboxComponent,
  TooltipComponent,
]);

@Component({
  selector: 'app-scientific-chart',
  standalone: true,
  imports: [NgxEchartsDirective],
  providers: [provideEchartsCore({ echarts })],
  templateUrl: './scientific-chart.component.html',
  styleUrl: './scientific-chart.component.scss',
})
export class ScientificChartComponent {
  readonly ariaLabel = input.required<string>();
  readonly chartHeight = input<string>('360px');
  readonly options = input.required<EChartsCoreOption>();
  readonly chartInit = output<ECharts>();
  readonly chartClick = output<Record<string, unknown>>();
}
