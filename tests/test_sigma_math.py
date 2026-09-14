import importlib.util
import json
import math
import shutil
import subprocess
import unittest
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "cozdx1_sigma_math_test",
    PACKAGE_ROOT / "nodes" / "sigma_math.py",
)
SIGMA_MATH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SIGMA_MATH)


class ProfileScheduleTests(unittest.TestCase):
    def test_supported_profiles_and_schedulers_are_stable(self):
        self.assertEqual(
            SIGMA_MATH.PROFILE_NAMES,
            (
                "illustrious / sdxl",
                "anima",
                "wan",
                "ltxv",
                "z-image",
                "qwen-image",
                "flux2",
                "krea2",
                "custom",
            ),
        )
        self.assertIn("beta57", SIGMA_MATH.SCHEDULER_NAMES)
        self.assertIn("bong_tangent", SIGMA_MATH.SCHEDULER_NAMES)

    def test_representative_simple_profiles_match_expected_shapes(self):
        cases = {
            "illustrious / sdxl": (1.0, 15.0, [15.0, 4.189356, 1.655415, 0.711483, 0.0]),
            "anima": (3.0, 1.0, [1.0, 0.9, 0.75, 0.5, 0.0]),
            "wan": (8.0, 1.0, [1.0, 0.96, 0.888889, 0.727273, 0.0]),
            "flux2": (2.02, 1.0, [1.0, 0.957654, 0.882881, 0.715325, 0.0]),
        }
        for profile, (shift, start, expected) in cases.items():
            with self.subTest(profile=profile):
                actual = SIGMA_MATH.build_schedule(
                    profile, "simple", 4, shift, start, 0.0
                )
                for value, target in zip(actual, expected):
                    self.assertAlmostEqual(value, target, places=5)

    def test_every_scheduler_honors_length_endpoints_and_finiteness(self):
        cases = (
            ("illustrious / sdxl", 1.0, 15.0),
            ("wan", 8.0, 1.0),
            ("flux2", 2.02, 1.0),
            ("custom", 1.0, 1.0),
        )
        for profile, shift, start in cases:
            for scheduler in SIGMA_MATH.SCHEDULER_NAMES:
                for steps in (1, 4, 20):
                    with self.subTest(profile=profile, scheduler=scheduler, steps=steps):
                        values = SIGMA_MATH.build_schedule(
                            profile, scheduler, steps, shift, start, 0.0
                        )
                        self.assertEqual(len(values), steps + 1)
                        self.assertAlmostEqual(values[0], start)
                        self.assertAlmostEqual(values[-1], 0.0)
                        self.assertTrue(all(math.isfinite(value) for value in values))

    def test_shift_changes_flow_shape_but_not_sdxl_shape(self):
        wan_low = SIGMA_MATH.build_schedule("wan", "simple", 4, 1.0, 1.0, 0.0)
        wan_high = SIGMA_MATH.build_schedule("wan", "simple", 4, 8.0, 1.0, 0.0)
        self.assertNotEqual(wan_low[2], wan_high[2])

        sdxl_low = SIGMA_MATH.build_schedule(
            "illustrious / sdxl", "simple", 4, 1.0, 15.0, 0.0
        )
        sdxl_high = SIGMA_MATH.build_schedule(
            "illustrious / sdxl", "simple", 4, 50.0, 15.0, 0.0
        )
        self.assertEqual(sdxl_low, sdxl_high)

    def test_invalid_numeric_inputs_are_rejected(self):
        with self.assertRaises(ValueError):
            SIGMA_MATH.build_schedule("wan", "simple", 4, 0.0, 1.0, 0.0)
        with self.assertRaises(ValueError):
            SIGMA_MATH.build_schedule(
                "custom", "simple", 4, 1.0, float("nan"), 0.0
            )


class SmoothInterpolationTests(unittest.TestCase):
    POINTS = ((0.0, 1.0), (0.25, 0.82), (0.65, 0.2), (1.0, 0.0))

    def test_zero_strength_is_piecewise_linear(self):
        actual = SIGMA_MATH.interpolate_control_points(self.POINTS, 4, 0.0)
        self.assertEqual(actual, [1.0, 0.82, 0.4325, 0.14285714285714288, 0.0])

    def test_all_strengths_preserve_monotonic_control_points(self):
        for strength in (0.0, 0.25, 0.5, 0.75, 1.0):
            with self.subTest(strength=strength):
                values = SIGMA_MATH.interpolate_control_points(
                    self.POINTS, 40, strength
                )
                self.assertEqual(values[0], 1.0)
                self.assertEqual(values[-1], 0.0)
                self.assertTrue(
                    all(left >= right for left, right in zip(values, values[1:]))
                )

    def test_full_smoothing_differs_from_linear_without_overshoot(self):
        linear = SIGMA_MATH.interpolate_control_points(self.POINTS, 40, 0.0)
        smooth = SIGMA_MATH.interpolate_control_points(self.POINTS, 40, 1.0)
        self.assertNotEqual(linear, smooth)
        self.assertGreaterEqual(min(smooth), 0.0)
        self.assertLessEqual(max(smooth), 1.0)


class CrossRuntimeTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "Node.js is not available")
    def test_javascript_preview_matches_python_backend(self):
        cases = [
            {
                "profile": "illustrious / sdxl",
                "scheduler": "simple",
                "steps": 4,
                "shift": 1.0,
                "sigmaStart": 15.0,
                "sigmaEnd": 0.0,
                "curveFactor": 0.0,
            },
            {
                "profile": "wan",
                "scheduler": "beta57",
                "steps": 20,
                "shift": 8.0,
                "sigmaStart": 1.0,
                "sigmaEnd": 0.0,
                "curveFactor": 0.35,
            },
            {
                "profile": "flux2",
                "scheduler": "bong_tangent",
                "steps": 30,
                "shift": 2.02,
                "sigmaStart": 1.0,
                "sigmaEnd": 0.0,
                "curveFactor": -0.2,
            },
            {
                "profile": "custom",
                "scheduler": "karras",
                "steps": 7,
                "shift": 1.0,
                "sigmaStart": 3.0,
                "sigmaEnd": 0.1,
                "curveFactor": 0.0,
            },
        ]
        for profile, definition in SIGMA_MATH.PROFILE_DEFINITIONS.items():
            for scheduler in SIGMA_MATH.SCHEDULER_NAMES:
                cases.append(
                    {
                        "profile": profile,
                        "scheduler": scheduler,
                        "steps": 7,
                        "shift": definition["default_shift"] or 1.0,
                        "sigmaStart": definition["default_sigma_start"],
                        "sigmaEnd": definition["default_sigma_end"],
                        "curveFactor": 0.15,
                    }
                )
        module_uri = (PACKAGE_ROOT / "web" / "js" / "sigma_math.js").as_uri()
        script = (
            "import { buildSchedule, interpolateControlPoints } "
            f"from {json.dumps(module_uri)};"
            f"const cases = {json.dumps(cases)};"
            "const schedules = cases.map(buildSchedule);"
            "const smooth = interpolateControlPoints("
            "[{x:0,y:1},{x:.25,y:.82},{x:.65,y:.2},{x:1,y:0}],40,.63);"
            "console.log(JSON.stringify({schedules,smooth}));"
        )
        completed = subprocess.run(
            [shutil.which("node"), "--input-type=module", "-e", script],
            check=True,
            capture_output=True,
            text=True,
            cwd=PACKAGE_ROOT,
        )
        javascript = json.loads(completed.stdout)

        for case, js_values in zip(cases, javascript["schedules"]):
            python_values = SIGMA_MATH.build_schedule(
                case["profile"],
                case["scheduler"],
                case["steps"],
                case["shift"],
                case["sigmaStart"],
                case["sigmaEnd"],
                case["curveFactor"],
            )
            with self.subTest(case=case):
                self.assertEqual(len(python_values), len(js_values))
                for python_value, js_value in zip(python_values, js_values):
                    self.assertAlmostEqual(python_value, js_value, places=10)

        python_smooth = SIGMA_MATH.interpolate_control_points(
            ((0.0, 1.0), (0.25, 0.82), (0.65, 0.2), (1.0, 0.0)),
            40,
            0.63,
        )
        for python_value, js_value in zip(python_smooth, javascript["smooth"]):
            self.assertAlmostEqual(python_value, js_value, places=12)


if __name__ == "__main__":
    unittest.main()
