"""schemas.py: Contratos OpenAPI estrictos para la app smileit.

Objetivo del archivo:
- Declarar serializers de request/response como contrato público HTTP de la app.
- Los serializers reflejan exactamente los tipos definidos en types.py.
- Incluir ejemplos realistas para la documentación OpenAPI.

Cómo se usa:
- `routers.py` valida entradas con `SmileitJobCreateSerializer`.
- `SmileitJobResponseSerializer` define la forma estable de salida para
  polling, monitoreo y documentación OpenAPI.
- `SmileitStructureInspectionSerializer` documenta el endpoint inspect-structure.
- `SmileitCatalogEntrySerializer` documenta los sustituyentes del catálogo.
"""

from drf_spectacular.utils import OpenApiExample, extend_schema_serializer
from rest_framework import serializers

from apps.core.models import ScientificJob

from .definitions import (
    DEFAULT_ALGORITHM_VERSION,
    MAX_GENERATED_STRUCTURES,
    MAX_NUM_BONDS,
    MAX_R_SUBSTITUTES,
    MAX_SELECTED_ATOMS,
    MAX_SUBSTITUENTS_IN_LIST,
)

# ---------------------------------------------------------------------------
# Serializers de catálogo e inspección (endpoints auxiliares sin job)
# ---------------------------------------------------------------------------


class SmileitCatalogEntrySerializer(serializers.Serializer):
    """Un sustituyente del catálogo inicial o personalizado."""

    name = serializers.CharField(max_length=100)
    smiles = serializers.CharField(max_length=500)
    description = serializers.CharField(max_length=300)
    selected_atom_index = serializers.IntegerField(min_value=0)


class SmileitAtomInfoSerializer(serializers.Serializer):
    """Información de un átomo para la UI de selección interactiva."""

    index = serializers.IntegerField(min_value=0)
    symbol = serializers.CharField(max_length=10)
    implicit_hydrogens = serializers.IntegerField(min_value=0)
    is_aromatic = serializers.BooleanField()


@extend_schema_serializer(
    examples=[
        OpenApiExample(
            "Inspeccionar benceno",
            value={"smiles": "c1ccccc1"},
            request_only=True,
            description="Inspecciona la molécula benceno para selección de átomos.",
        )
    ]
)
class SmileitStructureInspectionRequestSerializer(serializers.Serializer):
    """Request para el endpoint inspect-structure."""

    smiles = serializers.CharField(
        max_length=2000,
        help_text="Cadena SMILES de la molécula a inspeccionar.",
    )


class SmileitStructureInspectionResponseSerializer(serializers.Serializer):
    """Respuesta del endpoint inspect-structure con átomos indexados y SVG."""

    canonical_smiles = serializers.CharField(max_length=2000)
    atom_count = serializers.IntegerField(min_value=1)
    atoms = SmileitAtomInfoSerializer(many=True)
    svg = serializers.CharField(
        help_text="Representación SVG de la molécula con índices de átomo visibles.",
    )


# ---------------------------------------------------------------------------
# Serializer de sustituyente para la lista del job
# ---------------------------------------------------------------------------


class SmileitSubstituentInputSerializer(serializers.Serializer):
    """Un sustituyente a usar en la generación combinatoria."""

    name = serializers.CharField(
        max_length=100,
        help_text="Nombre descriptivo del sustituyente.",
    )
    smiles = serializers.CharField(
        max_length=2000,
        help_text="Cadena SMILES del sustituyente.",
    )
    selected_atom_index = serializers.IntegerField(
        min_value=0,
        help_text="Índice del átomo de anclaje del sustituyente (desde 0).",
    )


# ---------------------------------------------------------------------------
# Serializer de creación del job
# ---------------------------------------------------------------------------


@extend_schema_serializer(
    examples=[
        OpenApiExample(
            "Generar variantes del benceno",
            value={
                "version": "1.0.1",
                "principal_smiles": "c1ccccc1",
                "selected_atom_indices": [0, 1],
                "substituents": [
                    {"name": "Amine", "smiles": "[NH2]", "selected_atom_index": 0},
                    {"name": "Chlorine", "smiles": "[Cl]", "selected_atom_index": 0},
                ],
                "r_substitutes": 2,
                "num_bonds": 1,
                "allow_repeated": False,
                "max_structures": 500,
            },
            request_only=True,
            description=(
                "Genera variantes del benceno sustituyendo en los átomos 0 y 1 "
                "con Amine y Chlorine hasta 2 rondas sin SMILES repetidos."
            ),
        )
    ]
)
class SmileitJobCreateSerializer(serializers.Serializer):
    """Valida request de creación para jobs de generación smileit."""

    version = serializers.CharField(
        max_length=50,
        default=DEFAULT_ALGORITHM_VERSION,
        help_text="Versión del algoritmo de generación.",
    )
    principal_smiles = serializers.CharField(
        max_length=2000,
        help_text="SMILES de la molécula principal sobre la que se harán sustituciones.",
    )
    selected_atom_indices = serializers.ListField(
        child=serializers.IntegerField(min_value=0),
        min_length=1,
        max_length=MAX_SELECTED_ATOMS,
        help_text="Índices de los átomos del principal donde se permiten sustituciones.",
    )
    substituents = SmileitSubstituentInputSerializer(
        many=True,
        help_text="Lista de sustituyentes a combinar.",
    )
    r_substitutes = serializers.IntegerField(
        min_value=1,
        max_value=MAX_R_SUBSTITUTES,
        default=1,
        help_text="Profundidad (rondas) de sustitución combinatoria.",
    )
    num_bonds = serializers.IntegerField(
        min_value=1,
        max_value=MAX_NUM_BONDS,
        default=1,
        help_text="Orden máximo de enlace a crear (1=simple, 2=doble, 3=triple).",
    )
    allow_repeated = serializers.BooleanField(
        default=False,
        help_text="Si True, se permiten SMILES duplicados en la salida.",
    )
    max_structures = serializers.IntegerField(
        min_value=1,
        max_value=MAX_GENERATED_STRUCTURES,
        default=500,
        help_text="Límite de estructuras generadas para evitar explosión combinatoria.",
    )

    def validate_substituents(self, substituents_value: list) -> list:
        """Valida que haya al menos 1 sustituyente y no supere el máximo."""
        if len(substituents_value) == 0:
            raise serializers.ValidationError("Se requiere al menos un sustituyente.")
        if len(substituents_value) > MAX_SUBSTITUENTS_IN_LIST:
            raise serializers.ValidationError(
                f"Máximo {MAX_SUBSTITUENTS_IN_LIST} sustituyentes permitidos."
            )
        return substituents_value

    def validate(self, attrs: dict) -> dict:
        """Valida que r_substitutes no supere los átomos seleccionados."""
        r_subs: int = attrs.get("r_substitutes", 1)
        selected: list = attrs.get("selected_atom_indices", [])
        if len(selected) > 1 and r_subs > len(selected):
            raise serializers.ValidationError(
                {
                    "r_substitutes": (
                        "r_substitutes no puede superar el número de átomos seleccionados "
                        f"({len(selected)}) cuando hay más de 1 átomo seleccionado."
                    )
                }
            )
        return attrs


# ---------------------------------------------------------------------------
# Serializers de respuesta del job
# ---------------------------------------------------------------------------


class SmileitParametersSerializer(serializers.Serializer):
    """Parámetros del job smileit persistidos para trazabilidad."""

    principal_smiles = serializers.CharField(max_length=2000)
    selected_atom_indices = serializers.ListField(child=serializers.IntegerField())
    substituents = SmileitSubstituentInputSerializer(many=True)
    r_substitutes = serializers.IntegerField()
    num_bonds = serializers.IntegerField()
    allow_repeated = serializers.BooleanField()
    max_structures = serializers.IntegerField()


class SmileitGeneratedStructureSerializer(serializers.Serializer):
    """Una molécula generada en el resultado."""

    smiles = serializers.CharField(max_length=2000)
    name = serializers.CharField(max_length=500)
    svg = serializers.CharField()


class SmileitResultSerializer(serializers.Serializer):
    """Resultado completo de la generación combinatoria."""

    total_generated = serializers.IntegerField(min_value=0)
    generated_structures = SmileitGeneratedStructureSerializer(many=True)
    truncated = serializers.BooleanField()
    principal_smiles = serializers.CharField(max_length=2000)
    selected_atom_indices = serializers.ListField(child=serializers.IntegerField())


class SmileitJobResponseSerializer(serializers.ModelSerializer):
    """Salida tipada para jobs de smileit."""

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
