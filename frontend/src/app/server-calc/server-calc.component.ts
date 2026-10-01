// server-calc.component.ts: Calculadora remota (qta vía SSH) con archivo de resultado y logs.

import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  SERVER_CALC_OPERATORS,
  ServerCalcResultData,
  ServerCalcWorkflowService,
} from '../core/application/server-calc-workflow.service';
import { downloadBlobFile } from '../core/shared/scientific-app-ui.utils';

@Component({
  selector: 'app-server-calc',
  imports: [CommonModule, FormsModule, TranslocoPipe],
  providers: [ServerCalcWorkflowService],
  templateUrl: './server-calc.component.html',
  styleUrl: './server-calc.component.scss',
})
export class ServerCalcComponent {
  readonly workflow = inject(ServerCalcWorkflowService);
  readonly operators = SERVER_CALC_OPERATORS;

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
      'a,op,b,result,executed_on,file_name,file_path',
      [
        resultData.a,
        resultData.op,
        resultData.b,
        resultData.result ?? '',
        resultData.executedOn ?? '',
        resultData.fileName ?? '',
        resultData.filePath ?? '',
      ].join(','),
    ].join('\n');

    downloadBlobFile(
      'server_calc_report.csv',
      new Blob([csvContent], { type: 'text/csv;charset=utf-8' }),
    );
  }

  readonly toNumber = Number;

  /** Expresión "a op b = result" tal como quedó guardada en el archivo remoto. */
  formatExpression(resultData: ServerCalcResultData): string {
    const resultText = resultData.result === null ? '--' : String(resultData.result);
    return `${resultData.a} ${resultData.op} ${resultData.b} = ${resultText}`;
  }

  isRemoteExecution(resultData: ServerCalcResultData): boolean {
    return resultData.executedOn === 'qta' && resultData.fallbackUsed === false;
  }

  hasResultValues(resultData: ServerCalcResultData): boolean {
    return resultData.result !== null;
  }
}
