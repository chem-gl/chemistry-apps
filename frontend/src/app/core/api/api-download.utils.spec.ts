// api-download.utils.spec.ts: Pruebas unitarias de las utilidades de descarga de reportes.
// Cubre los casos de extracción de nombre de archivo por regex (UTF-8, regular y fallback).

import { HttpHeaders, HttpResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';

import { extractFilenameFromHeader, normalizeDownloadedReport } from './api-download.utils';

describe('extractFilenameFromHeader', () => {
  it('retorna el fallback cuando el header es null', () => {
    expect(extractFilenameFromHeader(null, 'report.csv')).toBe('report.csv');
  });

  it('extrae el nombre en formato UTF-8 y lo decodifica', () => {
    const header = "attachment; filename*=UTF-8''reporte%20final.csv";
    expect(extractFilenameFromHeader(header, 'fallback.csv')).toBe('reporte final.csv');
  });

  it('extrae el nombre en formato regular sin comillas', () => {
    const header = 'attachment; filename=report.xlsx';
    expect(extractFilenameFromHeader(header, 'fallback.xlsx')).toBe('report.xlsx');
  });

  it('extrae el nombre en formato regular con comillas', () => {
    const header = 'attachment; filename="data_export.zip"';
    expect(extractFilenameFromHeader(header, 'fallback.zip')).toBe('data_export.zip');
  });

  it('prefiere el formato UTF-8 sobre el regular cuando ambos están presentes', () => {
    const header =
      "attachment; filename=\"plain.csv\"; filename*=UTF-8''encoded%20v2.csv";
    expect(extractFilenameFromHeader(header, 'fallback.csv')).toBe('encoded v2.csv');
  });

  it('retorna el fallback cuando el header no contiene filename válido', () => {
    const header = 'attachment; inline';
    expect(extractFilenameFromHeader(header, 'default.txt')).toBe('default.txt');
  });

  it('retorna el fallback cuando filename está vacío', () => {
    const header = 'attachment; filename=""';
    expect(extractFilenameFromHeader(header, 'fallback.csv')).toBe('fallback.csv');
  });

  it('ignora mayúsculas en el nombre del parámetro', () => {
    const header = 'attachment; FILENAME=uppercase.csv';
    expect(extractFilenameFromHeader(header, 'fallback.csv')).toBe('uppercase.csv');
  });
});

describe('normalizeDownloadedReport', () => {
  const makeResponse = (
    body: Blob | null,
    headers: Record<string, string> = {},
  ): HttpResponse<Blob> => {
    const httpHeaders = new HttpHeaders(headers);
    return new HttpResponse<Blob>({ body, headers: httpHeaders, status: 200 });
  };

  it('lanza error cuando el body está vacío', () => {
    const response = makeResponse(null);
    expect(() => normalizeDownloadedReport(response, 'report.csv')).toThrow(
      'Backend report response is empty.',
    );
  });

  it('extrae el nombre del Content-Disposition cuando está presente', () => {
    const blob = new Blob(['data'], { type: 'text/csv' });
    const response = makeResponse(blob, {
      'content-disposition': 'attachment; filename="structure_results.csv"',
    });
    const result = normalizeDownloadedReport(response, 'fallback.csv');
    expect(result.filename).toBe('structure_results.csv');
    expect(result.blob).toBe(blob);
  });

  it('usa el fallback cuando no hay header Content-Disposition', () => {
    const blob = new Blob(['data'], { type: 'application/json' });
    const response = makeResponse(blob);
    const result = normalizeDownloadedReport(response, 'default-export.json');
    expect(result.filename).toBe('default-export.json');
    expect(result.blob).toBe(blob);
  });
});
