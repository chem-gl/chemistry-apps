"""models.py: Modelos persistentes versionados para catálogo y patrones de Smile-it.

Objetivo del archivo:
- Persistir sustituyentes, categorías químicas y patrones estructurales con
  versionado inmutable para trazabilidad y reproducibilidad.

Cómo se usa:
- `routers.py` consulta y crea versiones nuevas de sustituyentes/patrones.
- `engine.py` usa categorías y patrones activos para validar y anotar moléculas.
- El job de Smile-it guarda referencias `id + version` de estos modelos.
"""

from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q


class SmileitCategory(models.Model):
    """Categoría química verificable para filtrar y validar sustituyentes."""

    RULE_AROMATIC = "aromatic"
    RULE_HBOND_DONOR = "hbond_donor"
    RULE_HBOND_ACCEPTOR = "hbond_acceptor"
    RULE_HYDROPHOBIC = "hydrophobic"
    RULE_SMARTS = "smarts"

    VERIFICATION_RULE_CHOICES: list[tuple[str, str]] = [
        (RULE_AROMATIC, "Aromatic"),
        (RULE_HBOND_DONOR, "Hydrogen Bond Donor"),
        (RULE_HBOND_ACCEPTOR, "Hydrogen Bond Acceptor"),
        (RULE_HYDROPHOBIC, "Hydrophobic"),
        (RULE_SMARTS, "SMARTS Pattern"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    key = models.SlugField(max_length=80)
    version = models.PositiveIntegerField(default=1)
    is_latest = models.BooleanField(default=True)
    is_active = models.BooleanField(default=True)
    name = models.CharField(max_length=120)
    description = models.CharField(max_length=300)
    verification_rule = models.CharField(
        max_length=30, choices=VERIFICATION_RULE_CHOICES
    )
    verification_smarts = models.CharField(max_length=2000, blank=True, default="")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="smileit_categories",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["key", "-version"]
        constraints = [
            models.UniqueConstraint(
                fields=["key", "version"],
                name="unique_smileit_category_key_version",
            ),
            models.CheckConstraint(
                condition=(Q(verification_rule="smarts") & ~Q(verification_smarts=""))
                | (~Q(verification_rule="smarts") & Q(verification_smarts="")),
                name="smileit_category_smarts_rule_consistency",
            ),
        ]
        indexes = [
            models.Index(fields=["key", "is_latest"]),
            models.Index(fields=["is_active"]),
        ]

    def __str__(self) -> str:
        return f"Category<{self.key}:v{self.version}>"


class SmileitSubstituent(models.Model):
    """Sustituyente versionado para selección por referencia estable."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    stable_id = models.UUIDField(default=uuid.uuid4, editable=False, db_index=True)
    version = models.PositiveIntegerField(default=1)
    is_latest = models.BooleanField(default=True)
    is_active = models.BooleanField(default=True)

    name = models.CharField(max_length=120)
    smiles_input = models.CharField(max_length=2000)
    smiles_canonical = models.CharField(max_length=2000, db_index=True)
    anchor_atom_indices = models.JSONField(default=list)
    source_reference = models.CharField(max_length=200, blank=True, default="")
    provenance_metadata = models.JSONField(default=dict, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="smileit_substituents",
    )

    categories = models.ManyToManyField(
        SmileitCategory,
        through="SmileitSubstituentCategory",
        related_name="substituents",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name", "-version"]
        constraints = [
            models.UniqueConstraint(
                fields=["stable_id", "version"],
                name="unique_smileit_substituent_stable_version",
            )
        ]
        indexes = [
            models.Index(fields=["stable_id", "is_latest"]),
            models.Index(fields=["is_active"]),
        ]

    def save(self, *args: object, **kwargs: object) -> None:
        """Garantiza que smiles_canonical sea siempre el SMILES canónico de RDKit.

        Invariante de dominio: cualquier escritura a través del ORM que incluya
        smiles_canonical (save completo o update_fields que lo contenga) dejará
        el campo en su forma canónica.  Las migraciones usan modelos históricos
        (apps.get_model) y no pasan por este método — gestionan la canonicalización
        de forma explícita.
        """
        update_fields = kwargs.get("update_fields")
        if update_fields is None or "smiles_canonical" in update_fields:
            from rdkit import Chem  # noqa: PLC0415

            if self.smiles_canonical:
                mol = Chem.MolFromSmiles(self.smiles_canonical)
                if mol is not None:
                    self.smiles_canonical = Chem.MolToSmiles(mol, isomericSmiles=True)
        super().save(*args, **kwargs)  # type: ignore[misc]

    def __str__(self) -> str:
        return f"Substituent<{self.name}:{self.stable_id}:v{self.version}>"


class SmileitSubstituentCategory(models.Model):
    """Relación entre sustituyente y categoría con resultado de validación."""

    substituent = models.ForeignKey(
        SmileitSubstituent,
        on_delete=models.CASCADE,
        related_name="category_links",
    )
    category = models.ForeignKey(
        SmileitCategory,
        on_delete=models.CASCADE,
        related_name="substituent_links",
    )
    verification_passed = models.BooleanField(default=True)
    verification_message = models.CharField(max_length=255, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["substituent", "category"],
                name="unique_smileit_substituent_category",
            )
        ]
        indexes = [
            models.Index(fields=["category", "substituent"]),
        ]

    def __str__(self) -> str:
        return (
            f"SubstituentCategory<{self.substituent_id}:{self.category_id}:"
            f"{self.verification_passed}>"
        )


class SmileitPattern(models.Model):
    """Patrón estructural versionado para anotación visual."""

    TYPE_TOXICOPHORE = "toxicophore"
    TYPE_PRIVILEGED = "privileged"
    PATTERN_TYPE_CHOICES: list[tuple[str, str]] = [
        (TYPE_TOXICOPHORE, "Toxicophore"),
        (TYPE_PRIVILEGED, "Privileged"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    stable_id = models.UUIDField(default=uuid.uuid4, editable=False, db_index=True)
    version = models.PositiveIntegerField(default=1)
    is_latest = models.BooleanField(default=True)
    is_active = models.BooleanField(default=True)

    name = models.CharField(max_length=140)
    smarts = models.CharField(max_length=2000)
    pattern_type = models.CharField(max_length=30, choices=PATTERN_TYPE_CHOICES)
    caption = models.CharField(max_length=300)
    source_reference = models.CharField(max_length=200, blank=True, default="")
    provenance_metadata = models.JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["pattern_type", "name", "-version"]
        constraints = [
            models.UniqueConstraint(
                fields=["stable_id", "version"],
                name="unique_smileit_pattern_stable_version",
            )
        ]
        indexes = [
            models.Index(fields=["pattern_type", "is_active"]),
            models.Index(fields=["stable_id", "is_latest"]),
        ]

    def __str__(self) -> str:
        return f"Pattern<{self.name}:{self.pattern_type}:v{self.version}>"
