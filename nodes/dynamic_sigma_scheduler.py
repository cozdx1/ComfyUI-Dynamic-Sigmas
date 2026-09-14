import json
import math

import torch

from .sigma_math import (
    PROFILE_NAMES,
    SCHEDULER_NAMES,
    build_schedule,
    rescale_schedule,
)
from .utils import DynamicInputDict


def _parse_step_data(step_data, expected_length):
    """Return finite float values from serialized graph data, or None."""
    if not isinstance(step_data, str) or not step_data:
        return None

    try:
        parsed = json.loads(step_data)
        values = [float(value) for value in parsed]
    except (TypeError, ValueError, json.JSONDecodeError):
        return None

    if not isinstance(parsed, list) or len(values) != expected_length:
        return None
    if not all(math.isfinite(value) for value in values):
        return None
    return values


def _to_sigma_tensor(values):
    numeric = [float(value) for value in values]
    if not all(math.isfinite(value) for value in numeric):
        raise ValueError("Sigma schedule must contain only finite values")
    return torch.tensor(numeric, dtype=torch.float32)


class DynamicSigmaScheduler:
    SEARCH_ALIASES = [
        "cozdx1",
        "dynamic sigma",
        "sigma scheduler",
        "illustrious sigma",
    ]
    DESCRIPTION = (
        "Create, preview, and edit model-aware sigma schedules without a MODEL input. "
        "Profiles provide sampling defaults while every output remains editable."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model_profile": (
                    PROFILE_NAMES,
                    {
                        "default": "illustrious / sdxl",
                        "tooltip": "Sampling family and defaults used to build the schedule.",
                    },
                ),
                "scheduler": (
                    SCHEDULER_NAMES,
                    {
                        "default": "simple",
                        "tooltip": "Controls how denoising steps are distributed.",
                    },
                ),
                "steps": (
                    "INT",
                    {
                        "default": 20,
                        "min": 1,
                        "max": 100,
                        "tooltip": "Number of denoising intervals. The output contains steps + 1 values.",
                    },
                ),
                "shift": (
                    "FLOAT",
                    {
                        "default": 1.0,
                        "min": 0.01,
                        "max": 100.0,
                        "step": 0.01,
                        "tooltip": "Sampling shift for flow profiles. Ignored by SDXL and Custom.",
                    },
                ),
                "sigma_start": (
                    "FLOAT",
                    {
                        "default": 15.0,
                        "min": 0.0,
                        "max": 100.0,
                        "step": 0.01,
                        "tooltip": "Sigma value at the beginning of the schedule.",
                    },
                ),
                "sigma_end": (
                    "FLOAT",
                    {
                        "default": 0.0,
                        "min": 0.0,
                        "max": 100.0,
                        "step": 0.01,
                        "tooltip": "Sigma value at the end of the schedule.",
                    },
                ),
                "curve_factor": (
                    "FLOAT",
                    {
                        "default": 0.0,
                        "min": -100.0,
                        "max": 100.0,
                        "step": 0.01,
                        "tooltip": "Bends the generated curve toward the start or end.",
                    },
                ),
                "smooth_strength": (
                    "FLOAT",
                    {
                        "default": 0.0,
                        "min": 0.0,
                        "max": 1.0,
                        "step": 0.01,
                        "tooltip": "Blend manual points from linear (0) to monotone cubic (1).",
                    },
                ),
                "show_steps": (
                    "BOOLEAN",
                    {
                        "default": False,
                        "tooltip": "Show each sigma value as an editable number widget.",
                    },
                ),
                "black_theme": (
                    "BOOLEAN",
                    {
                        "default": True,
                        "tooltip": "Use the dark graph theme.",
                    },
                ),
            },
            # Step widgets are created by the frontend. Keeping this mapping empty
            # prevents duplicate widgets while allowing converted step inputs to run.
            "optional": DynamicInputDict(
                {},
                default_type=("FLOAT",),
                key_prefix="step_",
            ),
            "hidden": {
                "prompt": "PROMPT",
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ("SIGMAS",)
    RETURN_NAMES = ("sigmas",)
    OUTPUT_TOOLTIPS = ("The custom sigma schedule as a float32 tensor.",)
    FUNCTION = "get_sigmas"
    CATEGORY = "cozdx1/Sampling"

    def get_sigmas(
        self,
        model_profile="custom",
        scheduler="simple",
        steps=20,
        shift=1.0,
        sigma_start=1.0,
        sigma_end=0.0,
        curve_factor=0.0,
        smooth_strength=0.0,
        show_steps=False,
        black_theme=True,
        prompt=None,
        unique_id=None,
        **kwargs,
    ):
        kwargs.pop("curve_smooth", None)
        # Ignore prerelease workflows that still submit the removed guard input.
        kwargs.pop("sigma_guard", None)
        del smooth_strength, show_steps, black_theme

        steps = max(0, int(steps))
        node_data = prompt[unique_id] if prompt and unique_id in prompt else {}
        inputs = node_data.get("inputs", {})

        # Keep direct calls from older workflows safe even though the UI minimum is 1.
        if steps == 0:
            return (_to_sigma_tensor([sigma_start, sigma_end]),)

        is_step_external = any(f"step_{i}" in kwargs for i in range(steps + 1))
        is_shape_external = any(
            isinstance(inputs.get(key), list)
            for key in (
                "model_profile",
                "scheduler",
                "steps",
                "shift",
                "sigma_start",
                "sigma_end",
                "curve_factor",
                "smooth_strength",
                "curve_smooth",
            )
        )

        parsed_steps = _parse_step_data(inputs.get("step_data", ""), steps + 1)
        if parsed_steps is not None and not is_shape_external and not is_step_external:
            old_start = parsed_steps[0]
            old_end = parsed_steps[-1]
            if (
                abs(float(sigma_start) - old_start) > 1e-5
                or abs(float(sigma_end) - old_end) > 1e-5
            ):
                parsed_steps = rescale_schedule(
                    parsed_steps, float(sigma_start), float(sigma_end)
                )
            return (_to_sigma_tensor(parsed_steps),)

        sigmas = build_schedule(
            model_profile,
            scheduler,
            steps,
            shift,
            sigma_start,
            sigma_end,
            curve_factor,
        )
        for i in range(steps + 1):
            step_key = f"step_{i}"
            if step_key in kwargs:
                sigmas[i] = float(kwargs[step_key])
            else:
                val = inputs.get(step_key, None)
                if val is not None and not is_shape_external and not isinstance(val, list):
                    sigmas[i] = float(val)

        return (_to_sigma_tensor(sigmas),)
