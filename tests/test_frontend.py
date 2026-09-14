import shutil
import subprocess
import unittest
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[1]


class FrontendSmokeTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "Node.js is not available")
    def test_dynamic_scheduler_frontend_state_flow(self):
        completed = subprocess.run(
            [shutil.which("node"), PACKAGE_ROOT / "tests" / "dynamic_sigma_ui_smoke.mjs"],
            check=False,
            capture_output=True,
            text=True,
            cwd=PACKAGE_ROOT,
        )
        self.assertEqual(
            completed.returncode,
            0,
            msg=f"stdout:\n{completed.stdout}\nstderr:\n{completed.stderr}",
        )


if __name__ == "__main__":
    unittest.main()
