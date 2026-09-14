# Graph Sigmas

Renders each connected sigma schedule as a ComfyUI `IMAGE`.

- **input_count**: Adds matching `SIGMAS` inputs and `IMAGE` outputs.
- **black_theme**: Selects a dark or light plot background.
- **preview_resolution**: Selects a 450×300, 600×400, 900×600, or 1200×800 output. The default remains 600×400 for workflow compatibility, and plot styling scales proportionally with the output.

Connect each image output to an image preview or save node. Missing inputs produce a small blank image so the dynamic output positions remain stable.
