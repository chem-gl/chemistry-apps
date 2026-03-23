// sa-score.component.ts: Pantalla principal de SA Score con entrada de SMILES, sketch molecular,
// carga de archivos, visualización de imagen de molécula y exportes CSV.

import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  effect,
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
  private readonly sanitizer = inject(DomSanitizer);
  private readonly jobsApi = inject(JobsApiService);
  private routeSubscription: Subscription | null = null;

  // ---------------------------------------------------------------------------
  // Sketch dialog (Ketcher)
  // ---------------------------------------------------------------------------

  @ViewChild('sketchDialog')
  private sketchDialogRef?: ElementRef<HTMLDialogElement>;

  @ViewChild('ketcherFrame')
  private ketcherFrameRef?: ElementRef<HTMLIFrameElement>;

  readonly ketcherPublicUrl: SafeResourceUrl;
  sketchDraftSmiles: string = '';
  isKetcherReady: boolean = false;

  // ---------------------------------------------------------------------------
  // Molecule image modal
  // ---------------------------------------------------------------------------

  @ViewChild('moleculeImageDialog')
  private moleculeImageDialogRef?: ElementRef<HTMLDialogElement>;

  readonly moleculeModalSvg = signal<SafeHtml | null>(null);
  readonly moleculeModalSmiles = signal<string>('');
  readonly isLoadingMoleculeImage = signal<boolean>(false);
  readonly moleculeImageError = signal<string | null>(null);

  readonly methodItems = [
    { key: 'ambit' as SaScoreMethod, label: 'AMBIT SA' },
    { key: 'brsa' as SaScoreMethod, label: 'BRSAScore SA' },
    { key: 'rdkit' as SaScoreMethod, label: 'RDKit SA' },
  ];
  readonly selectedExportTarget = signal<ExportTarget>('all');

  readonly exportOptions = computed<ReadonlyArray<ExportOption>>(() => {
    const currentResultData = this.workflow.resultData();
    if (currentResultData === null) {
      return [];
    }

    const methodOptions: ExportOption[] = this.methodItems
      .filter((methodItem) => currentResultData.requestedMethods.includes(methodItem.key))
      .map((methodItem) => ({
        value: methodItem.key,
        label: `${methodItem.label} CSV`,
      }));

    return [{ value: 'all', label: 'All methods CSV' }, ...methodOptions];
  });

  constructor() {
    this.ketcherPublicUrl = this.sanitizer.bypassSecurityTrustResourceUrl('/ketcher/index.html');

    effect(() => {
      const availableOptions = this.exportOptions();
      if (availableOptions.length === 0) {
        return;
      }

      const selectedTarget = this.selectedExportTarget();
      const hasSelectedTarget = availableOptions.some((option) => option.value === selectedTarget);
      if (!hasSelectedTarget) {
        this.selectedExportTarget.set('all');
      }
    });
  }

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
      error: () => {},
    });
  }

  exportMethodCsv(method: SaScoreMethod): void {
    this.workflow.downloadMethodCsvReport(method).subscribe({
      next: (downloadedFile: DownloadedReportFile) => {
        this.downloadFile(downloadedFile.filename, downloadedFile.blob);
      },
      error: () => {},
    });
  }

  exportCsv(): void {
    const exportTarget: ExportTarget = this.selectedExportTarget();
    if (exportTarget === 'all') {
      this.exportAllCsv();
      return;
    }
    this.exportMethodCsv(exportTarget);
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

  // ---------------------------------------------------------------------------
  // Sketch dialog (Ketcher)
  // ---------------------------------------------------------------------------

  /** Abre el diálogo del sketcher Ketcher para dibujar un SMILES. */
  openSketchDialog(): void {
    this.sketchDraftSmiles = '';
    // No se resetea isKetcherReady: el iframe carga al montar la página y (load) no
    // vuelve a disparar en aperturas subsecuentes del diálogo.
    const dialog: HTMLDialogElement | undefined = this.sketchDialogRef?.nativeElement;
    if (dialog !== undefined) {
      dialog.showModal();
    }
  }

  /** Cierra el diálogo del sketcher sin aplicar cambios. */
  closeSketchDialog(): void {
    this.sketchDialogRef?.nativeElement.close();
  }

  /** Cierra el diálogo al hacer click en el backdrop (fuera del modal). */
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
      dialog.close();
    }
  }

  /** Marca el iframe de Ketcher como listo y carga el SMILES actual si existe. */
  onKetcherFrameLoaded(): void {
    this.isKetcherReady = true;
  }

  onSketchDraftSmilesChange(nextSmiles: string): void {
    this.sketchDraftSmiles = nextSmiles;
  }

  /** Aplica el SMILES del sketcher: intenta leerlo de Ketcher (con polling), si no usa el textarea. */
  async applySketch(): Promise<void> {
    const api: KetcherApi | null = await this.waitForKetcherApi();
    if (api !== null) {
      try {
        const ketcherSmiles: string = await api.getSmiles();
        if (ketcherSmiles.trim() !== '') {
          this.sketchDraftSmiles = ketcherSmiles.trim();
        }
      } catch {
        // fallback al textarea manual si Ketcher falla
      }
    }

    const smilesLine: string = this.sketchDraftSmiles.trim();
    if (smilesLine === '') {
      this.closeSketchDialog();
      return;
    }

    // Agrega el SMILES dibujado al textarea (nueva línea si ya hay contenido)
    const current: string = this.workflow.smilesInput().trimEnd();
    const updated: string = current.length > 0 ? `${current}\n${smilesLine}` : smilesLine;
    this.workflow.smilesInput.set(updated);
    this.closeSketchDialog();
  }

  /**
   * Espera hasta que el objeto `ketcher` esté disponible en el contentWindow del iframe.
   * Ketcher inicializa de forma asíncrona después del evento load, por lo que se usa
   * un polling de hasta 20 intentos (1 segundo total) antes de rendirse.
   */
  private async waitForKetcherApi(maxAttempts: number = 20): Promise<KetcherApi | null> {
    const iframe: HTMLIFrameElement | undefined = this.ketcherFrameRef?.nativeElement;
    if (iframe === undefined) {
      return null;
    }
    for (let attempt: number = 0; attempt < maxAttempts; attempt++) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const win: any = iframe.contentWindow;
        const api = win?.['ketcher'] as KetcherApi | undefined;
        if (api !== undefined) {
          return api;
        }
      } catch {
        // Protección cross-origin: si falla, continuar intentando
      }
      await new Promise<void>((resolve: () => void) => setTimeout(resolve, 50));
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Carga de archivo (.smi / .txt)
  // ---------------------------------------------------------------------------

  /** Maneja la carga de un archivo .smi o .txt y reemplaza el contenido del textarea. */
  onFileUpload(event: Event): void {
    const input: HTMLInputElement = event.target as HTMLInputElement;
    const file: File | undefined = input.files?.[0];
    if (file === undefined) {
      return;
    }

    const reader: FileReader = new FileReader();
    reader.onload = (readerEvent: ProgressEvent<FileReader>): void => {
      const rawContent: string = (readerEvent.target?.result as string) ?? '';
      // Filtra líneas vacías y comentarios (#) comunes en archivos .smi
      const smilesLines: string[] = rawContent
        .split(/\r?\n/)
        .map((line: string) => line.trim())
        .filter((line: string) => line.length > 0 && !line.startsWith('#'));
      this.workflow.smilesInput.set(smilesLines.join('\n'));
    };
    reader.readAsText(file);

    // Resetea el input para que el mismo archivo pueda volver a cargarse
    input.value = '';
  }

  // ---------------------------------------------------------------------------
  // Modal de imagen de molécula
  // ---------------------------------------------------------------------------

  /** Abre el modal de imagen para un SMILES del resultado. */
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

  /** Cierra el modal de imagen de molécula. */
  closeMoleculeImageModal(): void {
    this.moleculeImageDialogRef?.nativeElement.close();
  }

  /** Cierra el modal al hacer click en el backdrop. */
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

type ExportTarget = 'all' | SaScoreMethod;

type ExportOption = {
  value: ExportTarget;
  label: string;
};
