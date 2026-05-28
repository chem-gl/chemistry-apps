"""refresh_rett_seed.py: Refresca los datos de librerías RETT existentes desde el CSV.

Las librerías importadas antes de agregar authors/papertitle/doi quedaron con
referencias genéricas. Este comando re-importa los reference_rows de cada
CadmaReferenceLibrary cuyo disease_name sea "RETT Syndrome drugs".
"""

from __future__ import annotations

from django.core.management.base import BaseCommand

from apps.cadma_py.literature_catalog import enrich_bundled_sample_rows
from apps.cadma_py.models import CadmaReferenceLibrary
from apps.cadma_py.services import (
    _read_sample_text,
    build_compound_rows_from_sources,
    _sample_assets_dir,
)


SAMPLE_KEY = "rett"
CSV_FILENAME = "RETT_RefSet.csv"


class Command(BaseCommand):
    help = "Refresca reference_rows de librerías RETT desde el CSV actual."

    def handle(self, *args, **options) -> None:
        sample_path = _sample_assets_dir() / CSV_FILENAME
        if not sample_path.exists():
            self.stderr.write(f"CSV no encontrado: {sample_path}")
            return

        sample_text = sample_path.read_text(encoding="utf-8")
        rows = build_compound_rows_from_sources(
            combined_csv_text=sample_text,
            default_paper_reference="",
            default_paper_url="",
            default_evidence_note="",
            require_evidence=True,
        )
        enriched = enrich_bundled_sample_rows(SAMPLE_KEY, rows)

        libraries = CadmaReferenceLibrary.objects.filter(
            disease_name__iexact="RETT Syndrome drugs"
        )
        updated_count = 0
        for lib in libraries:
            lib.reference_rows = enriched
            lib.save(update_fields=["reference_rows", "updated_at"])
            updated_count += 1
            self.stdout.write(f"  ✓ {lib.name} ({lib.id}) — {len(enriched)} rows")

        self.stdout.write(f"\n{updated_count} librerías RETT actualizadas.")
        if updated_count == 0:
            self.stdout.write(
                "No se encontraron librerías RETT. "
                "Importa la muestra desde la UI para crearla."
            )
