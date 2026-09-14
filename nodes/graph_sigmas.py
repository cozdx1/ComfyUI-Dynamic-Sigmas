import io

import numpy as np
import torch
from matplotlib.figure import Figure
from matplotlib.backends.backend_agg import FigureCanvasAgg as FigureCanvas
from PIL import Image

from .utils import DynamicInputDict, DynamicReturnType, DynamicReturnNames


GRAPH_RESOLUTION_PRESETS = {
    "Compact (450×300)": (450, 300),
    "Default (600×400)": (600, 400),
    "Large (900×600)": (900, 600),
    "High (1200×800)": (1200, 800),
}
DEFAULT_GRAPH_RESOLUTION = "Default (600×400)"


class GraphSigmas:
    SEARCH_ALIASES = ["cozdx1", "graph sigma", "plot sigma"]
    DESCRIPTION = (
        "Render one graph image for each connected sigma schedule. "
        "Increase input_count to compare multiple schedules."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "input_count": (
                    "INT",
                    {
                        "default": 1,
                        "min": 1,
                        "max": 100,
                        "tooltip": "Number of sigma inputs and graph image outputs to display.",
                    },
                ),
                "black_theme": (
                    "BOOLEAN",
                    {
                        "default": True,
                        "tooltip": "Use a dark background for rendered graphs.",
                    },
                ),
                "preview_resolution": (
                    tuple(GRAPH_RESOLUTION_PRESETS),
                    {
                        "default": DEFAULT_GRAPH_RESOLUTION,
                        "tooltip": "Pixel resolution of each rendered graph image.",
                    },
                ),
            },
            "optional": DynamicInputDict(
                {"sigma_1": ("SIGMAS", {"tooltip": "First sigma schedule to plot."})},
                key_prefix="sigma_",
            ),
        }

    RETURN_TYPES = DynamicReturnType(("IMAGE",), default_type="IMAGE", max_len=100)
    RETURN_NAMES = DynamicReturnNames(("IMAGE_1",), prefix="IMAGE_", max_len=100)
    OUTPUT_TOOLTIPS = DynamicReturnType(
        ("Rendered graph for sigma_1.",),
        default_type="Rendered graph for the corresponding sigma input.",
        max_len=100,
    )
    FUNCTION = "plot_graph"
    CATEGORY = "cozdx1/Sampling"

    def plot_graph(
        self,
        input_count,
        black_theme,
        preview_resolution=DEFAULT_GRAPH_RESOLUTION,
        **kwargs,
    ):
        width, height = GRAPH_RESOLUTION_PRESETS.get(
            preview_resolution,
            GRAPH_RESOLUTION_PRESETS[DEFAULT_GRAPH_RESOLUTION],
        )
        images = []
        for i in range(1, input_count + 1):
            key = f"sigma_{i}"
            if key in kwargs:
                sig = (
                    torch.as_tensor(kwargs[key])
                    .detach()
                    .to(device="cpu", dtype=torch.float32)
                    .flatten()
                    .numpy()
                )
                x = np.arange(len(sig))

                if black_theme:
                    bg_color = "#1e1e1e"
                    text_color = "#d4d4d4"
                    line_color = "#00d2d3"
                    fill_color = "#00d2d3"
                    grid_color = "#ffffff"
                else:
                    bg_color = "#ffffff"
                    text_color = "#333333"
                    line_color = "#2e86de"
                    fill_color = "#2e86de"
                    grid_color = "#000000"

                # Keep the physical 3:2 canvas fixed and scale DPI instead of
                # figsize. Matplotlib then scales fonts, strokes, markers, and
                # padding together, so every preset has the same visual weight
                # when ComfyUI fits it into a preview.
                fig = Figure(figsize=(6, 4), dpi=width / 6)
                canvas = FigureCanvas(fig)
                fig.patch.set_facecolor(bg_color)

                ax = fig.add_subplot(111)
                ax.set_facecolor(bg_color)

                for spine in ax.spines.values():
                    spine.set_color(text_color)
                    spine.set_alpha(0.3)

                ax.tick_params(colors=text_color)
                ax.xaxis.label.set_color(text_color)
                ax.yaxis.label.set_color(text_color)

                ax.plot(
                    x,
                    sig,
                    marker="o",
                    markersize=5,
                    color=line_color,
                    linewidth=2,
                    zorder=3,
                )
                ax.fill_between(x, sig, 0, color=fill_color, alpha=0.15, zorder=2)

                ax.set_xlabel("Step")
                ax.set_ylabel("Sigma")
                ax.grid(
                    True,
                    color=grid_color,
                    linestyle="--",
                    alpha=0.15,
                    zorder=1,
                )

                fig.tight_layout()

                buf = io.BytesIO()
                try:
                    canvas.print_png(buf)
                    buf.seek(0)
                    with Image.open(buf) as image:
                        rgb = np.asarray(image.convert("RGB"), dtype=np.float32) / 255.0
                    images.append(torch.from_numpy(rgb).unsqueeze(0))
                finally:
                    buf.close()
                    fig.clear()
            else:
                blank = torch.zeros((1, 64, 64, 3), dtype=torch.float32)
                images.append(blank)

        return tuple(images)
