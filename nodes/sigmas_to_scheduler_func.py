import torch
import torch.nn.functional as F


def _resample_sigmas(sigmas, steps):
    """Return a detached sigma schedule with exactly ``steps + 1`` values."""
    requested_steps = int(steps)
    if requested_steps < 1:
        raise ValueError("[cozdx1] Scheduler steps must be at least 1.")

    target_count = requested_steps + 1
    if sigmas.numel() == target_count:
        return sigmas.clone()

    original_dtype = sigmas.dtype
    interpolation_dtype = (
        original_dtype
        if original_dtype in (torch.float32, torch.float64)
        else torch.float32
    )
    values = sigmas.to(dtype=interpolation_dtype).reshape(1, 1, -1)
    resized = F.interpolate(
        values,
        size=target_count,
        mode="linear",
        align_corners=True,
    ).reshape(-1)

    resized = resized.to(dtype=original_dtype)
    resized[0] = sigmas[0]
    resized[-1] = sigmas[-1]
    return resized


class SigmasToSchedulerFunc:
    SEARCH_ALIASES = [
        "cozdx1",
        "sigma scheduler func",
        "sigmas to scheduler",
        "impact detailer scheduler",
    ]
    DESCRIPTION = (
        "Convert a SIGMAS schedule into a SCHEDULER_FUNC for nodes such as "
        "Impact Pack Detailers. The schedule is automatically resampled to "
        "the step count requested by the receiving node."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "sigmas": (
                    "SIGMAS",
                    {
                        "tooltip": (
                            "Sigma schedule to expose as a scheduler function. "
                            "Its shape and endpoints are preserved when the "
                            "receiving node requests a different step count."
                        ),
                    },
                ),
            },
        }

    RETURN_TYPES = ("SCHEDULER_FUNC",)
    RETURN_NAMES = ("scheduler_func",)
    OUTPUT_TOOLTIPS = (
        "Connect to scheduler_func_opt. In Impact Pack, this overrides the "
        "receiving node's scheduler widget.",
    )
    FUNCTION = "convert"
    CATEGORY = "cozdx1/Sampling"

    def convert(self, sigmas):
        if not isinstance(sigmas, torch.Tensor):
            raise TypeError("[cozdx1] SIGMAS input must be a torch.Tensor.")
        if sigmas.ndim != 1:
            raise ValueError("[cozdx1] SIGMAS input must be one-dimensional.")
        if sigmas.numel() < 2:
            raise ValueError("[cozdx1] SIGMAS input must contain at least 2 values.")
        if not bool(torch.isfinite(sigmas).all()):
            raise ValueError("[cozdx1] SIGMAS input must contain only finite values.")
        if not (sigmas.is_floating_point() or sigmas.is_complex()):
            raise TypeError("[cozdx1] SIGMAS input must use a floating-point dtype.")
        if sigmas.is_complex():
            raise TypeError("[cozdx1] SIGMAS input cannot use a complex dtype.")

        source = sigmas.detach().clone()

        def scheduler_func(model, sampler_name, steps):
            del model, sampler_name
            return _resample_sigmas(source, steps)

        return (scheduler_func,)
