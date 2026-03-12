"""tests.py: Pruebas de contrato y ejecución para la app Marcus.

Objetivo del archivo:
- Verificar create multipart, ejecución plugin Marcus y descarga de entradas.
"""

from __future__ import annotations

from io import BytesIO
from unittest.mock import patch
from zipfile import ZipFile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.services import JobService

from .definitions import APP_API_BASE_PATH, PLUGIN_NAME


def _build_gaussian_log_content(
    *,
    scf_energy: float,
    thermal_free_enthalpy: float,
    temperature: float,
) -> bytes:
    """Construye log mínimo compatible con parser Gaussian del backend."""
    lines: list[str] = [
        "Initial command:",
        "#p opt freq b3lyp/6-31g(d)",
        "----------------------------------",
        "Test calculation",
        "----------------------------------",
        "Charge =  0 Multiplicity = 1",
        "0 imaginary frequencies (negative Signs)",
        f"Temperature   {temperature:.4f} Kelvin",
        f"SCF Done:  E(RB3LYP) = {scf_energy:.8f} A.U. after 1 cycles",
        f"Sum of electronic and thermal Free Energies= {thermal_free_enthalpy:.8f}",
        "Normal termination of Gaussian",
    ]
    return "\n".join(lines).encode("utf-8")


class MarcusContractApiTests(TestCase):
    """Valida endpoints y ejecución principal de la app Marcus."""

    def setUp(self) -> None:
        self.client = APIClient()

    def _build_payload(self) -> dict[str, object]:
        """Construye payload multipart válido para Marcus."""
        return {
            "version": "1.0.0",
            "title": "Marcus Pathway",
            "diffusion": "true",
            "radius_reactant_1": "2.0",
            "radius_reactant_2": "2.5",
            "reaction_distance": "3.2",
            "reactant_1_file": SimpleUploadedFile(
                "r1.log",
                _build_gaussian_log_content(
                    scf_energy=-150.0000,
                    thermal_free_enthalpy=-149.9000,
                    temperature=298.15,
                ),
                content_type="text/plain",
            ),
            "reactant_2_file": SimpleUploadedFile(
                "r2.log",
                _build_gaussian_log_content(
                    scf_energy=-130.0000,
                    thermal_free_enthalpy=-129.9000,
                    temperature=298.15,
                ),
                content_type="text/plain",
            ),
            "product_1_adiabatic_file": SimpleUploadedFile(
                "p1a.log",
                _build_gaussian_log_content(
                    scf_energy=-149.9500,
                    thermal_free_enthalpy=-149.8500,
                    temperature=298.15,
                ),
                content_type="text/plain",
            ),
            "product_2_adiabatic_file": SimpleUploadedFile(
                "p2a.log",
                _build_gaussian_log_content(
                    scf_energy=-129.9400,
                    thermal_free_enthalpy=-129.8400,
                    temperature=298.15,
                ),
                content_type="text/plain",
            ),
            "product_1_vertical_file": SimpleUploadedFile(
                "p1v.log",
                _build_gaussian_log_content(
                    scf_energy=-149.9100,
                    thermal_free_enthalpy=-149.8100,
                    temperature=298.15,
                ),
                content_type="text/plain",
            ),
            "product_2_vertical_file": SimpleUploadedFile(
                "p2v.log",
                _build_gaussian_log_content(
                    scf_energy=-129.9000,
                    thermal_free_enthalpy=-129.8000,
                    temperature=298.15,
                ),
                content_type="text/plain",
            ),
        }

    def test_create_and_retrieve_marcus_job(self) -> None:
        """Crea job Marcus y valida resultado tras ejecución del plugin."""
        payload = self._build_payload()

        with patch("apps.marcus.routers.dispatch_scientific_job") as dispatch_mock:
            dispatch_mock.return_value = True
            create_response = self.client.post(
                APP_API_BASE_PATH,
                payload,
                format="multipart",
            )

        self.assertEqual(create_response.status_code, 201)
        self.assertEqual(create_response.data["plugin_name"], PLUGIN_NAME)

        job_id: str = str(create_response.data["id"])
        JobService.run_job(job_id)

        retrieve_response = self.client.get(f"{APP_API_BASE_PATH}{job_id}/")
        self.assertEqual(retrieve_response.status_code, 200)
        self.assertEqual(retrieve_response.data["status"], "completed")
        self.assertIn("barrier_kcal_mol", retrieve_response.data["results"])
        self.assertIn("rate_constant", retrieve_response.data["results"])

    def test_report_inputs_returns_zip(self) -> None:
        """Verifica descarga ZIP de artefactos de entrada persistidos."""
        payload = self._build_payload()

        with patch("apps.marcus.routers.dispatch_scientific_job") as dispatch_mock:
            dispatch_mock.return_value = False
            create_response = self.client.post(
                APP_API_BASE_PATH,
                payload,
                format="multipart",
            )

        self.assertEqual(create_response.status_code, 201)
        job_id: str = str(create_response.data["id"])

        response = self.client.get(f"{APP_API_BASE_PATH}{job_id}/report-inputs/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("application/zip", str(response["Content-Type"]))

        with ZipFile(BytesIO(response.content), mode="r") as zip_file:
            self.assertIn("manifest.json", zip_file.namelist())
