// scientific-app-ui.utils.ts: Utilidades compartidas de UI para apps científicas
// (historial por query param, descargas, backdrop de diálogos y parseo de SMILES).

import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';

export interface NamedSmilesInputRow {
  name: string;
  smiles: string;
}

export interface ParsedNamedSmilesBatch {
  rows: NamedSmilesInputRow[];
  containsExplicitNames: boolean;
}

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

function splitCsvLine(lineValue: string, delimiter: string): string[] {
  const cells: string[] = [];
  let currentCell: string = '';
  let insideQuotes: boolean = false;

  for (let index = 0; index < lineValue.length; index += 1) {
    const currentCharacter: string = lineValue[index] ?? '';
    const nextCharacter: string = lineValue[index + 1] ?? '';

    if (currentCharacter === '"') {
      if (insideQuotes && nextCharacter === '"') {
        currentCell += '"';
        index += 1;
        continue;
      }
      insideQuotes = !insideQuotes;
      continue;
    }

    if (!insideQuotes && currentCharacter === delimiter) {
      cells.push(currentCell.trim());
      currentCell = '';
      continue;
    }

    currentCell += currentCharacter;
  }

  cells.push(currentCell.trim());
  return cells;
}

function normalizeHeaderToken(rawValue: string): string {
  return rawValue
    .replace(/^\uFEFF+/, '')
    .trim()
    .toLowerCase()
    .replace(/^"|"$/g, '')
    .replace(/[\s_-]+/g, '');
}

function isSingleColumnHeaderLine(lineValue: string): boolean {
  const normalizedToken: string = normalizeHeaderToken(lineValue);
  return ['smiles', 'smile', 'smi', 'name', 'nombre', 'label'].includes(normalizedToken);
}

function detectStructuredDelimiter(lines: string[]): string | null {
  const supportedDelimiters: string[] = [',', ';', '\t'];
  for (const delimiter of supportedDelimiters) {
    const hasStructuredRow: boolean = lines.some(
      (lineValue: string) => splitCsvLine(lineValue, delimiter).length >= 2,
    );
    if (hasStructuredRow) {
      return delimiter;
    }
  }
  return null;
}

function isHeaderRow(cells: string[]): boolean {
  if (cells.length < 2) {
    return false;
  }

  const firstCell: string = normalizeHeaderToken(cells[0] ?? '');
  const secondCell: string = normalizeHeaderToken(cells[1] ?? '');
  const firstIsName: boolean = ['name', 'nombre', 'label'].includes(firstCell);
  const secondIsSmiles: boolean = ['smiles', 'smile', 'smi'].includes(secondCell);
  const firstIsSmiles: boolean = ['smiles', 'smile', 'smi'].includes(firstCell);
  const secondIsName: boolean = ['name', 'nombre', 'label'].includes(secondCell);
  return (firstIsName && secondIsSmiles) || (firstIsSmiles && secondIsName);
}

export function normalizeNamedSmilesRows(rows: NamedSmilesInputRow[]): NamedSmilesInputRow[] {
  return rows
    .map((rowValue: NamedSmilesInputRow) => {
      const normalizedSmiles: string = rowValue.smiles.trim();
      const normalizedNameCandidate: string = rowValue.name.trim();
      return {
        name: normalizedNameCandidate.length > 0 ? normalizedNameCandidate : normalizedSmiles,
        smiles: normalizedSmiles,
      };
    })
    .filter((rowValue: NamedSmilesInputRow) => rowValue.smiles.length > 0);
}

export function buildSmilesTextFromRows(rows: NamedSmilesInputRow[]): string {
  return normalizeNamedSmilesRows(rows)
    .map((rowValue: NamedSmilesInputRow) => rowValue.smiles)
    .join('\n');
}

export function parseNamedSmilesBatch(rawContent: string): ParsedNamedSmilesBatch {
  const normalizedLines: string[] = rawContent
    .split(/\r?\n/)
    .map((lineValue: string) => lineValue.replace(/^\uFEFF+/, '').trim())
    .filter((lineValue: string) => lineValue.length > 0 && !lineValue.startsWith('#'));

  if (normalizedLines.length === 0) {
    return { rows: [], containsExplicitNames: false };
  }

  const contentLines: string[] =
    normalizedLines.length > 1 && isSingleColumnHeaderLine(normalizedLines[0] ?? '')
      ? normalizedLines.slice(1)
      : normalizedLines;

  if (contentLines.length === 0) {
    return { rows: [], containsExplicitNames: false };
  }

  const detectedDelimiter: string | null = detectStructuredDelimiter(contentLines);
  if (detectedDelimiter === null) {
    const plainRows: NamedSmilesInputRow[] = contentLines.map((smilesValue: string) => ({
      name: smilesValue,
      smiles: smilesValue,
    }));
    return {
      rows: normalizeNamedSmilesRows(plainRows),
      containsExplicitNames: false,
    };
  }

  const firstRowCells: string[] = splitCsvLine(contentLines[0] ?? '', detectedDelimiter);
  const hasHeader: boolean = isHeaderRow(firstRowCells);
  const dataLines: string[] = hasHeader ? contentLines.slice(1) : contentLines;
  const parsedRows: NamedSmilesInputRow[] = dataLines.map((lineValue: string) => {
    const cells: string[] = splitCsvLine(lineValue, detectedDelimiter);
    const firstCell: string = cells[0] ?? '';
    const secondCell: string = cells[1] ?? '';
    if (cells.length < 2) {
      return { name: firstCell, smiles: firstCell };
    }

    if (
      hasHeader &&
      ['smiles', 'smile', 'smi'].includes(normalizeHeaderToken(firstRowCells[0] ?? ''))
    ) {
      return {
        name: secondCell,
        smiles: firstCell,
      };
    }

    return {
      name: firstCell,
      smiles: secondCell,
    };
  });

  return {
    rows: normalizeNamedSmilesRows(parsedRows),
    containsExplicitNames: true,
  };
}

export function parseSmilesLines(rawContent: string): string {
  return buildSmilesTextFromRows(parseNamedSmilesBatch(rawContent).rows);
}
