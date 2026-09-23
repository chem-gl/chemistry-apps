import { Injectable, inject } from '@angular/core';
import { Observable, from, map, of, shareReplay, switchMap } from 'rxjs';
import { createReportDownload$ } from './api-download.utils';
import {
  EasyRateJobResponse,
  EasyRateService,
  MarcusJobResponse,
  MarcusService,
  MolarFractionsJobCreateRequest,
  MolarFractionsJobResponse,
  MolarFractionsService,
  SaScoreJobCreateRequest,
  SAScoreService,
  SmileitJobCreateRequest,
  SmileitService,
  SmileitStructureInspectionRequestRequest,
  SmileitStructureInspectionResponse,
  ToxicityJobCreateRequest,
  ToxicityPropertiesService,
  TunnelJobCreateRequest,
  TunnelJobResponse,
  TunnelService,
} from './generated';
import type {
  DownloadedReportFile,
  EasyRateFileInspectionView,
  EasyRateInputFieldName,
  EasyRateParams,
  MarcusParams,
  MolarFractionsParams,
  SaScoreJobResponseView,
  SaScoreMethod,
  SaScoreParams,
  SmileitAssignmentBlockParams,
  SmileitCategoryView,
  SmileitDerivationPageView,
  SmileitGenerationParams,
  SmileitJobResponseView,
  SmileitStructureInspectionView,
  SmileitSubstituentReferenceParams,
  SmileitManualSubstituentParams,
  SmileitCatalogEntryView,
  SmileitPatternEntryView,
  ToxicityJobResponseView,
  ToxicityPropertiesParams,
  TunnelParams,
  TunnelInputChangeEvent,
} from './types';

@Injectable({ providedIn: 'root' })
export class PublicJobsApiService {
  private readonly molar = inject(MolarFractionsService);
  private readonly tunnel = inject(TunnelService);
  private readonly easyRate = inject(EasyRateService);
  private readonly marcus = inject(MarcusService);
  private readonly saScore = inject(SAScoreService);
  private readonly toxicity = inject(ToxicityPropertiesService);
  private readonly smileit = inject(SmileitService);

  dispatchMolarFractionsJob(params: MolarFractionsParams): Observable<MolarFractionsJobResponse> {
    if (params.pkaValues.length < 1 || params.pkaValues.length > 6)
      throw new Error('molar-fractions requiere entre 1 y 6 valores pKa.');
    const payload: MolarFractionsJobCreateRequest = {
      version: params.version ?? '1.0.0',
      pka_values: params.pkaValues.map(Number),
      ph_mode: params.phMode as never,
      ...(params.initialCharge === undefined
        ? {}
        : { initial_charge: String(params.initialCharge) }),
      ...(params.label?.trim() ? { label: params.label.trim() } : {}),
      ...(params.phMode === 'single'
        ? { ph_value: params.phValue }
        : { ph_min: params.phMin, ph_max: params.phMax, ph_step: params.phStep }),
    };
    return this.molar.publicMolarFractionsJobsCreate(payload).pipe(shareReplay(1));
  }
  getMolarFractionsJobStatus(id: string): Observable<MolarFractionsJobResponse> {
    return this.molar.publicMolarFractionsJobsRetrieve(id);
  }
  dispatchTunnelJob(params: TunnelParams): Observable<TunnelJobResponse> {
    const payload: TunnelJobCreateRequest = {
      version: params.version ?? '2.0.0',
      reaction_barrier_zpe: Number(params.reactionBarrierZpe),
      imaginary_frequency: Number(params.imaginaryFrequency),
      reaction_energy_zpe: Number(params.reactionEnergyZpe),
      temperature: Number(params.temperature),
      input_change_events: (params.inputChangeEvents ?? []).map((item: TunnelInputChangeEvent) => ({
        field_name: item.fieldName,
        previous_value: Number(item.previousValue),
        new_value: Number(item.newValue),
        changed_at: item.changedAt,
      })),
    };
    return this.tunnel.publicTunnelJobsCreate(payload).pipe(shareReplay(1));
  }
  getTunnelJobStatus(id: string): Observable<TunnelJobResponse> {
    return this.tunnel.publicTunnelJobsRetrieve(id);
  }
  dispatchEasyRateJob(params: EasyRateParams): Observable<EasyRateJobResponse> {
    return this.easyRate
      .publicEasyRateJobsCreate(
        params.reactant1File,
        params.reactant2File,
        params.transitionStateFile,
        params.version ?? '2.0.0',
        params.title,
        params.reactionPathDegeneracy,
        params.cageEffects,
        params.diffusion,
        params.solvent,
        params.customViscosity,
        params.radiusReactant1,
        params.radiusReactant2,
        params.reactionDistance,
        params.printDataInput,
        params.reactant1ExecutionIndex,
        params.reactant2ExecutionIndex,
        params.transitionStateExecutionIndex,
        params.product1ExecutionIndex,
        params.product2ExecutionIndex,
        params.product1File,
        params.product2File,
      )
      .pipe(shareReplay(1));
  }
  inspectEasyRateInput(
    field: EasyRateInputFieldName,
    file: File,
  ): Observable<EasyRateFileInspectionView> {
    return this.easyRate.publicEasyRateJobsInspectInputCreate(field, file).pipe(
      map((raw) => ({
        sourceField: field,
        originalFilename: raw.original_filename,
        parseErrors: raw.parse_errors,
        executionCount: raw.execution_count,
        defaultExecutionIndex: raw.default_execution_index,
        executions: raw.executions.map((execution) => ({
          sourceField: field,
          originalFilename: execution.original_filename,
          executionIndex: execution.execution_index,
          jobTitle: execution.job_title,
          checkpointFile: execution.checkpoint_file,
          charge: execution.charge,
          multiplicity: execution.multiplicity,
          freeEnergy: execution.free_energy,
          thermalEnthalpy: execution.thermal_enthalpy,
          zeroPointEnergy: execution.zero_point_energy,
          scfEnergy: execution.scf_energy,
          temperature: execution.temperature,
          negativeFrequencies: execution.negative_frequencies,
          imaginaryFrequency: execution.imaginary_frequency,
          normalTermination: execution.normal_termination,
          isOptFreq: execution.is_opt_freq,
          isValidForRole: execution.is_valid_for_role,
          validationErrors: execution.validation_errors,
        })),
      })),
    );
  }
  getEasyRateJobStatus(id: string): Observable<EasyRateJobResponse> {
    return this.easyRate.publicEasyRateJobsRetrieve(id);
  }
  dispatchMarcusJob(params: MarcusParams): Observable<MarcusJobResponse> {
    return this.marcus
      .publicMarcusJobsCreate(
        params.reactant1File,
        params.reactant2File,
        params.product1AdiabaticFile,
        params.product2AdiabaticFile,
        params.product1VerticalFile,
        params.product2VerticalFile,
        params.version ?? '1.0.0',
        params.title,
        params.diffusion,
        params.radiusReactant1,
        params.radiusReactant2,
        params.reactionDistance,
      )
      .pipe(shareReplay(1));
  }
  getMarcusJobStatus(id: string): Observable<MarcusJobResponse> {
    return this.marcus.publicMarcusJobsRetrieve(id);
  }
  dispatchSaScoreJob(params: SaScoreParams): Observable<SaScoreJobResponseView> {
    const payload: SaScoreJobCreateRequest = {
      molecules: params.molecules,
      methods: params.methods as never[],
      version: params.version ?? '1.0.0',
    };
    return this.saScore.publicSaScoreJobsCreate(payload).pipe(shareReplay(1));
  }
  getSaScoreJobStatus(id: string): Observable<SaScoreJobResponseView> {
    return this.saScore.publicSaScoreJobsRetrieve(id);
  }
  dispatchToxicityPropertiesJob(
    params: ToxicityPropertiesParams,
  ): Observable<ToxicityJobResponseView> {
    const payload: ToxicityJobCreateRequest = {
      molecules: params.molecules,
      version: params.version ?? '1.0.0',
    };
    return this.toxicity.publicToxicityPropertiesJobsCreate(payload).pipe(shareReplay(1));
  }
  getToxicityPropertiesJobStatus(id: string): Observable<ToxicityJobResponseView> {
    return this.toxicity.publicToxicityPropertiesJobsRetrieve(id);
  }
  dispatchSmileitJob(params: SmileitGenerationParams): Observable<SmileitJobResponseView> {
    const payload: SmileitJobCreateRequest = {
      version: params.version ?? '2.0.0',
      principal_smiles: params.principalSmiles,
      selected_atom_indices: params.selectedAtomIndices,
      assignment_blocks: params.assignmentBlocks.map((block: SmileitAssignmentBlockParams) => ({
        label: block.label,
        site_atom_indices: block.siteAtomIndices,
        category_keys: block.categoryKeys,
        substituent_refs: block.substituentRefs.map((ref: SmileitSubstituentReferenceParams) => ({
          stable_id: ref.stableId,
          version: ref.version,
        })),
        manual_substituents: block.manualSubstituents.map(
          (item: SmileitManualSubstituentParams) => ({
            name: item.name,
            smiles: item.smiles,
            anchor_atom_indices: item.anchorAtomIndices,
            categories: item.categories,
            source_reference: item.sourceReference,
            provenance_metadata: item.provenanceMetadata,
          }),
        ),
      })),
      site_overlap_policy: params.siteOverlapPolicy,
      r_substitutes: params.rSubstitutes,
      num_bonds: params.numBonds,
      max_structures: params.maxStructures,
      export_name_base: params.exportNameBase,
      export_padding: params.exportPadding,
    };
    return this.smileit.publicSmileitJobsCreate(payload).pipe(shareReplay(1));
  }
  getSmileitJobStatus(id: string): Observable<SmileitJobResponseView> {
    return this.smileit.publicSmileitJobsRetrieve(id);
  }

  listSmileitCatalog(): Observable<SmileitCatalogEntryView[]> {
    return this.smileit.publicSmileitJobsCatalogList();
  }
  listSmileitCategories(): Observable<SmileitCategoryView[]> {
    return this.smileit.publicSmileitJobsCategoriesList();
  }
  listSmileitPatterns(): Observable<SmileitPatternEntryView[]> {
    return this.smileit.publicSmileitJobsPatternsList();
  }
  inspectSmileitStructure(smiles: string): Observable<SmileitStructureInspectionView> {
    return this.smileit
      .publicSmileitJobsInspectStructureCreate({
        smiles,
      } as SmileitStructureInspectionRequestRequest)
      .pipe(
        map((raw: SmileitStructureInspectionResponse) => ({
          canonicalSmiles: raw.canonical_smiles,
          atomCount: raw.atom_count,
          atoms: raw.atoms.map((atom) => ({
            index: atom.index,
            symbol: atom.symbol,
            implicitHydrogens: atom.implicit_hydrogens,
            isAromatic: atom.is_aromatic,
          })),
          svg: raw.svg,
          quickProperties: raw.quick_properties,
          annotations: raw.annotations,
          activePatternRefs: raw.active_pattern_refs,
        })),
      );
  }
  listSmileitDerivations(
    id: string,
    offset: number,
    limit: number,
  ): Observable<SmileitDerivationPageView> {
    return this.smileit.publicSmileitJobsDerivationsRetrieve(id, limit, offset).pipe(
      map((raw) => ({
        totalGenerated: raw.total_generated,
        offset: raw.offset,
        limit: raw.limit,
        items: raw.items.map((item) => ({
          structureIndex: item.structure_index,
          name: item.name,
          smiles: item.smiles,
          placeholderAssignments: item.placeholder_assignments.map((assignment) => ({
            placeholderLabel: assignment.placeholder_label,
            siteAtomIndex: assignment.site_atom_index,
            substituentName: assignment.substituent_name,
            substituentSmiles: assignment.substituent_smiles ?? '',
          })),
          traceability: item.traceability,
        })),
      })),
    );
  }
  getSmileitDerivationSvg(
    id: string,
    index: number,
    variant: 'thumb' | 'detail' = 'detail',
  ): Observable<string> {
    return this.smileit
      .publicSmileitJobsDerivationsSvgRetrieve(id, index, variant)
      .pipe(switchMap((value) => (value instanceof Blob ? from(value.text()) : of(''))));
  }
  downloadSmileitCsvReport(id: string): Observable<DownloadedReportFile> {
    return this.download(
      this.smileit.publicSmileitJobsReportCsvRetrieve(id, 'response'),
      `smileit_${id}_report.csv`,
    );
  }
  downloadSmileitSmilesReport(id: string): Observable<DownloadedReportFile> {
    return this.download(
      this.smileit.publicSmileitJobsReportSmilesRetrieve(id, 'response'),
      `smileit_${id}_structures.smi`,
    );
  }
  downloadSmileitTraceabilityReport(id: string): Observable<DownloadedReportFile> {
    return this.download(
      this.smileit.publicSmileitJobsReportTraceabilityRetrieve(id, 'response'),
      `smileit_${id}_traceability.csv`,
    );
  }
  downloadSmileitLogReport(id: string): Observable<DownloadedReportFile> {
    return this.download(
      this.smileit.publicSmileitJobsReportLogRetrieve(id, 'response'),
      `smileit_${id}_report.log`,
    );
  }
  downloadSmileitErrorReport(id: string): Observable<DownloadedReportFile> {
    return this.download(
      this.smileit.publicSmileitJobsReportErrorRetrieve(id, 'response'),
      `smileit_${id}_error.txt`,
    );
  }
  downloadSmileitInputsZip(id: string): Observable<DownloadedReportFile> {
    return this.download(
      this.smileit.publicSmileitJobsReportInputsRetrieve(id, 'response'),
      `smileit_${id}_inputs.zip`,
    );
  }
  downloadSmileitImagesZipServer(id: string): Observable<DownloadedReportFile> {
    return this.download(
      this.smileit.publicSmileitJobsReportImagesZipRetrieve(id, 'response'),
      `smileit_${id}_images.zip`,
    );
  }

  downloadMolarFractionsCsvReport(id: string): Observable<DownloadedReportFile> {
    return this.download(
      this.molar.publicMolarFractionsJobsReportCsvRetrieve(id, 'response'),
      `molar_fractions_${id}_report.csv`,
    );
  }
  downloadMolarFractionsLogReport(id: string): Observable<DownloadedReportFile> {
    return this.download(
      this.molar.publicMolarFractionsJobsReportLogRetrieve(id, 'response'),
      `molar_fractions_${id}_report.log`,
    );
  }
  downloadTunnelCsvReport(id: string): Observable<DownloadedReportFile> {
    return this.download(
      this.tunnel.publicTunnelJobsReportCsvRetrieve(id, 'response'),
      `tunnel_effect_${id}_report.csv`,
    );
  }
  downloadTunnelLogReport(id: string): Observable<DownloadedReportFile> {
    return this.download(
      this.tunnel.publicTunnelJobsReportLogRetrieve(id, 'response'),
      `tunnel_effect_${id}_report.log`,
    );
  }
  downloadTunnelErrorReport(id: string): Observable<DownloadedReportFile> {
    return this.download(
      this.tunnel.publicTunnelJobsReportErrorRetrieve(id, 'response'),
      `tunnel_effect_${id}_error.txt`,
    );
  }
  downloadEasyRateCsvReport(id: string): Observable<DownloadedReportFile> {
    return this.download(
      this.easyRate.publicEasyRateJobsReportCsvRetrieve(id, 'response'),
      `easy_rate_${id}_report.csv`,
    );
  }
  downloadEasyRateLogReport(id: string): Observable<DownloadedReportFile> {
    return this.download(
      this.easyRate.publicEasyRateJobsReportLogRetrieve(id, 'response'),
      `easy_rate_${id}_report.log`,
    );
  }
  downloadEasyRateErrorReport(id: string): Observable<DownloadedReportFile> {
    return this.download(
      this.easyRate.publicEasyRateJobsReportErrorRetrieve(id, 'response'),
      `easy_rate_${id}_error.txt`,
    );
  }
  downloadEasyRateInputsZip(id: string): Observable<DownloadedReportFile> {
    return this.download(
      this.easyRate.publicEasyRateJobsReportInputsRetrieve(id, 'response'),
      `easy_rate_${id}_inputs.zip`,
    );
  }
  downloadMarcusCsvReport(id: string): Observable<DownloadedReportFile> {
    return this.download(
      this.marcus.publicMarcusJobsReportCsvRetrieve(id, 'response'),
      `marcus_${id}_report.csv`,
    );
  }
  downloadMarcusLogReport(id: string): Observable<DownloadedReportFile> {
    return this.download(
      this.marcus.publicMarcusJobsReportLogRetrieve(id, 'response'),
      `marcus_${id}_report.log`,
    );
  }
  downloadMarcusErrorReport(id: string): Observable<DownloadedReportFile> {
    return this.download(
      this.marcus.publicMarcusJobsReportErrorRetrieve(id, 'response'),
      `marcus_${id}_error.txt`,
    );
  }
  downloadMarcusInputsZip(id: string): Observable<DownloadedReportFile> {
    return this.download(
      this.marcus.publicMarcusJobsReportInputsRetrieve(id, 'response'),
      `marcus_${id}_inputs.zip`,
    );
  }
  downloadSaScoreCsvReport(id: string): Observable<DownloadedReportFile> {
    return this.download(
      this.saScore.publicSaScoreJobsReportCsvRetrieve(id, 'response'),
      `sa_score_${id}_report.csv`,
    );
  }
  downloadSaScoreCsvMethodReport(
    id: string,
    method: SaScoreMethod,
  ): Observable<DownloadedReportFile> {
    return this.download(
      this.saScore.publicSaScoreJobsReportCsvMethodRetrieve(id, method, 'response'),
      `sa_score_${id}_${method}.csv`,
    );
  }
  downloadToxicityPropertiesCsvReport(id: string): Observable<DownloadedReportFile> {
    return this.download(
      this.toxicity.publicToxicityPropertiesJobsReportCsvRetrieve(id, 'response'),
      `toxicity_properties_${id}_report.csv`,
    );
  }

  private download(
    source: Observable<import('@angular/common/http').HttpResponse<Blob>>,
    filename: string,
  ): Observable<DownloadedReportFile> {
    return createReportDownload$(source, filename);
  }
}
