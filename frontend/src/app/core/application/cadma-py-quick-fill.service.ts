// cadma-py-quick-fill.service.ts: Auto-rellena CADMA Py a partir de jobs previos de Smile-it, Toxicity Properties y SA Score.

import { inject, Injectable } from '@angular/core';
import { forkJoin, from, last, map, Observable, of, switchMap, throwError } from 'rxjs';
import { JobsApiService, SaScoreMethod, ScientificJobView } from '../api/jobs-api.service';
import type { NamedSmilesJobMolecule } from '../api/types/named-smiles-api.types';

export interface CadmaQuickFillSources {
  smileitJobs: ScientificJobView[];
  toxicityJobs: ScientificJobView[];
  saScoreJobs: ScientificJobView[];
}

export interface CadmaQuickFillSelection {
  smileitJobId: string;
  toxicityJobId?: string;
  saScoreJobId?: string;
  saMethod: SaScoreMethod;
}

export interface CadmaQuickFillPayload {
  sourceConfigsJson: string;
  filenames: string[];
  totalFiles: number;
  totalUsableRows: number;
}

export interface CadmaQuickGuideSummary {
  hasGuide: boolean;
  guideFilename: string;
  moleculeCount: number;
  hasNamedCandidates: boolean;
  hasToxicityData: boolean;
  hasSaData: boolean;
}

export interface CadmaQuickGuidePreviewRow {
  smiles: string;
  name: string;
  dt: number | null;
  m: number | null;
  ld50: number | null;
  sa: number | null;
}

export interface CadmaQuickGuidePreview {
  hasGuide: boolean;
  guideFilename: string;
  moleculeCount: number;
  hasToxicityData: boolean;
  hasSaData: boolean;
  rows: CadmaQuickGuidePreviewRow[];
}

export interface CadmaQuickLaunchPayload extends CadmaQuickFillPayload {
  launchedToxicityJobId: string;
  launchedSaScoreJobId: string;
}

type QuickFillConfig = Record<string, string | boolean | number>;

interface ParsedSourceRow {
  smiles: string;
  name: string;
  dt: number | null;
  m: number | null;
  ld50: number | null;
  sa: number | null;
}

type ParsedMetricValues = Pick<ParsedSourceRow, 'dt' | 'm' | 'ld50' | 'sa'>;

const DEFAULT_SA_METHODS: readonly SaScoreMethod[] = ['ambit', 'brsa', 'rdkit'];
const SMILES_COLUMN_ALIASES = [
  'smiles',
  'smile',
  'smi',
  'generated_smiles',
  'generatedsmiles',
  'derivative_smiles',
  'derivativesmiles',
] as const;
const NAME_COLUMN_ALIASES = [
  'name',
  'label',
  'compound',
  'compound_name',
  'compoundname',
  'candidate',
  'candidate_name',
  'candidatename',
  'derivative_name',
  'derivativename',
] as const;
const EMPTY_METRIC_VALUES: ParsedMetricValues = {
  dt: null,
  m: null,
  ld50: null,
  sa: null,
};
const POSITIVE_LABELS = new Set(['positive', 'toxic', 'high', 'yes', 'true', '1']);
const NEGATIVE_LABELS = new Set(['negative', 'nontoxic', 'safe', 'low', 'no', 'false', '0']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeToken(rawValue: string): string {
  return rawValue
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '');
}

function csvEscape(rawValue: string): string {
  if (/[",\n]/.test(rawValue)) {
    return `"${rawValue.replaceAll('"', '""')}"`;
  }
  return rawValue;
}

function detectDelimiter(rawContent: string): string {
  const firstLine = rawContent
    .replaceAll('\r', '')
    .split('\n')
    .map((lineValue) => lineValue.trim())
    .find((lineValue) => lineValue !== '' && !lineValue.startsWith('#'));

  if (!firstLine) {
    return ',';
  }

  const candidates = [',', ';', '\t'] as const;
  return (
    candidates.reduce(
      (bestDelimiter, delimiter) =>
        firstLine.split(delimiter).length > firstLine.split(bestDelimiter).length
          ? delimiter
          : bestDelimiter,
      ',',
    ) ?? ','
  );
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

function looksLikeHeader(columns: string[]): boolean {
  return columns.some((columnName) => {
    const normalized = normalizeToken(columnName);
    return (
      normalized.includes('smiles') ||
      normalized.includes('name') ||
      normalized.includes('label') ||
      normalized.includes('dt') ||
      normalized.includes('ld50') ||
      normalized.includes('sa')
    );
  });
}

function findColumn(columns: string[], aliases: readonly string[]): string {
  const normalizedAliases = aliases.map((alias) => normalizeToken(alias));

  for (const columnName of columns) {
    const normalizedColumn = normalizeToken(columnName);
    if (normalizedAliases.includes(normalizedColumn)) {
      return columnName;
    }
  }

  for (const columnName of columns) {
    const normalizedColumn = normalizeToken(columnName);
    if (
      normalizedAliases.some(
        (alias) =>
          alias.length >= 2 &&
          (normalizedColumn.includes(alias) || alias.includes(normalizedColumn)),
      )
    ) {
      return columnName;
    }
  }

  return '';
}

function countUsableRows(rawContent: string, hasHeader: boolean): number {
  const rows = rawContent
    .replaceAll('\r', '')
    .split('\n')
    .map((lineValue) => lineValue.trim())
    .filter((lineValue) => lineValue !== '' && !lineValue.startsWith('#'));

  if (rows.length === 0) {
    return 0;
  }

  return Math.max(0, rows.length - (hasHeader ? 1 : 0));
}

function readStringField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readBooleanField(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readNumberField(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function parseSerializedSourceConfigs(sourceConfigsJson: string): QuickFillConfig[] {
  if (sourceConfigsJson.trim() === '') {
    return [];
  }

  try {
    const parsedValue = JSON.parse(sourceConfigsJson);
    return Array.isArray(parsedValue)
      ? parsedValue.filter((item): item is QuickFillConfig => isRecord(item))
      : [];
  } catch {
    return [];
  }
}

function buildGuideCsvFromMolecules(molecules: NamedSmilesJobMolecule[]): string {
  return [
    'smiles,name',
    ...molecules.map((molecule, index) => {
      const smilesValue = molecule.smiles.trim();
      const fallbackName = `candidate_${index + 1}`;
      const nameValue = molecule.name.trim() || smilesValue || fallbackName;
      return `${csvEscape(smilesValue)},${csvEscape(nameValue)}`;
    }),
  ].join('\n');
}

function readOptionalMetricValue(
  metricName: 'DT' | 'M' | 'LD50' | 'SA',
  value: string,
): number | null {
  const trimmedValue = value.trim();
  if (trimmedValue === '') {
    return null;
  }

  const normalizedValue = normalizeToken(trimmedValue);
  if (metricName === 'DT' || metricName === 'M') {
    if (POSITIVE_LABELS.has(normalizedValue)) {
      return 1;
    }
    if (NEGATIVE_LABELS.has(normalizedValue)) {
      return 0;
    }
  }

  const numericValue = Number(trimmedValue);
  if (!Number.isFinite(numericValue)) {
    return null;
  }

  if ((metricName === 'DT' || metricName === 'M') && numericValue > 1 && numericValue <= 100) {
    return numericValue / 100;
  }

  return numericValue;
}

function buildFallbackCandidateName(index: number, filename: string, smilesValue: string): string {
  const normalizedFilename = filename.trim().toLowerCase();
  if (normalizedFilename.includes('smileit')) {
    return index === 0 ? 'principal' : `dprincipal${index}`;
  }

  return smilesValue || `candidate_${index + 1}`;
}

function extractSourceRowsFromConfig(config: QuickFillConfig): ParsedSourceRow[] {
  const contentText = readStringField(config['content_text']);
  if (contentText.trim() === '') {
    return [];
  }

  const filename = readStringField(config['filename']);
  const skipLines = Math.max(0, readNumberField(config['skip_lines'], 0));
  const preparedLines = contentText
    .replaceAll('\r', '')
    .split('\n')
    .slice(skipLines)
    .map((lineValue) => lineValue.trim())
    .filter((lineValue) => lineValue !== '' && !lineValue.startsWith('#'));

  if (preparedLines.length === 0) {
    return [];
  }

  const configuredDelimiter = readStringField(config['delimiter']);
  const delimiter = configuredDelimiter || detectDelimiter(contentText);
  const firstColumns = splitDelimitedLine(preparedLines[0] ?? '', delimiter);
  const hasHeader = readBooleanField(config['has_header'], looksLikeHeader(firstColumns));
  const columns = hasHeader
    ? firstColumns
    : Array.from({ length: firstColumns.length }, (_, index) => `column${index + 1}`);

  const smilesHeader =
    readStringField(config['smiles_column']) ||
    findColumn(columns, SMILES_COLUMN_ALIASES) ||
    columns[0] ||
    'smiles';
  const nameHeader =
    readStringField(config['name_column']) || findColumn(columns, NAME_COLUMN_ALIASES);
  const dtHeader =
    readStringField(config['dt_column']) ||
    findColumn(columns, ['dt', 'devtox', 'devtox_score', 'developmentaltoxicity']);
  const mHeader =
    readStringField(config['m_column']) ||
    findColumn(columns, ['m', 'mutagenicity', 'ames', 'ames_score']);
  const ld50Header =
    readStringField(config['ld50_column']) || findColumn(columns, ['ld50', 'ld_50']);
  const saHeader =
    readStringField(config['sa_column']) ||
    findColumn(columns, ['sa', 'sa_score', 'sa_percent', 'sapercent']);

  const smilesIndex = columns.indexOf(smilesHeader);
  const nameIndex = nameHeader === '' ? -1 : columns.indexOf(nameHeader);
  const dtIndex = dtHeader === '' ? -1 : columns.indexOf(dtHeader);
  const mIndex = mHeader === '' ? -1 : columns.indexOf(mHeader);
  const ld50Index = ld50Header === '' ? -1 : columns.indexOf(ld50Header);
  const saIndex = saHeader === '' ? -1 : columns.indexOf(saHeader);
  const dataLines = hasHeader ? preparedLines.slice(1) : preparedLines;

  return dataLines
    .map((lineValue, index) => {
      const csvCells = splitDelimitedLine(lineValue, delimiter);
      const normalizedCells =
        !hasHeader && csvCells.length <= 1
          ? lineValue
              .split(/\s+/)
              .map((cell) => cell.trim())
              .filter((cell) => cell !== '')
          : csvCells;

      const fallbackSmiles = normalizedCells[0] ?? '';
      const smilesValue =
        smilesIndex >= 0
          ? (normalizedCells[smilesIndex] ?? fallbackSmiles).trim()
          : fallbackSmiles.trim();
      const explicitName = nameIndex >= 0 ? (normalizedCells[nameIndex] ?? '').trim() : '';
      const inlineName = hasHeader ? '' : normalizedCells.slice(1).join(' ').trim();
      const fallbackName = buildFallbackCandidateName(index, filename, smilesValue);

      return {
        smiles: smilesValue,
        name: explicitName || inlineName || fallbackName,
        dt: dtIndex >= 0 ? readOptionalMetricValue('DT', normalizedCells[dtIndex] ?? '') : null,
        m: mIndex >= 0 ? readOptionalMetricValue('M', normalizedCells[mIndex] ?? '') : null,
        ld50:
          ld50Index >= 0 ? readOptionalMetricValue('LD50', normalizedCells[ld50Index] ?? '') : null,
        sa: saIndex >= 0 ? readOptionalMetricValue('SA', normalizedCells[saIndex] ?? '') : null,
      } satisfies ParsedSourceRow;
    })
    .filter((row) => row.smiles.trim() !== '');
}

function extractNamedMoleculesFromConfig(config: QuickFillConfig): NamedSmilesJobMolecule[] {
  return extractSourceRowsFromConfig(config).map(
    (row) =>
      ({
        smiles: row.smiles,
        name: row.name,
      }) satisfies NamedSmilesJobMolecule,
  );
}

function resolveGuideFromConfigs(configs: QuickFillConfig[]): {
  guideFilename: string;
  guideCsv: string;
  molecules: NamedSmilesJobMolecule[];
  hasToxicityData: boolean;
  hasSaData: boolean;
} {
  let bestGuideFilename = 'candidate_guide.csv';
  let bestMolecules: NamedSmilesJobMolecule[] = [];
  let bestScore = -1;

  for (const config of configs) {
    const molecules = extractNamedMoleculesFromConfig(config);
    if (molecules.length === 0) {
      continue;
    }

    const filename = readStringField(config['filename']);
    const normalizedFilename = filename.toLowerCase();
    const hasToxicityColumns =
      readStringField(config['dt_column']) !== '' ||
      readStringField(config['m_column']) !== '' ||
      readStringField(config['ld50_column']) !== '';
    const hasSaColumn = readStringField(config['sa_column']) !== '';

    let score = molecules.length;
    if (normalizedFilename.includes('guide') || normalizedFilename.includes('smiles')) {
      score += 50;
    }
    if (!hasToxicityColumns && !hasSaColumn) {
      score += 25;
    }
    if (readStringField(config['name_column']) !== '') {
      score += 10;
    }

    if (score > bestScore) {
      bestScore = score;
      bestGuideFilename = filename.trim() || 'candidate_guide.csv';
      bestMolecules = molecules;
    }
  }

  const hasToxicityData = configs.some(
    (config) =>
      readStringField(config['dt_column']) !== '' ||
      readStringField(config['m_column']) !== '' ||
      readStringField(config['ld50_column']) !== '',
  );
  const hasSaData = configs.some((config) => readStringField(config['sa_column']) !== '');

  return {
    guideFilename: bestGuideFilename,
    guideCsv: buildGuideCsvFromMolecules(bestMolecules),
    molecules: bestMolecules,
    hasToxicityData,
    hasSaData,
  };
}

function mergeMetricValues(
  primary: ParsedMetricValues,
  secondary: ParsedMetricValues,
): ParsedMetricValues {
  return {
    dt: primary.dt ?? secondary.dt,
    m: primary.m ?? secondary.m,
    ld50: primary.ld50 ?? secondary.ld50,
    sa: primary.sa ?? secondary.sa,
  };
}

function hasMetricValues(values: ParsedMetricValues): boolean {
  return values.dt !== null || values.m !== null || values.ld50 !== null || values.sa !== null;
}

function buildMetricLookups(configs: QuickFillConfig[]): {
  bySmiles: Map<string, ParsedMetricValues>;
  byName: Map<string, ParsedMetricValues>;
} {
  const bySmiles = new Map<string, ParsedMetricValues>();
  const byName = new Map<string, ParsedMetricValues>();

  for (const config of configs) {
    for (const row of extractSourceRowsFromConfig(config)) {
      const metricValues: ParsedMetricValues = {
        dt: row.dt,
        m: row.m,
        ld50: row.ld50,
        sa: row.sa,
      };

      if (!hasMetricValues(metricValues)) {
        continue;
      }

      const normalizedSmiles = row.smiles.trim();
      if (normalizedSmiles !== '') {
        bySmiles.set(
          normalizedSmiles,
          mergeMetricValues(metricValues, bySmiles.get(normalizedSmiles) ?? EMPTY_METRIC_VALUES),
        );
      }

      const normalizedName = normalizeToken(row.name);
      if (normalizedName !== '') {
        byName.set(
          normalizedName,
          mergeMetricValues(metricValues, byName.get(normalizedName) ?? EMPTY_METRIC_VALUES),
        );
      }
    }
  }

  return { bySmiles, byName };
}

export function inspectCadmaSourceConfigs(sourceConfigsJson: string): CadmaQuickGuideSummary {
  const resolvedGuide = resolveGuideFromConfigs(parseSerializedSourceConfigs(sourceConfigsJson));

  return {
    hasGuide: resolvedGuide.molecules.length > 0,
    guideFilename: resolvedGuide.guideFilename,
    moleculeCount: resolvedGuide.molecules.length,
    hasNamedCandidates: resolvedGuide.molecules.some(
      (molecule) => molecule.name.trim() !== '' && molecule.name.trim() !== molecule.smiles.trim(),
    ),
    hasToxicityData: resolvedGuide.hasToxicityData,
    hasSaData: resolvedGuide.hasSaData,
  };
}

export function previewCadmaSourceConfigs(
  sourceConfigsJson: string,
  maxRows: number = 8,
): CadmaQuickGuidePreview {
  const configs = parseSerializedSourceConfigs(sourceConfigsJson);
  const resolvedGuide = resolveGuideFromConfigs(configs);
  const metricLookups = buildMetricLookups(configs);

  return {
    hasGuide: resolvedGuide.molecules.length > 0,
    guideFilename: resolvedGuide.guideFilename,
    moleculeCount: resolvedGuide.molecules.length,
    hasToxicityData: resolvedGuide.hasToxicityData,
    hasSaData: resolvedGuide.hasSaData,
    rows: resolvedGuide.molecules.slice(0, Math.max(1, maxRows)).map((molecule) => {
      const metricBySmiles =
        metricLookups.bySmiles.get(molecule.smiles.trim()) ?? EMPTY_METRIC_VALUES;
      const metricByName =
        metricLookups.byName.get(normalizeToken(molecule.name)) ?? EMPTY_METRIC_VALUES;
      const mergedMetrics = mergeMetricValues(metricBySmiles, metricByName);

      return {
        name: molecule.name.trim(),
        smiles: molecule.smiles.trim(),
        dt: mergedMetrics.dt,
        m: mergedMetrics.m,
        ld50: mergedMetrics.ld50,
        sa: mergedMetrics.sa,
      } satisfies CadmaQuickGuidePreviewRow;
    }),
  };
}

function detectColumns(rawContent: string): {
  delimiter: string;
  hasHeader: boolean;
  columns: string[];
} {
  const preparedLines = rawContent
    .replaceAll('\r', '')
    .split('\n')
    .map((lineValue) => lineValue.trim())
    .filter((lineValue) => lineValue !== '' && !lineValue.startsWith('#'));

  if (preparedLines.length === 0) {
    return { delimiter: ',', hasHeader: false, columns: [] };
  }

  const delimiter = detectDelimiter(rawContent);
  const firstRow = splitDelimitedLine(preparedLines[0] ?? '', delimiter);
  const hasHeader = looksLikeHeader(firstRow);
  const columns = hasHeader
    ? firstRow
    : Array.from({ length: firstRow.length }, (_, index) => `column${index + 1}`);

  return { delimiter, hasHeader, columns };
}

export function extractRequestedSaMethods(parameters: unknown): SaScoreMethod[] {
  if (!isRecord(parameters)) {
    return [...DEFAULT_SA_METHODS];
  }

  const rawMethods = parameters['methods'];
  if (!Array.isArray(rawMethods)) {
    return [...DEFAULT_SA_METHODS];
  }

  const resolvedMethods = rawMethods.filter(
    (item): item is SaScoreMethod =>
      typeof item === 'string' && DEFAULT_SA_METHODS.includes(item as SaScoreMethod),
  );

  return resolvedMethods.length > 0 ? resolvedMethods : [...DEFAULT_SA_METHODS];
}

function buildReadableJobCandidate(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 32 ? `${trimmedValue.slice(0, 29)}...` : trimmedValue;
}

function extractPrimaryMoleculeLabel(parameters: unknown): string | null {
  if (!isRecord(parameters)) {
    return null;
  }

  const moleculesValue = parameters['molecules'];
  if (!Array.isArray(moleculesValue)) {
    return null;
  }

  const firstMolecule = moleculesValue.find(
    (item) => isRecord(item) && typeof item['smiles'] === 'string' && item['smiles'].trim() !== '',
  );

  if (!isRecord(firstMolecule)) {
    return null;
  }

  const preferredValue =
    typeof firstMolecule['name'] === 'string' && firstMolecule['name'].trim() !== ''
      ? firstMolecule['name']
      : firstMolecule['smiles'];

  return buildReadableJobCandidate(preferredValue);
}

export function resolveScientificJobLabel(
  job: Pick<ScientificJobView, 'id' | 'updated_at' | 'parameters'>,
): string {
  const parameters = job.parameters;
  const explicitParameterKeys = ['project_label', 'title', 'job_name', 'name'] as const;
  const fallbackParameterKeys = ['principal_smiles', 'principalSmiles', 'smiles'] as const;
  const candidates: string[] = [];

  if (isRecord(parameters)) {
    candidates.push(
      ...explicitParameterKeys
        .map((key) => buildReadableJobCandidate(parameters[key]))
        .filter((value): value is string => value !== null),
    );
  }

  const primaryMoleculeLabel = extractPrimaryMoleculeLabel(parameters);
  if (primaryMoleculeLabel !== null) {
    candidates.push(primaryMoleculeLabel);
  }

  if (isRecord(parameters)) {
    candidates.push(
      ...fallbackParameterKeys
        .map((key) => buildReadableJobCandidate(parameters[key]))
        .filter((value): value is string => value !== null),
    );
  }

  const preferredLabel = candidates[0] ?? `Job ${job.id.slice(0, 8)}`;
  const parsedDate = new Date(job.updated_at);
  if (Number.isNaN(parsedDate.getTime())) {
    return preferredLabel;
  }

  return `${preferredLabel} · ${parsedDate.toLocaleString()}`;
}

export function pickPreferredHistoricalJobId(
  currentJobId: string,
  jobs: Pick<ScientificJobView, 'id'>[],
  allowAutoSelect: boolean = false,
): string {
  const normalizedCurrentJobId = currentJobId.trim();
  if (normalizedCurrentJobId !== '' && jobs.some((job) => job.id === normalizedCurrentJobId)) {
    return normalizedCurrentJobId;
  }

  if (!allowAutoSelect || jobs.length !== 1) {
    return '';
  }

  return jobs[0]?.id ?? '';
}

export function normalizeSmilesGuideCsv(
  rawContent: string,
  sourceFilename: string = 'candidate_guide.csv',
): string {
  const rows = extractSourceRowsFromConfig({
    filename: sourceFilename,
    content_text: rawContent,
    delimiter: detectDelimiter(rawContent),
    has_header: looksLikeHeader(
      splitDelimitedLine(
        rawContent.replaceAll('\r', '').split('\n')[0] ?? '',
        detectDelimiter(rawContent),
      ),
    ),
    skip_lines: 0,
    smiles_column: '',
    name_column: '',
    dt_column: '',
    m_column: '',
    ld50_column: '',
    sa_column: '',
  });

  if (rows.length === 0) {
    return 'smiles,name';
  }

  return [
    'smiles,name',
    ...rows.map((row) => `${csvEscape(row.smiles)},${csvEscape(row.name)}`),
  ].join('\n');
}

function buildGuideConfig(filename: string, contentText: string): QuickFillConfig {
  return {
    filename,
    content_text: contentText,
    file_format: 'csv',
    delimiter: ',',
    has_header: true,
    skip_lines: 0,
    smiles_column: 'smiles',
    name_column: 'name',
    paper_reference_column: '',
    paper_url_column: '',
    evidence_note_column: '',
    dt_column: '',
    m_column: '',
    ld50_column: '',
    sa_column: '',
  };
}

function buildMetricConfig(
  filename: string,
  contentText: string,
  kind: 'toxicity' | 'sa',
): QuickFillConfig {
  const csvMetadata = detectColumns(contentText);
  const columns = csvMetadata.columns;

  return {
    filename,
    content_text: contentText,
    file_format: 'csv',
    delimiter: csvMetadata.delimiter,
    has_header: csvMetadata.hasHeader,
    skip_lines: 0,
    smiles_column: findColumn(columns, ['smiles', 'smile', 'smi']),
    name_column: findColumn(columns, ['name', 'label', 'compound', 'compound_name']),
    paper_reference_column: findColumn(columns, ['paper_reference', 'paper', 'reference']),
    paper_url_column: findColumn(columns, ['paper_url', 'doi', 'url', 'link']),
    evidence_note_column: findColumn(columns, ['evidence_note', 'note', 'notes', 'comment']),
    dt_column:
      kind === 'toxicity' ? findColumn(columns, ['dt', 'devtox', 'developmentaltoxicity']) : '',
    m_column: kind === 'toxicity' ? findColumn(columns, ['m', 'mutagenicity', 'ames']) : '',
    ld50_column: kind === 'toxicity' ? findColumn(columns, ['ld50', 'ld_50']) : '',
    sa_column:
      kind === 'sa' ? findColumn(columns, ['sa', 'sa_score', 'sa_percent', 'sapercent']) : '',
  };
}

function buildPayloadFromSourceTexts(
  guideFilename: string,
  guideCsv: string,
  toxicityInput: { filename: string; contentText: string } | null,
  saInput: { filename: string; contentText: string } | null,
): CadmaQuickFillPayload {
  const configs: QuickFillConfig[] = [buildGuideConfig(guideFilename, guideCsv)];

  if (toxicityInput !== null && toxicityInput.contentText.trim() !== '') {
    configs.push(buildMetricConfig(toxicityInput.filename, toxicityInput.contentText, 'toxicity'));
  }

  if (saInput !== null && saInput.contentText.trim() !== '') {
    configs.push(buildMetricConfig(saInput.filename, saInput.contentText, 'sa'));
  }

  return {
    sourceConfigsJson: JSON.stringify(configs),
    filenames: configs.map((config) => String(config['filename'])),
    totalFiles: configs.length,
    totalUsableRows: configs.reduce(
      (total, config) =>
        total +
        countUsableRows(
          String(config['content_text']),
          typeof config['has_header'] === 'boolean' ? config['has_header'] : true,
        ),
      0,
    ),
  } satisfies CadmaQuickFillPayload;
}

@Injectable({ providedIn: 'root' })
export class CadmaPyQuickFillService {
  private readonly jobsApi = inject(JobsApiService);

  loadSourceJobs(): Observable<CadmaQuickFillSources> {
    return forkJoin({
      smileitJobs: this.jobsApi
        .listJobs({ pluginName: 'smileit', status: 'completed' })
        .pipe(map((jobs) => this.sortRecentJobs(jobs))),
      toxicityJobs: this.jobsApi
        .listJobs({ pluginName: 'toxicity-properties', status: 'completed' })
        .pipe(map((jobs) => this.sortRecentJobs(jobs))),
      saScoreJobs: this.jobsApi
        .listJobs({ pluginName: 'sa-score', status: 'completed' })
        .pipe(map((jobs) => this.sortRecentJobs(jobs))),
    });
  }

  buildAutoFillPayload(selection: CadmaQuickFillSelection): Observable<CadmaQuickFillPayload> {
    const smileitJobId = selection.smileitJobId.trim();
    if (smileitJobId === '') {
      return throwError(() => new Error('Select a Smile-it job to build the CADMA guide.'));
    }

    const toxicityJobId = selection.toxicityJobId?.trim() ?? '';
    const saScoreJobId = selection.saScoreJobId?.trim() ?? '';

    return forkJoin({
      guideText: this.jobsApi
        .downloadSmileitCsvReport(smileitJobId)
        .pipe(switchMap((report) => from(report.blob.text()))),
      toxicityText:
        toxicityJobId === ''
          ? of(null)
          : this.jobsApi
              .downloadToxicityPropertiesCsvReport(toxicityJobId)
              .pipe(switchMap((report) => from(report.blob.text()))),
      saText:
        saScoreJobId === ''
          ? of(null)
          : this.jobsApi
              .downloadSaScoreCsvMethodReport(saScoreJobId, selection.saMethod)
              .pipe(switchMap((report) => from(report.blob.text()))),
    }).pipe(
      map(({ guideText, toxicityText, saText }) =>
        buildPayloadFromSourceTexts(
          `smileit_${smileitJobId}_guide.csv`,
          normalizeSmilesGuideCsv(guideText, `smileit_${smileitJobId}_guide.csv`),
          toxicityText === null
            ? null
            : {
                filename: `toxicity_${toxicityJobId}_report.csv`,
                contentText: toxicityText,
              },
          saText === null
            ? null
            : {
                filename: `sa_score_${saScoreJobId}_${selection.saMethod}.csv`,
                contentText: saText,
              },
        ),
      ),
    );
  }

  launchAutoFillFromSmileitJob(
    smileitJobId: string,
    saMethod: SaScoreMethod,
  ): Observable<CadmaQuickLaunchPayload> {
    const normalizedJobId = smileitJobId.trim();
    if (normalizedJobId === '') {
      return throwError(
        () => new Error('Select a Smile-it job before generating Toxicity or SA Score reports.'),
      );
    }

    return this.jobsApi.downloadSmileitCsvReport(normalizedJobId).pipe(
      switchMap((report) => from(report.blob.text())),
      switchMap((guideText) => {
        const guideFilename = `smileit_${normalizedJobId}_guide.csv`;
        const guideCsv = normalizeSmilesGuideCsv(guideText, guideFilename);
        const molecules = extractNamedMoleculesFromConfig(
          buildGuideConfig(guideFilename, guideCsv),
        );

        if (molecules.length === 0) {
          return throwError(
            () => new Error('The selected Smile-it job does not expose usable named molecules.'),
          );
        }

        return this.jobsApi
          .validateSmilesCompatibility(molecules.map((molecule) => molecule.smiles))
          .pipe(
            switchMap((validationResult) => {
              if (!validationResult.compatible) {
                return throwError(
                  () =>
                    new Error(
                      'The selected Smile-it job contains unsupported SMILES. Review the imported guide first.',
                    ),
                );
              }

              return forkJoin({
                toxicityJob: this.jobsApi.dispatchToxicityPropertiesJob({
                  molecules,
                  version: '1.0.0',
                }),
                saJob: this.jobsApi.dispatchSaScoreJob({
                  molecules,
                  methods: [saMethod],
                  version: '1.0.0',
                }),
              });
            }),
            switchMap(({ toxicityJob, saJob }) =>
              forkJoin({
                toxicityJobId: of(toxicityJob.id),
                saJobId: of(saJob.id),
                toxicityText: this.waitForToxicityReportCsv(toxicityJob.id, toxicityJob.status),
                saText: this.waitForSaReportCsv(saJob.id, saJob.status, saMethod),
              }),
            ),
            map(
              ({ toxicityJobId, saJobId, toxicityText, saText }) =>
                ({
                  ...buildPayloadFromSourceTexts(
                    guideFilename,
                    guideCsv,
                    {
                      filename: `toxicity_${toxicityJobId}_report.csv`,
                      contentText: toxicityText,
                    },
                    {
                      filename: `sa_score_${saJobId}_${saMethod}.csv`,
                      contentText: saText,
                    },
                  ),
                  launchedToxicityJobId: toxicityJobId,
                  launchedSaScoreJobId: saJobId,
                }) satisfies CadmaQuickLaunchPayload,
            ),
          );
      }),
    );
  }

  launchAutoFillFromCurrentGuide(
    sourceConfigsJson: string,
    saMethod: SaScoreMethod,
  ): Observable<CadmaQuickLaunchPayload> {
    const resolvedGuide = resolveGuideFromConfigs(parseSerializedSourceConfigs(sourceConfigsJson));

    if (resolvedGuide.molecules.length === 0) {
      return throwError(
        () =>
          new Error(
            'Upload a candidate guide with SMILES and names before launching SA Score or Toxicity quick fill.',
          ),
      );
    }

    const needsToxicity = !resolvedGuide.hasToxicityData;
    const needsSa = !resolvedGuide.hasSaData;

    if (!needsToxicity && !needsSa) {
      return throwError(
        () =>
          new Error(
            'This candidate guide already includes toxicity and SA values. You can run CADMA directly.',
          ),
      );
    }

    return this.jobsApi
      .validateSmilesCompatibility(resolvedGuide.molecules.map((molecule) => molecule.smiles))
      .pipe(
        switchMap((validationResult) => {
          if (!validationResult.compatible) {
            return throwError(
              () =>
                new Error(
                  'The current candidate guide contains unsupported SMILES. Review the imported names and structures first.',
                ),
            );
          }

          return forkJoin({
            toxicityJob: needsToxicity
              ? this.jobsApi.dispatchToxicityPropertiesJob({
                  molecules: resolvedGuide.molecules,
                  version: '1.0.0',
                })
              : of(null),
            saJob: needsSa
              ? this.jobsApi.dispatchSaScoreJob({
                  molecules: resolvedGuide.molecules,
                  methods: [saMethod],
                  version: '1.0.0',
                })
              : of(null),
          });
        }),
        switchMap(({ toxicityJob, saJob }) =>
          forkJoin({
            toxicityJobId: of(toxicityJob?.id ?? ''),
            saJobId: of(saJob?.id ?? ''),
            toxicityText:
              toxicityJob === null
                ? of(null)
                : this.waitForToxicityReportCsv(toxicityJob.id, toxicityJob.status),
            saText:
              saJob === null ? of(null) : this.waitForSaReportCsv(saJob.id, saJob.status, saMethod),
          }),
        ),
        map(
          ({ toxicityJobId, saJobId, toxicityText, saText }) =>
            ({
              ...buildPayloadFromSourceTexts(
                resolvedGuide.guideFilename,
                resolvedGuide.guideCsv,
                toxicityText === null
                  ? null
                  : {
                      filename: `toxicity_${toxicityJobId}_report.csv`,
                      contentText: toxicityText,
                    },
                saText === null
                  ? null
                  : {
                      filename: `sa_score_${saJobId}_${saMethod}.csv`,
                      contentText: saText,
                    },
              ),
              launchedToxicityJobId: toxicityJobId,
              launchedSaScoreJobId: saJobId,
            }) satisfies CadmaQuickLaunchPayload,
        ),
      );
  }

  private waitForToxicityReportCsv(
    jobId: string,
    initialStatus: string | null | undefined,
  ): Observable<string> {
    return this.waitForJobCompletion(jobId, initialStatus, (resolvedJobId) =>
      this.jobsApi.getToxicityPropertiesJobStatus(resolvedJobId),
    ).pipe(
      switchMap(() => this.jobsApi.downloadToxicityPropertiesCsvReport(jobId)),
      switchMap((report) => from(report.blob.text())),
    );
  }

  private waitForSaReportCsv(
    jobId: string,
    initialStatus: string | null | undefined,
    saMethod: SaScoreMethod,
  ): Observable<string> {
    return this.waitForJobCompletion(jobId, initialStatus, (resolvedJobId) =>
      this.jobsApi.getSaScoreJobStatus(resolvedJobId),
    ).pipe(
      switchMap(() => this.jobsApi.downloadSaScoreCsvMethodReport(jobId, saMethod)),
      switchMap((report) => from(report.blob.text())),
    );
  }

  private waitForJobCompletion<T extends { status?: string | null }>(
    jobId: string,
    initialStatus: string | null | undefined,
    getStatus: (jobId: string) => Observable<T>,
  ): Observable<void> {
    const normalizedStatus = initialStatus?.toLowerCase() ?? '';
    if (normalizedStatus === 'completed') {
      return of(void 0);
    }

    return this.jobsApi.pollJobUntilCompleted(jobId).pipe(
      last(),
      switchMap(() => getStatus(jobId)),
      switchMap((jobResponse) => {
        const finalStatus = String(jobResponse.status ?? '').toLowerCase();
        return finalStatus === 'completed'
          ? of(void 0)
          : throwError(
              () =>
                new Error(
                  `The launched job ${jobId} finished with status ${finalStatus || 'unknown'}.`,
                ),
            );
      }),
    );
  }

  private sortRecentJobs(jobs: ScientificJobView[]): ScientificJobView[] {
    return [...jobs].sort(
      (leftJob, rightJob) =>
        new Date(rightJob.updated_at).getTime() - new Date(leftJob.updated_at).getTime(),
    );
  }
}
