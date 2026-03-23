// sa-score.component.ts: Pantalla principal de SA Score con entrada de SMILES, ejecución async y exportes CSV.

import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import {
  DownloadedReportFile,
  JobLogEntryView,
  SaScoreMethod,
  SaScoreMoleculeResultView,
  ScientificJobView,
} from '../core/api/jobs-api.service';
import { SaScoreWorkflowService } from '../core/application/sa-score-workflow.service';

@Component({
  selector: 'app-sa-score',
  standalone: true,
  imports: [CommonModule, FormsModule],
  providers: [SaScoreWorkflowService],
  templateUrl: './sa-score.component.html',
  styleUrl: './sa-score.component.scss',
})
export class SaScoreComponent implements OnInit, OnDestroy {
  readonly workflow = inject(SaScoreWorkflowService);
  private readonly route = inject(ActivatedRoute);
  private routeSubscription: Subscription | null = null;

  readonly methodItems = [
    { key: 'ambit' as SaScoreMethod, label: 'AMBIT SA (0-100)' },
    { key: 'brsa' as SaScoreMethod, label: 'BRSAScore SA (0-100)' },
    { key: 'rdkit' as SaScoreMethod, label: 'RDKit SA (0-100)' },
  ];

  readonly lineCount = computed<number>(() => {
    const normalizedRows: string[] = this.workflow
      .smilesInput()
      .split(/\r?\n/)
      .map((lineValue: string) => lineValue.trim())
      .filter((lineValue: string) => lineValue.length > 0);
    return normalizedRows.length;
  });

  ngOnInit(): void {
    this.workflow.loadHistory();

    this.routeSubscription = this.route.queryParamMap.subscribe((paramsMap) => {
      const jobId: string | null = paramsMap.get('jobId');
      if (jobId !== null && jobId.trim() !== '') {
        this.workflow.openHistoricalJob(jobId);
      }
    });
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
  }

  dispatch(): void {
    this.workflow.dispatch();
  }

  reset(): void {
    this.workflow.reset();
  }

  openHistoricalJob(jobId: string): void {
    this.workflow.openHistoricalJob(jobId);
  }

  exportAllCsv(): void {
    this.workflow.downloadFullCsvReport().subscribe({
      next: (downloadedFile: DownloadedReportFile) => {
        this.downloadFile(downloadedFile.filename, downloadedFile.blob);
      },
      error: () => {
        // El workflow ya expone el mensaje de error para UI.
      },
    });
  }

  exportMethodCsv(method: SaScoreMethod): void {
    this.workflow.downloadMethodCsvReport(method).subscribe({
      next: (downloadedFile: DownloadedReportFile) => {
        this.downloadFile(downloadedFile.filename, downloadedFile.blob);
      },
      error: () => {
        // El workflow ya expone el mensaje de error para UI.
      },
    });
  }

  hasPayload(logEntry: JobLogEntryView): boolean {
    return Object.keys(logEntry.payload).length > 0;
  }

  logLevelClass(logLevel: JobLogEntryView['level']): string {
    return `log-level log-level-${logLevel}`;
  }

  historicalStatusClass(jobStatus: ScientificJobView['status']): string {
    return `history-status history-${jobStatus}`;
  }

  methodScore(molecule: SaScoreMoleculeResultView, method: SaScoreMethod): string {
    const rawValue: number | null =
      method === 'ambit'
        ? molecule.ambit_sa
        : method === 'brsa'
          ? molecule.brsa_sa
          : molecule.rdkit_sa;

    if (rawValue === null) {
      return '-';
    }

    return rawValue.toFixed(4);
  }

  methodError(molecule: SaScoreMoleculeResultView, method: SaScoreMethod): string | null {
    return method === 'ambit'
      ? molecule.ambit_error
      : method === 'brsa'
        ? molecule.brsa_error
        : molecule.rdkit_error;
  }

  private downloadFile(filename: string, blob: Blob): void {
    const objectUrl: string = URL.createObjectURL(blob);
    const linkElement: HTMLAnchorElement = document.createElement('a');

    linkElement.href = objectUrl;
    linkElement.download = filename;
    linkElement.click();

    URL.revokeObjectURL(objectUrl);
  }
}
