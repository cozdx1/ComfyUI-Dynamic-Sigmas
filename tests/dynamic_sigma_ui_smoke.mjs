import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "cozdx1-ui-test-"));

try {
    fs.mkdirSync(path.join(temporary, "web", "js"), { recursive: true });
    fs.mkdirSync(path.join(temporary, "scripts"), { recursive: true });
    fs.copyFileSync(
        path.join(repository, "web", "js", "dynamic_sigma_scheduler.js"),
        path.join(temporary, "web", "js", "dynamic_sigma_scheduler.js"),
    );
    fs.copyFileSync(
        path.join(repository, "web", "js", "sigma_math.js"),
        path.join(temporary, "web", "js", "sigma_math.js"),
    );
    fs.writeFileSync(path.join(temporary, "package.json"), JSON.stringify({ type: "module" }));
    fs.writeFileSync(
        path.join(temporary, "scripts", "app.js"),
        "export const app = { registerExtension(value) { globalThis.__cozdx1Extension = value; } };\n",
    );

    globalThis.LiteGraph = { NODE_WIDGET_HEIGHT: 20 };
    globalThis.requestAnimationFrame = (callback) => callback();

    await import(pathToFileURL(path.join(temporary, "web", "js", "dynamic_sigma_scheduler.js")));
    const extension = globalThis.__cozdx1Extension;
    assert.ok(extension, "frontend extension should register");

    class MockNode {
        constructor() {
            this.size = [320, 300];
            this.properties = {};
            this.widgets = [];
            const definitions = [
                ["combo", "model_profile", "illustrious / sdxl"],
                ["combo", "scheduler", "simple"],
                ["number", "steps", 20],
                ["number", "shift", 1.0],
                ["number", "sigma_start", 15.0],
                ["number", "sigma_end", 0.0],
                ["number", "curve_factor", 0.0],
                ["number", "smooth_strength", 0.0],
                ["toggle", "show_steps", false],
                ["toggle", "black_theme", true],
            ];
            definitions.forEach(([type, name, value]) => this.addWidget(type, name, value, null, {}));
        }

        addWidget(type, name, value, callback, options = {}) {
            const widget = { type, name, value, callback, options };
            this.widgets.push(widget);
            return widget;
        }

        computeSize(out) {
            const result = [260, this.widgets.length * 24 + 40];
            if (out) {
                out[0] = result[0];
                out[1] = result[1];
                return out;
            }
            return result;
        }

        onConfigure(info) {
            info.widgets_values?.forEach((value, index) => {
                if (this.widgets[index]) this.widgets[index].value = value;
            });
            this.properties = { ...(info.properties || {}) };
        }

        onSerialize() {}
        setDirtyCanvas() {}
        captureInput() {}
    }

    await extension.beforeRegisterNodeDef(MockNode, { name: "DynamicSigmaScheduler" });

    const widget = (node, name) => node.widgets.find((value) => value.name === name);
    const change = (node, name, value) => {
        const target = widget(node, name);
        target.value = value;
        target.callback?.(value);
    };

    const node = new MockNode();
    node.onNodeCreated();
    assert.equal(node.size[0], 300);
    assert.equal(node.size[1], node.minimumHeight());
    const initialSize = [...node.size];
    const initialGraph = node.graphInfo();
    assert.equal(initialGraph.y + initialGraph.graphHeight + 10, node.size[1]);
    assert.equal(node.getStepData().length, 21);
    assert.equal(node.getStepData()[0], 15.0);
    assert.equal(widget(node, "shift").disabled, true);
    assert.equal(widget(node, "step_data").hidden, true);

    const recreated = new MockNode();
    recreated.onNodeCreated();
    assert.deepEqual(recreated.size, initialSize, "new and recreated nodes need the same size");

    change(node, "steps", 4);
    change(node, "model_profile", "wan");
    assert.equal(widget(node, "shift").value, 8.0);
    assert.equal(widget(node, "sigma_start").value, 1.0);
    assert.ok(Math.abs(node.getStepData()[1] - 0.96) < 1e-6);

    change(node, "show_steps", true);
    assert.equal(node.widgets.filter((value) => /^step_\d+$/.test(value.name)).length, 5);
    widget(node, "step_0").callback(2.0);
    assert.equal(widget(node, "sigma_start").value, 2.0);
    assert.equal(node.getStepData()[0], 2.0);

    widget(node, "step_1").callback(2.0);
    assert.equal(node.getStepData()[1], 2.0, "manual values must pass through unchanged");

    const drawnText = [];
    const context = new Proxy({}, {
        get(_target, property) {
            if (property === "fillText") {
                return (text, x, y, maxWidth) => drawnText.push({ text, x, y, maxWidth });
            }
            return () => {};
        },
        set() {
            return true;
        },
    });
    node.onDrawForeground(context);
    const manualLabel = drawnText.find((entry) => entry.text === "manual edit");
    assert.ok(manualLabel, "manual edit status should be drawn");
    assert.equal(drawnText.some((entry) => entry.text.startsWith("Guard")), false);

    const serialized = {};
    node.onSerialize(serialized);
    assert.equal(serialized.properties.cozdx1_dynamic_sigma_schema, 3);
    assert.equal(serialized.raw_step_data_cache.length, 5);
    assert.equal(serialized.step_data_cache.length, 5);

    const legacy = new MockNode();
    legacy.onNodeCreated();
    const oldCurve = [2.0, 1.4, 0.9, 0.3, 0.0];
    legacy.onConfigure({
        widgets_values: [
            4,
            2.0,
            0.0,
            0.25,
            true,
            false,
            true,
            JSON.stringify(oldCurve),
            "Generate",
            "Reset",
        ],
        step_data_cache: oldCurve,
        custom_points_cache: [],
        properties: {},
    });
    assert.equal(widget(legacy, "model_profile").value, "custom");
    assert.equal(widget(legacy, "scheduler").value, "simple");
    assert.equal(widget(legacy, "smooth_strength").value, 1.0);
    assert.equal(widget(legacy, "sigma_guard"), undefined);
    assert.deepEqual(legacy.getStepData(), oldCurve);
    assert.equal(legacy.manualEdited, true);

    const renamedProfile = new MockNode();
    renamedProfile.onNodeCreated();
    renamedProfile.onConfigure({
        widgets_values: [
            "flux2 / klein", "simple", 4, 2.02, 1.0, 0.0, 0.0, 0.0,
            "warn", false, true, "[]", "Generate", "Reset",
        ],
        properties: { cozdx1_dynamic_sigma_schema: 2 },
    });
    assert.equal(widget(renamedProfile, "model_profile").value, "flux2");
    assert.equal(widget(renamedProfile, "show_steps").value, false);
    assert.equal(widget(renamedProfile, "black_theme").value, true);
    assert.equal(renamedProfile.properties.cozdx1_dynamic_sigma_schema, 3);

    console.log("Dynamic Sigma Scheduler frontend smoke test passed");
} finally {
    fs.rmSync(temporary, { recursive: true, force: true });
}
