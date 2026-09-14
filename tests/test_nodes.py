import importlib.util
import json
import sys
import unittest
from pathlib import Path

import torch


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
PACKAGE_NAME = "dynamic_sigmas_test_package"
SPEC = importlib.util.spec_from_file_location(
    PACKAGE_NAME,
    PACKAGE_ROOT / "__init__.py",
    submodule_search_locations=[str(PACKAGE_ROOT)],
)
PACKAGE = importlib.util.module_from_spec(SPEC)
sys.modules[PACKAGE_NAME] = PACKAGE
SPEC.loader.exec_module(PACKAGE)

DynamicSigmaScheduler = PACKAGE.DynamicSigmaScheduler
ConcatSigmas = PACKAGE.ConcatSigmas
GraphSigmas = PACKAGE.GraphSigmas
SigmasToSchedulerFunc = PACKAGE.SigmasToSchedulerFunc
DynamicInputDict = sys.modules[f"{PACKAGE_NAME}.nodes.utils"].DynamicInputDict


class DynamicSigmaSchedulerTests(unittest.TestCase):
    def make_schedule(self, **overrides):
        arguments = {
            "steps": 4,
            "sigma_start": 1.0,
            "sigma_end": 0.0,
            "curve_factor": 0.0,
            "curve_smooth": False,
            "show_steps": False,
            "black_theme": True,
        }
        arguments.update(overrides)
        return DynamicSigmaScheduler().get_sigmas(**arguments)[0]

    def test_new_node_defaults_to_twenty_steps(self):
        schema = DynamicSigmaScheduler.INPUT_TYPES()
        self.assertEqual(schema["required"]["steps"][1]["default"], 20)
        self.assertEqual(len(DynamicSigmaScheduler().get_sigmas()[0]), 21)

    def test_linear_fallback_includes_both_endpoints(self):
        actual = self.make_schedule()
        expected = torch.tensor([1.0, 0.75, 0.5, 0.25, 0.0])
        torch.testing.assert_close(actual, expected)

    def test_serialized_graph_data_is_restored(self):
        prompt = {
            "node-1": {
                "inputs": {
                    "step_data": json.dumps([1.0, 0.8, 0.3, 0.0]),
                }
            }
        }
        actual = self.make_schedule(
            steps=3,
            prompt=prompt,
            unique_id="node-1",
        )
        expected = torch.tensor([1.0, 0.8, 0.3, 0.0])
        torch.testing.assert_close(actual, expected)

    def test_serialized_graph_data_rescales_with_new_endpoints(self):
        prompt = {
            "node-1": {
                "inputs": {
                    "step_data": json.dumps([1.0, 0.6, 0.0]),
                }
            }
        }
        actual = self.make_schedule(
            steps=2,
            sigma_start=2.0,
            sigma_end=0.0,
            prompt=prompt,
            unique_id="node-1",
        )
        expected = torch.tensor([2.0, 1.2, 0.0])
        torch.testing.assert_close(actual, expected)

    def test_invalid_or_non_finite_graph_data_uses_fallback(self):
        for step_data in ("not-json", "[1, 0]", "[1, NaN, 0]"):
            with self.subTest(step_data=step_data):
                prompt = {"node-1": {"inputs": {"step_data": step_data}}}
                actual = self.make_schedule(
                    steps=2,
                    prompt=prompt,
                    unique_id="node-1",
                )
                expected = torch.tensor([1.0, 0.5, 0.0])
                torch.testing.assert_close(actual, expected)

    def test_dynamic_step_input_overrides_serialized_graph_data(self):
        prompt = {
            "node-1": {
                "inputs": {
                    "step_data": json.dumps([1.0, 0.7, 0.3, 0.0]),
                }
            }
        }
        actual = self.make_schedule(
            steps=3,
            prompt=prompt,
            unique_id="node-1",
            step_1=0.9,
            step_2=0.2,
        )
        expected = torch.tensor([1.0, 0.9, 0.2, 0.0])
        torch.testing.assert_close(actual, expected)

    def test_profile_scheduler_reaches_backend_output(self):
        actual = self.make_schedule(
            model_profile="wan",
            scheduler="simple",
            shift=8.0,
        )
        expected = torch.tensor([1.0, 0.96, 0.8888889, 0.72727275, 0.0])
        torch.testing.assert_close(actual, expected)

    def test_removed_legacy_guard_argument_does_not_change_manual_values(self):
        prompt = {
            "node-1": {
                "inputs": {
                    "step_data": json.dumps([1.0, 1.0, 0.8, 0.9, 0.0]),
                }
            }
        }
        actual = self.make_schedule(
            sigma_guard="enforce",
            prompt=prompt,
            unique_id="node-1",
        )
        expected = torch.tensor([1.0, 1.0, 0.8, 0.9, 0.0])
        torch.testing.assert_close(actual, expected)

    def test_non_finite_dynamic_step_is_rejected(self):
        with self.assertRaises(ValueError):
            self.make_schedule(step_1=float("nan"))


class ConcatSigmasTests(unittest.TestCase):
    def test_shared_boundaries_are_not_duplicated(self):
        actual = ConcatSigmas().concat(
            2,
            sigma_1=torch.tensor([1.0, 0.5]),
            sigma_2=torch.tensor([0.5, 0.0]),
        )[0]
        expected = torch.tensor([1.0, 0.5, 0.0])
        torch.testing.assert_close(actual, expected)

    def test_empty_final_schedule_does_not_drop_previous_endpoint(self):
        actual = ConcatSigmas().concat(
            2,
            sigma_1=torch.tensor([1.0, 0.0]),
            sigma_2=torch.tensor([]),
        )[0]
        expected = torch.tensor([1.0, 0.0])
        torch.testing.assert_close(actual, expected)

    def test_unconnected_slots_are_ignored(self):
        actual = ConcatSigmas().concat(
            3,
            sigma_1=torch.tensor([1.0, 0.5]),
            sigma_3=torch.tensor([0.5, 0.0]),
        )[0]
        expected = torch.tensor([1.0, 0.5, 0.0])
        torch.testing.assert_close(actual, expected)


class GraphSigmasTests(unittest.TestCase):
    def test_tensor_requiring_grad_is_rendered(self):
        sigma = torch.tensor([1.0, 0.5, 0.0], requires_grad=True)
        image = GraphSigmas().plot_graph(1, True, sigma_1=sigma)[0]

        self.assertEqual(image.dtype, torch.float32)
        self.assertEqual(tuple(image.shape), (1, 400, 600, 3))
        self.assertGreaterEqual(float(image.min()), 0.0)
        self.assertLessEqual(float(image.max()), 1.0)

    def test_resolution_presets_render_exact_pixel_sizes(self):
        sigma = torch.tensor([1.0, 0.5, 0.0])
        expected = {
            "Compact (450×300)": (300, 450),
            "Default (600×400)": (400, 600),
            "Large (900×600)": (600, 900),
            "High (1200×800)": (800, 1200),
        }

        for preset, (height, width) in expected.items():
            with self.subTest(preset=preset):
                image = GraphSigmas().plot_graph(
                    1,
                    True,
                    preview_resolution=preset,
                    sigma_1=sigma,
                )[0]
                self.assertEqual(tuple(image.shape), (1, height, width, 3))

    def test_unknown_resolution_falls_back_to_existing_default(self):
        sigma = torch.tensor([1.0, 0.0])
        image = GraphSigmas().plot_graph(
            1,
            True,
            preview_resolution="unknown",
            sigma_1=sigma,
        )[0]
        self.assertEqual(tuple(image.shape), (1, 400, 600, 3))

    def test_missing_input_returns_stable_blank_output(self):
        images = GraphSigmas().plot_graph(2, False)

        self.assertEqual(len(images), 2)
        self.assertEqual(tuple(images[0].shape), (1, 64, 64, 3))
        self.assertEqual(tuple(images[1].shape), (1, 64, 64, 3))

    @unittest.skipUnless(torch.cuda.is_available(), "CUDA is not available")
    def test_cuda_tensor_is_rendered_on_cpu(self):
        sigma = torch.tensor([1.0, 0.5, 0.0], device="cuda")
        image = GraphSigmas().plot_graph(1, True, sigma_1=sigma)[0]
        self.assertEqual(image.device.type, "cpu")


class SigmasToSchedulerFuncTests(unittest.TestCase):
    def make_func(self, sigmas):
        return SigmasToSchedulerFunc().convert(sigmas)[0]

    def test_matching_step_count_returns_an_independent_exact_copy(self):
        source = torch.tensor([1.0, 0.7, 0.2, 0.0])
        scheduler_func = self.make_func(source)

        actual = scheduler_func(object(), "euler", 3)
        torch.testing.assert_close(actual, source)

        actual[-1] = 9.0
        repeated = scheduler_func(object(), "euler", 3)
        torch.testing.assert_close(repeated, source)

    def test_step_mismatch_resamples_curve_and_preserves_endpoints(self):
        source = torch.tensor([1.0, 0.5, 0.0])
        scheduler_func = self.make_func(source)

        actual = scheduler_func(object(), "euler", 4)
        expected = torch.tensor([1.0, 0.75, 0.5, 0.25, 0.0])
        torch.testing.assert_close(actual, expected)

    def test_impact_denoise_style_effective_steps_are_supported(self):
        source = torch.tensor([1.0, 0.5, 0.0])
        scheduler_func = self.make_func(source)

        # Impact Pack requests floor(detailer_steps / denoise) steps.
        actual = scheduler_func(object(), "euler", 8)
        self.assertEqual(len(actual), 9)
        self.assertEqual(float(actual[0]), 1.0)
        self.assertEqual(float(actual[-1]), 0.0)

    def test_invalid_inputs_fail_with_clear_errors(self):
        invalid_inputs = (
            torch.tensor([]),
            torch.tensor([1.0]),
            torch.tensor([[1.0, 0.0]]),
            torch.tensor([1.0, float("nan"), 0.0]),
        )

        for sigmas in invalid_inputs:
            with self.subTest(shape=tuple(sigmas.shape)):
                with self.assertRaises((TypeError, ValueError)):
                    self.make_func(sigmas)

    def test_requested_steps_must_be_positive(self):
        scheduler_func = self.make_func(torch.tensor([1.0, 0.0]))

        with self.assertRaises(ValueError):
            scheduler_func(object(), "euler", 0)


class DynamicTypesTests(unittest.TestCase):
    def test_dynamic_inputs_only_accept_numbered_prefix_keys(self):
        inputs = DynamicInputDict({"sigma_1": ("SIGMAS",)}, key_prefix="sigma_")

        self.assertIn("sigma_1", inputs)
        self.assertIn("sigma_27", inputs)
        self.assertNotIn("sigma_bad", inputs)
        self.assertNotIn("unrelated", inputs)
        with self.assertRaises(KeyError):
            _ = inputs["unrelated"]

    def test_scheduler_accepts_dynamic_numbered_step_inputs(self):
        optional = DynamicSigmaScheduler.INPUT_TYPES()["optional"]

        self.assertIn("step_1", optional)
        self.assertIn("step_99", optional)
        self.assertNotIn("step_data", optional)
        self.assertEqual(optional["step_27"], ("FLOAT",))

    def test_scheduler_exposes_v110_controls(self):
        required = DynamicSigmaScheduler.INPUT_TYPES()["required"]

        self.assertEqual(required["model_profile"][1]["default"], "illustrious / sdxl")
        self.assertIn("beta57", required["scheduler"][0])
        self.assertIn("bong_tangent", required["scheduler"][0])
        self.assertEqual(required["smooth_strength"][1]["min"], 0.0)
        self.assertEqual(required["smooth_strength"][1]["max"], 1.0)
        self.assertNotIn("sigma_guard", required)


class PackageMetadataTests(unittest.TestCase):
    def test_version(self):
        self.assertEqual(PACKAGE.__version__, "1.1.0")

    def test_all_nodes_share_cozdx1_discovery_metadata(self):
        for node_id, node_class in PACKAGE.NODE_CLASS_MAPPINGS.items():
            with self.subTest(node_id=node_id):
                self.assertEqual(node_class.CATEGORY, "cozdx1/Sampling")
                self.assertIn("cozdx1", node_class.SEARCH_ALIASES)
                self.assertTrue(
                    PACKAGE.NODE_DISPLAY_NAME_MAPPINGS[node_id].startswith("[cozdx1]")
                )


if __name__ == "__main__":
    unittest.main()
