"""types.py: Tipos estrictos para CADMA Py.

Define contratos serializables del set de referencia, los candidatos, las
estadísticas agregadas y el payload final consumido por la interfaz Angular.
"""

from __future__ import annotations

from typing import Literal, NotRequired, TypedDict

MetricName = Literal[
    "MW",
    "logP",
    "MR",
    "AtX",
    "HBLA",
    "HBLD",
    "RB",
    "PSA",
    "DT",
    "M",
    "LD50",
    "SA",
]


class CadmaCompoundRow(TypedDict):
    """Fila normalizada y serializable para referencia o candidato."""

    name: str
    smiles: str
    MW: float
    logP: float
    MR: float
    AtX: float
    HBLA: float
    HBLD: float
    RB: float
    PSA: float
    DT: float
    M: float
    LD50: float
    SA: float
    paper_reference: str
    paper_url: str
    evidence_note: str


class CadmaMetricSummary(TypedDict):
    """Resumen estadístico por métrica del set de referencia."""

    metric: MetricName
    mean: float
    stdev: float
    min_value: float
    max_value: float


class CadmaRankingRow(TypedDict):
    """Fila de ranking para un compuesto candidato."""

    name: str
    smiles: str
    selection_score: float
    adme_alignment: float
    toxicity_alignment: float
    sa_alignment: float
    adme_hits_in_band: int
    metrics_in_band: list[str]
    best_fit_summary: str


class CadmaMetricChart(TypedDict):
    """Payload para una gráfica de barras con líneas de referencia."""

    metric: MetricName
    label: str
    categories: list[str]
    values: list[float]
    reference_mean: float
    reference_low: float
    reference_high: float
    better_direction: Literal["balanced", "higher", "lower"]


class CadmaScoreChart(TypedDict):
    """Payload de ranking global por compuesto."""

    categories: list[str]
    values: list[float]
    reference_line: float


class CadmaReferenceSourceFileView(TypedDict):
    """Metadatos serializables de un archivo fuente persistido."""

    id: str
    field_name: str
    original_filename: str
    content_type: str
    size_bytes: int
    sha256: str
    created_at: str


class CadmaReferenceLibraryView(TypedDict):
    """Representación serializable de una familia de referencia persistida."""

    id: str
    name: str
    disease_name: str
    description: str
    source_reference: str
    group_id: int | None
    created_by_id: int | None
    created_by_name: str
    editable: bool
    deletable: bool
    forkable: bool
    row_count: int
    rows: list[CadmaCompoundRow]
    source_file_count: int
    source_files: list[CadmaReferenceSourceFileView]
    paper_reference: str
    paper_url: str
    created_at: str
    updated_at: str


class CadmaReferenceSample(TypedDict):
    """Muestra precargada tomada del material deprecated del repositorio."""

    key: str
    name: str
    disease_name: str
    description: str
    row_count: int
    source_note: str


class CadmaMappedSourceConfig(TypedDict):
    """Configuración serializable de un archivo importado por el asistente guiado."""

    filename: str
    content_text: str
    file_format: NotRequired[str]
    delimiter: NotRequired[str]
    has_header: NotRequired[bool]
    skip_lines: NotRequired[int]
    smiles_column: NotRequired[str]
    name_column: NotRequired[str]
    paper_reference_column: NotRequired[str]
    paper_url_column: NotRequired[str]
    evidence_note_column: NotRequired[str]
    mw_column: NotRequired[str]
    logp_column: NotRequired[str]
    mr_column: NotRequired[str]
    atx_column: NotRequired[str]
    hbla_column: NotRequired[str]
    hbld_column: NotRequired[str]
    rb_column: NotRequired[str]
    psa_column: NotRequired[str]
    dt_column: NotRequired[str]
    m_column: NotRequired[str]
    ld50_column: NotRequired[str]
    sa_column: NotRequired[str]


class CadmaPyResult(TypedDict):
    """Resultado completo del job CADMA Py."""

    library_name: str
    disease_name: str
    reference_count: int
    candidate_count: int
    reference_stats: list[CadmaMetricSummary]
    ranking: list[CadmaRankingRow]
    score_chart: CadmaScoreChart
    metric_charts: list[CadmaMetricChart]
    methodology_note: str


class CadmaPyJobCreatePayload(TypedDict):
    """Payload validado para crear un job de comparación."""

    reference_library_id: str
    project_label: NotRequired[str]
    combined_csv_text: NotRequired[str]
    smiles_csv_text: NotRequired[str]
    toxicity_csv_text: NotRequired[str]
    sa_csv_text: NotRequired[str]
    source_configs_json: NotRequired[str]
    start_paused: NotRequired[bool]
