// smiles-structure-preview.service.ts: Servicio reutilizable para resolver y cachear vistas estructurales a partir de SMILES.

import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, shareReplay, throwError } from 'rxjs';
import { JobsApiService, SmileitStructureInspectionView } from '../api/jobs-api.service';

export interface SmilesStructurePreviewView {
  smiles: string;
  canonicalSmiles: string;
  svg: string;
  atomCount: number;
}

@Injectable({
  providedIn: 'root',
})
export class SmilesStructurePreviewService {
  private readonly jobsApiService = inject(JobsApiService);
  private readonly previewsBySmiles: Map<string, Observable<SmilesStructurePreviewView>> =
    new Map();

  getPreview(smiles: string): Observable<SmilesStructurePreviewView> {
    const normalizedSmiles: string = smiles.trim();
    const cachedPreview: Observable<SmilesStructurePreviewView> | undefined =
      this.previewsBySmiles.get(normalizedSmiles);

    if (cachedPreview !== undefined) {
      return cachedPreview;
    }

    const previewRequest: Observable<SmilesStructurePreviewView> = this.jobsApiService
      .inspectSmileitStructure(normalizedSmiles)
      .pipe(
        map((inspection: SmileitStructureInspectionView) =>
          this.fromInspection(inspection, normalizedSmiles),
        ),
        catchError((error: unknown) => {
          this.previewsBySmiles.delete(normalizedSmiles);
          return throwError(() => error);
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );

    this.previewsBySmiles.set(normalizedSmiles, previewRequest);
    return previewRequest;
  }

  fromInspection(
    inspection: SmileitStructureInspectionView,
    fallbackSmiles: string,
  ): SmilesStructurePreviewView {
    return {
      smiles: fallbackSmiles,
      canonicalSmiles: inspection.canonicalSmiles,
      svg: inspection.svg,
      atomCount: inspection.atomCount,
    };
  }

  fromSvg(smiles: string, svg: string): SmilesStructurePreviewView {
    const normalizedSmiles: string = smiles.trim();
    return {
      smiles: normalizedSmiles,
      canonicalSmiles: normalizedSmiles,
      svg,
      atomCount: 0,
    };
  }
}
