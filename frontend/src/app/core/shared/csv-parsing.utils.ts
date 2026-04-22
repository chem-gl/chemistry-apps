// csv-parsing.utils.ts: Utilidades compartidas para parsear filas CSV con comillas.

export function splitDelimitedLine(lineValue: string, delimiter: string): string[] {
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
