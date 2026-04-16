// cadma-py-importer.component.ts: Importador guiado reutilizable para CSV y SMI en CADMA Py.

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

export type CadmaImportMode = 'reference' | 'candidate';
type CadmaFileFormat = 'csv' | 'smi';

export interface CadmaImportStateChange {
  sourceConfigsJson: string;
  totalFiles: number;
  totalUsableRows: number;
  filenames: string[];
}

interface SourcePreviewData {
  columns: string[];
  previewRows: string[][];
  usableRowCount: number;
  delimiter: string;
}

interface GuidedSourceConfig {
  id: string;
  filename: string;
  contentText: string;
  fileFormat: CadmaFileFormat;
  delimiter: string;
  hasHeader: boolean;
  skipLines: number;
  columns: string[];
  previewRows: string[][];
  usableRowCount: number;
  smilesColumn: string;
  nameColumn: string;
  paperReferenceColumn: string;
  paperUrlColumn: string;
  evidenceNoteColumn: string;
  dtColumn: string;
  mColumn: string;
  ld50Column: string;
  saColumn: string;
}

type ColumnRole =
  | ''
  | 'smiles'
  | 'name'
  | 'paperReference'
  | 'paperUrl'
  | 'evidenceNote'
  | 'dt'
  | 'm'
  | 'ld50'
  | 'sa';

type MappedColumnProperty =
  | 'smilesColumn'
  | 'nameColumn'
  | 'paperReferenceColumn'
  | 'paperUrlColumn'
  | 'evidenceNoteColumn'
  | 'dtColumn'
  | 'mColumn'
  | 'ld50Column'
  | 'saColumn';

const ROLE_TO_PROPERTY: Record<Exclude<ColumnRole, ''>, MappedColumnProperty> = {
  smiles: 'smilesColumn',
  name: 'nameColumn',
  paperReference: 'paperReferenceColumn',
  paperUrl: 'paperUrlColumn',
  evidenceNote: 'evidenceNoteColumn',
  dt: 'dtColumn',
  m: 'mColumn',
  ld50: 'ld50Column',
  sa: 'saColumn',
};

const COLUMN_HINTS: Record<string, string[]> = {
  smiles: ['smiles', 'smile', 'smi'],
  name: ['name', 'compound', 'label', 'nombre'],
  paperReference: ['paper', 'reference', 'citation', 'source'],
  paperUrl: ['doi', 'url', 'link'],
  evidenceNote: ['note', 'notes', 'comment', 'comments', 'evidence'],
  dt: ['dt', 'devtox', 'developmental'],
  m: ['m', 'mutagenicity', 'ames'],
  ld50: ['ld50'],
  sa: ['sa', 'sascore', 'synthetic'],
};

function normalizeToken(rawValue: string): string {
  return rawValue
    .replaceAll('\uFEFF', '')
    .trim()
    .toLowerCase()
    .replaceAll('"', '')
    .replaceAll(/[^a-z0-9]+/g, '');
}

function splitDelimitedLine(lineValue: string, delimiter: string): string[] {
  const cells: string[] = [];
  let currentCell = '';
  let insideQuotes = false;

  for (let index = 0; index < lineValue.length; index += 1) {
    const currentCharacter = lineValue[index] ?? '';
    const nextCharacter = lineValue[index + 1] ?? '';

    if (currentCharacter === '"') {
      if (insideQuotes && nextCharacter === '"') {
        currentCell += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
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

function detectDelimiter(lines: string[]): string {
  const candidates: string[] = [',', ';', '\t'];
  let bestDelimiter = ',';
  let bestScore = 1;

  for (const delimiter of candidates) {
    const score = lines.reduce((currentBest: number, lineValue: string) => {
      const cellCount = splitDelimitedLine(lineValue, delimiter).length;
      return Math.max(currentBest, cellCount);
    }, 1);
    if (score > bestScore) {
      bestScore = score;
      bestDelimiter = delimiter;
    }
  }

  return bestDelimiter;
}

function inferSkipLines(rawContent: string): number {
  const rawLines = rawContent.replaceAll('\r', '').split('\n');
  let skipLines = 0;
  for (const lineValue of rawLines) {
    const normalizedLine = lineValue.trim();
    if (normalizedLine === '' || normalizedLine.startsWith('#')) {
      skipLines += 1;
      continue;
    }
    break;
  }
  return skipLines;
}

function inferFormat(filename: string): CadmaFileFormat {
  return filename.toLowerCase().endsWith('.smi') ? 'smi' : 'csv';
}

function inferDefaultHeader(format: CadmaFileFormat): boolean {
  return format === 'csv';
}

function inferColumn(columns: string[], aliasKey: keyof typeof COLUMN_HINTS): string {
  const hints = COLUMN_HINTS[aliasKey].map((hint) => normalizeToken(hint));

  for (const columnName of columns) {
    const normalizedColumn = normalizeToken(columnName);
    if (hints.includes(normalizedColumn)) {
      return columnName;
    }
  }

  for (const columnName of columns) {
    const normalizedColumn = normalizeToken(columnName);
    if (
      hints.some(
        (hint) =>
          hint.length >= 3 &&
          (normalizedColumn.startsWith(hint) ||
            normalizedColumn.endsWith(hint) ||
            normalizedColumn.includes(hint)),
      )
    ) {
      return columnName;
    }
  }

  return '';
}

function parseCsvPreview(
  rawContent: string,
  hasHeader: boolean,
  skipLines: number,
  delimiter: string,
): SourcePreviewData {
  const preparedLines = rawContent
    .replaceAll('\r', '')
    .split('\n')
    .slice(skipLines)
    .map((lineValue) => lineValue.trim())
    .filter((lineValue) => lineValue !== '' && !lineValue.startsWith('#'));

  if (preparedLines.length === 0) {
    return { columns: [], previewRows: [], usableRowCount: 0, delimiter };
  }

  const resolvedDelimiter = delimiter || detectDelimiter(preparedLines);
  const rawRows = preparedLines.map((lineValue) =>
    splitDelimitedLine(lineValue, resolvedDelimiter),
  );
  const maxColumns = rawRows.reduce(
    (currentMax, rowValue) => Math.max(currentMax, rowValue.length),
    0,
  );

  const columns = hasHeader
    ? (rawRows[0] ?? []).map((columnName, index) => columnName.trim() || `column${index + 1}`)
    : Array.from({ length: maxColumns }, (_, index) => `column${index + 1}`);
  const dataRows = hasHeader ? rawRows.slice(1) : rawRows;

  return {
    columns,
    previewRows: dataRows.slice(0, 4),
    usableRowCount: dataRows.length,
    delimiter: resolvedDelimiter,
  };
}

function parseSmiPreview(
  rawContent: string,
  hasHeader: boolean,
  skipLines: number,
): SourcePreviewData {
  const preparedLines = rawContent
    .replaceAll('\r', '')
    .split('\n')
    .slice(skipLines)
    .map((lineValue) => lineValue.trim())
    .filter((lineValue) => lineValue !== '' && !lineValue.startsWith('#'));

  const dataLines = hasHeader ? preparedLines.slice(1) : preparedLines;
  const previewRows = dataLines.slice(0, 4).map((lineValue) => {
    if (lineValue.includes('\t')) {
      const [smilesValue = '', nameValue = ''] = lineValue.split('\t');
      return [smilesValue.trim(), nameValue.trim()];
    }
    const [smilesValue = '', ...labelParts] = lineValue.split(/\s+/);
    return [smilesValue.trim(), labelParts.join(' ').trim()];
  });

  return {
    columns: ['column1', 'column2'],
    previewRows,
    usableRowCount: dataLines.length,
    delimiter: '\t',
  };
}

function buildPreview(
  source: Pick<
    GuidedSourceConfig,
    'contentText' | 'fileFormat' | 'hasHeader' | 'skipLines' | 'delimiter'
  >,
): SourcePreviewData {
  if (source.fileFormat === 'smi') {
    return parseSmiPreview(source.contentText, source.hasHeader, source.skipLines);
  }
  return parseCsvPreview(source.contentText, source.hasHeader, source.skipLines, source.delimiter);
}

function ensureValidSelection(selectedColumn: string, columns: string[]): string {
  return columns.includes(selectedColumn) ? selectedColumn : '';
}

function applyColumnRole(
  source: GuidedSourceConfig,
  columnName: string,
  nextRole: ColumnRole,
): GuidedSourceConfig {
  const nextSource: GuidedSourceConfig = { ...source };
  const mappedProperties = Object.values(ROLE_TO_PROPERTY) as MappedColumnProperty[];

  for (const propertyKey of mappedProperties) {
    if (
      nextSource[propertyKey] === columnName ||
      (nextRole !== '' && propertyKey === ROLE_TO_PROPERTY[nextRole])
    ) {
      nextSource[propertyKey] = '';
    }
  }

  if (nextRole !== '') {
    nextSource[ROLE_TO_PROPERTY[nextRole]] = columnName;
  }

  return nextSource;
}

function buildSerializableConfig(
  source: GuidedSourceConfig,
): Record<string, string | boolean | number> {
  return {
    filename: source.filename,
    content_text: source.contentText,
    file_format: source.fileFormat,
    delimiter: source.delimiter,
    has_header: source.hasHeader,
    skip_lines: source.skipLines,
    smiles_column: source.smilesColumn,
    name_column: source.nameColumn,
    paper_reference_column: source.paperReferenceColumn,
    paper_url_column: source.paperUrlColumn,
    evidence_note_column: source.evidenceNoteColumn,
    dt_column: source.dtColumn,
    m_column: source.mColumn,
    ld50_column: source.ld50Column,
    sa_column: source.saColumn,
  };
}

@Component({
  selector: 'app-cadma-py-importer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './cadma-py-importer.component.html',
  styleUrl: './cadma-py-importer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CadmaPyImporterComponent {
  readonly mode = input<CadmaImportMode>('candidate');
  readonly fallbackNamePrefix = input<string>('');
  readonly initialSourceConfigsJson = input<string>('');
  readonly stateChanged = output<CadmaImportStateChange>();

  readonly sources = signal<GuidedSourceConfig[]>([]);
  private readonly lastHydratedConfigJson = signal<string>('');
  readonly importerError = signal<string>('');
  readonly totalUsableRows = computed(() =>
    this.sources().reduce((total, source) => total + source.usableRowCount, 0),
  );
  readonly summaryText = computed(() => {
    const sourceCount = this.sources().length;
    if (sourceCount === 0) {
      return 'No files configured yet.';
    }
    const rowLabel = sourceCount === 1 ? 'file' : 'files';
    return `${sourceCount} ${rowLabel} ready · ${this.totalUsableRows()} usable rows reviewed`;
  });
  readonly uploadButtonTitle = computed(() =>
    this.sources().length > 0 ? 'Add more CSV / SMI files' : 'Upload one or many CSV / SMI files',
  );
  readonly uploadButtonSubtitle = computed(() =>
    this.sources().length > 0
      ? 'You can append files one by one or all at once. This button stays available.'
      : 'The first file must define the main SMILES guide.',
  );

  constructor() {
    effect(() => {
      const serializedConfigs = this.initialSourceConfigsJson().trim();
      if (serializedConfigs === '' || serializedConfigs === this.lastHydratedConfigJson()) {
        return;
      }

      const restoredSources = this.parseSerializedConfigs(serializedConfigs);
      if (restoredSources.length === 0) {
        this.lastHydratedConfigJson.set(serializedConfigs);
        return;
      }

      this.sources.set(restoredSources);
      this.importerError.set('');
      this.lastHydratedConfigJson.set(serializedConfigs);
      this.emitState();
    });
  }

  async onFilesSelected(event: Event): Promise<void> {
    const inputElement = event.target as HTMLInputElement | null;
    const files = Array.from(inputElement?.files ?? []);
    if (files.length === 0) {
      return;
    }

    const currentSources = this.sources();
    const nextSources: GuidedSourceConfig[] = [...currentSources];
    for (const file of files) {
      const contentText = await file.text();
      const isFirstSource = nextSources.length === 0;
      nextSources.push(this.buildSourceFromFile(file.name, contentText, isFirstSource));
    }

    this.sources.set(nextSources);
    this.importerError.set('');
    if (inputElement !== null) {
      inputElement.value = '';
    }
    this.emitState();
  }

  removeSource(sourceId: string): void {
    this.sources.update((currentSources) =>
      currentSources.filter((source) => source.id !== sourceId),
    );
    this.importerError.set('');
    this.emitState();
  }

  reparseSource(sourceId: string): void {
    this.sources.update((currentSources) =>
      currentSources.map((source, index) => {
        if (source.id !== sourceId) {
          return source;
        }

        const preview = buildPreview(source);
        const nextSource: GuidedSourceConfig = {
          ...source,
          columns: preview.columns,
          previewRows: preview.previewRows,
          usableRowCount: preview.usableRowCount,
          delimiter: preview.delimiter,
          smilesColumn:
            index === 0
              ? ensureValidSelection(source.smilesColumn, preview.columns) ||
                inferColumn(preview.columns, 'smiles')
              : ensureValidSelection(source.smilesColumn, preview.columns),
          nameColumn:
            ensureValidSelection(source.nameColumn, preview.columns) ||
            inferColumn(preview.columns, 'name'),
          paperReferenceColumn:
            ensureValidSelection(source.paperReferenceColumn, preview.columns) ||
            inferColumn(preview.columns, 'paperReference'),
          paperUrlColumn:
            ensureValidSelection(source.paperUrlColumn, preview.columns) ||
            inferColumn(preview.columns, 'paperUrl'),
          evidenceNoteColumn:
            ensureValidSelection(source.evidenceNoteColumn, preview.columns) ||
            inferColumn(preview.columns, 'evidenceNote'),
          dtColumn:
            ensureValidSelection(source.dtColumn, preview.columns) ||
            inferColumn(preview.columns, 'dt'),
          mColumn:
            ensureValidSelection(source.mColumn, preview.columns) ||
            inferColumn(preview.columns, 'm'),
          ld50Column:
            ensureValidSelection(source.ld50Column, preview.columns) ||
            inferColumn(preview.columns, 'ld50'),
          saColumn:
            ensureValidSelection(source.saColumn, preview.columns) ||
            inferColumn(preview.columns, 'sa'),
        };

        return nextSource;
      }),
    );

    this.importerError.set('');
    this.emitState();
  }

  columnsFor(source: GuidedSourceConfig): string[] {
    return source.columns;
  }

  fileRoleLabel(index: number): string {
    return index === 0 ? 'Guide file' : 'Additional file';
  }

  formatDelimiterLabel(source: GuidedSourceConfig): string {
    if (source.fileFormat === 'smi') {
      return 'SMI';
    }
    if (source.delimiter === '\t') {
      return 'CSV · tab';
    }
    return `CSV · ${source.delimiter || ','}`;
  }

  roleForColumn(source: GuidedSourceConfig, columnName: string): ColumnRole {
    for (const [roleName, propertyKey] of Object.entries(ROLE_TO_PROPERTY) as Array<
      [Exclude<ColumnRole, ''>, MappedColumnProperty]
    >) {
      if (source[propertyKey] === columnName) {
        return roleName;
      }
    }
    return '';
  }

  roleOptions(sourceIndex: number): Array<{ value: ColumnRole; label: string }> {
    return [
      { value: '', label: 'Ignore this column' },
      {
        value: 'smiles',
        label: sourceIndex === 0 ? 'Main SMILES guide' : 'SMILES match column',
      },
      { value: 'name', label: 'Compound name' },
      { value: 'paperReference', label: 'Paper reference' },
      { value: 'paperUrl', label: 'DOI or URL' },
      { value: 'evidenceNote', label: 'Evidence note' },
      { value: 'dt', label: 'Dev tox' },
      { value: 'm', label: 'Mutagenicity' },
      { value: 'ld50', label: 'LD50' },
      { value: 'sa', label: 'SA score' },
    ];
  }

  assignColumnRole(sourceId: string, columnName: string, nextRole: ColumnRole): void {
    this.sources.update((currentSources) =>
      currentSources.map((source) =>
        source.id === sourceId ? applyColumnRole(source, columnName, nextRole) : source,
      ),
    );
    this.importerError.set('');
    this.emitState();
  }

  private parseSerializedConfigs(serializedConfigs: string): GuidedSourceConfig[] {
    try {
      const parsedValue: unknown = JSON.parse(serializedConfigs);
      if (!Array.isArray(parsedValue)) {
        return [];
      }

      return parsedValue.flatMap((rawSource, index) => {
        if (typeof rawSource !== 'object' || rawSource === null || Array.isArray(rawSource)) {
          return [];
        }

        const sourceRecord = rawSource as Record<string, unknown>;
        const contentText = this.readStringField(
          sourceRecord['content_text'],
          this.readStringField(sourceRecord['contentText']),
        );
        if (contentText.trim() === '') {
          return [];
        }

        const filename = this.readStringField(
          sourceRecord['filename'],
          this.readStringField(sourceRecord['fileName'], `restored-source-${index + 1}.csv`),
        );
        const fileFormatRaw = this.readStringField(
          sourceRecord['file_format'],
          this.readStringField(sourceRecord['fileFormat'], inferFormat(filename)),
        );
        const fileFormat: CadmaFileFormat = fileFormatRaw === 'smi' ? 'smi' : 'csv';
        const delimiter = this.readStringField(
          sourceRecord['delimiter'],
          fileFormat === 'smi' ? '\t' : ',',
        );
        const hasHeader = this.readBooleanField(
          sourceRecord['has_header'],
          this.readBooleanField(sourceRecord['hasHeader'], inferDefaultHeader(fileFormat)),
        );
        const skipLines = this.readNumberField(
          sourceRecord['skip_lines'],
          this.readNumberField(sourceRecord['skipLines'], 0),
        );
        const preview = buildPreview({
          contentText,
          fileFormat,
          hasHeader,
          skipLines,
          delimiter,
        });

        return [
          {
            id: crypto.randomUUID(),
            filename,
            contentText,
            fileFormat,
            delimiter: preview.delimiter,
            hasHeader,
            skipLines,
            columns: preview.columns,
            previewRows: preview.previewRows,
            usableRowCount: preview.usableRowCount,
            smilesColumn: this.readStringField(
              sourceRecord['smiles_column'],
              this.readStringField(
                sourceRecord['smilesColumn'],
                index === 0
                  ? inferColumn(preview.columns, 'smiles') || (preview.columns[0] ?? '')
                  : '',
              ),
            ),
            nameColumn: this.readStringField(
              sourceRecord['name_column'],
              this.readStringField(
                sourceRecord['nameColumn'],
                inferColumn(preview.columns, 'name'),
              ),
            ),
            paperReferenceColumn: this.readStringField(
              sourceRecord['paper_reference_column'],
              this.readStringField(
                sourceRecord['paperReferenceColumn'],
                inferColumn(preview.columns, 'paperReference'),
              ),
            ),
            paperUrlColumn: this.readStringField(
              sourceRecord['paper_url_column'],
              this.readStringField(
                sourceRecord['paperUrlColumn'],
                inferColumn(preview.columns, 'paperUrl'),
              ),
            ),
            evidenceNoteColumn: this.readStringField(
              sourceRecord['evidence_note_column'],
              this.readStringField(
                sourceRecord['evidenceNoteColumn'],
                inferColumn(preview.columns, 'evidenceNote'),
              ),
            ),
            dtColumn: this.readStringField(
              sourceRecord['dt_column'],
              this.readStringField(sourceRecord['dtColumn'], inferColumn(preview.columns, 'dt')),
            ),
            mColumn: this.readStringField(
              sourceRecord['m_column'],
              this.readStringField(sourceRecord['mColumn'], inferColumn(preview.columns, 'm')),
            ),
            ld50Column: this.readStringField(
              sourceRecord['ld50_column'],
              this.readStringField(
                sourceRecord['ld50Column'],
                inferColumn(preview.columns, 'ld50'),
              ),
            ),
            saColumn: this.readStringField(
              sourceRecord['sa_column'],
              this.readStringField(sourceRecord['saColumn'], inferColumn(preview.columns, 'sa')),
            ),
          },
        ];
      });
    } catch {
      return [];
    }
  }

  private readStringField(value: unknown, fallbackValue: string = ''): string {
    return typeof value === 'string' ? value : fallbackValue;
  }

  private readBooleanField(value: unknown, fallbackValue: boolean): boolean {
    return typeof value === 'boolean' ? value : fallbackValue;
  }

  private readNumberField(value: unknown, fallbackValue: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallbackValue;
  }

  private buildSourceFromFile(
    filename: string,
    contentText: string,
    isFirstSource: boolean,
  ): GuidedSourceConfig {
    const fileFormat = inferFormat(filename);
    const hasHeader = inferDefaultHeader(fileFormat);
    const skipLines = inferSkipLines(contentText);
    const preview = buildPreview({
      contentText,
      fileFormat,
      hasHeader,
      skipLines,
      delimiter:
        fileFormat === 'smi'
          ? '\t'
          : detectDelimiter(
              contentText.split(/\r?\n/).filter((lineValue) => lineValue.trim() !== ''),
            ),
    });

    return {
      id: crypto.randomUUID(),
      filename,
      contentText,
      fileFormat,
      delimiter: preview.delimiter,
      hasHeader,
      skipLines,
      columns: preview.columns,
      previewRows: preview.previewRows,
      usableRowCount: preview.usableRowCount,
      smilesColumn: isFirstSource
        ? inferColumn(preview.columns, 'smiles') || (preview.columns[0] ?? '')
        : inferColumn(preview.columns, 'smiles'),
      nameColumn: inferColumn(preview.columns, 'name'),
      paperReferenceColumn: inferColumn(preview.columns, 'paperReference'),
      paperUrlColumn: inferColumn(preview.columns, 'paperUrl'),
      evidenceNoteColumn: inferColumn(preview.columns, 'evidenceNote'),
      dtColumn: inferColumn(preview.columns, 'dt'),
      mColumn: inferColumn(preview.columns, 'm'),
      ld50Column: inferColumn(preview.columns, 'ld50'),
      saColumn: inferColumn(preview.columns, 'sa'),
    };
  }

  private emitState(): void {
    const currentSources = this.sources();
    const firstSource = currentSources[0] ?? null;
    if (firstSource === null || firstSource.smilesColumn.trim() === '') {
      this.importerError.set('Select the main SMILES column in the first uploaded file.');
      this.stateChanged.emit({
        sourceConfigsJson: '',
        totalFiles: currentSources.length,
        totalUsableRows: this.totalUsableRows(),
        filenames: currentSources.map((source) => source.filename),
      });
      return;
    }

    this.stateChanged.emit({
      sourceConfigsJson: JSON.stringify(
        currentSources.map((source) => buildSerializableConfig(source)),
      ),
      totalFiles: currentSources.length,
      totalUsableRows: this.totalUsableRows(),
      filenames: currentSources.map((source) => source.filename),
    });
  }
}
