import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { API_BASE_URL } from '../shared/constants';
import { CadmaPyApiService } from './cadma-py-api.service';

describe('CadmaPyApiService', () => {
  let service: CadmaPyApiService;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), CadmaPyApiService] });
    service = TestBed.inject(CadmaPyApiService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('builds CRUD, sample and row requests with JSON payloads', () => {
    service.listReferenceLibraries().subscribe();
    expect(http.expectOne(`${API_BASE_URL}/api/cadma-py/jobs/reference-libraries/`).request.method).toBe('GET');
    service.createReferenceLibrary({ name: 'x', disease_name: 'd', description: '  ', paper_url: '' }).subscribe();
    expect(http.expectOne((request) => request.method === 'POST').request.body).toEqual({ name: 'x', disease_name: 'd' });
    service.updateReferenceLibrary('id', { name: 'new' }).subscribe();
    expect(http.expectOne((request) => request.method === 'PATCH').request.url).toContain('/id/');
    service.deleteReferenceLibrary('id', true).subscribe();
    expect(http.expectOne((request) => request.method === 'DELETE').request.params.get('cascade')).toBe('true');
    service.forkReferenceLibrary('id', '  Copy ').subscribe();
    expect(http.expectOne((request) => request.method === 'POST').request.body).toEqual({ new_name: 'Copy' });
    service.listReferenceSamples().subscribe();
    service.previewReferenceSample('neuro').subscribe();
    service.previewReferenceSampleDetail('neuro').subscribe();
    expect(http.match((request) => request.method === 'GET')).toHaveLength(3);
    service.patchReferenceRow('id', 0, { name: 'A' }).subscribe();
    service.deleteReferenceRow('id', 0).subscribe();
    service.addCompoundToLibrary('id', { smiles: 'CCO' }).subscribe();
    expect(http.match((request) => request.url.includes('/rows/'))).toHaveLength(3);
  });

  it('uses FormData for files and preserves boolean fields', () => {
    const file = new File(['x'], 'input.csv', { type: 'text/csv' });
    service.createComparisonJob({ reference_library_id: 'id', combined_file: file, start_paused: true }).subscribe();
    const request = http.expectOne((candidate) => candidate.method === 'POST');
    expect(request.request.body).toBeInstanceOf(FormData);
    expect((request.request.body as FormData).get('combined_file')).toBe(file);
    expect((request.request.body as FormData).get('start_paused')).toBe('true');
  });
});
