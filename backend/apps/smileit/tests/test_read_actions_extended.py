"""test_read_actions_extended.py: Cobertura adicional de endpoints GET y reportes de Smile-it.

Objetivo del archivo:
- Cubrir paginación de derivados, render SVG y descargas de reportes que no
  estaban suficientemente ejercitados por los tests HTTP existentes.
- Validar además el alcance de visibilidad sobre jobs cuando el actor no tiene
  permisos para consultarlos.
"""

from __future__ import annotations

from io import BytesIO
from zipfile import ZipFile

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from apps.core.models import ScientificJob

from ..definitions import APP_API_BASE_PATH, DEFAULT_ALGORITHM_VERSION, PLUGIN_NAME
from .test_seed import SmileitSeedTestCase


def _build_completed_results_payload() -> dict[str, object]:
    """Construye resultados mínimos válidos para endpoints de lectura/reportes."""
    return {
        "principal_smiles": "c1ccccc1",
        "export_name_base": "SMILEIT",
        "total_generated": 2,
        "generated_structures": [
            {
                "smiles": "Cc1ccccc1",
                "name": "Toluene",
                "svg": "<svg></svg>",
                "placeholder_assignments": [
                    {
                        "placeholder_label": "R1",
                        "site_atom_index": 0,
                        "substituent_name": "Methyl",
                        "substituent_smiles": "C",
                    }
                ],
                "traceability": [
                    {
                        "site_atom_index": 0,
                        "round_index": 1,
                        "block_priority": 1,
                        "block_label": "HydrophobicBlock",
                        "substituent_name": "Methyl",
                        "substituent_smiles": "C",
                        "substituent_stable_id": "stable-1",
                        "substituent_version": 1,
                        "source_kind": "seed",
                        "bond_order": 1,
                    }
                ],
            },
            {
                "smiles": "CCc1ccccc1",
                "name": "Ethyl benzene",
                "svg": "<svg></svg>",
                "placeholder_assignments": [
                    {
                        "placeholder_label": "R2",
                        "site_atom_index": 1,
                        "substituent_name": "Ethyl",
                        "substituent_smiles": "CC",
                    }
                ],
                "traceability": [
                    {
                        "site_atom_index": 1,
                        "round_index": 1,
                        "block_priority": 1,
                        "block_label": "HydrophobicBlock",
                        "substituent_name": "Ethyl",
                        "substituent_smiles": "CC",
                        "substituent_stable_id": "stable-2",
                        "substituent_version": 1,
                        "source_kind": "manual",
                        "bond_order": 1,
                    }
                ],
            },
        ],
        "traceability_rows": [
            {
                "derivative_name": "dSMILEIT1",
                "derivative_smiles": "Cc1ccccc1",
                "round_index": 1,
                "site_atom_index": 0,
                "block_label": "HydrophobicBlock",
                "block_priority": 1,
                "substituent_name": "Methyl",
                "substituent_smiles": "C",
                "substituent_stable_id": "stable-1",
                "substituent_version": 1,
                "source_kind": "seed",
                "bond_order": 1,
            }
        ],
    }


class SmileitReadActionsExtendedTests(SmileitSeedTestCase):
    """Cubre las rutas GET especializadas del viewset de lectura de Smile-it."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.user_model = get_user_model()

    def _create_completed_job(self) -> ScientificJob:
        """Crea un job Smile-it completado con resultados exportables."""
        return ScientificJob.objects.create(
            job_hash="smileit-read-actions-hash",
            plugin_name=PLUGIN_NAME,
            algorithm_version=DEFAULT_ALGORITHM_VERSION,
            status="completed",
            cache_hit=False,
            cache_miss=True,
            parameters={"version": DEFAULT_ALGORITHM_VERSION},
            results=_build_completed_results_payload(),
        )

    def _create_pending_job(self) -> ScientificJob:
        """Crea un job pendiente para validar rutas 409 de reportes."""
        return ScientificJob.objects.create(
            job_hash="smileit-pending-report-hash",
            plugin_name=PLUGIN_NAME,
            algorithm_version=DEFAULT_ALGORITHM_VERSION,
            status="pending",
            cache_hit=False,
            cache_miss=True,
            parameters={"version": DEFAULT_ALGORITHM_VERSION},
            results=None,
        )

    def test_derivations_endpoint_returns_pagination_payload(self) -> None:
        # Verifica la paginación nominal para evitar payloads gigantes en el frontend.
        job = self._create_completed_job()

        response = self.client.get(
            f"{APP_API_BASE_PATH}{job.id}/derivations/", {"offset": 1, "limit": 1}
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["total_generated"], 2)
        self.assertEqual(response.data["offset"], 1)
        self.assertEqual(response.data["limit"], 1)
        self.assertEqual(len(response.data["items"]), 1)
        self.assertEqual(response.data["items"][0]["structure_index"], 1)

    def test_derivations_endpoint_rejects_invalid_pagination_and_pending_jobs(
        self,
    ) -> None:
        # Verifica validación de query params y bloqueo de reportes para jobs no completados.
        completed_job = self._create_completed_job()
        pending_job = self._create_pending_job()

        invalid_params_response = self.client.get(
            f"{APP_API_BASE_PATH}{completed_job.id}/derivations/",
            {"offset": "abc", "limit": "nan"},
        )
        pending_response = self.client.get(
            f"{APP_API_BASE_PATH}{pending_job.id}/derivations/"
        )

        self.assertEqual(
            invalid_params_response.status_code, status.HTTP_400_BAD_REQUEST
        )
        self.assertIn("offset y limit", invalid_params_response.data["detail"])
        self.assertEqual(pending_response.status_code, status.HTTP_409_CONFLICT)

    def test_derivation_svg_returns_svg_and_handles_missing_structure(self) -> None:
        # Verifica render SVG bajo demanda y 404 cuando el índice no existe.
        job = self._create_completed_job()

        success_response = self.client.get(
            f"{APP_API_BASE_PATH}{job.id}/derivations/0/svg/",
            {"variant": "thumb"},
        )
        missing_response = self.client.get(
            f"{APP_API_BASE_PATH}{job.id}/derivations/99/svg/"
        )

        self.assertEqual(success_response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            success_response["Content-Type"], "image/svg+xml; charset=utf-8"
        )
        self.assertIn("<svg", success_response.content.decode("utf-8"))
        self.assertEqual(missing_response.status_code, status.HTTP_404_NOT_FOUND)

    def test_report_smiles_traceability_and_images_zip_are_downloadable(self) -> None:
        # Verifica los tres reportes descargables principales y su contenido mínimo.
        job = self._create_completed_job()

        smiles_response = self.client.get(f"{APP_API_BASE_PATH}{job.id}/report-smiles/")
        traceability_response = self.client.get(
            f"{APP_API_BASE_PATH}{job.id}/report-traceability/"
        )
        zip_response = self.client.get(
            f"{APP_API_BASE_PATH}{job.id}/report-images-zip/"
        )

        self.assertEqual(smiles_response.status_code, status.HTTP_200_OK)
        self.assertEqual(traceability_response.status_code, status.HTTP_200_OK)
        self.assertEqual(zip_response.status_code, status.HTTP_200_OK)
        self.assertIn("attachment; filename=", smiles_response["Content-Disposition"])
        self.assertIn(
            "attachment; filename=", traceability_response["Content-Disposition"]
        )
        self.assertIn("attachment; filename=", zip_response["Content-Disposition"])
        self.assertIn("c1ccccc1", smiles_response.content.decode("utf-8"))
        self.assertIn("derivative_name", traceability_response.content.decode("utf-8"))

        with ZipFile(BytesIO(zip_response.content)) as archive:
            zip_entries = archive.namelist()
            self.assertIn("generated_smiles.txt", zip_entries)
            self.assertTrue(any(entry.endswith(".svg") for entry in zip_entries))

    def test_report_endpoints_return_conflict_for_non_completed_jobs(self) -> None:
        # Verifica que los reportes descargables respeten el estado terminal requerido.
        job = self._create_pending_job()

        smiles_response = self.client.get(f"{APP_API_BASE_PATH}{job.id}/report-smiles/")
        traceability_response = self.client.get(
            f"{APP_API_BASE_PATH}{job.id}/report-traceability/"
        )
        zip_response = self.client.get(
            f"{APP_API_BASE_PATH}{job.id}/report-images-zip/"
        )

        self.assertEqual(smiles_response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(traceability_response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(zip_response.status_code, status.HTTP_409_CONFLICT)

    def test_retrieve_returns_404_for_authenticated_user_without_visibility(
        self,
    ) -> None:
        # Verifica el alcance de visibilidad del job cuando el actor no es dueño ni comparte grupo.
        owner_user = self.user_model.objects.create_user(
            username="smileit-owner",
            email="owner@test.local",
            password="owner-password",
        )
        outsider_user = self.user_model.objects.create_user(
            username="smileit-outsider",
            email="outsider@test.local",
            password="outsider-password",
        )
        job = self._create_completed_job()
        job.owner = owner_user
        job.group = None
        job.save(update_fields=["owner", "group", "updated_at"])

        self.client.force_authenticate(user=outsider_user)
        response = self.client.get(f"{APP_API_BASE_PATH}{job.id}/")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class SmileitReadActionsSmokeTests(TestCase):
    """Pruebas ligeras de compatibilidad para endpoints con IDs inexistentes."""

    def setUp(self) -> None:
        self.client = APIClient()

    def test_missing_job_returns_404_in_read_endpoints(self) -> None:
        # Verifica que los endpoints lean el job desde el queryset acotado y fallen con 404 si no existe.
        missing_id = "00000000-0000-0000-0000-000000000001"

        retrieve_response = self.client.get(f"{APP_API_BASE_PATH}{missing_id}/")
        report_response = self.client.get(
            f"{APP_API_BASE_PATH}{missing_id}/report-smiles/"
        )

        self.assertEqual(retrieve_response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(report_response.status_code, status.HTTP_404_NOT_FOUND)
