// cadma-py-boxplot-dialog.component.ts: Dialogo de boxplots interactivos para los resultados de CADMA Py.
// Grafico unico multi-serie con leyenda para mostrar/ocultar metricas individuales.

import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewChild,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import type { ECharts } from 'echarts/core';
import type { EChartsCoreOption } from 'echarts/core';
import { CadmaRankingRowView } from '../core/api/cadma-py-api.service';
import { JobsApiService } from '../core/api/jobs-api.service';
import { ScientificChartComponent } from '../core/shared/components/scientific-chart/scientific-chart.component';
import { closeDialogOnBackdropClick } from '../core/shared/scientific-app-ui.utils';
import { buildCadmaResultsBoxplotSingleChart, getResultsBoxplotMetricDefs, type BoxplotMetricDef } from './cadma-py-chart.options';

const METRIC_LABELS: Record<string, string> = {
  MW: 'Molecular Weight', logP: 'LogP', MR: 'Molar Refractivity', AtX: 'Heavy Atoms',
  HBLA: 'HB Acceptors', HBLD: 'HB Donors', RB: 'Rotatable Bonds', PSA: 'Polar SA',
  DT: 'Dev. Toxicity', M: 'Mutagenicity', LD50: 'LD50 (mg/kg)', SA: 'SA Score',
};

@Component({
  selector: 'app-cadma-py-boxplot-dialog',
  standalone: true,
  imports: [ScientificChartComponent],
  templateUrl: './cadma-py-boxplot-dialog.component.html',
  styleUrl: './cadma-py-boxplot-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CadmaPyBoxplotDialogComponent {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly jobsApi = inject(JobsApiService);

  @ViewChild('boxplotDialog')
  private readonly dialogRef?: ElementRef<HTMLDialogElement>;

  readonly ranking = input.required<CadmaRankingRowView[]>();

  readonly selectedCompound = signal<CadmaRankingRowView | null>(null);
  readonly compoundSvg = signal<SafeHtml | null>(null);
  readonly compoundBusy = signal<boolean>(false);
  readonly compoundError = signal<string>('');

  private chartInstance: ECharts | null = null;

  readonly visibleGroups = signal<Set<string>>(new Set(['ADME', 'Toxicity', 'SA Score']));
  readonly hiddenKeys = signal<Set<string>>(new Set());
  readonly boxplotGroups = ['ADME', 'Toxicity', 'SA Score'] as const;

  readonly allMetrics = computed<BoxplotMetricDef[]>(() => getResultsBoxplotMetricDefs());

  readonly boxplotChartOptions = computed<EChartsCoreOption>(() => {
    return buildCadmaResultsBoxplotSingleChart(
      this.ranking(),
      this.visibleGroups(),
      this.hiddenKeys(),
    );
  });

  toggleGroup(group: string): void {
    this.visibleGroups.update((current) => {
      const next = new Set(current);
      if (next.has(group)) {
        if (next.size > 1) next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
    this.resizeChart();
  }

  toggleMetric(key: string): void {
    this.hiddenKeys.update((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
    this.resizeChart();
  }

  private resizeChart(): void {
    setTimeout(() => {
      try { this.chartInstance?.resize(); } catch { /* ignore */ }
    }, 80);
  }

  isGroupVisible(group: string): boolean {
    return this.visibleGroups().has(group);
  }

  isMetricHidden(key: string): boolean {
    return this.hiddenKeys().has(key);
  }

  visibleMetricsForGroup(group: string): BoxplotMetricDef[] {
    return this.allMetrics().filter((m) => m.group === group);
  }

  readonly compoundMetrics = computed(() => {
    const compound = this.selectedCompound();
    if (!compound) return [];
    const keys = ['MW', 'logP', 'MR', 'AtX', 'HBLA', 'HBLD', 'RB', 'PSA', 'DT', 'M', 'LD50', 'SA'] as const;
    return keys.map((key) => ({
      key,
      label: METRIC_LABELS[key] ?? key,
      value: (compound[key as keyof CadmaRankingRowView] as number | undefined) ?? null,
    }));
  });

  open(): void {
    this.dialogRef?.nativeElement?.showModal();
    setTimeout(() => {
      try { this.chartInstance?.resize(); } catch { /* not ready */ }
    }, 80);
  }

  close(): void {
    this.selectedCompound.set(null);
    this.compoundSvg.set(null);
    this.compoundError.set('');
    this.compoundBusy.set(false);
    this.dialogRef?.nativeElement?.close();
  }

  onBackdropClick(event: MouseEvent | KeyboardEvent): void {
    closeDialogOnBackdropClick(event, this.dialogRef?.nativeElement, () => {
      this.close();
    });
  }

  onChartInit(chart: ECharts): void {
    this.chartInstance = chart;
  }

  onChartClick(params: Record<string, unknown>): void {
    const seriesType = params['seriesType'] as string | undefined;
    if (seriesType !== 'scatter') return;

    const data = params['data'] as { smiles?: string } | undefined;
    const smiles = data?.smiles;
    if (!smiles) return;

    const compound = this.ranking().find((r) => r.smiles === smiles) ?? null;
    if (compound) {
      this.selectCompound(compound);
    }
  }

  formatMetricLabel(key: string): string {
    return METRIC_LABELS[key] ?? key;
  }

  formatValue(val: number | null): string {
    if (val === null || val === undefined) return '—';
    return val.toFixed(2);
  }

  clearSelectedCompound(): void {
    this.selectedCompound.set(null);
    this.compoundSvg.set(null);
    this.compoundError.set('');
    this.compoundBusy.set(false);
  }

  selectCompound(compound: CadmaRankingRowView): void {
    this.selectedCompound.set(compound);
    this.compoundSvg.set(null);
    this.compoundError.set('');
    this.compoundBusy.set(true);

    this.jobsApi.inspectSmileitStructure(compound.smiles).subscribe({
      next: (inspection) => {
        this.compoundSvg.set(this.sanitizer.bypassSecurityTrustHtml(inspection.svg));
        this.compoundBusy.set(false);
      },
      error: () => {
        this.compoundError.set('Could not generate the molecule preview.');
        this.compoundBusy.set(false);
      },
    });
  }
}
