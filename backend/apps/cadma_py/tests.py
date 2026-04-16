"""tests.py: Pruebas unitarias y HTTP mínimas para CADMA Py.

Verifican la normalización de datasets y el alta del job de comparación sin
requerir ejecución Celery real.
"""

from __future__ import annotations

import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework import status
from rest_framework.response import Response
from rest_framework.test import APIClient

from apps.core.models import GroupMembership, ScientificJob, WorkGroup

from .models import CadmaReferenceLibrary
from .plugin import cadma_py_plugin
from .services import (
    build_compound_rows_from_mapped_sources,
    build_compound_rows_from_sources,
    create_library_from_sample,
    deactivate_reference_library,
    fork_reference_library,
    preview_reference_sample_detail,
    remove_reference_row,
    update_reference_library,
)


class CadmaPyServiceTests(TestCase):
    """Pruebas focalizadas en parsing y cálculo de ranking."""

    def test_build_rows_computes_missing_adme_descriptors(self) -> None:
        rows = build_compound_rows_from_sources(
            combined_csv_text=(
                "name,smiles,DT,M,LD50,SA,paper_reference\n"
                "Candidate A,CCO,0.18,0.12,420.0,86.0,Example paper"
            ),
            require_evidence=True,
        )

        self.assertEqual(len(rows), 1)
        self.assertGreater(rows[0]["MW"], 0)
        self.assertGreaterEqual(rows[0]["SA"], 0)

    def test_plugin_returns_ranked_result_payload(self) -> None:
        reference_rows = build_compound_rows_from_sources(
            combined_csv_text=(
                "name,smiles,DT,M,LD50,SA,paper_reference\n"
                "Ref A,CCO,0.20,0.10,450.0,84.0,Paper A\n"
                "Ref B,CCN,0.25,0.15,470.0,80.0,Paper B"
            ),
            require_evidence=True,
        )
        candidate_rows = build_compound_rows_from_sources(
            combined_csv_text=(
                "name,smiles,DT,M,LD50,SA\nHit 1,CCO,0.18,0.08,500.0,88.0"
            ),
            require_evidence=False,
        )

        result = cadma_py_plugin(
            {
                "library_name": "Neuro Reference",
                "disease_name": "Neuro",
                "reference_rows": reference_rows,
                "candidate_rows": candidate_rows,
            },
            lambda _percent, _message: None,
        )

        self.assertEqual(result["candidate_count"], 1)
        self.assertEqual(len(result["ranking"]), 1)
        self.assertIn("score_chart", result)
        self.assertEqual(result["score_chart"]["reference_line"], 1.0)

    def test_mapped_sources_support_row_order_fallback_without_secondary_smiles(
        self,
    ) -> None:
        rows = build_compound_rows_from_mapped_sources(
            source_configs=[
                {
                    "filename": "guide.csv",
                    "content_text": (
                        "Compound,Main SMILES\nLigand A,CCO\nLigand B,CCN"
                    ),
                    "has_header": True,
                    "skip_lines": 0,
                    "delimiter": ",",
                    "smiles_column": "Main SMILES",
                    "name_column": "Compound",
                },
                {
                    "filename": "toxicity.csv",
                    "content_text": "0.12,0.09,450,83\n0.25,0.14,470,79",
                    "has_header": False,
                    "skip_lines": 0,
                    "delimiter": ",",
                    "dt_column": "column_1",
                    "m_column": "column_2",
                    "ld50_column": "column_3",
                    "sa_column": "column_4",
                },
            ],
            default_name_prefix="Candidate Batch",
            require_evidence=False,
        )

        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["name"], "Ligand A")
        self.assertAlmostEqual(rows[1]["DT"], 0.25)
        self.assertAlmostEqual(rows[1]["LD50"], 470.0)

    def test_mapped_sources_block_smiles_mismatches(self) -> None:
        with self.assertRaisesMessage(ValueError, "no coincide"):
            build_compound_rows_from_mapped_sources(
                source_configs=[
                    {
                        "filename": "guide.csv",
                        "content_text": "name,smiles\nLigand A,CCO\nLigand B,CCN",
                        "has_header": True,
                        "skip_lines": 0,
                        "delimiter": ",",
                        "smiles_column": "smiles",
                        "name_column": "name",
                    },
                    {
                        "filename": "sa.csv",
                        "content_text": "smiles,sa\nCCC,87\nCCN,84",
                        "has_header": True,
                        "skip_lines": 0,
                        "delimiter": ",",
                        "smiles_column": "smiles",
                        "sa_column": "sa",
                    },
                ],
                default_name_prefix="Reference family",
                require_evidence=False,
            )


class CadmaPyOwnershipTests(TestCase):
    """Verifica propiedad derivada, trazabilidad y permanencia de familias CADMA."""

    def setUp(self) -> None:
        user_model = get_user_model()
        self.root_user = user_model.objects.create_user(
            username="cadma-root",
            password="root123",
        )
        self.root_user.role = "root"

        self.normal_user = user_model.objects.create_user(
            username="cadma-user",
            password="user123",
        )
        self.normal_user.role = "user"

        self.reference_rows = build_compound_rows_from_sources(
            combined_csv_text=(
                "name,smiles,DT,M,LD50,SA,paper_reference\n"
                "Donepezil,CCO,0.20,0.10,450.0,84.0,Donepezil review"
            ),
            require_evidence=True,
        )
        self.root_library = CadmaReferenceLibrary.objects.create(
            name="Legacy Neuro Reference",
            disease_name="Neurodegenerative Disorders",
            description="Original root description",
            paper_reference="Root benchmark review",
            paper_url="https://doi.org/10.1016/S0140-6736(06)69113-7",
            source_reference="root",
            provenance_metadata={
                "owner_user_id": self.root_user.id,
                "owner_username": self.root_user.username,
            },
            created_by=self.root_user,
            reference_rows=self.reference_rows,
        )

    def test_named_copy_preserves_original_and_uses_requested_name(self) -> None:
        copied_library = fork_reference_library(
            library_id=str(self.root_library.id),
            actor=self.normal_user,
            new_name="Neuro Family For Editing",
        )

        self.root_library.refresh_from_db()

        self.assertEqual(copied_library.name, "Neuro Family For Editing")
        self.assertEqual(copied_library.created_by_id, self.normal_user.id)
        self.assertEqual(self.root_library.name, "Legacy Neuro Reference")

    def test_non_root_update_on_root_library_creates_owned_copy(self) -> None:
        forked_library = update_reference_library(
            library_id=str(self.root_library.id),
            payload={
                "name": "My Neuro Copy",
                "disease_name": "Neurodegenerative Disorders",
                "description": "Personal working copy",
                "paper_reference": "Updated personal notes",
            },
            actor=self.normal_user,
        )

        self.root_library.refresh_from_db()

        self.assertNotEqual(forked_library.id, self.root_library.id)
        self.assertEqual(forked_library.created_by_id, self.normal_user.id)
        self.assertEqual(forked_library.source_reference, "local-lab")
        self.assertEqual(self.root_library.description, "Original root description")
        self.assertEqual(
            str(forked_library.provenance_metadata.get("forked_from_library_id", "")),
            str(self.root_library.id),
        )

    def test_group_member_update_on_admin_library_creates_owned_copy(self) -> None:
        work_group = WorkGroup.objects.create(
            name="Medicinal Chemistry", slug="med-chem"
        )
        admin_user = get_user_model().objects.create_user(
            username="cadma-admin",
            password="admin123",
        )
        admin_user.role = "admin"
        GroupMembership.objects.create(
            user=admin_user,
            group=work_group,
            role_in_group=GroupMembership.ROLE_ADMIN,
        )
        GroupMembership.objects.create(
            user=self.normal_user,
            group=work_group,
            role_in_group=GroupMembership.ROLE_MEMBER,
        )
        shared_group_library = CadmaReferenceLibrary.objects.create(
            name="Shared Neuro Group Library",
            disease_name="Neurodegenerative Disorders",
            description="Shared by admin",
            paper_reference="Admin benchmark",
            paper_url="https://doi.org/10.1007/s12017-019-08558-2",
            source_reference=f"admin-{work_group.id}",
            provenance_metadata={
                "owner_user_id": admin_user.id,
                "owner_username": admin_user.username,
            },
            created_by=admin_user,
            group=work_group,
            reference_rows=self.reference_rows,
        )

        forked_library = update_reference_library(
            library_id=str(shared_group_library.id),
            payload={
                "name": "Member editable copy",
                "disease_name": "Neurodegenerative Disorders",
                "description": "Forked from admin shared library",
            },
            actor=self.normal_user,
        )

        shared_group_library.refresh_from_db()

        self.assertNotEqual(forked_library.id, shared_group_library.id)
        self.assertEqual(forked_library.created_by_id, self.normal_user.id)
        self.assertEqual(forked_library.source_reference, "local-lab")
        self.assertEqual(shared_group_library.description, "Shared by admin")
        self.assertEqual(
            str(forked_library.provenance_metadata.get("forked_from_library_id", "")),
            str(shared_group_library.id),
        )

    def test_used_library_cannot_be_deactivated(self) -> None:
        ScientificJob.objects.create(
            owner=self.root_user,
            group=None,
            job_hash="a" * 64,
            plugin_name="cadma-py",
            algorithm_version="1.0.0",
            status="completed",
            parameters={
                "reference_library_id": str(self.root_library.id),
                "library_name": self.root_library.name,
                "reference_rows": self.root_library.reference_rows,
            },
            results={"ok": True},
        )

        with self.assertRaisesMessage(ValueError, "permanente"):
            deactivate_reference_library(
                library_id=str(self.root_library.id),
                actor=self.root_user,
            )

        self.root_library.refresh_from_db()
        self.assertTrue(self.root_library.is_active)

    def test_sample_import_enriches_real_reference_metadata(self) -> None:
        imported_library = create_library_from_sample(
            sample_key="neuro",
            actor=self.root_user,
        )

        self.assertIn("doi.org", imported_library.paper_url)
        self.assertNotEqual(imported_library.paper_reference.strip(), "")

        donepezil_row = next(
            row for row in imported_library.reference_rows if row["name"] == "Donepezil"
        )
        self.assertNotEqual(donepezil_row["paper_reference"].strip(), "")
        self.assertNotEqual(donepezil_row["paper_url"].strip(), "")
        self.assertNotEqual(donepezil_row["evidence_note"].strip(), "")

    def test_seed_preview_exposes_full_reference_detail(self) -> None:
        sample_view = preview_reference_sample_detail("rett")

        self.assertEqual(sample_view["source_reference"], "root")
        self.assertFalse(sample_view["editable"])
        self.assertGreater(sample_view["row_count"], 0)
        self.assertIn("doi.org", sample_view["paper_url"])
        self.assertGreater(len(sample_view["rows"]), 0)
        self.assertNotEqual(sample_view["rows"][0]["paper_reference"].strip(), "")
        self.assertNotEqual(sample_view["rows"][0]["evidence_note"].strip(), "")

    def test_remove_reference_row_allows_pruning_compounds(self) -> None:
        editable_library = CadmaReferenceLibrary.objects.create(
            name="Editable Family",
            disease_name="Neuro",
            description="Working copy",
            paper_reference="Paper A",
            source_reference="local-lab",
            provenance_metadata={
                "owner_user_id": self.normal_user.id,
                "owner_username": self.normal_user.username,
            },
            created_by=self.normal_user,
            reference_rows=build_compound_rows_from_sources(
                combined_csv_text=(
                    "name,smiles,DT,M,LD50,SA,paper_reference\n"
                    "Donepezil,CCO,0.20,0.10,450.0,84.0,Paper A\n"
                    "Memantine,CCN,0.22,0.08,430.0,80.0,Paper B"
                ),
                require_evidence=True,
            ),
        )

        removed_row = remove_reference_row(
            library_id=str(editable_library.id),
            row_index=0,
            actor=self.normal_user,
        )

        editable_library.refresh_from_db()

        self.assertEqual(removed_row["name"], "Donepezil")
        self.assertEqual(len(editable_library.reference_rows), 1)
        self.assertEqual(editable_library.reference_rows[0]["name"], "Memantine")


class CadmaPyApiTests(TestCase):
    """Smoke tests HTTP de la app CADMA Py."""

    URL = "/api/cadma-py/jobs/"

    def setUp(self) -> None:
        self.client = APIClient()
        reference_rows = build_compound_rows_from_sources(
            combined_csv_text=(
                "name,smiles,DT,M,LD50,SA,paper_reference\n"
                "Ref A,CCO,0.20,0.10,450.0,84.0,Paper A\n"
                "Ref B,CCN,0.25,0.15,470.0,80.0,Paper B"
            ),
            require_evidence=True,
        )
        self.reference_library = CadmaReferenceLibrary.objects.create(
            name="Neuro Library",
            disease_name="Neuro",
            description="Legacy compatible reference set",
            paper_reference="Paper A",
            source_reference="root",
            reference_rows=reference_rows,
        )

    @patch(
        "apps.cadma_py.routers.CadmaPyJobViewSet.prepare_and_dispatch_with_artifacts",
        return_value=Response(
            {"plugin_name": "cadma-py"}, status=status.HTTP_201_CREATED
        ),
    )
    def test_create_cadma_job_returns_201(self, _mock_dispatch: object) -> None:
        payload = {
            "reference_library_id": str(self.reference_library.id),
            "combined_csv_text": (
                "name,smiles,DT,M,LD50,SA\nCandidate A,CCO,0.18,0.12,420.0,86.0"
            ),
        }

        response = self.client.post(self.URL, payload, format="json")

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["plugin_name"], "cadma-py")

    @patch(
        "apps.cadma_py.routers.CadmaPyJobViewSet.prepare_and_dispatch_with_artifacts",
        return_value=Response(
            {"plugin_name": "cadma-py"}, status=status.HTTP_201_CREATED
        ),
    )
    def test_create_cadma_job_accepts_guided_import_config(
        self, _mock_dispatch: object
    ) -> None:
        payload = {
            "reference_library_id": str(self.reference_library.id),
            "project_label": "Series A",
            "source_configs_json": json.dumps(
                [
                    {
                        "filename": "guide.csv",
                        "content_text": (
                            "name,smiles,DT,M,LD50,SA\n"
                            "Candidate A,CCO,0.18,0.12,420.0,86.0"
                        ),
                        "file_format": "csv",
                        "delimiter": ",",
                        "has_header": True,
                        "skip_lines": 0,
                        "smiles_column": "smiles",
                        "name_column": "name",
                        "dt_column": "DT",
                        "m_column": "M",
                        "ld50_column": "LD50",
                        "sa_column": "SA",
                    }
                ]
            ),
        }

        response = self.client.post(self.URL, payload, format="json")

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["plugin_name"], "cadma-py")

    @patch(
        "apps.cadma_py.routers.CadmaPyJobViewSet.prepare_and_pause_with_artifacts",
        return_value=Response(
            {"plugin_name": "cadma-py", "status": "paused"},
            status=status.HTTP_201_CREATED,
        ),
    )
    def test_create_cadma_job_can_start_paused(
        self, mock_prepare_paused: object
    ) -> None:
        payload = {
            "reference_library_id": str(self.reference_library.id),
            "project_label": "Paused draft",
            "combined_csv_text": (
                "name,smiles,DT,M,LD50,SA\nCandidate A,CCO,0.18,0.12,420.0,86.0"
            ),
            "start_paused": True,
        }

        response = self.client.post(self.URL, payload, format="json")

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["status"], "paused")
        mock_prepare_paused.assert_called_once()
