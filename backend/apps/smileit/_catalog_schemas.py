"""_catalog_schemas.py: Serializers de catálogo, patrones e inspección para Smile-it.

Objetivo del archivo:
- Declarar serializers de catálogo persistente (categorías, sustituyentes, patrones),
  inspección estructural y sustituyentes de entrada por bloque.

Cómo se usa:
- `schemas.py` importa y re-exporta estos serializers para mantenibilidad.
- `routers/viewset_write.py` los usa directamente para validar creación de catálogo.
"""

from __future__ import annotations

from drf_spectacular.utils import OpenApiExample, extend_schema_serializer
from rest_framework import serializers

from .definitions import (
    MAX_CATEGORIES_PER_BLOCK,
    MAX_PATTERN_CAPTION_LENGTH,
    MAX_PATTERN_NAME_LENGTH,
    MAX_PATTERN_SMARTS_LENGTH,
    MAX_SUBSTITUENT_NAME_LENGTH,
    MAX_SUBSTITUENT_SMILES_LENGTH,
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
        required=False,
        default=list,
        max_length=MAX_CATEGORIES_PER_BLOCK,
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
        required=False,
        default=list,
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
