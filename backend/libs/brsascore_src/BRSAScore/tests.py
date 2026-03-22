"""tests.py: Pruebas unitarias para BR-SAScore y descriptores de complejidad."""

import unittest

from BRSAScore.BRSAScore import SAScorer


class SAScorerDescriptorTests(unittest.TestCase):
    """Valida el contrato del metodo extendido de descriptores."""

    def setUp(self) -> None:
        self.scorer = SAScorer()

    def test_calculate_score_keeps_backward_contract(self) -> None:
        score, contribution = self.scorer.calculateScore("CCO")

        self.assertIsInstance(score, float)
        self.assertGreaterEqual(score, 1.0)
        self.assertLessEqual(score, 10.0)
        self.assertIsInstance(contribution, dict)

    def test_calculate_score_with_descriptors_returns_expected_keys(self) -> None:
        score, contribution, descriptors = self.scorer.calculateScoreWithDescriptors(
            "C[C@H](O)Cl"
        )

        self.assertIsInstance(score, float)
        self.assertIsInstance(contribution, dict)
        self.assertSetEqual(
            set(descriptors.keys()),
            {
                "molecular_complexity",
                "stereochemical_complexity",
                "cyclomatic_number",
                "ring_complexity",
            },
        )

        self.assertIn("value", descriptors["molecular_complexity"])
        self.assertIn("score", descriptors["molecular_complexity"])

        self.assertEqual(descriptors["stereochemical_complexity"]["value"], 1)
        self.assertIsInstance(descriptors["stereochemical_complexity"]["score"], float)

        self.assertIsInstance(descriptors["cyclomatic_number"]["value"], int)
        self.assertIsNone(descriptors["cyclomatic_number"]["score"])

        self.assertIsInstance(descriptors["ring_complexity"]["value"], int)
        self.assertIsNone(descriptors["ring_complexity"]["score"])

    def test_invalid_smiles_raises_value_error(self) -> None:
        with self.assertRaises(ValueError):
            self.scorer.calculateScore("not-a-smiles")

        with self.assertRaises(ValueError):
            self.scorer.calculateScoreWithDescriptors("not-a-smiles")


if __name__ == "__main__":
    unittest.main()
