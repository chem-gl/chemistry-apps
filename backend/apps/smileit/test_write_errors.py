"""test_write_errors.py: Tests de rutas de error en los endpoints de escritura de Smile-it.

Objetivo: Cubrir ramas de manejo de errores en viewset_write.py que no alcanzan los
tests de integración existentes, particularmente los endpoints de categorías, patrones
duplicados, inspect-structure con SMILES inválido y job create con fallos de servicio.
"""

from __future__ import annotations

from unittest.mock import patch

from rest_framework.test import APIClient

from .definitions import APP_API_BASE_PATH
from .test_seed import SmileitSeedTestCase


class CategoriesEndpointTests(SmileitSeedTestCase):
    """Cubre la acción GET categories/ que lista categorías disponibles."""

    def setUp(self) -> None:
        self.client = APIClient()

    def test_categories_endpoint_returns_list(self) -> None:
        """GET categories/ debe retornar la lista de categorías activas con 200."""
        response = self.client.get(f"{APP_API_BASE_PATH}categories/")
        self.assertEqual(response.status_code, 200)
        self.assertIsInstance(response.data, list)

    def test_categories_endpoint_has_key_field(self) -> None:
        """Cada categoría debe incluir al menos el campo key."""
        response = self.client.get(f"{APP_API_BASE_PATH}categories/")
        self.assertEqual(response.status_code, 200)
        if len(response.data) > 0:
            self.assertIn("key", response.data[0])


class CatalogPostConflictTests(SmileitSeedTestCase):
    """Cubre la ruta de conflicto 409 al intentar crear sustituyente duplicado."""

    def setUp(self) -> None:
        self.client = APIClient()

    def test_create_duplicate_catalog_returns_409(self) -> None:
        """POST catalog/ con SMILES duplicado debe retornar 409."""
        # Primero crea un sustituyente válido
        payload = {
            "name": "TestDupHydro",
            "smiles": "C1CC1",
            "anchor_atom_indices": [0],
            "category_keys": ["hydrophobic"],
            "source_reference": "dup-test",
            "provenance_metadata": {},
        }
        first_response = self.client.post(
            f"{APP_API_BASE_PATH}catalog/", data=payload, format="json"
        )
        self.assertIn(
            first_response.status_code, (201, 409)
        )  # puede ya existir en seed

        # Intenta crear el mismo de nuevo → debe ser 409
        second_response = self.client.post(
            f"{APP_API_BASE_PATH}catalog/", data=payload, format="json"
        )
        self.assertEqual(second_response.status_code, 409)
        self.assertIn("detail", second_response.json())


class UpdateCatalogErrorTests(SmileitSeedTestCase):
    """Cubre las rutas de error 404/409 en PATCH catalog/<stable_id>/."""

    def setUp(self) -> None:
        self.client = APIClient()

    def test_update_nonexistent_stable_id_returns_404(self) -> None:
        """PATCH con stable_id inexistente debe retornar 404."""
        import uuid

        payload = {
            "name": "NonExisting",
            "smiles": "C",
            "anchor_atom_indices": [0],
            "category_keys": ["hydrophobic"],
            "source_reference": "test",
            "provenance_metadata": {},
        }
        response = self.client.patch(
            f"{APP_API_BASE_PATH}catalog/{uuid.uuid4()}/",
            data=payload,
            format="json",
        )
        self.assertEqual(response.status_code, 404)
        self.assertIn("detail", response.json())

    def test_update_catalog_success_returns_200_list(self) -> None:
        """PATCH exitoso debe retornar 200 con la lista actualizada de sustituyentes."""
        # Crea sustituyente de usuario
        create_payload = {
            "name": "TempSubHydroA",
            "smiles": "C1CC1CC",
            "anchor_atom_indices": [0],
            "category_keys": ["hydrophobic"],
            "source_reference": "user-test",
            "provenance_metadata": {"src": "test"},
        }
        create_resp = self.client.post(
            f"{APP_API_BASE_PATH}catalog/", data=create_payload, format="json"
        )
        self.assertEqual(create_resp.status_code, 201)
        stable_id = create_resp.json()["stable_id"]

        update_payload = {
            "name": "TempSubHydroAv2",
            "smiles": "C1CC1CCC",
            "anchor_atom_indices": [0],
            "category_keys": ["hydrophobic"],
            "source_reference": "user-test",
            "provenance_metadata": {"src": "test", "v": "2"},
        }
        update_resp = self.client.patch(
            f"{APP_API_BASE_PATH}catalog/{stable_id}/",
            data=update_payload,
            format="json",
        )
        self.assertEqual(update_resp.status_code, 200)
        self.assertIsInstance(update_resp.json(), list)


class InspectStructureErrorTests(SmileitSeedTestCase):
    """Cubre la ruta de error 400 en POST inspect-structure/ con SMILES inválido."""

    def setUp(self) -> None:
        self.client = APIClient()

    def test_invalid_smiles_returns_400(self) -> None:
        """SMILES vacío o no parseable debe retornar 400."""
        with patch(
            "apps.smileit.routers.viewset_write.inspect_smiles_structure_with_patterns",
            side_effect=ValueError("SMILES no válido"),
        ):
            response = self.client.post(
                f"{APP_API_BASE_PATH}inspect-structure/",
                data={
                    "smiles": "CC"
                },  # SMILES válido para pasar validación del serializer
                format="json",
            )
        self.assertEqual(response.status_code, 400)
        self.assertIn("detail", response.json())


class PatternConflictTests(SmileitSeedTestCase):
    """Cubre la ruta de conflicto 409 al crear patrón duplicado via HTTP."""

    def setUp(self) -> None:
        self.client = APIClient()

    def test_create_duplicate_pattern_returns_409(self) -> None:
        """POST patterns/ con SMARTS duplicado y mismo tipo debe retornar 409."""
        payload = {
            "name": "TestDupPattern",
            "smarts": "[NH2]",
            "pattern_type": "toxicophore",
            "caption": "Pattern unitario de test duplicado",
            "source_reference": "test-dup",
            "provenance_metadata": {},
        }
        first_resp = self.client.post(
            f"{APP_API_BASE_PATH}patterns/", data=payload, format="json"
        )
        self.assertIn(first_resp.status_code, (201, 409))

        second_resp = self.client.post(
            f"{APP_API_BASE_PATH}patterns/", data=payload, format="json"
        )
        self.assertEqual(second_resp.status_code, 409)
        self.assertIn("detail", second_resp.json())


class PatternsGetEndpointTests(SmileitSeedTestCase):
    """Cubre la acción GET patterns/ que lista patrones activos (líneas 164-167)."""

    def setUp(self) -> None:
        self.client = APIClient()

    def test_patterns_get_returns_200_list(self) -> None:
        """GET patterns/ debe retornar 200 con una lista de patrones activos."""
        response = self.client.get(f"{APP_API_BASE_PATH}patterns/")
        self.assertEqual(response.status_code, 200)
        self.assertIsInstance(response.data, list)

    def test_patterns_entries_have_smarts_field(self) -> None:
        """Cada patrón debe incluir el campo smarts."""
        response = self.client.get(f"{APP_API_BASE_PATH}patterns/")
        self.assertEqual(response.status_code, 200)
        if len(response.data) > 0:
            self.assertIn("smarts", response.data[0])
