// toxicity-properties.component.ts: Pantalla principal de Toxicity Properties con
// entrada de SMILES, sketch molecular, carga de archivos, tabla fija y export CSV.

import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import {
  DownloadedReportFile,
  JobsApiService,
  ScientificJobView,
  ToxicityMoleculeResultView,
} from '../core/api/jobs-api.service';
import { KetcherFrameService } from '../core/application/ketcher-frame.service';
import { ToxicityPropertiesWorkflowService } from '../core/application/toxicity-properties-workflow.service';
import {
  closeDialogOnBackdropClick,
  downloadBlobFile,
  parseSmilesLines,
  subscribeToRouteHistoricalJob,
} from '../core/shared/scientific-app-ui.utils';
import { JobLogsPanelComponent } from '../core/shared/components/job-logs-panel/job-logs-panel.component';
import { JobProgressCardComponent } from '../core/shared/components/job-progress-card/job-progress-card.component';

@Component({
  selector: 'app-toxicity-properties',
  standalone: true,
  imports: [CommonModule, FormsModule, JobProgressCardComponent, JobLogsPanelComponent],
  providers: [ToxicityPropertiesWorkflowService],
  templateUrl: './toxicity-properties.component.html',
  styleUrl: './toxicity-properties.component.scss',
})
export class ToxicityPropertiesComponent implements OnInit, OnDestroy {
  readonly workflow = inject(ToxicityPropertiesWorkflowService);
  private readonly route = inject(ActivatedRoute);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly jobsApi = inject(JobsApiService);
  private readonly ketcherFrameService = inject(KetcherFrameService);
  private routeSubscription: Subscription | null = null;

  @ViewChild('sketchDialog')
  private readonly sketchDialogRef?: ElementRef<HTMLDialogElement>;

  @ViewChild('ketcherFrame')
  private readonly ketcherFrameRef?: ElementRef<HTMLIFrameElement>;

  @ViewChild('moleculeImageDialog')
  private readonly moleculeImageDialogRef?: ElementRef<HTMLDialogElement>;

  readonly ketcherPublicUrl: SafeResourceUrl;
  readonly moleculeModalSvg = signal<SafeHtml | null>(null);
  readonly moleculeModalSmiles = signal<string>('');
  readonly isLoadingMoleculeImage = signal<boolean>(false);
  readonly moleculeImageError = signal<string | null>(null);

  sketchDraftSmiles: string = '';
  isKetcherReady: boolean = false;
  readonly isSketchDialogLoading = signal<boolean>(false);
  private hasCompletedFirstSketchLoad: boolean = false;

  readonly lineCount = computed<number>(() => {
    const normalizedRows: string[] = this.workflow
      .smilesInput()
      .split(/\r?\n/)
      .map((lineValue: string) => lineValue.trim())
      .filter((lineValue: string) => lineValue.length > 0);
    return normalizedRows.length;
  });

  constructor() {
    this.ketcherPublicUrl = this.sanitizer.bypassSecurityTrustResourceUrl('/ketcher/index.html');
  }

  ngOnInit(): void {
    this.routeSubscription = subscribeToRouteHistoricalJob(this.route, this.workflow);
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

  exportCsv(): void {
    this.workflow.downloadCsvReport().subscribe({
      next: (downloadedFile: DownloadedReportFile) => {
        downloadBlobFile(downloadedFile.filename, downloadedFile.blob);
      },
      error: () => {},
    });
  }

  historicalStatusClass(jobStatus: ScientificJobView['status']): string {
    return `history-status history-${jobStatus}`;
  }

  formatDecimal(value: number | null, digits: number = 4): string {
    if (value === null) {
      return '-';
    }
    return value.toFixed(digits);
  }

  openSketchDialog(): void {
    this.sketchDraftSmiles = '';
    if (!this.hasCompletedFirstSketchLoad) {
      this.startSketchLoadingPhase();
    }
    void this.ensureKetcherReady();
    const dialog: HTMLDialogElement | undefined = this.sketchDialogRef?.nativeElement;
    if (dialog !== undefined) {
      dialog.showModal();
    }
  }

  closeSketchDialog(): void {
    this.isSketchDialogLoading.set(false);
    this.sketchDialogRef?.nativeElement.close();
  }

  onSketchDialogBackdropClick(event: MouseEvent | KeyboardEvent): void {
    closeDialogOnBackdropClick(event, this.sketchDialogRef?.nativeElement, () => {
      this.closeSketchDialog();
    });
  }

  onKetcherFrameLoaded(): void {
    this.isKetcherReady = true;
    this.syncSketchLoadingVisibility();
  }

  async applySketch(): Promise<void> {
    const api = await this.ketcherFrameService.waitForApi(this.ketcherFrameRef?.nativeElement);
    if (api !== null) {
      try {
        const ketcherSmiles: string = await api.getSmiles();
        if (ketcherSmiles.trim() !== '') {
          this.sketchDraftSmiles = ketcherSmiles.trim();
        }
      } catch {
        // Se mantiene fallback en textarea manual.
      }
    }

    const smilesLine: string = this.sketchDraftSmiles.trim();
    if (smilesLine === '') {
      this.closeSketchDialog();
      return;
    }

    const current: string = this.workflow.smilesInput().trimEnd();
    const updated: string = current.length > 0 ? `${current}\n${smilesLine}` : smilesLine;
    this.workflow.smilesInput.set(updated);
    this.closeSketchDialog();
  }

  private async ensureKetcherReady(): Promise<void> {
    if (this.isKetcherReady) {
      this.syncSketchLoadingVisibility();
      return;
    }

    const api = await this.ketcherFrameService.waitForApi(this.ketcherFrameRef?.nativeElement, 120);
    if (api !== null) {
      this.isKetcherReady = true;
      this.syncSketchLoadingVisibility();
    }
  }

  private startSketchLoadingPhase(): void {
    this.isSketchDialogLoading.set(!this.isKetcherReady);
    this.syncSketchLoadingVisibility();
  }

  private syncSketchLoadingVisibility(): void {
    const mustKeepLoading: boolean = !this.isKetcherReady;
    this.isSketchDialogLoading.set(mustKeepLoading);
    if (!mustKeepLoading) {
      this.hasCompletedFirstSketchLoad = true;
    }
  }

  onFileUpload(event: Event): void {
    const input: HTMLInputElement = event.target as HTMLInputElement;
    const file: File | undefined = input.files?.[0];
    if (file === undefined) {
      return;
    }

    void file.text().then((rawContent: string) => {
      this.workflow.smilesInput.set(parseSmilesLines(rawContent));
    });

    input.value = '';
  }

  openMoleculeImageModal(smiles: string): void {
    if (smiles.trim() === '') {
      return;
    }
    this.moleculeModalSmiles.set(smiles);
    this.moleculeModalSvg.set(null);
    this.moleculeImageError.set(null);
    this.isLoadingMoleculeImage.set(true);

    const dialog: HTMLDialogElement | undefined = this.moleculeImageDialogRef?.nativeElement;
    if (dialog !== undefined) {
      dialog.showModal();
    }

    this.jobsApi.inspectSmileitStructure(smiles).subscribe({
      next: (inspection) => {
        this.moleculeModalSvg.set(this.sanitizer.bypassSecurityTrustHtml(inspection.svg));
        this.isLoadingMoleculeImage.set(false);
      },
      error: () => {
        this.moleculeImageError.set('Could not load molecule image.');
        this.isLoadingMoleculeImage.set(false);
      },
    });
  }

  closeMoleculeImageModal(): void {
    this.moleculeImageDialogRef?.nativeElement.close();
  }

  onMoleculeImageDialogBackdropClick(event: MouseEvent | KeyboardEvent): void {
    closeDialogOnBackdropClick(event, this.moleculeImageDialogRef?.nativeElement, () => {
      this.closeMoleculeImageModal();
    });
  }

  rowHasError(molecule: ToxicityMoleculeResultView): boolean {
    return molecule.error_message !== null && molecule.error_message.trim() !== '';
  }

}
