// smiles-molecules-base.component.ts: Clase base abstracta para componentes de apps SMILES con
// sketch Ketcher integrado y modal de imagen molecular. Compartida por SaScoreComponent y
// ToxicityPropertiesComponent. Los subcomponentes deben implementar workflowSmilesInput.

import {
  Directive,
  ElementRef,
  OnDestroy,
  OnInit,
  Signal,
  ViewChild,
  WritableSignal,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DomSanitizer, SafeHtml, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { JobsApiService } from '../api/jobs-api.service';
import { KetcherFrameService } from '../application/ketcher-frame.service';
import {
  HistoricalJobWorkflowPort,
  NamedSmilesInputRow,
  SmilesMoleculeWorkflowPort,
  buildSmilesTextFromRows,
  closeDialogOnBackdropClick,
  parseNamedSmilesBatch,
  subscribeToRouteHistoricalJob,
} from './scientific-app-ui.utils';

/**
 * Clase base que proporciona el comportamiento compartido del sketch Ketcher,
 * el modal de imagen molecular y la carga de archivos SMILES.
 *
 * Uso: extender esta clase en el componente concreto e implementar
 * `workflowSmilesInput` retornando la señal de entrada del workflow.
 */
@Directive()
export abstract class SmilesMoleculesBaseComponent implements OnInit, OnDestroy {
  protected readonly sanitizer = inject(DomSanitizer);
  protected readonly jobsApi = inject(JobsApiService);
  protected readonly ketcherFrameService = inject(KetcherFrameService);
  protected readonly route = inject(ActivatedRoute);

  // ---------------------------------------------------------------------------
  // Referencias al DOM para los diálogos
  // ---------------------------------------------------------------------------

  @ViewChild('sketchDialog')
  protected readonly sketchDialogRef?: ElementRef<HTMLDialogElement>;

  @ViewChild('ketcherFrame')
  protected readonly ketcherFrameRef?: ElementRef<HTMLIFrameElement>;

  @ViewChild('moleculeImageDialog')
  protected readonly moleculeImageDialogRef?: ElementRef<HTMLDialogElement>;

  // ---------------------------------------------------------------------------
  // Estado del sketch Ketcher
  // ---------------------------------------------------------------------------

  readonly ketcherPublicUrl: SafeResourceUrl =
    this.sanitizer.bypassSecurityTrustResourceUrl('/ketcher/index.html');

  sketchDraftSmiles: string = '';
  isKetcherReady: boolean = false;
  readonly isSketchDialogLoading = signal<boolean>(false);
  private hasCompletedFirstSketchLoad: boolean = false;

  // ---------------------------------------------------------------------------
  // Estado del modal de imagen de molécula
  // ---------------------------------------------------------------------------

  readonly moleculeModalSvg = signal<SafeHtml | null>(null);
  readonly moleculeModalSmiles = signal<string>('');
  readonly isLoadingMoleculeImage = signal<boolean>(false);
  readonly moleculeImageError = signal<string | null>(null);

  // ---------------------------------------------------------------------------
  // Suscripción de ruta
  // ---------------------------------------------------------------------------

  protected routeSubscription: Subscription | null = null;

  // ---------------------------------------------------------------------------
  // Computed que el subcomponente puede usar directamente en su template
  // ---------------------------------------------------------------------------

  /** Número de filas SMILES válidas (sin blancos) en la entrada actual. */
  readonly lineCount: Signal<number> = computed<number>(() => {
    return this.workflowSmilesInput()
      .split(/\r?\n/)
      .map((line: string) => line.trim())
      .filter((line: string) => line.length > 0).length;
  });

  // ---------------------------------------------------------------------------
  // Contrato con el subcomponente
  // ---------------------------------------------------------------------------

  /** Retorna la señal de texto SMILES del workflow concreto. */
  protected abstract get workflowSmilesInput(): WritableSignal<string>;

  /** Retorna la señal de filas parseadas name/smiles del workflow concreto. */
  protected abstract get workflowInputRows(): WritableSignal<NamedSmilesInputRow[]>;

  /** Retorna la señal que controla la edición de nombres personalizados. */
  protected abstract get workflowCustomNamesEnabled(): WritableSignal<boolean>;

  /**
   * Retorna el workflow del componente concreto con operaciones compartidas de UI.
   * Implementar retornando `this.workflow`.
   */
  protected abstract readonly workflow: SmilesMoleculeWorkflowPort;

  // ---------------------------------------------------------------------------
  // Ciclo de vida
  // ---------------------------------------------------------------------------

  ngOnInit(): void {
    this.routeSubscription = subscribeToRouteHistoricalJob(this.route, this.workflowPort);
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
  }

  /**
   * Retorna el workflow del componente concreto como HistoricalJobWorkflowPort.
   * Implementar retornando `this.workflow`.
   */
  protected get workflowPort(): HistoricalJobWorkflowPort {
    return this.workflow;
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

  // ---------------------------------------------------------------------------
  // Clase CSS para el badge de estado en historial
  // ---------------------------------------------------------------------------

  historicalStatusClass(jobStatus: string | undefined): string {
    return `history-status history-${jobStatus ?? 'unknown'}`;
  }

  // ---------------------------------------------------------------------------
  // Sketch dialog (Ketcher)
  // ---------------------------------------------------------------------------

  /** Abre el diálogo del sketcher Ketcher para dibujar un SMILES. */
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

  /** Cierra el diálogo del sketcher sin aplicar cambios. */
  closeSketchDialog(): void {
    this.isSketchDialogLoading.set(false);
    this.sketchDialogRef?.nativeElement.close();
  }

  /** Cierra el diálogo al hacer click en el backdrop (fuera del modal). */
  onSketchDialogBackdropClick(event: MouseEvent | KeyboardEvent): void {
    closeDialogOnBackdropClick(event, this.sketchDialogRef?.nativeElement, () => {
      this.closeSketchDialog();
    });
  }

  /** Marca el iframe de Ketcher como listo y carga el SMILES actual si existe. */
  onKetcherFrameLoaded(): void {
    this.isKetcherReady = true;
    this.syncSketchLoadingVisibility();
  }

  /** Aplica el SMILES del sketcher: intenta leerlo de Ketcher (con polling), si no usa el textarea. */
  async applySketch(): Promise<void> {
    const api = await this.ketcherFrameService.waitForApi(this.ketcherFrameRef?.nativeElement);
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

    const nextRows: NamedSmilesInputRow[] = [
      ...this.workflowInputRows(),
      { name: smilesLine, smiles: smilesLine },
    ];
    this.workflowInputRows.set(nextRows);
    this.workflowSmilesInput.set(buildSmilesTextFromRows(nextRows));
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

    void file.text().then((rawContent: string) => {
      const parsedBatch = parseNamedSmilesBatch(rawContent);
      this.workflowInputRows.set(parsedBatch.rows);
      this.workflowSmilesInput.set(buildSmilesTextFromRows(parsedBatch.rows));
      if (parsedBatch.containsExplicitNames) {
        this.workflowCustomNamesEnabled.set(true);
      }
    });

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
        this.moleculeModalSvg.set(this.sanitizer.bypassSecurityTrustHtml(inspection.svg)); // NOSONAR: S6268 - el SVG proviene del backend interno validado, nunca de entrada directa del usuario
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
  onMoleculeImageDialogBackdropClick(event: MouseEvent | KeyboardEvent): void {
    closeDialogOnBackdropClick(event, this.moleculeImageDialogRef?.nativeElement, () => {
      this.closeMoleculeImageModal();
    });
  }
}
