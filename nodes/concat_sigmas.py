import torch

from .utils import DynamicInputDict


class ConcatSigmas:
    SEARCH_ALIASES = ["cozdx1", "concat sigma", "combine sigma"]
    DESCRIPTION = (
        "Join multiple sigma schedules in order. The final value of each "
        "non-final schedule is removed to avoid duplicated boundaries."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "input_count": (
                    "INT",
                    {
                        "default": 2,
                        "min": 2,
                        "max": 100,
                        "tooltip": "Number of sigma schedule inputs to display.",
                    },
                ),
            },
            "optional": DynamicInputDict(
                {"sigma_1": ("SIGMAS", {"tooltip": "First sigma schedule."})},
                key_prefix="sigma_",
            ),
        }

    RETURN_TYPES = ("SIGMAS",)
    RETURN_NAMES = ("sigmas",)
    OUTPUT_TOOLTIPS = ("The schedules concatenated in input order.",)
    FUNCTION = "concat"
    CATEGORY = "cozdx1/Sampling"

    def concat(self, input_count, **kwargs):
        sigmas_list = []
        for i in range(1, input_count + 1):
            key = f"sigma_{i}"
            if key in kwargs and len(kwargs[key]) > 0:
                sigmas_list.append(kwargs[key])

        if not sigmas_list:
            return (torch.tensor([], dtype=torch.float32),)

        res_list = []
        for i, sig in enumerate(sigmas_list):
            if i < len(sigmas_list) - 1:
                res_list.append(sig[:-1])
            else:
                res_list.append(sig)

        res = torch.cat(res_list, dim=0)
        return (res,)
