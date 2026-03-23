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
  JobLogEntryView,
  JobsApiService,
  ScientificJobView,
  ToxicityMoleculeResultView,
} from '../core/api/jobs-api.service';
import { ToxicityPropertiesWorkflowService } from '../core/application/toxicity-properties-workflow.service';

@Component({
  selector: 'app-toxicity-properties',
  standalone: true,
  imports: [CommonModule, FormsModule],
  providers: [ToxicityPropertiesWorkflowService],
  templateUrl: './toxicity-properties.component.html',
  styleUrl: './toxicity-properties.component.scss',
})
export class ToxicityPropertiesComponent implements OnInit, OnDestroy {
  readonly workflow = inject(ToxicityPropertiesWorkflowService);
  private readonly route = inject(ActivatedRoute);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly jobsApi = inject(JobsApiService);
  private routeSubscription: Subscription | null = null;

  @ViewChild('sketchDialog')
  private sketchDialogRef?: ElementRef<HTMLDialogElement>;

  @ViewChild('ketcherFrame')
  private ketcherFrameRef?: ElementRef<HTMLIFrameElement>;

  @ViewChild('moleculeImageDialog')
  private moleculeImageDialogRef?: ElementRef<HTMLDialogElement>;

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

  exportCsv(): void {
    this.workflow.downloadCsvReport().subscribe({
      next: (downloadedFile: DownloadedReportFile) => {
        this.downloadFile(downloadedFile.filename, downloadedFile.blob);
      },
      error: () => {},
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

  onSketchDialogBackdropClick(event: MouseEvent): void {
    const dialog: HTMLDialogElement | undefined = this.sketchDialogRef?.nativeElement;
    if (dialog === undefined) {
      return;
    }

    const rect: DOMRect = dialog.getBoundingClientRect();
    const isOutside: boolean =
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom;
    if (isOutside) {
      this.closeSketchDialog();
    }
  }

  onKetcherFrameLoaded(): void {
    this.isKetcherReady = true;
    this.syncSketchLoadingVisibility();
  }

  async applySketch(): Promise<void> {
    const api: KetcherApi | null = await this.waitForKetcherApi();
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

  private async waitForKetcherApi(maxAttempts: number = 20): Promise<KetcherApi | null> {
    const iframe: HTMLIFrameElement | undefined = this.ketcherFrameRef?.nativeElement;
    if (iframe === undefined) {
      return null;
    }

    for (let attempt: number = 0; attempt < maxAttempts; attempt++) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const windowValue: any = iframe.contentWindow;
        const api = windowValue?.['ketcher'] as KetcherApi | undefined;
        if (api !== undefined) {
          return api;
        }
      } catch {
        // Protección cross-origin.
      }
      await new Promise<void>((resolve: () => void) => setTimeout(resolve, 50));
    }

    return null;
  }

  private async ensureKetcherReady(): Promise<void> {
    if (this.isKetcherReady) {
      this.syncSketchLoadingVisibility();
      return;
    }

    const api: KetcherApi | null = await this.waitForKetcherApi(120);
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

    const reader: FileReader = new FileReader();
    reader.onload = (readerEvent: ProgressEvent<FileReader>): void => {
      const rawContent: string = (readerEvent.target?.result as string) ?? '';
      const smilesLines: string[] = rawContent
        .split(/\r?\n/)
        .map((lineValue: string) => lineValue.trim())
        .filter((lineValue: string) => lineValue.length > 0 && !lineValue.startsWith('#'));
      this.workflow.smilesInput.set(smilesLines.join('\n'));
    };
    reader.readAsText(file);

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

  onMoleculeImageDialogBackdropClick(event: MouseEvent): void {
    const dialog: HTMLDialogElement | undefined = this.moleculeImageDialogRef?.nativeElement;
    if (dialog === undefined) {
      return;
    }
    const rect: DOMRect = dialog.getBoundingClientRect();
    const isOutside: boolean =
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom;
    if (isOutside) {
      dialog.close();
    }
  }

  rowHasError(molecule: ToxicityMoleculeResultView): boolean {
    return molecule.error_message !== null && molecule.error_message.trim() !== '';
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

type KetcherApi = {
  getSmiles: () => Promise<string>;
  setMolecule: (molecule: string) => Promise<void>;
};
