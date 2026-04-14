// tunnel.component.ts: Tunnel effect screen with Tkinter-equivalent inputs and result panel.

import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  TunnelResultData,
  TunnelWorkflowService,
} from '../core/application/tunnel-workflow.service';
import { downloadBlobFile } from '../core/shared/scientific-app-ui.utils';

@Component({
  selector: 'app-tunnel',
  imports: [CommonModule, FormsModule, TranslocoPipe],
  providers: [TunnelWorkflowService],
  templateUrl: './tunnel.component.html',
  styleUrl: './tunnel.component.scss',
})
export class TunnelComponent {
  readonly workflow = inject(TunnelWorkflowService);

  dispatch(): void {
    this.workflow.dispatch();
  }

  reset(): void {
    this.workflow.reset();
  }

  exportCsv(): void {
    const resultData = this.workflow.resultData();
    if (resultData === null) {
      return;
    }

    const csvContent = [
      'reaction_barrier_zpe,imaginary_frequency,reaction_energy_zpe,temperature,model_name,source_library,u,alpha_1,alpha_2,g,kappa_tst',
      [
        resultData.reactionBarrierZpe,
        resultData.imaginaryFrequency,
        resultData.reactionEnergyZpe,
        resultData.temperature,
        resultData.modelName ?? '',
        resultData.sourceLibrary ?? '',
        resultData.u ?? '',
        resultData.alpha1 ?? '',
        resultData.alpha2 ?? '',
        resultData.g ?? '',
        resultData.kappaTst ?? '',
      ].join(','),
    ].join('\n');

    downloadBlobFile(
      'tunnel_effect_report.csv',
      new Blob([csvContent], { type: 'text/csv;charset=utf-8' }),
    );
  }

  readonly toNumber = Number;

  formatOutputValue(rawValue: number | null): string {
    if (rawValue === null) {
      return '--';
    }
    return rawValue.toExponential(6).toUpperCase();
  }

  hasResultValues(resultData: TunnelResultData): boolean {
    return (
      resultData.u !== null &&
      resultData.alpha1 !== null &&
      resultData.alpha2 !== null &&
      resultData.g !== null &&
      resultData.kappaTst !== null
    );
  }
}
