"""schemas.py: Contratos OpenAPI estrictos para Smile-it profesional.

Objetivo del archivo:
- Declarar serializers de request/response para asignación por bloques,
  catálogo persistente, patrones y resultados trazables.

Cómo se usa:
- `routers.py` valida entradas y serializa respuestas HTTP de Smile-it.
- El contrato mantiene tipado estricto y ejemplos realistas para OpenAPI.
"""

from __future__ import annotations

from drf_spectacular.utils import OpenApiExample, extend_schema_serializer
from rest_framework import serializers

from apps.core.models import ScientificJob

from .definitions import (
    DEFAULT_ALGORITHM_VERSION,
    DEFAULT_EXPORT_PADDING,
    MAX_ASSIGNMENT_BLOCKS,
    MAX_CATEGORIES_PER_BLOCK,
    MAX_EXPORT_PADDING,
    MAX_MANUAL_SUBSTITUENTS_PER_BLOCK,
    MAX_NUM_BONDS,
    MAX_PATTERN_CAPTION_LENGTH,
    MAX_PATTERN_NAME_LENGTH,
    MAX_PATTERN_SMARTS_LENGTH,
    MAX_R_SUBSTITUTES,
    MAX_SELECTED_ATOMS,
    MAX_SUBSTITUENT_NAME_LENGTH,
    MAX_SUBSTITUENT_REFS_PER_BLOCK,
    MAX_SUBSTITUENT_SMILES_LENGTH,
    MIN_EXPORT_PADDING,
    SITE_OVERLAP_POLICY_CHOICES,
)


class SmileitCategorySerializer(serializers.Serializer):
    """Categoría química verificable para selección y validación."""

    id = serializers.UUIDField(read_only=True)
    key = serializers.SlugField(max_length=80)
    version = serializers.IntegerField(min_value=1)
    name = serializers.CharField(max_length=120)
    description = serializers.CharField(max_length=300)
    verification_rule = serializers.ChoiceField(
        choices=["aromatic", "hbond_donor", "hbond_acceptor", "hydrophobic", "smarts"]
    )
    verification_smarts = serializers.CharField(max_length=2000, allow_blank=True)


class SmileitCatalogEntrySerializer(serializers.Serializer):
    """Sustituyente persistente disponible para asignación por bloques."""

    id = serializers.CharField()
    stable_id = serializers.CharField()
    version = serializers.IntegerField(min_value=1)
    name = serializers.CharField(max_length=MAX_SUBSTITUENT_NAME_LENGTH)
    smiles = serializers.CharField(max_length=MAX_SUBSTITUENT_SMILES_LENGTH)
    anchor_atom_indices = serializers.ListField(
        child=serializers.IntegerField(min_value=0),
        min_length=1,
    )
    categories = serializers.ListField(
        child=serializers.SlugField(max_length=80),
        required=False,
        default=list,
    )
    source_reference = serializers.CharField(max_length=200, allow_blank=True)
    provenance_metadata = serializers.DictField(
        child=serializers.CharField(),
        required=False,
        default=dict,
    )


@extend_schema_serializer(
    examples=[
        OpenApiExample(
            "Alta de sustituyente aromático",
            value={
                "name": "4-Fluorophenyl",
                "smiles": "c1ccc(cc1)F",
                "anchor_atom_indices": [0],
                "category_keys": ["aromatic", "hydrophobic"],
                "source_reference": "MedicinalChemTeam",
                "provenance_metadata": {"ticket": "SMI-204", "author": "team-a"},
            },
            request_only=True,
        )
    ]
)
class SmileitCatalogEntryCreateSerializer(serializers.Serializer):
    """Payload para crear sustituyente en catálogo persistente."""

    name = serializers.CharField(max_length=MAX_SUBSTITUENT_NAME_LENGTH)
    smiles = serializers.CharField(max_length=MAX_SUBSTITUENT_SMILES_LENGTH)
    anchor_atom_indices = serializers.ListField(
        child=serializers.IntegerField(min_value=0),
        min_length=1,
    )
    category_keys = serializers.ListField(
        child=serializers.SlugField(max_length=80),
        min_length=1,
    )
    source_reference = serializers.CharField(max_length=200, required=False, default="")
    provenance_metadata = serializers.DictField(
        child=serializers.CharField(),
        required=False,
        default=dict,
    )


class SmileitPatternEntrySerializer(serializers.Serializer):
    """Patrón estructural persistente para anotación visual."""

    id = serializers.CharField()
    stable_id = serializers.CharField()
    version = serializers.IntegerField(min_value=1)
    name = serializers.CharField(max_length=MAX_PATTERN_NAME_LENGTH)
    smarts = serializers.CharField(max_length=MAX_PATTERN_SMARTS_LENGTH)
    pattern_type = serializers.ChoiceField(choices=["toxicophore", "privileged"])
    caption = serializers.CharField(max_length=MAX_PATTERN_CAPTION_LENGTH)
    source_reference = serializers.CharField(max_length=200, allow_blank=True)
    provenance_metadata = serializers.DictField(
        child=serializers.CharField(),
        required=False,
        default=dict,
    )


@extend_schema_serializer(
    examples=[
        OpenApiExample(
            "Alta de patrón toxicóforo",
            value={
                "name": "Nitro Aromatic Alert",
                "smarts": "[NX3+](=O)[O-]",
                "pattern_type": "toxicophore",
                "caption": "Nitro group with known toxicological alert profile.",
                "source_reference": "SafetyRulesV2",
                "provenance_metadata": {"source": "internal-rulebook"},
            },
            request_only=True,
        )
    ]
)
class SmileitPatternEntryCreateSerializer(serializers.Serializer):
    """Payload para crear patrón estructural con caption obligatorio."""

    name = serializers.CharField(max_length=MAX_PATTERN_NAME_LENGTH)
    smarts = serializers.CharField(max_length=MAX_PATTERN_SMARTS_LENGTH)
    pattern_type = serializers.ChoiceField(choices=["toxicophore", "privileged"])
    caption = serializers.CharField(max_length=MAX_PATTERN_CAPTION_LENGTH)
    source_reference = serializers.CharField(max_length=200, required=False, default="")
    provenance_metadata = serializers.DictField(
        child=serializers.CharField(),
        required=False,
        default=dict,
    )


class SmileitQuickPropertiesSerializer(serializers.Serializer):
    """Propiedades rápidas para decisiones de química medicinal."""

    molecular_weight = serializers.FloatField()
    clogp = serializers.FloatField()
    rotatable_bonds = serializers.IntegerField(min_value=0)
    hbond_donors = serializers.IntegerField(min_value=0)
    hbond_acceptors = serializers.IntegerField(min_value=0)
    tpsa = serializers.FloatField()
    aromatic_rings = serializers.IntegerField(min_value=0)


class SmileitAtomInfoSerializer(serializers.Serializer):
    """Información de átomo para selección de sitios en UI."""

    index = serializers.IntegerField(min_value=0)
    symbol = serializers.CharField(max_length=10)
    implicit_hydrogens = serializers.IntegerField(min_value=0)
    is_aromatic = serializers.BooleanField()


class SmileitStructuralAnnotationSerializer(serializers.Serializer):
    """Región anotada en la estructura principal con tooltip/caption."""

    pattern_stable_id = serializers.CharField()
    pattern_version = serializers.IntegerField(min_value=1)
    name = serializers.CharField(max_length=MAX_PATTERN_NAME_LENGTH)
    pattern_type = serializers.ChoiceField(choices=["toxicophore", "privileged"])
    caption = serializers.CharField(max_length=MAX_PATTERN_CAPTION_LENGTH)
    atom_indices = serializers.ListField(child=serializers.IntegerField(min_value=0))
    color = serializers.CharField(max_length=16)


@extend_schema_serializer(
    examples=[
        OpenApiExample(
            "Inspeccionar benzeno",
            value={"smiles": "c1ccccc1"},
            request_only=True,
        )
    ]
)
class SmileitStructureInspectionRequestSerializer(serializers.Serializer):
    """Entrada para inspección de estructura y anotación automática."""

    smiles = serializers.CharField(max_length=2000)


class SmileitPatternReferenceSerializer(serializers.Serializer):
    """Referencia a patrón activo usado para anotación."""

    stable_id = serializers.CharField()
    version = serializers.IntegerField(min_value=1)
    name = serializers.CharField(max_length=MAX_PATTERN_NAME_LENGTH)
    pattern_type = serializers.ChoiceField(choices=["toxicophore", "privileged"])


class SmileitStructureInspectionResponseSerializer(serializers.Serializer):
    """Respuesta enriquecida de inspección molecular para la UI."""

    canonical_smiles = serializers.CharField(max_length=2000)
    atom_count = serializers.IntegerField(min_value=1)
    atoms = SmileitAtomInfoSerializer(many=True)
    svg = serializers.CharField()
    quick_properties = SmileitQuickPropertiesSerializer()
    annotations = SmileitStructuralAnnotationSerializer(many=True)
    active_pattern_refs = SmileitPatternReferenceSerializer(many=True)


class SmileitSubstituentReferenceInputSerializer(serializers.Serializer):
    """Referencia inmutable a sustituyente por stable_id + version."""

    stable_id = serializers.UUIDField()
    version = serializers.IntegerField(min_value=1)


class SmileitManualSubstituentInputSerializer(serializers.Serializer):
    """Sustituyente manual incluido dentro de un bloque de asignación."""

    name = serializers.CharField(max_length=MAX_SUBSTITUENT_NAME_LENGTH)
    smiles = serializers.CharField(max_length=MAX_SUBSTITUENT_SMILES_LENGTH)
    anchor_atom_indices = serializers.ListField(
        child=serializers.IntegerField(min_value=0),
        min_length=1,
    )
    categories = serializers.ListField(
        child=serializers.SlugField(max_length=80),
        min_length=1,
        max_length=MAX_CATEGORIES_PER_BLOCK,
    )
    source_reference = serializers.CharField(
        max_length=200, required=False, default="manual"
    )
    provenance_metadata = serializers.DictField(
        child=serializers.CharField(),
        required=False,
        default=dict,
    )


class SmileitAssignmentBlockInputSerializer(serializers.Serializer):
    """Bloque de asignación de sustituyentes a uno o más sitios."""

    label = serializers.CharField(max_length=120)
    site_atom_indices = serializers.ListField(
        child=serializers.IntegerField(min_value=0),
        min_length=1,
        max_length=MAX_SELECTED_ATOMS,
    )
    category_keys = serializers.ListField(
        child=serializers.SlugField(max_length=80),
        required=False,
        default=list,
        max_length=MAX_CATEGORIES_PER_BLOCK,
    )
    substituent_refs = SmileitSubstituentReferenceInputSerializer(
        many=True,
        required=False,
        default=list,
        allow_empty=True,
    )
    manual_substituents = SmileitManualSubstituentInputSerializer(
        many=True,
        required=False,
        default=list,
        allow_empty=True,
    )

    def validate(self, attrs: dict) -> dict:
        """Valida que cada bloque tenga al menos una fuente de sustituyentes."""
        category_keys = attrs.get("category_keys", [])
        substituent_refs = attrs.get("substituent_refs", [])
        manual_substituents = attrs.get("manual_substituents", [])

        if (
            len(category_keys) == 0
            and len(substituent_refs) == 0
            and len(manual_substituents) == 0
        ):
            raise serializers.ValidationError(
                "Cada bloque debe definir categorías, referencias o sustituyentes manuales."
            )

        if len(substituent_refs) > MAX_SUBSTITUENT_REFS_PER_BLOCK:
            raise serializers.ValidationError(
                f"Máximo {MAX_SUBSTITUENT_REFS_PER_BLOCK} referencias de sustituyentes por bloque."
            )

        if len(manual_substituents) > MAX_MANUAL_SUBSTITUENTS_PER_BLOCK:
            raise serializers.ValidationError(
                f"Máximo {MAX_MANUAL_SUBSTITUENTS_PER_BLOCK} sustituyentes manuales por bloque."
            )

        return attrs


@extend_schema_serializer(
    examples=[
        OpenApiExample(
            "Generación por bloques mixtos",
            value={
                "version": "2.0.0",
                "principal_smiles": "c1ccccc1",
                "selected_atom_indices": [0, 1, 2, 3, 4],
                "assignment_blocks": [
                    {
                        "label": "Aromatic coverage",
                        "site_atom_indices": [0, 1],
                        "category_keys": ["aromatic"],
                        "substituent_refs": [],
                        "manual_substituents": [],
                    },
                    {
                        "label": "Donor tuning",
                        "site_atom_indices": [2],
                        "category_keys": ["hbond_donor"],
                        "substituent_refs": [],
                        "manual_substituents": [],
                    },
                    {
                        "label": "Custom lipophilic",
                        "site_atom_indices": [3, 4],
                        "category_keys": [],
                        "substituent_refs": [],
                        "manual_substituents": [
                            {
                                "name": "Cyclopropyl",
                                "smiles": "C1CC1",
                                "anchor_atom_indices": [0],
                                "categories": ["hydrophobic"],
                            }
                        ],
                    },
                ],
                "site_overlap_policy": "last_block_wins",
                "r_substitutes": 2,
                "num_bonds": 1,
                "allow_repeated": False,
                "max_structures": 600,
                "export_name_base": "BENZENE_SERIES",
                "export_padding": 5,
            },
            request_only=True,
        )
    ]
)
class SmileitJobCreateSerializer(serializers.Serializer):
    """Contrato de creación del job Smile-it con asignación flexible por bloques."""

    version = serializers.CharField(max_length=50, default=DEFAULT_ALGORITHM_VERSION)
    principal_smiles = serializers.CharField(max_length=2000)
    selected_atom_indices = serializers.ListField(
        child=serializers.IntegerField(min_value=0),
        min_length=1,
        max_length=MAX_SELECTED_ATOMS,
    )
    assignment_blocks = SmileitAssignmentBlockInputSerializer(
        many=True,
        min_length=1,
        max_length=MAX_ASSIGNMENT_BLOCKS,
    )
    site_overlap_policy = serializers.ChoiceField(
        choices=SITE_OVERLAP_POLICY_CHOICES,
        default="last_block_wins",
    )
    r_substitutes = serializers.IntegerField(
        min_value=1, max_value=MAX_R_SUBSTITUTES, default=1
    )
    num_bonds = serializers.IntegerField(
        min_value=1, max_value=MAX_NUM_BONDS, default=1
    )
    max_structures = serializers.IntegerField(
        min_value=0,
        default=0,
        help_text="Máximo de estructuras a generar. Usa 0 para ejecutar sin límite.",
    )
    export_name_base = serializers.CharField(max_length=120, default="SMILEIT")
    export_padding = serializers.IntegerField(
        min_value=MIN_EXPORT_PADDING,
        max_value=MAX_EXPORT_PADDING,
        default=DEFAULT_EXPORT_PADDING,
    )

    def validate(self, attrs: dict) -> dict:
        """Valida cobertura básica de sitios y coherencia de configuración."""
        selected_sites = sorted(
            {int(value) for value in attrs.get("selected_atom_indices", [])}
        )
        if len(selected_sites) != len(attrs.get("selected_atom_indices", [])):
            raise serializers.ValidationError(
                {"selected_atom_indices": "No se permiten índices de sitio duplicados."}
            )

        attrs["selected_atom_indices"] = selected_sites

        # r_substitutes no puede superar la cantidad de sitios de sustitución disponibles
        r_substitutes = attrs.get("r_substitutes", 1)
        num_sites = len(selected_sites)
        if r_substitutes > num_sites:
            raise serializers.ValidationError(
                {
                    "r_substitutes": (
                        f"r_substitutes ({r_substitutes}) no puede ser mayor que el número "
                        f"de sitios de sustitución seleccionados ({num_sites})."
                    )
                }
            )

        block_entries: list[dict] = attrs.get("assignment_blocks", [])
        covered_sites: set[int] = set()
        for block in block_entries:
            block_sites = sorted(
                {int(value) for value in block.get("site_atom_indices", [])}
            )
            block["site_atom_indices"] = block_sites
            covered_sites.update(block_sites)

        missing_sites = [
            value for value in selected_sites if value not in covered_sites
        ]
        if len(missing_sites) > 0:
            raise serializers.ValidationError(
                {
                    "assignment_blocks": (
                        "No se permite ejecutar con sitios sin cobertura. "
                        f"Sitios pendientes: {missing_sites}."
                    )
                }
            )

        return attrs


class SmileitResolvedSubstituentSerializer(serializers.Serializer):
    """Sustituyente normalizado que participa en la ejecución del plugin."""

    source_kind = serializers.ChoiceField(choices=["catalog", "manual"])
    stable_id = serializers.CharField()
    version = serializers.IntegerField(min_value=1)
    name = serializers.CharField(max_length=MAX_SUBSTITUENT_NAME_LENGTH)
    smiles = serializers.CharField(max_length=MAX_SUBSTITUENT_SMILES_LENGTH)
    selected_atom_index = serializers.IntegerField(min_value=0)
    categories = serializers.ListField(child=serializers.SlugField(max_length=80))


class SmileitResolvedAssignmentBlockSerializer(serializers.Serializer):
    """Bloque normalizado persistido dentro de parámetros del job."""

    label = serializers.CharField(max_length=120)
    priority = serializers.IntegerField(min_value=1)
    site_atom_indices = serializers.ListField(
        child=serializers.IntegerField(min_value=0)
    )
    resolved_substituents = SmileitResolvedSubstituentSerializer(many=True)


class SmileitParametersSerializer(serializers.Serializer):
    """Parámetros persistidos para reproducibilidad completa de la corrida."""

    principal_smiles = serializers.CharField(max_length=2000)
    selected_atom_indices = serializers.ListField(
        child=serializers.IntegerField(min_value=0)
    )
    assignment_blocks = SmileitResolvedAssignmentBlockSerializer(
        many=True,
        required=False,
        default=list,
    )
    r_substitutes = serializers.IntegerField(min_value=1, required=False, default=1)
    num_bonds = serializers.IntegerField(min_value=1, required=False, default=1)
    allow_repeated = serializers.BooleanField(required=False, default=False)
    max_structures = serializers.IntegerField(min_value=0, required=False, default=0)
    site_overlap_policy = serializers.ChoiceField(
        choices=SITE_OVERLAP_POLICY_CHOICES,
        required=False,
        default="last_block_wins",
    )
    export_name_base = serializers.CharField(
        max_length=120,
        required=False,
        default="SMILEIT",
    )
    export_padding = serializers.IntegerField(
        min_value=MIN_EXPORT_PADDING,
        max_value=MAX_EXPORT_PADDING,
        required=False,
        default=DEFAULT_EXPORT_PADDING,
    )
    references = serializers.DictField(
        child=serializers.ListField(child=serializers.DictField()),
        required=False,
        default=dict,
    )


class SmileitSubstitutionTraceEventSerializer(serializers.Serializer):
    """Evento de sustitución aplicado en un derivado generado."""

    round_index = serializers.IntegerField(min_value=1)
    site_atom_index = serializers.IntegerField(min_value=0)
    block_label = serializers.CharField(max_length=120)
    block_priority = serializers.IntegerField(min_value=1)
    substituent_name = serializers.CharField(max_length=MAX_SUBSTITUENT_NAME_LENGTH)
    substituent_smiles = serializers.CharField(
        max_length=MAX_SUBSTITUENT_SMILES_LENGTH,
        required=False,
        allow_blank=True,
        default="",
    )
    substituent_stable_id = serializers.CharField()
    substituent_version = serializers.IntegerField(min_value=1)
    source_kind = serializers.ChoiceField(choices=["catalog", "manual"])
    bond_order = serializers.IntegerField(min_value=1, max_value=3)


class SmileitPlaceholderAssignmentSerializer(serializers.Serializer):
    """Relación placeholder -> sustituyente para la lectura química del derivado."""

    placeholder_label = serializers.CharField(max_length=20)
    site_atom_index = serializers.IntegerField(min_value=0)
    substituent_name = serializers.CharField(max_length=MAX_SUBSTITUENT_NAME_LENGTH)
    substituent_smiles = serializers.CharField(
        max_length=MAX_SUBSTITUENT_SMILES_LENGTH,
        required=False,
        allow_blank=True,
        default="",
    )


class SmileitGeneratedStructureSerializer(serializers.Serializer):
    """Derivado generado con representación SVG y trazabilidad interna."""

    smiles = serializers.CharField(max_length=MAX_SUBSTITUENT_SMILES_LENGTH)
    name = serializers.CharField(max_length=500)
    svg = serializers.CharField()
    placeholder_assignments = SmileitPlaceholderAssignmentSerializer(many=True)
    traceability = SmileitSubstitutionTraceEventSerializer(many=True)


class SmileitTraceabilityRowSerializer(serializers.Serializer):
    """Fila para auditoría de sitio -> sustituyente aplicado por derivado."""

    derivative_name = serializers.CharField(max_length=500)
    derivative_smiles = serializers.CharField(max_length=MAX_SUBSTITUENT_SMILES_LENGTH)
    round_index = serializers.IntegerField(min_value=1)
    site_atom_index = serializers.IntegerField(min_value=0)
    block_label = serializers.CharField(max_length=120)
    block_priority = serializers.IntegerField(min_value=1)
    substituent_name = serializers.CharField(max_length=MAX_SUBSTITUENT_NAME_LENGTH)
    substituent_smiles = serializers.CharField(
        max_length=MAX_SUBSTITUENT_SMILES_LENGTH,
        required=False,
        allow_blank=True,
        default="",
    )
    substituent_stable_id = serializers.CharField()
    substituent_version = serializers.IntegerField(min_value=1)
    source_kind = serializers.CharField(max_length=20)
    bond_order = serializers.IntegerField(min_value=1, max_value=3)


class SmileitResultSerializer(serializers.Serializer):
    """Resultado final de generación combinatoria y exportes reproducibles."""

    total_generated = serializers.IntegerField(min_value=0)
    generated_structures = SmileitGeneratedStructureSerializer(
        many=True,
        required=False,
        default=list,
    )
    traceability_rows = SmileitTraceabilityRowSerializer(
        many=True,
        required=False,
        default=list,
    )
    truncated = serializers.BooleanField(required=False, default=False)
    principal_smiles = serializers.CharField(max_length=2000)
    selected_atom_indices = serializers.ListField(
        child=serializers.IntegerField(min_value=0)
    )
    export_name_base = serializers.CharField(
        max_length=120,
        required=False,
        default="SMILEIT",
    )
    export_padding = serializers.IntegerField(
        min_value=MIN_EXPORT_PADDING,
        max_value=MAX_EXPORT_PADDING,
        required=False,
        default=DEFAULT_EXPORT_PADDING,
    )
    references = serializers.DictField(
        child=serializers.ListField(child=serializers.DictField()),
        required=False,
        default=dict,
    )


class SmileitJobResponseSerializer(serializers.ModelSerializer):
    """Respuesta principal para estado/resultados de job Smile-it."""

    parameters = SmileitParametersSerializer()
    results = SmileitResultSerializer(allow_null=True, required=False)

    class Meta:
        model = ScientificJob
        fields = [
            "id",
            "job_hash",
            "plugin_name",
            "algorithm_version",
            "status",
            "cache_hit",
            "cache_miss",
            "progress_percentage",
            "progress_stage",
            "progress_message",
            "progress_event_index",
            "parameters",
            "results",
            "error_trace",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields
