"""test_identity_catalog_e2e.py: Integración e2e de Smile-it con login y aislamiento por usuario.

Objetivo del archivo:
- Verificar desde inicio de sesión JWT que cada usuario solo ve/edita sus
  sustituyentes propios (más los seed globales) en el catálogo Smile-it.
"""

from __future__ import annotations

import secrets
from typing import Any

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APIClient

from ..definitions import APP_API_BASE_PATH
from .test_seed import SmileitSeedTestCase


class SmileitCatalogIdentityE2ETests(SmileitSeedTestCase):
    """Valida aislamiento de catálogo Smile-it por usuario autenticado."""

    def setUp(self) -> None:
        self.client_user_a = APIClient()
        self.client_user_b = APIClient()
        self.client_anonymous = APIClient()
        self.user_a_password = secrets.token_urlsafe(12)
        self.user_b_password = secrets.token_urlsafe(12)

        user_model = get_user_model()
        self.user_a = user_model.objects.create_user(
            username="smileit_user_a",
            email="smileit_user_a@test.local",
        )
        self.user_b = user_model.objects.create_user(
            username="smileit_user_b",
            email="smileit_user_b@test.local",
        )

        self.user_a.set_password(self.user_a_password)
        self.user_a.save(update_fields=["password"])
        self.user_b.set_password(self.user_b_password)
        self.user_b.save(update_fields=["password"])

        self._authenticate_client(
            self.client_user_a,
            "smileit_user_a",
            self.user_a_password,
        )
        self._authenticate_client(
            self.client_user_b,
            "smileit_user_b",
            self.user_b_password,
        )

    def _authenticate_client(
        self, client: APIClient, username: str, password: str
    ) -> None:
        """Obtiene JWT vía login y configura header Authorization del cliente."""
        login_response: Any = client.post(
            "/api/auth/login/",
            data={"username": username, "password": password},
            format="json",
        )
        self.assertEqual(login_response.status_code, status.HTTP_200_OK)
        access_token = login_response.json()["access"]
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {access_token}")

    def _build_payload(self, name: str, smiles: str) -> dict[str, object]:
        """Crea payload válido de sustituyente sin categorías para evitar falsos negativos."""
        return {
            "name": name,
            "smiles": smiles,
            "anchor_atom_indices": [0],
            "category_keys": [],
            "source_reference": "user-catalog-e2e",
            "provenance_metadata": {"scope": "identity-e2e"},
        }

    def test_each_authenticated_user_sees_only_own_catalog_entries(self) -> None:
        """Cada usuario autenticado debe ver solo sus entradas propias + seed compartidos."""
        create_a: Any = self.client_user_a.post(
            f"{APP_API_BASE_PATH}catalog/",
            data=self._build_payload("UserA Cyclobutyl", "C1CCC1N"),
            format="json",
        )
        self.assertEqual(create_a.status_code, status.HTTP_201_CREATED)

        create_b: Any = self.client_user_b.post(
            f"{APP_API_BASE_PATH}catalog/",
            data=self._build_payload("UserB Cyclopentyl", "C1CCCC1N"),
            format="json",
        )
        self.assertEqual(create_b.status_code, status.HTTP_201_CREATED)

        catalog_a_response: Any = self.client_user_a.get(f"{APP_API_BASE_PATH}catalog/")
        catalog_b_response: Any = self.client_user_b.get(f"{APP_API_BASE_PATH}catalog/")
        self.assertEqual(catalog_a_response.status_code, status.HTTP_200_OK)
        self.assertEqual(catalog_b_response.status_code, status.HTTP_200_OK)

        names_a = {entry["name"] for entry in catalog_a_response.json()}
        names_b = {entry["name"] for entry in catalog_b_response.json()}

        self.assertIn("UserA Cyclobutyl", names_a)
        self.assertNotIn("UserB Cyclopentyl", names_a)

        self.assertIn("UserB Cyclopentyl", names_b)
        self.assertNotIn("UserA Cyclobutyl", names_b)

    def test_user_cannot_edit_catalog_entry_owned_by_another_user(self) -> None:
        """Un usuario no debe poder versionar entradas creadas por otro usuario."""
        create_a: Any = self.client_user_a.post(
            f"{APP_API_BASE_PATH}catalog/",
            data=self._build_payload("UserA Locked Entry", "CCCN"),
            format="json",
        )
        self.assertEqual(create_a.status_code, status.HTTP_201_CREATED)
        stable_id = create_a.json()["stable_id"]

        update_b: Any = self.client_user_b.patch(
            f"{APP_API_BASE_PATH}catalog/{stable_id}/",
            data=self._build_payload("UserB Should Not Edit", "CCCCN"),
            format="json",
        )
        self.assertEqual(update_b.status_code, status.HTTP_409_CONFLICT)
        self.assertIn("detail", update_b.json())

    def test_anonymous_catalog_still_exposes_seed_entries_only(self) -> None:
        """Sin login, el catálogo se mantiene funcional para lectura base de seed."""
        response: Any = self.client_anonymous.get(f"{APP_API_BASE_PATH}catalog/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(len(response.json()), 1)
