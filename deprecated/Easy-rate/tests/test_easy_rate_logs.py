import math
import sys
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path

# Ensure local modules resolve (equivalent to PYTHONPATH=Easy-rate)
ROOT = Path(__file__).resolve().parents[2]
EASY_RATE_DIR = ROOT / "Easy-rate"
if str(EASY_RATE_DIR) not in sys.path:
    sys.path.insert(0, str(EASY_RATE_DIR))

from main import Ejecucion
from read_log_gaussian.Estructura import Estructura
from read_log_gaussian.read_log_gaussian import read_log_gaussian


class EasyRateLogTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.logs = {
            "reactivo1": ROOT / "reactivo1.log",
            "reactivo2": ROOT / "reactivo2.log",
            "ts": ROOT / "transition state.log",
            "prod2": ROOT / "producto2.log",
        }

        def load_one(path: Path) -> Estructura:
            data = read_log_gaussian(str(path))
            if not data.Estructuras:
                raise RuntimeError(f"No estructuras en {path}")
            return data.Estructuras[0]

        react1 = load_one(cls.logs["reactivo1"])
        react2 = load_one(cls.logs["reactivo2"])
        ts = load_one(cls.logs["ts"])
        prod2 = load_one(cls.logs["prod2"])

        cls.run = Ejecucion(
            title="test",
            react_1=react1,
            react_2=react2,
            transition_rate=ts,
            product_1=Estructura(),  # product_1 placeholder
            product_2=prod2,
            cage_efects=False,
            diffusion=False,
            degen=1.0,
        )
        cls.run.run()

        # Snapshot of the same console output used in the web client
        buffer = StringIO()
        with redirect_stdout(buffer):
            print("Temp", cls.run.temp)
            print("dH_react", cls.run.dH_react)
            print("dHact", cls.run.dHact)
            print("Zreact", cls.run.Zreact)
            print("Zact", cls.run.Zact)
            print("Greact", cls.run.Greact)
            print("Gact", cls.run.Gact)
            print("Kappa", getattr(cls.run, "Kappa", None))
            print("rateCte", cls.run.rateCte)
            print("freq", cls.run.frequency_negative)
            print("CalcularTunel.U", cls.run.CalcularTunel.U)
            print("ALPH1", cls.run.CalcularTunel.ALPH1)
            print("ALPH2", cls.run.CalcularTunel.ALPH2)
        cls.console_output = buffer.getvalue().strip()

    def test_numeric_results_match_reference(self):
        self.assertTrue(math.isnan(self.run.temp))
        self.assertAlmostEqual(self.run.dH_react, 889867.5673346721, places=6)
        self.assertAlmostEqual(self.run.dHact, 17.479277122528263, places=6)
        self.assertAlmostEqual(self.run.Zreact, 889882.6846660364, places=6)
        self.assertAlmostEqual(self.run.Zact, 17.424683796023416, places=6)
        self.assertTrue(math.isnan(self.run.Greact))
        self.assertTrue(math.isnan(self.run.Gact))
        self.assertIsNone(getattr(self.run, "Kappa", None))
        self.assertTrue(math.isnan(self.run.rateCte))
        self.assertAlmostEqual(self.run.frequency_negative, -2518.151, places=3)
        self.assertTrue(math.isnan(self.run.CalcularTunel.U))
        self.assertTrue(math.isnan(self.run.CalcularTunel.ALPH1))
        self.assertTrue(math.isnan(self.run.CalcularTunel.ALPH2))

    def test_console_output_matches_web_snapshot(self):
        expected = (
            "Temp nan\n"
            "dH_react 889867.5673346721\n"
            "dHact 17.479277122528263\n"
            "Zreact 889882.6846660364\n"
            "Zact 17.424683796023416\n"
            "Greact nan\n"
            "Gact nan\n"
            "Kappa None\n"
            "rateCte nan\n"
            "freq -2518.151\n"
            "CalcularTunel.U nan\n"
            "ALPH1 nan\n"
            "ALPH2 nan"
        )
        self.assertEqual(self.console_output, expected)


if __name__ == "__main__":
    unittest.main()
