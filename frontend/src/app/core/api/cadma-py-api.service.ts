// cadma-py-api.service.ts: Wrapper estable para la API manual de CADMA Py.
// Centraliza CRUD de familias de referencia y despacho del job de comparación.

import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../shared/constants';
import { ScientificJobView } from './jobs-api.service';

export interface CadmaReferenceRowView {
  name: string;
  smiles: string;
  MW: number;
  logP: number;
  MR: number;
  AtX: number;
  HBLA: number;
  HBLD: number;
  RB: number;
  PSA: number;
  DT: number;
  M: number;
  LD50: number;
  SA: number;
  paper_reference: string;
  paper_url: string;
  evidence_note: string;
}

export interface CadmaReferenceSourceFileView {
  id: string;
  field_name: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  created_at: string;
}

export interface CadmaReferenceLibraryView {
  id: string;
  name: string;
  disease_name: string;
  description: string;
  source_reference: string;
  group_id: number | null;
  created_by_id: number | null;
  created_by_name: string;
  editable: boolean;
  deletable: boolean;
  forkable: boolean;
  row_count: number;
  rows: CadmaReferenceRowView[];
  source_file_count: number;
  source_files: CadmaReferenceSourceFileView[];
  paper_reference: string;
  paper_url: string;
  created_at: string;
  updated_at: string;
}

export interface CadmaLinkedJobView {
  id: string;
  status: string;
  created_at: string;
  project_label: string;
}

export interface CadmaDeletionPreview {
  library_id: string;
  library_name: string;
  linked_job_count: number;
  linked_jobs: CadmaLinkedJobView[];
}

export interface CadmaReferenceSampleView {
  key: string;
  name: string;
  disease_name: string;
  description: string;
  row_count: number;
  source_note: string;
}

export interface CadmaSamplePreviewRowView {
  name: string;
  smiles: string;
}

export interface CadmaReferenceLibraryWritePayload {
  name: string;
  disease_name: string;
  description?: string;
  paper_reference?: string;
  paper_url?: string;
  combined_csv_text?: string;
  smiles_csv_text?: string;
  toxicity_csv_text?: string;
  sa_csv_text?: string;
  combined_file?: File | null;
  smiles_file?: File | null;
  toxicity_file?: File | null;
  sa_file?: File | null;
  source_configs_json?: string;
}

export interface CadmaMetricSummaryView {
  metric: string;
  mean: number;
  stdev: number;
  min_value: number;
  max_value: number;
}

export interface CadmaRankingRowView {
  name: string;
  smiles: string;
  selection_score: number;
  adme_alignment: number;
  toxicity_alignment: number;
  sa_alignment: number;
  adme_hits_in_band: number;
  MW?: number;
  logP?: number;
  MR?: number;
  AtX?: number;
  HBLA?: number;
  HBLD?: number;
  RB?: number;
  PSA?: number;
  DT?: number;
  M?: number;
  LD50?: number;
  SA?: number;
  metrics_in_band: string[];
  best_fit_summary: string;
}

export interface CadmaScoreChartView {
  categories: string[];
  values: number[];
  reference_line: number;
}

export interface CadmaMetricChartView {
  metric: string;
  label: string;
  categories: string[];
  values: number[];
  reference_mean: number;
  reference_low: number;
  reference_high: number;
  better_direction: 'balanced' | 'higher' | 'lower';
}

export interface CadmaIntervalRangeView {
  min: number;
  max: number;
}

export interface CadmaScoreWeightsView {
  adme: number;
  toxicity: number;
  sa: number;
}

export interface CadmaReferenceValuesView {
  LD50: number;
  M: number;
  DT: number;
  SA: number;
}

export interface CadmaScoreConfigView {
  adme_intervals: Record<string, CadmaIntervalRangeView>;
  weights: CadmaScoreWeightsView;
  reference_values: CadmaReferenceValuesView;
  adme_reference_hits: number;
}

export interface CadmaPyResultView {
  library_name: string;
  disease_name: string;
  reference_count: number;
  candidate_count: number;
  reference_stats: CadmaMetricSummaryView[];
  ranking: CadmaRankingRowView[];
  score_chart: CadmaScoreChartView;
  metric_charts: CadmaMetricChartView[];
  score_config: CadmaScoreConfigView;
  methodology_note: string;
}

export interface CadmaPyJobCreatePayload {
  reference_library_id: string;
  project_label?: string;
  combined_csv_text?: string;
  smiles_csv_text?: string;
  toxicity_csv_text?: string;
  sa_csv_text?: string;
  combined_file?: File | null;
  smiles_file?: File | null;
  toxicity_file?: File | null;
  sa_file?: File | null;
  source_configs_json?: string;
  score_config_json?: string;
  start_paused?: boolean;
}

export interface CadmaReferenceRowPatchPayload {
  name?: string;
  paper_reference?: string;
  paper_url?: string;
  evidence_note?: string;
}

export interface CadmaCompoundAddPayload {
  smiles: string;
  name?: string;
  paper_reference?: string;
  paper_url?: string;
  evidence_note?: string;
  toxicity_dt?: number | null;
  toxicity_m?: number | null;
  toxicity_ld50?: number | null;
  sa_score?: number | null;
}

type CadmaRequestValue = string | boolean | File | null | undefined;
type CadmaWritablePayload =
  | CadmaReferenceLibraryWritePayload
  | Partial<CadmaReferenceLibraryWritePayload>
  | CadmaPyJobCreatePayload;

@Injectable({ providedIn: 'root' })
export class CadmaPyApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${API_BASE_URL}/api/cadma-py/jobs`;

  private buildRequestBody(
    payload: CadmaWritablePayload,
  ): FormData | Record<string, string | boolean> {
    const normalizedPayload = payload as Record<string, CadmaRequestValue>;
    const hasFiles = Object.values(normalizedPayload).some((value) => value instanceof File);
    if (!hasFiles) {
      return Object.fromEntries(
        Object.entries(normalizedPayload)
          .filter(
            ([, value]) =>
              typeof value === 'boolean' || (typeof value === 'string' && value.trim() !== ''),
          )
          .map(([key, value]) => [key, value as string | boolean]),
      );
    }

    const formData = new FormData();
    for (const [key, value] of Object.entries(normalizedPayload)) {
      if (value === null || value === undefined) {
        continue;
      }
      if (value instanceof File) {
        formData.append(key, value);
        continue;
      }
      if (typeof value === 'boolean') {
        formData.append(key, value ? 'true' : 'false');
        continue;
      }
      if (value.trim() !== '') {
        formData.append(key, value);
      }
    }
    return formData;
  }

  listReferenceLibraries(): Observable<CadmaReferenceLibraryView[]> {
    return this.http.get<CadmaReferenceLibraryView[]>(`${this.baseUrl}/reference-libraries/`);
  }

  createReferenceLibrary(
    payload: CadmaReferenceLibraryWritePayload,
  ): Observable<CadmaReferenceLibraryView> {
    return this.http.post<CadmaReferenceLibraryView>(
      `${this.baseUrl}/reference-libraries/`,
      this.buildRequestBody(payload),
    );
  }

  updateReferenceLibrary(
    libraryId: string,
    payload: Partial<CadmaReferenceLibraryWritePayload>,
  ): Observable<CadmaReferenceLibraryView> {
    return this.http.patch<CadmaReferenceLibraryView>(
      `${this.baseUrl}/reference-libraries/${libraryId}/`,
      this.buildRequestBody(payload),
    );
  }

  deleteReferenceLibrary(libraryId: string, cascade: boolean = false): Observable<void> {
    const params = cascade ? { params: { cascade: 'true' } } : {};
    return this.http.delete<void>(`${this.baseUrl}/reference-libraries/${libraryId}/`, params);
  }

  previewLibraryDeletion(libraryId: string): Observable<CadmaDeletionPreview> {
    return this.http.get<CadmaDeletionPreview>(
      `${this.baseUrl}/reference-libraries/${libraryId}/deletion-preview/`,
    );
  }

  forkReferenceLibrary(libraryId: string, newName?: string): Observable<CadmaReferenceLibraryView> {
    return this.http.post<CadmaReferenceLibraryView>(
      `${this.baseUrl}/reference-libraries/${libraryId}/fork/`,
      { new_name: newName?.trim() ?? '' },
    );
  }

  listReferenceSamples(): Observable<CadmaReferenceSampleView[]> {
    return this.http.get<CadmaReferenceSampleView[]>(`${this.baseUrl}/reference-samples/`);
  }

  importReferenceSample(
    sampleKey: string,
    newName?: string,
  ): Observable<CadmaReferenceLibraryView> {
    return this.http.post<CadmaReferenceLibraryView>(`${this.baseUrl}/reference-samples/import/`, {
      sample_key: sampleKey,
      new_name: newName?.trim() ?? '',
    });
  }

  previewReferenceSample(sampleKey: string): Observable<CadmaSamplePreviewRowView[]> {
    return this.http.get<CadmaSamplePreviewRowView[]>(
      `${this.baseUrl}/reference-samples/${sampleKey}/preview/`,
    );
  }

  previewReferenceSampleDetail(sampleKey: string): Observable<CadmaReferenceLibraryView> {
    return this.http.get<CadmaReferenceLibraryView>(
      `${this.baseUrl}/reference-samples/${sampleKey}/detail/`,
    );
  }

  patchReferenceRow(
    libraryId: string,
    rowIndex: number,
    patch: CadmaReferenceRowPatchPayload,
  ): Observable<CadmaReferenceRowView> {
    return this.http.patch<CadmaReferenceRowView>(
      `${this.baseUrl}/reference-libraries/${libraryId}/rows/${rowIndex}/`,
      patch,
    );
  }

  deleteReferenceRow(libraryId: string, rowIndex: number): Observable<void> {
    return this.http.delete<void>(
      `${this.baseUrl}/reference-libraries/${libraryId}/rows/${rowIndex}/`,
    );
  }

  addCompoundToLibrary(
    libraryId: string,
    payload: CadmaCompoundAddPayload,
  ): Observable<CadmaReferenceRowView> {
    return this.http.post<CadmaReferenceRowView>(
      `${this.baseUrl}/reference-libraries/${libraryId}/rows/`,
      payload,
    );
  }

  createComparisonJob(payload: CadmaPyJobCreatePayload): Observable<ScientificJobView> {
    return this.http.post<ScientificJobView>(`${this.baseUrl}/`, this.buildRequestBody(payload));
  }
}
