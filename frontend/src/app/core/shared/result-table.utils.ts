// result-table.utils.ts: Utilidades compartidas para búsqueda y ordenamiento de tablas
// de resultados científicas del frontend. Se usan para mantener una experiencia
// consistente entre SA Score y Toxicity Properties sin duplicar lógica.

export type ResultTableSortDirection = 'asc' | 'desc';

export interface ResultTableSortState<TColumn extends string> {
  column: TColumn;
  direction: ResultTableSortDirection;
}

export function matchesResultTableQuery(
  candidateValues: Array<string | null | undefined>,
  rawQuery: string,
): boolean {
  const normalizedTokens: string[] = rawQuery
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((tokenValue: string) => tokenValue.length > 0);

  if (normalizedTokens.length === 0) {
    return true;
  }

  const haystack: string = candidateValues
    .map((value: string | null | undefined) => (value ?? '').trim().toLowerCase())
    .filter((value: string) => value.length > 0)
    .join(' ');

  return normalizedTokens.every((tokenValue: string) => haystack.includes(tokenValue));
}

export function compareResultTableText(leftValue: string, rightValue: string): number {
  return leftValue.localeCompare(rightValue, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

export function compareNullableResultTableNumber(
  leftValue: number | null,
  rightValue: number | null,
): number {
  if (leftValue === null && rightValue === null) {
    return 0;
  }
  if (leftValue === null) {
    return 1;
  }
  if (rightValue === null) {
    return -1;
  }
  return leftValue - rightValue;
}

export function applyResultTableSortDirection(
  rawComparison: number,
  direction: ResultTableSortDirection,
): number {
  return direction === 'asc' ? rawComparison : -rawComparison;
}

export function nextResultTableSortState<TColumn extends string>(
  currentState: ResultTableSortState<TColumn>,
  nextColumn: TColumn,
): ResultTableSortState<TColumn> {
  if (currentState.column !== nextColumn) {
    return { column: nextColumn, direction: 'asc' };
  }

  return {
    column: nextColumn,
    direction: currentState.direction === 'asc' ? 'desc' : 'asc',
  };
}
