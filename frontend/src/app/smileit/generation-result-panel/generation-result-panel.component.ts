// generation-result-panel.component.ts: Panel de generación continua, historial y resultados de derivados para Smile-it.

import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { TranslocoPipe } from '@jsverse/transloco';
import { DownloadedReportFile, ScientificJobView } from '../../core/api/jobs-api.service';
import {
  SmileitGeneratedStructureView,
  SmileitWorkflowService,
} from '../../core/application/smileit-workflow.service';
import { JobProgressCardComponent } from '../../core/shared/components/job-progress-card/job-progress-card.component';
import { GenerationResultDataService } from './generation-result-data.service';
import {
  buildDerivativeDisplayName,
  buildHistoricalJobDisplayName,
  resolveJobNameLabel,
} from './generation-result-naming.utils';

@Component({
  selector: 'app-generation-result-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, JobProgressCardComponent, TranslocoPipe],
  providers: [GenerationResultDataService],
  templateUrl: './generation-result-panel.component.html',
  styleUrl: './generation-result-panel.component.scss',
})
export class GenerationResultPanelComponent {
  readonly workflow = inject(SmileitWorkflowService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly resultDataService = inject(GenerationResultDataService);

  readonly selectedGeneratedStructure = signal<SmileitGeneratedStructureView | null>(null);
  readonly isGeneratedStructuresCollapsed = this.resultDataService.isGeneratedStructuresCollapsed;
  readonly visibleGeneratedStructures = this.resultDataService.visibleGeneratedStructures;
  readonly hasMoreGeneratedStructures = this.resultDataService.hasMoreGeneratedStructures;
  readonly isLoadingGeneratedStructures = this.resultDataService.isLoadingGeneratedStructures;
  readonly isPreparingImagesZip = this.resultDataService.isPreparingImagesZip;
  readonly imagesZipProgress = this.resultDataService.imagesZipProgress;
  readonly visibleHistoryJobs = computed<ScientificJobView[]>(() => {
    const selectedHistoricalJobId = this.workflow.selectedHistoricalJobId();
    const currentJobId = this.workflow.currentJobId();

    return this.workflow
      .historyJobs()
      .filter(
        (historyJob: ScientificJobView) =>
          !(
            selectedHistoricalJobId === null &&
            currentJobId !== null &&
            historyJob.id === currentJobId
          ),
      );
  });
  readonly isShowingCurrentResultBelow = computed<boolean>(
    () => this.workflow.currentJobId() !== null && this.workflow.selectedHistoricalJobId() === null,
  );

  @ViewChild('generatedStructureDialog')
  private readonly generatedStructureDialogRef?: ElementRef<HTMLDialogElement>;

  dispatch(): void {
    this.workflow.dispatch();
  }

  reset(): void {
    this.workflow.reset();
  }

  openHistoricalJob(jobId: string): void {
    this.workflow.openHistoricalJob(jobId);
  }

  deleteHistoricalJob(jobId: string): void {
    this.workflow.deleteHistoryJob(jobId);
  }

  toggleGeneratedStructuresCollapse(): void {
    this.resultDataService.toggleGeneratedStructuresCollapse();
  }

  showMoreStructures(): void {
    this.resultDataService.showMoreStructures();
  }

  async downloadVisibleStructuresZip(): Promise<void> {
    await this.resultDataService.downloadVisibleStructuresZip();
  }

  exportCsv(): void {
    this.downloadReport(this.workflow.downloadCsvReport.bind(this.workflow));
  }

  exportSmiles(): void {
    this.downloadReport(this.workflow.downloadSmilesReport.bind(this.workflow));
  }

  exportLog(): void {
    this.downloadReport(this.workflow.downloadLogReport.bind(this.workflow));
  }

  readonly toNumber = Number;

  historicalStatusClass(jobStatus: ScientificJobView['status']): string {
    return `history-status history-${jobStatus}`;
  }

  isHistoricalJobSelected(jobId: string): boolean {
    return this.workflow.selectedHistoricalJobId() === jobId;
  }

  historicalJobViewStateLabel(jobId: string): string {
    return this.isHistoricalJobSelected(jobId) ? 'Viewing below' : 'Available';
  }

  historicalJobViewStateClass(jobId: string): string {
    return this.isHistoricalJobSelected(jobId)
      ? 'job-view-state is-viewing'
      : 'job-view-state is-available';
  }

  historicalJobDisplayName(historyJob: ScientificJobView): string {
    const jobParameters = historyJob.parameters as Record<string, unknown> | null;
    const exportBaseName = jobParameters?.['export_name_base'];
    if (typeof exportBaseName === 'string' && exportBaseName.trim() !== '') {
      return buildHistoricalJobDisplayName(exportBaseName, historyJob.id);
    }
    return buildHistoricalJobDisplayName('job', historyJob.id);
  }

  historicalJobPrincipalSmiles(historyJob: ScientificJobView): string {
    const jobParameters = historyJob.parameters as Record<string, unknown> | null;
    const principalSmiles = jobParameters?.['principal_smiles'];
    if (typeof principalSmiles === 'string' && principalSmiles.trim() !== '') {
      return principalSmiles;
    }
    return 'Principal SMILES not available';
  }

  historicalJobUpdatedAt(historyJob: ScientificJobView): string | null {
    return historyJob.updated_at ?? historyJob.created_at ?? null;
  }

  canDeleteHistoricalJob(historyJob: ScientificJobView): boolean {
    return (
      historyJob.status === 'completed' ||
      historyJob.status === 'failed' ||
      historyJob.status === 'cancelled'
    );
  }

  historicalJobBlockSummaries(
    historyJob: ScientificJobView,
  ): Array<{ label: string; positions: string; smiles: string }> {
    const jobParameters = historyJob.parameters as Record<string, unknown> | null;
    const rawBlocks = jobParameters?.['assignment_blocks'];
    if (!Array.isArray(rawBlocks)) {
      return [];
    }

    return rawBlocks.map((rawBlock: unknown, blockIndex: number) => {
      const normalizedBlock =
        rawBlock !== null && typeof rawBlock === 'object'
          ? (rawBlock as Record<string, unknown>)
          : ({} as Record<string, unknown>);

      const blockLabel =
        typeof normalizedBlock['label'] === 'string' && normalizedBlock['label'].trim() !== ''
          ? normalizedBlock['label']
          : `Block ${blockIndex + 1}`;

      const rawPositions = normalizedBlock['site_atom_indices'];
      const positions = Array.isArray(rawPositions)
        ? rawPositions
            .map(String)
            .filter((positionValue: string) => positionValue.trim() !== '')
            .join(', ')
        : 'Not assigned';

      const rawResolvedSubstituents = normalizedBlock['resolved_substituents'];
      const uniqueSmiles = new Set<string>();
      if (Array.isArray(rawResolvedSubstituents)) {
        rawResolvedSubstituents.forEach((rawSubstituent: unknown) => {
          if (rawSubstituent === null || typeof rawSubstituent !== 'object') {
            return;
          }
          const substituentSmiles = (rawSubstituent as Record<string, unknown>)['smiles'];
          if (typeof substituentSmiles === 'string' && substituentSmiles.trim() !== '') {
            uniqueSmiles.add(substituentSmiles.trim());
          }
        });
      }

      return {
        label: blockLabel,
        positions,
        smiles: uniqueSmiles.size > 0 ? [...uniqueSmiles].join(' | ') : 'No substituent SMILES',
      };
    });
  }

  structureDisplayName(structure: SmileitGeneratedStructureView, index: number): string {
    const structureOrdinal = (structure.structureIndex ?? index) + 1;
    return buildDerivativeDisplayName(this.currentResultJobName(), structureOrdinal);
  }

  scaffoldLegendLabel(): string {
    return resolveJobNameLabel(this.currentResultJobName());
  }

  placeholderAssignmentsForStructure(structure: SmileitGeneratedStructureView): Array<{
    placeholderLabel: string;
    siteAtomIndex: number;
    substituentName: string;
    substituentSmiles?: string;
  }> {
    return structure.placeholderAssignments;
  }

  placeholderAssignmentLabel(
    structure: SmileitGeneratedStructureView,
    placeholderAssignment: {
      placeholderLabel: string;
      siteAtomIndex: number;
      substituentName: string;
      substituentSmiles?: string;
    },
  ): string {
    const substituentDescriptor =
      placeholderAssignment.substituentSmiles?.trim() === ''
        ? placeholderAssignment.substituentName
        : placeholderAssignment.substituentSmiles?.trim();
    const duplicateAssignments = this.placeholderAssignmentsForStructure(structure).filter(
      (assignmentItem) => assignmentItem.siteAtomIndex === placeholderAssignment.siteAtomIndex,
    );
    const siteSuffix = duplicateAssignments.length > 1 ? ' (reused site)' : '';
    return `${placeholderAssignment.placeholderLabel} = ${substituentDescriptor} · site ${placeholderAssignment.siteAtomIndex}${siteSuffix}`;
  }

  structurePlaceholderSummary(structure: SmileitGeneratedStructureView): string {
    const placeholderAssignments = this.placeholderAssignmentsForStructure(structure);
    if (placeholderAssignments.length === 0) {
      return 'No placeholder assignments available';
    }

    return placeholderAssignments
      .map((placeholderAssignment) =>
        this.placeholderAssignmentLabel(structure, placeholderAssignment),
      )
      .join(' | ');
  }

  getUniqueSubstituentsForStructure(structure: SmileitGeneratedStructureView): string[] {
    const uniqueNames: Set<string> = new Set(
      structure.traceability.map((traceEntry) => traceEntry.substituent_name),
    );
    return [...uniqueNames].slice(0, 4);
  }

  toTrustedSvg(svgMarkup: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(svgMarkup); // NOSONAR: S6268 - el SVG proviene del backend interno validado, nunca de entrada directa del usuario
  }

  openGeneratedStructureModal(generatedStructure: SmileitGeneratedStructureView): void {
    this.selectedGeneratedStructure.set(generatedStructure);
    void this.hydrateDetailSvg(generatedStructure);

    const dialog: HTMLDialogElement | undefined = this.generatedStructureDialogRef?.nativeElement;
    if (dialog === undefined) {
      return;
    }
    if (dialog.open) {
      dialog.close();
    }
    try {
      dialog.showModal();
    } catch {
      dialog.setAttribute('open', 'true');
    }
  }

  closeGeneratedStructureModal(): void {
    const dialog: HTMLDialogElement | undefined = this.generatedStructureDialogRef?.nativeElement;
    if (dialog?.open) {
      dialog.close();
    }
    this.selectedGeneratedStructure.set(null);
  }

  onGeneratedStructureDialogClick(event: Event): void {
    if (event.target === this.generatedStructureDialogRef?.nativeElement) {
      this.closeGeneratedStructureModal();
    }
  }

  private downloadReport(
    downloadFactory: () => ReturnType<SmileitWorkflowService['downloadCsvReport']>,
  ): void {
    downloadFactory().subscribe({
      next: (downloadedFile: DownloadedReportFile) => {
        this.downloadFile(downloadedFile.filename, downloadedFile.blob);
      },
      error: () => {
        // El workflow expone el mensaje de error para la UI.
      },
    });
  }

  private downloadFile(filename: string, blob: Blob): void {
    const objectUrl: string = URL.createObjectURL(blob);
    const linkElement: HTMLAnchorElement = document.createElement('a');

    linkElement.href = objectUrl;
    linkElement.download = filename;
    linkElement.click();

    URL.revokeObjectURL(objectUrl);
  }

  private async hydrateDetailSvg(generatedStructure: SmileitGeneratedStructureView): Promise<void> {
    const detailSvg = await this.resultDataService.resolveDetailSvg(generatedStructure);
    if (detailSvg === null || detailSvg.trim() === '') {
      return;
    }

    const updatedStructure: SmileitGeneratedStructureView = {
      ...generatedStructure,
      svg: detailSvg,
    };
    this.selectedGeneratedStructure.set(updatedStructure);
  }

  private currentResultJobName(): string {
    return this.workflow.resultData()?.exportNameBase ?? this.workflow.exportNameBase();
  }
}
