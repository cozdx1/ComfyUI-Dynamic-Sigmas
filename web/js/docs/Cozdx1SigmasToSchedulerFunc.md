# Sigmas to Scheduler Func

Converts a completed `SIGMAS` schedule into a callable `SCHEDULER_FUNC`.

Connect the output to `scheduler_func_opt` on a compatible node. This includes Impact Pack FaceDetailer, FaceDetailer (pipe), MaskDetailer (pipe), DetailerForEach variants, and other nodes that expose the same input type.

The receiving node decides the effective step count. When that count differs from the input schedule, the bridge linearly resamples the curve to `steps + 1` values while preserving the first and final values. It does not apply additional smoothing.

When connected to Impact Pack, the Detailer's visible `scheduler` widget remains available in the interface but its value is ignored during sampling.
