# Dynamic Sigma Scheduler

Creates a model-aware, editable `SIGMAS` schedule without a `MODEL` input. The graph updates immediately and the output has `steps + 1` values because both endpoints are included.

## Controls

- **model_profile**: Selects the sampling family and its defaults. Custom preserves manual behavior.
- **scheduler**: Controls where the denoising steps are placed. Includes `beta57` and `bong_tangent`.
- **steps**: Number of denoising intervals.
- **shift**: Uses the selected Discrete Flow or Flux formula. It is disabled for SDXL and Custom.
- **sigma_start / sigma_end**: Schedule endpoints.
- **curve_factor**: Positive values stay high longer; negative values fall earlier.
- **smooth_strength**: Blends custom-point interpolation from linear (`0`) to monotone cubic (`1`).
- **show_steps**: Shows editable per-step values, which can also be converted to inputs.
- **black_theme**: Changes the editor theme only.

Click and drag in the graph to create or move a control point. Shift-click a point to remove it. The graph endpoints and the first/final step widgets stay synchronized with `sigma_start` and `sigma_end`. **Generate Curve** discards manual edits and regenerates the selected schedule. **Reset Profile** also restores the profile defaults.

The output tensor is `float32`. Profiles are convenient starting points rather than model auto-detection, so verify suitable values for the model, sampler, and receiving node.
