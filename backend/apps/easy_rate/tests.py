"""tests.py: Pruebas de contrato y ejecución para la app Easy-rate.

Objetivo del archivo:
- Verificar create multipart, cálculo del plugin y reportes de trazabilidad.

Cómo se usa:
- Ejecutar con `python manage.py test apps.easy_rate`.
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
    free_energy: float,
    thermal_enthalpy: float,
    zero_point_energy: float,
    scf_energy: float,
    temperature: float,
    imaginary_frequency: float,
    include_ts_marker: bool,
) -> bytes:
    """Genera contenido mínimo de log Gaussian compatible con parser local."""
    lines: list[str] = [
        "Initial command:",
        "#p opt freq b3lyp/6-31g(d)",
        "----------------------------------",
        "Test calculation",
        "----------------------------------",
        "Charge =  0 Multiplicity = 1",
        f"Temperature   {temperature:.4f} Kelvin",
        f"SCF Done:  E(RB3LYP) = {scf_energy:.8f} A.U. after 1 cycles",
        f"Sum of electronic and zero-point Energies= {zero_point_energy:.8f}",
        f"Sum of electronic and thermal Enthalpies= {thermal_enthalpy:.8f}",
        f"Sum of electronic and thermal Free Energies= {free_energy:.8f}",
    ]

    if include_ts_marker:
        lines.append("1 imaginary frequencies (negative Signs)")
        lines.append(f"Frequencies -- {-abs(imaginary_frequency):.4f} 120.0 300.0")
    else:
        lines.append("0 imaginary frequencies (negative Signs)")

    lines.append("Normal termination of Gaussian")
    return "\n".join(lines).encode("utf-8")


class EasyRateContractApiTests(TestCase):
    """Valida contrato HTTP y flujo completo de ejecución Easy-rate."""

    def setUp(self) -> None:
        self.client = APIClient()

    def _build_valid_multipart_payload(self) -> dict[str, object]:
        """Construye payload multipart válido para pruebas de create."""
        reactant_1_file = SimpleUploadedFile(
            "reactant-1.log",
            _build_gaussian_log_content(
                free_energy=-100.0000,
                thermal_enthalpy=-99.9000,
                zero_point_energy=-99.8500,
                scf_energy=-100.2000,
                temperature=298.15,
                imaginary_frequency=0.0,
                include_ts_marker=False,
            ),
            content_type="text/plain",
        )
        transition_state_file = SimpleUploadedFile(
            "transition-state.log",
            _build_gaussian_log_content(
                free_energy=-99.9500,
                thermal_enthalpy=-99.8500,
                zero_point_energy=-99.8000,
                scf_energy=-100.0000,
                temperature=298.15,
                imaginary_frequency=625.0,
                include_ts_marker=True,
            ),
            content_type="text/plain",
        )
        product_1_file = SimpleUploadedFile(
            "product-1.log",
            _build_gaussian_log_content(
                free_energy=-100.0500,
                thermal_enthalpy=-99.9500,
                zero_point_energy=-99.9000,
                scf_energy=-100.2500,
                temperature=298.15,
                imaginary_frequency=0.0,
                include_ts_marker=False,
            ),
            content_type="text/plain",
        )

        return {
            "version": "2.0.0",
            "title": "Easy-rate Test Path",
            "reaction_path_degeneracy": "1.0",
            "cage_effects": "true",
            "diffusion": "true",
            "solvent": "Water",
            "radius_reactant_1": "2.10",
            "radius_reactant_2": "2.30",
            "reaction_distance": "2.80",
            "print_data_input": "true",
            "reactant_1_file": reactant_1_file,
            "transition_state_file": transition_state_file,
            "product_1_file": product_1_file,
        }

    def test_create_and_retrieve_easy_rate_job(self) -> None:
        """Crea job multipart, ejecuta plugin y valida salida tipada."""
        multipart_payload = self._build_valid_multipart_payload()

        with patch("apps.easy_rate.routers.dispatch_scientific_job") as dispatch_mock:
            dispatch_mock.return_value = True
            create_response = self.client.post(
                APP_API_BASE_PATH,
                multipart_payload,
                format="multipart",
            )

        self.assertEqual(create_response.status_code, 201)
        self.assertEqual(create_response.data["plugin_name"], PLUGIN_NAME)

        created_job_id: str = str(create_response.data["id"])
        JobService.run_job(created_job_id)

        retrieve_response = self.client.get(f"{APP_API_BASE_PATH}{created_job_id}/")
        self.assertEqual(retrieve_response.status_code, 200)
        self.assertEqual(retrieve_response.data["status"], "completed")

        result_payload = retrieve_response.data["results"]
        self.assertIn("rate_constant", result_payload)
        self.assertIn("kappa_tst", result_payload)
        self.assertIn("gibbs_activation_kcal_mol", result_payload)
        self.assertIn("structures", result_payload)

    def test_create_easy_rate_rejects_missing_reactants(self) -> None:
        """Valida error 400 cuando no se carga ningún reactivo."""
        transition_state_file = SimpleUploadedFile(
            "transition-state.log",
            _build_gaussian_log_content(
                free_energy=-99.9500,
                thermal_enthalpy=-99.8500,
                zero_point_energy=-99.8000,
                scf_energy=-100.0000,
                temperature=298.15,
                imaginary_frequency=625.0,
                include_ts_marker=True,
            ),
            content_type="text/plain",
        )
        product_1_file = SimpleUploadedFile(
            "product-1.log",
            _build_gaussian_log_content(
                free_energy=-100.0500,
                thermal_enthalpy=-99.9500,
                zero_point_energy=-99.9000,
                scf_energy=-100.2500,
                temperature=298.15,
                imaginary_frequency=0.0,
                include_ts_marker=False,
            ),
            content_type="text/plain",
        )

        payload = {
            "version": "2.0.0",
            "title": "Invalid payload",
            "reaction_path_degeneracy": "1.0",
            "transition_state_file": transition_state_file,
            "product_1_file": product_1_file,
        }

        response = self.client.post(APP_API_BASE_PATH, payload, format="multipart")
        self.assertEqual(response.status_code, 400)

    def test_report_inputs_returns_zip_with_manifest(self) -> None:
        """Verifica descarga ZIP de entradas persistidas para trazabilidad."""
        multipart_payload = self._build_valid_multipart_payload()

        with patch("apps.easy_rate.routers.dispatch_scientific_job") as dispatch_mock:
            dispatch_mock.return_value = False
            create_response = self.client.post(
                APP_API_BASE_PATH,
                multipart_payload,
                format="multipart",
            )

        self.assertEqual(create_response.status_code, 201)
        created_job_id: str = str(create_response.data["id"])

        response = self.client.get(
            f"{APP_API_BASE_PATH}{created_job_id}/report-inputs/"
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("application/zip", str(response["Content-Type"]))

        with ZipFile(BytesIO(response.content), mode="r") as zip_file:
            entry_names: list[str] = zip_file.namelist()
            self.assertIn("manifest.json", entry_names)
