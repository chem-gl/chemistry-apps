// scientific-app-ui.utils.ts: Utilidades compartidas de UI para apps científicas
// (historial por query param, descargas, backdrop de diálogos y parseo de SMILES).

import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';

export interface HistoricalJobWorkflowPort {
  loadHistory(): void;
  openHistoricalJob(jobId: string): void;
}

export function subscribeToRouteHistoricalJob(
  route: ActivatedRoute,
  workflow: HistoricalJobWorkflowPort,
): Subscription {
  workflow.loadHistory();
  return route.queryParamMap.subscribe((paramsMap) => {
    const jobId: string | null = paramsMap.get('jobId');
    if (jobId !== null && jobId.trim() !== '') {
      workflow.openHistoricalJob(jobId);
    }
  });
}

export function downloadBlobFile(filename: string, blob: Blob): void {
  const objectUrl: string = URL.createObjectURL(blob);
  const anchorElement: HTMLAnchorElement = document.createElement('a');
  anchorElement.href = objectUrl;
  anchorElement.download = filename;
  anchorElement.click();
  URL.revokeObjectURL(objectUrl);
}

export function closeDialogOnBackdropClick(
  event: MouseEvent | KeyboardEvent,
  dialog: HTMLDialogElement | undefined,
  onOutsideClick: () => void,
): void {
  if (!(event instanceof MouseEvent) || dialog === undefined) {
    return;
  }

  const rect: DOMRect = dialog.getBoundingClientRect();
  const isOutside: boolean =
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom;
  if (isOutside) {
    onOutsideClick();
  }
}

export function parseSmilesLines(rawContent: string): string {
  const smilesLines: string[] = rawContent
    .split(/\r?\n/)
    .map((lineValue: string) => lineValue.trim())
    .filter((lineValue: string) => lineValue.length > 0 && !lineValue.startsWith('#'));
  return smilesLines.join('\n');
}
