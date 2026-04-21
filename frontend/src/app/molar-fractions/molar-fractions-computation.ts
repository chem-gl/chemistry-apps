// molar-fractions-computation.ts: Utilidades puras para etiquetas, cálculo y procesamiento batch CSV.
// Mantiene la lógica alineada con el notebook legado para reutilizarla desde la UI sin persistencia.

export type InitialChargeValue = number | string;

export const MIN_RANGE_PH_STEP = 0.05;
export const MIN_RANGE_PH_POINTS = 8;
export const MAX_RANGE_PH_POINTS = 350;

export interface BatchSpeciesRow {
  acronym: string;
  smiles: string;
  pkaValues: number[];
  pkaValuesText: string;
  initialCharge: InitialChargeValue;
  pH: number;
  speciesIndex: number;
  totalPkaCount: number;
  protonCount: number;
  species: string;
  speciesAscii: string;
  charge: InitialChargeValue;
  fraction: number;
}

interface BatchCompoundInput {
  acronym: string;
  smiles: string;
  initialCharge: InitialChargeValue;
  pkaValues: number[];
}

interface SpeciesLabelPayload {
  labelsPretty: string[];
  labelsAscii: string[];
  charges: InitialChargeValue[];
}

export interface SpeciesLabelDisplayParts {
  baseLabel: string;
  chargeLabel: string | null;
}

function getNonEmptyLines(csvText: string): string[] {
  return csvText
    .split(/\r?\n/u)
    .map((lineValue) => lineValue.trim())
    .filter(Boolean);
}

function formatPkaValue(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toString();
}

const SUBSCRIPT_MAP: Record<string, string> = {
  '0': '₀',
  '1': '₁',
  '2': '₂',
  '3': '₃',
  '4': '₄',
  '5': '₅',
  '6': '₆',
  '7': '₇',
  '8': '₈',
  '9': '₉',
};

const SUPERSCRIPT_MAP: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '-': '⁻',
  '+': '⁺',
  q: 'q',
  '(': '⁽',
  ')': '⁾',
};

const SUPERSCRIPT_TO_PLAIN_MAP: Record<string, string> = {
  '⁰': '0',
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
  '⁻': '-',
  '⁺': '+',
  '⁽': '(',
  '⁾': ')',
};

const SYMBOLIC_CHARGE_SUFFIX_REGEX = /q[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺⁽⁾]*$/u;
const NUMERIC_CHARGE_SUFFIX_REGEX = /[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺⁽⁾]+$/u;

function translateDigits(value: string, map: Record<string, string>): string {
  return value
    .split('')
    .map((character) => map[character] ?? character)
    .join('');
}

function normalizeSuperscriptText(value: string): string {
  return value
    .split('')
    .map((character) => SUPERSCRIPT_TO_PLAIN_MAP[character] ?? character)
    .join('');
}

export function splitSpeciesLabelForDisplay(speciesLabel: string): SpeciesLabelDisplayParts {
  const trimmedLabel = speciesLabel.trim();
  if (trimmedLabel === '') {
    return { baseLabel: '', chargeLabel: null };
  }

  const symbolicChargeMatch = SYMBOLIC_CHARGE_SUFFIX_REGEX.exec(trimmedLabel);
  if (symbolicChargeMatch?.index !== undefined) {
    return {
      baseLabel: trimmedLabel.slice(0, symbolicChargeMatch.index),
      chargeLabel: normalizeSuperscriptText(symbolicChargeMatch[0]),
    };
  }

  const numericChargeMatch = NUMERIC_CHARGE_SUFFIX_REGEX.exec(trimmedLabel);
  if (numericChargeMatch?.index !== undefined) {
    return {
      baseLabel: trimmedLabel.slice(0, numericChargeMatch.index),
      chargeLabel: normalizeSuperscriptText(numericChargeMatch[0]),
    };
  }

  return { baseLabel: trimmedLabel, chargeLabel: null };
}

function validatePkaValues(pkaValues: number[]): void {
  if (pkaValues.length === 0) {
    throw new Error('pKa values must contain at least one value.');
  }

  if (pkaValues.some((value) => !Number.isFinite(value))) {
    throw new Error('All pKa values must be finite numbers.');
  }

  for (let index = 1; index < pkaValues.length; index += 1) {
    if ((pkaValues[index] ?? 0) < (pkaValues[index - 1] ?? 0)) {
      throw new Error('pKa values must be in ascending order.');
    }
  }
}

export function estimatePhRangePointCount(phMin: number, phMax: number, phStep: number): number {
  if (
    !Number.isFinite(phMin) ||
    !Number.isFinite(phMax) ||
    !Number.isFinite(phStep) ||
    phStep <= 0
  ) {
    return 0;
  }

  const normalizedMin = Math.min(phMin, phMax);
  const normalizedMax = Math.max(phMin, phMax);
  const span = normalizedMax - normalizedMin;
  const epsilon = Math.max(phStep * 1e-6, 1e-9);
  return Math.floor((span + epsilon) / phStep) + 1;
}

export function validatePhRangeConstraints(
  phMin: number,
  phMax: number,
  phStep: number,
): string | null {
  if (!Number.isFinite(phMin) || !Number.isFinite(phMax) || !Number.isFinite(phStep)) {
    return 'Los valores del rango de pH deben ser numéricos.';
  }

  if (phStep < MIN_RANGE_PH_STEP) {
    return `El paso de pH debe ser de al menos ${MIN_RANGE_PH_STEP}.`;
  }

  const totalPoints = estimatePhRangePointCount(phMin, phMax, phStep);
  if (totalPoints < MIN_RANGE_PH_POINTS) {
    return `El rango de pH debe generar al menos ${MIN_RANGE_PH_POINTS} datos.`;
  }

  if (totalPoints > MAX_RANGE_PH_POINTS) {
    return `El rango de pH no puede generar más de ${MAX_RANGE_PH_POINTS} datos.`;
  }

  return null;
}

function splitDelimitedLine(lineValue: string, delimiter: string): string[] {
  const cells: string[] = [];
  let currentCell = '';
  let insideQuotes = false;

  let index = 0;
  while (index < lineValue.length) {
    const currentCharacter = lineValue[index] ?? '';
    const nextCharacter = lineValue[index + 1] ?? '';

    if (currentCharacter === '"') {
      if (insideQuotes && nextCharacter === '"') {
        currentCell += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (!insideQuotes && currentCharacter === delimiter) {
      cells.push(currentCell.trim());
      currentCell = '';
    } else {
      currentCell += currentCharacter;
    }

    index += 1;
  }

  cells.push(currentCell.trim());
  return cells;
}

function normalizeHeaderToken(rawValue: string): string {
  return rawValue
    .replaceAll('\uFEFF', '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replaceAll(/[\u0300-\u036f]/g, '')
    .replaceAll(/[\s_\-.]+/g, '');
}

function resolveCsvDelimiter(csvText: string): string {
  const nonEmptyLines = getNonEmptyLines(csvText);

  const headerLine = nonEmptyLines[0] ?? '';
  const commaCells = splitDelimitedLine(headerLine, ',').length;
  const tabCells = splitDelimitedLine(headerLine, '\t').length;
  return tabCells > commaCells ? '\t' : ',';
}

function resolveHeaderIndexMap(headerCells: string[]): Record<string, number> {
  const normalizedHeaders = headerCells.map(normalizeHeaderToken);
  const headerIndexMap = new Map<string, number>();
  normalizedHeaders.forEach((headerToken, index) => {
    headerIndexMap.set(headerToken, index);
  });

  const aliases: Record<string, string[]> = {
    acronym: ['acronym', 'acronimo'],
    smiles: ['smiles'],
    initialCharge: ['initialcharge', 'cargadelaespeciemaximamenteprotonada'],
    pkaValues: ['pkavalues', 'valoresdepka', 'pka'],
  };

  const resolvedMap: Record<string, number> = {};
  for (const [fieldName, candidates] of Object.entries(aliases)) {
    const resolvedIndex = candidates
      .map((candidate) => headerIndexMap.get(candidate))
      .find((value): value is number => value !== undefined);

    if (resolvedIndex === undefined) {
      throw new Error(`Missing required CSV column for ${fieldName}.`);
    }

    resolvedMap[fieldName] = resolvedIndex;
  }

  return resolvedMap;
}

function formatNumericChargeUnicode(charge: number): string {
  if (charge === 0) {
    return '';
  }
  if (charge === 1) {
    return '⁺';
  }
  if (charge === -1) {
    return '⁻';
  }
  if (charge > 1) {
    return `${translateDigits(String(charge), SUPERSCRIPT_MAP)}⁺`;
  }
  return `${translateDigits(String(Math.abs(charge)), SUPERSCRIPT_MAP)}⁻`;
}

function symbolicChargeValue(initialCharge: InitialChargeValue, index: number): InitialChargeValue {
  if (initialCharge === 'q') {
    return index === 0 ? 'q' : (`q-${index}` as const);
  }
  if (typeof initialCharge !== 'number') {
    throw new TypeError('Initial charge must be numeric when using arithmetic operations.');
  }
  return initialCharge - index;
}

function protonPrefixUnicode(protonCount: number, label: string): string {
  if (protonCount === 0) {
    return label;
  }
  if (protonCount === 1) {
    return `H${label}`;
  }
  return `H${translateDigits(String(protonCount), SUBSCRIPT_MAP)}${label}`;
}

function protonPrefixAscii(protonCount: number, label: string): string {
  if (protonCount === 0) {
    return label;
  }
  if (protonCount === 1) {
    return `H${label}`;
  }
  return `H${protonCount}${label}`;
}

function formatSpeciesLabel(
  protonCount: number,
  label: string,
  charge: InitialChargeValue,
): string {
  const baseLabel = protonPrefixUnicode(protonCount, label);

  if (charge === 'q') {
    return `${baseLabel}q`;
  }

  if (typeof charge === 'string') {
    const [, suffix = ''] = charge.split('-');
    const suffixText = `-${suffix}`;
    return `${baseLabel}q${translateDigits(suffixText, SUPERSCRIPT_MAP)}`;
  }

  return `${baseLabel}${formatNumericChargeUnicode(charge)}`;
}

function formatAsciiCharge(charge: InitialChargeValue): string {
  if (charge === 'q') {
    return 'q';
  }

  if (typeof charge === 'string') {
    return charge;
  }

  if (charge === 0) {
    return '';
  }
  if (charge === 1) {
    return '+';
  }
  if (charge === -1) {
    return '-';
  }
  if (charge > 1) {
    return `${charge}+`;
  }
  return `${Math.abs(charge)}-`;
}

export function parseInitialCharge(rawValue: unknown): InitialChargeValue {
  if (typeof rawValue === 'number' && Number.isInteger(rawValue)) {
    return rawValue;
  }

  if (typeof rawValue !== 'string') {
    throw new TypeError('Initial charge must be an integer or q.');
  }

  const normalizedValue = rawValue.trim().toLowerCase();
  if (normalizedValue === 'q') {
    return 'q';
  }

  const parsedValue = Number(normalizedValue);
  if (!Number.isInteger(parsedValue)) {
    throw new TypeError('Initial charge must be an integer or q.');
  }

  return parsedValue;
}

export function parsePkaList(rawValue: unknown): number[] {
  if (Array.isArray(rawValue)) {
    return rawValue.map(Number);
  }

  if (typeof rawValue === 'number') {
    return Number.isFinite(rawValue) ? [rawValue] : [];
  }

  if (typeof rawValue !== 'string') {
    throw new TypeError('pKa values must be provided as text, number, or numeric array.');
  }

  const normalizedValue = rawValue.trim();
  if (normalizedValue === '') {
    return [];
  }

  if (normalizedValue.startsWith('[') && normalizedValue.endsWith(']')) {
    return normalizedValue
      .slice(1, -1)
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value));
  }

  const separator = normalizedValue.includes(';') ? ';' : ',';
  if (normalizedValue.includes(separator)) {
    return normalizedValue
      .split(separator)
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value));
  }

  const parsedValue = Number(normalizedValue);
  return Number.isFinite(parsedValue) ? [parsedValue] : [];
}

export function generateSpeciesLabels(
  pkaValues: number[],
  initialCharge: InitialChargeValue = 'q',
  label = 'A',
): SpeciesLabelPayload {
  validatePkaValues(pkaValues);

  const labelsPretty: string[] = [];
  const labelsAscii: string[] = [];
  const charges: InitialChargeValue[] = [];
  for (let index = 0; index < pkaValues.length + 1; index += 1) {
    const protonCount = pkaValues.length - index;
    const charge = symbolicChargeValue(initialCharge, index);
    labelsPretty.push(formatSpeciesLabel(protonCount, label, charge));
    labelsAscii.push(`${protonPrefixAscii(protonCount, label)}${formatAsciiCharge(charge)}`);
    charges.push(charge);
  }

  return {
    labelsPretty,
    labelsAscii,
    charges,
  };
}

export function speciesFractions(pH: number, pkaValues: number[]): number[] {
  validatePkaValues(pkaValues);

  const hydrogenConcentration = 10 ** -pH;
  const kaValues = pkaValues.map((value) => 10 ** -value);
  const kaProducts = new Array<number>(pkaValues.length + 1).fill(1);

  for (let index = 1; index < kaProducts.length; index += 1) {
    kaProducts[index] = (kaProducts[index - 1] ?? 1) * (kaValues[index - 1] ?? 1);
  }

  let denominator = 0;
  for (let index = 0; index < kaProducts.length; index += 1) {
    denominator += (kaProducts[index] ?? 0) * hydrogenConcentration ** (pkaValues.length - index);
  }

  return kaProducts.map(
    (product, index) =>
      (product * hydrogenConcentration ** (pkaValues.length - index)) / denominator,
  );
}

function parseBatchCompoundRows(csvText: string): BatchCompoundInput[] {
  const nonEmptyLines = getNonEmptyLines(csvText);

  if (nonEmptyLines.length < 2) {
    throw new Error('CSV file must contain a header row and at least one data row.');
  }

  const delimiter = resolveCsvDelimiter(csvText);
  const headerCells = splitDelimitedLine(nonEmptyLines[0] ?? '', delimiter);
  const headerIndexMap = resolveHeaderIndexMap(headerCells);

  return nonEmptyLines.slice(1).map((lineValue, rowIndex) => {
    const cells = splitDelimitedLine(lineValue, delimiter);
    const acronym = cells[headerIndexMap['acronym']]?.trim() ?? '';
    const smiles = cells[headerIndexMap['smiles']]?.trim() ?? '';
    const initialCharge = parseInitialCharge(cells[headerIndexMap['initialCharge']] ?? 'q');
    const pkaValues = parsePkaList(cells[headerIndexMap['pkaValues']] ?? '');

    if (acronym === '' || smiles === '') {
      throw new Error(`CSV row ${rowIndex + 2} must include acronym and SMILES.`);
    }

    validatePkaValues(pkaValues);

    return {
      acronym,
      smiles,
      initialCharge,
      pkaValues,
    };
  });
}

export function buildBatchSpeciesRows(
  csvText: string,
  targetPh: number,
  threshold = 0,
): BatchSpeciesRow[] {
  if (!Number.isFinite(targetPh)) {
    throw new TypeError('Target pH must be a finite number.');
  }

  const compoundRows = parseBatchCompoundRows(csvText);
  const resultRows = compoundRows.flatMap((compoundRow) => {
    const labelPayload = generateSpeciesLabels(
      compoundRow.pkaValues,
      compoundRow.initialCharge,
      compoundRow.acronym,
    );
    const fractions = speciesFractions(targetPh, compoundRow.pkaValues);
    const pkaValuesText = compoundRow.pkaValues.map((value) => formatPkaValue(value)).join('; ');

    return fractions.map((fraction, index) => ({
      acronym: compoundRow.acronym,
      smiles: compoundRow.smiles,
      pkaValues: compoundRow.pkaValues,
      pkaValuesText,
      initialCharge: compoundRow.initialCharge,
      pH: targetPh,
      speciesIndex: index,
      totalPkaCount: compoundRow.pkaValues.length,
      protonCount: compoundRow.pkaValues.length - index,
      species: labelPayload.labelsPretty[index] ?? '',
      speciesAscii: labelPayload.labelsAscii[index] ?? '',
      charge: labelPayload.charges[index] ?? 'q',
      fraction,
    }));
  });

  return resultRows
    .filter((rowValue) => rowValue.fraction >= threshold)
    .sort(
      (leftValue, rightValue) =>
        leftValue.acronym.localeCompare(rightValue.acronym) ||
        rightValue.fraction - leftValue.fraction,
    );
}

export function buildBatchCsvContent(rows: BatchSpeciesRow[]): string {
  const header = [
    'Acronym',
    'SMILES',
    'pKaValues',
    'InitialCharge',
    'pH',
    'Species',
    'Species_ASCII',
    'Charge',
    'Fraction',
  ];
  const body = rows.map((rowValue) =>
    [
      rowValue.acronym,
      rowValue.smiles,
      rowValue.pkaValuesText,
      String(rowValue.initialCharge),
      rowValue.pH.toFixed(2),
      rowValue.species,
      rowValue.speciesAscii,
      String(rowValue.charge),
      rowValue.fraction.toString(),
    ].join(','),
  );

  return [header.join(','), ...body].join('\n');
}
