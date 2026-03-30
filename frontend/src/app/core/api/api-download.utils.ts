// api-download.utils.ts: Funciones puras compartidas para descarga de reportes.
// Usadas por todos los sub-servicios API que descargan archivos del backend.

import { HttpResponse } from '@angular/common/http';
import { Observable, map, shareReplay } from 'rxjs';
import type { DownloadedReportFile } from './types';

/**
 * Extrae el nombre de archivo del header Content-Disposition.
 * Soporta formatos UTF-8 y regular; retorna fallback si no hay header.
 */
export function extractFilenameFromHeader(
  contentDispositionHeader: string | null,
  fallbackFilename: string,
): string {
  if (contentDispositionHeader === null) {
    return fallbackFilename;
  }

  const utf8Match: RegExpMatchArray | null =
    contentDispositionHeader.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match !== null) {
    const encodedFilename: string | undefined = utf8Match[1];
    if (encodedFilename !== undefined && encodedFilename.trim() !== '') {
      return decodeURIComponent(encodedFilename.trim());
    }
  }

  const regularMatch: RegExpMatchArray | null =
    contentDispositionHeader.match(/filename="?([^";]+)"?/i);
  if (regularMatch !== null) {
    const rawFilename: string | undefined = regularMatch[1];
    if (rawFilename !== undefined && rawFilename.trim() !== '') {
      return rawFilename.trim();
    }
  }

  return fallbackFilename;
}

/**
 * Normaliza la respuesta HTTP de descarga en un DownloadedReportFile.
 * Lanza error si el body está vacío.
 */
export function normalizeDownloadedReport(
  response: HttpResponse<Blob>,
  fallbackFilename: string,
): DownloadedReportFile {
  const responseBlob: Blob | null = response.body;
  if (responseBlob === null) {
    throw new Error('Backend report response is empty.');
  }

  const contentDispositionHeader: string | null = response.headers.get('content-disposition');
  const filename: string = extractFilenameFromHeader(contentDispositionHeader, fallbackFilename);

  return { filename, blob: responseBlob };
}

/**
 * Operador compartido: transforma un Observable de HttpResponse<Blob>
 * en Observable<DownloadedReportFile> con caching de última emisión.
 */
export function createReportDownload$(
  source$: Observable<HttpResponse<Blob>>,
  fallbackFilename: string,
): Observable<DownloadedReportFile> {
  return source$.pipe(
    map((response: HttpResponse<Blob>) => normalizeDownloadedReport(response, fallbackFilename)),
    shareReplay(1),
  );
}
