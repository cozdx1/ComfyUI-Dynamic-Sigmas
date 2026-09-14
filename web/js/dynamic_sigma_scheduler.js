import { app } from "../../scripts/app.js";
import {
    PROFILE_DEFINITIONS,
    buildSchedule,
    interpolateControlPoints,
    rescaleSchedule,
} from "./sigma_math.js";

const EXTENSION_NAME = "cozdx1.DynamicSigmaScheduler";
const NODE_NAME = "DynamicSigmaScheduler";
const SCHEMA_KEY = "cozdx1_dynamic_sigma_schema";
const SCHEMA_VERSION = 3;
const GRAPH_TOP_OFFSET = 34;
const GRAPH_MIN_HEIGHT = 180;
const GRAPH_BOTTOM_MARGIN = 10;
const NODE_MIN_WIDTH = 300;

function widgetOf(node, name) {
    return node.widgets?.find((widget) => widget.name === name);
}

function finiteArray(value, expectedLength = null) {
    if (!Array.isArray(value)) return null;
    const output = value.map(Number);
    if (expectedLength !== null && output.length !== expectedLength) return null;
    return output.every(Number.isFinite) ? output : null;
}

function parseArray(value, expectedLength = null) {
    try {
        return finiteArray(typeof value === "string" ? JSON.parse(value) : value, expectedLength);
    } catch (_error) {
        return null;
    }
}

function arraysClose(left, right, tolerance = 1e-7) {
    return left.length === right.length && left.every((value, index) => (
        Math.abs(Number(value) - Number(right[index])) <= tolerance
    ));
}

function resampleValues(values, length) {
    if (length <= 0) return [];
    if (length === 1) return [Number(values[0] ?? 0)];
    if (values.length < 2) return Array(length).fill(Number(values[0] ?? 0));
    return Array.from({ length }, (_, index) => {
        const position = index / (length - 1) * (values.length - 1);
        const low = Math.floor(position);
        const high = Math.ceil(position);
        if (low === high) return Number(values[low]);
        const weight = position - low;
        return Number(values[low]) * (1 - weight) + Number(values[high]) * weight;
    });
}

function remapValue(value, position, oldStart, oldEnd, newStart, newEnd) {
    const range = oldStart - oldEnd;
    if (Math.abs(range) <= 1e-12) {
        return newStart + position * (newEnd - newStart);
    }
    return newEnd + (Number(value) - oldEnd) / range * (newStart - newEnd);
}

function migrateLegacyInfo(info) {
    if (!info || !Array.isArray(info.widgets_values)) return false;
    info.properties = { ...(info.properties || {}) };
    const values = info.widgets_values;
    const savedSchema = Number(info.properties[SCHEMA_KEY]);
    let migrated = false;
    // v1.0.x begins with numeric `steps`; v1.1 begins with model_profile.
    if ((!Number.isFinite(savedSchema) || savedSchema < SCHEMA_VERSION) && typeof values[0] === "number") {
        const [steps, start, end, factor, smooth, showSteps, blackTheme, ...tail] = values;
        info.widgets_values = [
            "custom",
            "simple",
            steps,
            1.0,
            start,
            end,
            factor,
            smooth ? 1.0 : 0.0,
            showSteps,
            blackTheme,
            ...tail,
        ];
        migrated = true;
    } else if (
        (!Number.isFinite(savedSchema) || savedSchema < SCHEMA_VERSION)
        && ["off", "warn", "enforce"].includes(info.widgets_values[8])
    ) {
        // Remove the guard value saved by prerelease v1.1 test workflows so
        // show_steps, black_theme, and custom widgets keep their positions.
        info.widgets_values.splice(8, 1);
        migrated = true;
    }
    // Preserve workflows saved during the v1.1.0 test cycle under the former label.
    if (info.widgets_values[0] === "flux2 / klein") info.widgets_values[0] = "flux2";
    info.properties[SCHEMA_KEY] = SCHEMA_VERSION;
    return migrated;
}

function bindWidget(node, name, handler) {
    const widget = widgetOf(node, name);
    if (!widget || widget._cozdx1Bound) return;
    const original = widget.callback;
    widget.callback = function (value) {
        const result = original?.apply(this, arguments);
        if (!node._suspendCallbacks) handler(value, widget);
        return result;
    };
    widget._cozdx1Bound = true;
}

function createHiddenDataWidget(node) {
    let widget = widgetOf(node, "step_data");
    if (!widget) widget = node.addWidget("text", "step_data", "[]", () => {});
    widget.type = "hidden";
    widget.hidden = true;
    widget.options = {
        ...(widget.options || {}),
        hidden: true,
        hideInPanel: true,
        serialize: true,
    };
    widget.computeSize = () => [0, 0];
    widget.serializeValue = () => widget.value;
    return widget;
}

function installDynamicScheduler(node) {
    node.properties = { ...(node.properties || {}), [SCHEMA_KEY]: SCHEMA_VERSION };
    node.customPoints = [];
    node.rawStepData = [];
    node.manualEdited = false;
    node.scheduleError = "";
    node.hoveredPointIndex = -1;
    node.hoveredEndpoint = null;
    node.draggedPointIndex = null;
    node.draggedEndpoint = null;
    node._suspendCallbacks = false;

    const stepDataWidget = createHiddenDataWidget(node);
    const originalComputeSize = node.computeSize?.bind(node);
    const originalDraw = node.onDrawForeground?.bind(node);
    const originalMouseDown = node.onMouseDown?.bind(node);
    const originalMouseMove = node.onMouseMove?.bind(node);
    const originalMouseUp = node.onMouseUp?.bind(node);
    const originalMouseLeave = node.onMouseLeave?.bind(node);

    node.getStepData = function () {
        return parseArray(stepDataWidget.value) || [];
    };

    node.getExpectedLength = function () {
        return Math.max(1, Math.trunc(Number(widgetOf(this, "steps")?.value ?? 1))) + 1;
    };

    node.minimumHeight = function () {
        const visible = this.widgets?.filter((widget) => widget.type !== "hidden" && !widget.hidden) || [];
        const widgetHeight = globalThis.LiteGraph?.NODE_WIDGET_HEIGHT ?? 20;
        return GRAPH_TOP_OFFSET
            + visible.length * (widgetHeight + 4)
            + GRAPH_MIN_HEIGHT
            + GRAPH_BOTTOM_MARGIN;
    };

    node.computeSize = function (out) {
        const base = originalComputeSize ? originalComputeSize([0, 0]) : [NODE_MIN_WIDTH, 0];
        const result = [
            Math.max(NODE_MIN_WIDTH, Number(base?.[0] ?? 0)),
            this.minimumHeight(),
        ];
        if (out) {
            out[0] = result[0];
            out[1] = result[1];
            return out;
        }
        return result;
    };

    node.preserveGraphHeight = function (action) {
        const previousMinimum = this.minimumHeight();
        const extra = Math.max(0, Number(this.size?.[1] ?? previousMinimum) - previousMinimum);
        action();
        if (this.size) this.size[1] = this.minimumHeight() + extra;
        this.setDirtyCanvas?.(true, true);
    };

    node.setStepData = function (values) {
        stepDataWidget.value = JSON.stringify(values.map(Number));
    };

    node.updateVisibleStepValues = function (values) {
        const steps = this.getExpectedLength() - 1;
        for (let index = 0; index <= steps; index++) {
            const widget = widgetOf(this, `step_${index}`);
            if (widget) widget.value = Number(values[index]);
        }
    };

    node.setRawSchedule = function (values) {
        const parsed = finiteArray(values, this.getExpectedLength());
        if (!parsed) {
            this.scheduleError = "Schedule contains invalid values";
            this.setDirtyCanvas?.(true, true);
            return false;
        }

        this.rawStepData = parsed;
        this.setStepData(parsed);
        this.scheduleError = "";
        this.updateVisibleStepValues(parsed);
        this.setDirtyCanvas?.(true, true);
        return true;
    };

    node.scheduleOptions = function () {
        return {
            profile: String(widgetOf(this, "model_profile")?.value ?? "custom"),
            scheduler: String(widgetOf(this, "scheduler")?.value ?? "simple"),
            steps: Math.max(1, Math.trunc(Number(widgetOf(this, "steps")?.value ?? 1))),
            shift: Number(widgetOf(this, "shift")?.value ?? 1),
            sigmaStart: Number(widgetOf(this, "sigma_start")?.value ?? 1),
            sigmaEnd: Number(widgetOf(this, "sigma_end")?.value ?? 0),
            curveFactor: Number(widgetOf(this, "curve_factor")?.value ?? 0),
        };
    };

    node.generateCurve = function ({ clearEdits = true } = {}) {
        if (clearEdits) {
            this.customPoints = [];
            this.manualEdited = false;
        }
        try {
            const options = this.scheduleOptions();
            this.endpointState = { start: options.sigmaStart, end: options.sigmaEnd };
            this.setRawSchedule(buildSchedule(options));
            this.syncStepVisibility();
        } catch (error) {
            this.scheduleError = String(error?.message || error);
            this.setDirtyCanvas?.(true, true);
        }
    };

    node.controlPoints = function () {
        const start = Number(widgetOf(this, "sigma_start")?.value ?? 1);
        const end = Number(widgetOf(this, "sigma_end")?.value ?? 0);
        return [
            { x: 0, y: start },
            ...this.customPoints.map((point) => ({ x: point.t, y: point.val })),
            { x: 1, y: end },
        ].sort((left, right) => left.x - right.x);
    };

    node.updateFromCustomPoints = function () {
        const steps = this.getExpectedLength() - 1;
        const strength = Number(widgetOf(this, "smooth_strength")?.value ?? 0);
        try {
            this.manualEdited = true;
            this.setRawSchedule(interpolateControlPoints(this.controlPoints(), steps, strength));
            this.syncStepVisibility();
        } catch (error) {
            this.scheduleError = String(error?.message || error);
            this.setDirtyCanvas?.(true, true);
        }
    };

    node.removeStepWidgets = function () {
        for (let index = this.widgets.length - 1; index >= 0; index--) {
            const name = this.widgets[index]?.name;
            if (name?.startsWith("step_") && name !== "step_data") this.widgets.splice(index, 1);
        }
    };

    node.editStep = function (index, value) {
        const steps = this.getExpectedLength() - 1;
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return;
        if (index === 0 || index === steps) {
            this.changeEndpoint(index === 0 ? "start" : "end", numeric);
            return;
        }
        const data = finiteArray(this.rawStepData, steps + 1) || this.getStepData();
        if (data.length !== steps + 1) return;
        this.customPoints = [];
        this.manualEdited = true;
        data[index] = numeric;
        this.setRawSchedule(data);
    };

    node.renderStepWidgets = function () {
        const steps = this.getExpectedLength() - 1;
        const data = this.getStepData();
        const start = Number(widgetOf(this, "sigma_start")?.value ?? 1);
        const end = Number(widgetOf(this, "sigma_end")?.value ?? 0);
        const minimum = Math.min(start, end);
        const maximum = Math.max(start, end);
        const increment = Math.max(Math.abs(start - end) / 1000, 1e-6);
        this.removeStepWidgets();

        for (let index = 0; index <= steps; index++) {
            const isEndpoint = index === 0 || index === steps;
            const widget = this.addWidget(
                "number",
                `step_${index}`,
                Number(data[index] ?? (index === 0 ? start : end)),
                (value) => this.editStep(index, value),
                {
                    min: isEndpoint ? 0 : minimum,
                    max: isEndpoint ? 100 : maximum,
                    step: increment,
                    precision: 6,
                },
            );
            widget.tooltip = isEndpoint
                ? `Synchronized with sigma_${index === 0 ? "start" : "end"}`
                : "Editable sigma value";
        }
    };

    node.syncStepVisibility = function (preserveSize = true) {
        const action = () => {
            if (widgetOf(this, "show_steps")?.value) {
                const count = this.widgets.filter(
                    (widget) => widget.name?.startsWith("step_") && widget.name !== "step_data",
                ).length;
                if (count !== this.getExpectedLength()) this.renderStepWidgets();
                else this.updateVisibleStepValues(this.getStepData());
            } else {
                this.removeStepWidgets();
            }
        };
        if (preserveSize) this.preserveGraphHeight(action);
        else action();
    };

    node.changeEndpoint = function (which, value) {
        const startWidget = widgetOf(this, "sigma_start");
        const endWidget = widgetOf(this, "sigma_end");
        if (!startWidget || !endWidget) return;

        this._suspendCallbacks = true;
        if (which === "start") startWidget.value = value;
        else endWidget.value = value;
        this._suspendCallbacks = false;

        const previous = this.endpointState || {
            start: Number(this.rawStepData[0] ?? startWidget.value),
            end: Number(this.rawStepData[this.rawStepData.length - 1] ?? endWidget.value),
        };
        const next = { start: Number(startWidget.value), end: Number(endWidget.value) };

        if (this.customPoints.length) {
            this.customPoints = this.customPoints.map((point) => ({
                t: point.t,
                val: remapValue(
                    point.val,
                    point.t,
                    previous.start,
                    previous.end,
                    next.start,
                    next.end,
                ),
            }));
        }
        this.endpointState = next;

        if (this.customPoints.length) {
            this.updateFromCustomPoints();
        } else if (this.rawStepData.length === this.getExpectedLength()) {
            this.setRawSchedule(rescaleSchedule(this.rawStepData, next.start, next.end));
            this.syncStepVisibility();
        } else {
            this.generateCurve({ clearEdits: false });
        }
    };

    node.updateShiftAvailability = function () {
        const profile = String(widgetOf(this, "model_profile")?.value ?? "custom");
        const definition = PROFILE_DEFINITIONS[profile] || PROFILE_DEFINITIONS.custom;
        const disabled = definition.defaultShift === null;
        const shiftWidget = widgetOf(this, "shift");
        if (shiftWidget) {
            shiftWidget.disabled = disabled;
            shiftWidget.options = { ...(shiftWidget.options || {}), disabled };
        }
    };

    node.selectProfile = function (profile) {
        const definition = PROFILE_DEFINITIONS[profile] || PROFILE_DEFINITIONS.custom;
        this.updateShiftAvailability();
        if (profile === "custom") {
            this.setRawSchedule(this.rawStepData.length ? this.rawStepData : this.getStepData());
            return;
        }

        this._suspendCallbacks = true;
        if (definition.defaultShift !== null) widgetOf(this, "shift").value = definition.defaultShift;
        widgetOf(this, "sigma_start").value = definition.defaultSigmaStart;
        widgetOf(this, "sigma_end").value = definition.defaultSigmaEnd;
        this._suspendCallbacks = false;
        this.endpointState = {
            start: definition.defaultSigmaStart,
            end: definition.defaultSigmaEnd,
        };
        this.generateCurve();
    };

    node.resetProfile = function () {
        const profile = String(widgetOf(this, "model_profile")?.value ?? "custom");
        const definition = PROFILE_DEFINITIONS[profile] || PROFILE_DEFINITIONS.custom;
        this._suspendCallbacks = true;
        if (definition.defaultShift !== null) widgetOf(this, "shift").value = definition.defaultShift;
        else widgetOf(this, "shift").value = 1.0;
        widgetOf(this, "sigma_start").value = definition.defaultSigmaStart;
        widgetOf(this, "sigma_end").value = definition.defaultSigmaEnd;
        widgetOf(this, "curve_factor").value = 0.0;
        widgetOf(this, "smooth_strength").value = 0.0;
        this._suspendCallbacks = false;
        this.endpointState = {
            start: definition.defaultSigmaStart,
            end: definition.defaultSigmaEnd,
        };
        this.updateShiftAvailability();
        this.generateCurve();
    };

    node.addWidget("button", "↻ Generate Curve", "Generate", () => node.generateCurve());
    node.addWidget("button", "Reset Profile", "Reset", () => node.resetProfile());

    node.graphInfo = function () {
        const points = this.getStepData();
        if (points.length < 2) return null;
        const visibleCount = this.widgets.filter(
            (widget) => widget.type !== "hidden" && !widget.hidden,
        ).length;
        const widgetHeight = globalThis.LiteGraph?.NODE_WIDGET_HEIGHT ?? 20;
        const y = GRAPH_TOP_OFFSET + visibleCount * (widgetHeight + 4);
        const graphHeight = Math.max(
            GRAPH_MIN_HEIGHT,
            Number(this.size?.[1] ?? 0) - y - GRAPH_BOTTOM_MARGIN,
        );
        const width = Number(this.size?.[0] ?? NODE_MIN_WIDTH);
        const paddingX = 24;
        const paddingY = 20;
        const drawX = 10 + paddingX;
        const drawY = y + paddingY;
        const drawW = Math.max(20, width - 20 - paddingX * 2);
        const drawH = Math.max(20, graphHeight - paddingY * 2);
        const customValues = this.customPoints.map((point) => Number(point.val));
        let minimum = Math.min(...points, ...customValues);
        let maximum = Math.max(...points, ...customValues);
        if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return null;
        if (Math.abs(maximum - minimum) <= 1e-12) {
            minimum -= 0.5;
            maximum += 0.5;
        } else {
            const margin = (maximum - minimum) * 0.06;
            minimum -= margin;
            maximum += margin;
        }
        const getX = (position) => drawX + position * drawW;
        const getY = (value) => drawY + drawH - (value - minimum) / (maximum - minimum) * drawH;
        const getT = (x) => (x - drawX) / drawW;
        const getValue = (screenY) => minimum + (drawY + drawH - screenY) / drawH * (maximum - minimum);
        return {
            points,
            minimum,
            maximum,
            y,
            graphHeight,
            width,
            drawX,
            drawY,
            drawW,
            drawH,
            getX,
            getY,
            getT,
            getValue,
        };
    };

    node.onDrawForeground = function (context) {
        originalDraw?.(...arguments);
        const graph = this.graphInfo();
        if (!graph) return;
        const {
            points, minimum, y, graphHeight, width,
            drawX, drawY, drawW, drawH, getX, getY,
        } = graph;
        const dark = Boolean(widgetOf(this, "black_theme")?.value ?? true);
        const colors = dark ? {
            background: "#1e1e1e",
            border: "rgba(220,220,220,.28)",
            grid: "rgba(255,255,255,.14)",
            line: "#00d2d3",
            fill: "rgba(0,210,211,.14)",
            guide: "rgba(255,255,255,.16)",
            control: "#b8b8b8",
            text: "#dedede",
        } : {
            background: "#ffffff",
            border: "rgba(30,30,30,.28)",
            grid: "rgba(0,0,0,.13)",
            line: "#2e86de",
            fill: "rgba(46,134,222,.14)",
            guide: "rgba(0,0,0,.16)",
            control: "#666666",
            text: "#333333",
        };

        context.save();
        context.fillStyle = colors.background;
        context.fillRect(10, y, width - 20, graphHeight);
        context.strokeStyle = colors.border;
        context.strokeRect(10, y, width - 20, graphHeight);

        context.strokeStyle = colors.grid;
        context.lineWidth = 1;
        context.beginPath();
        for (let index = 0; index <= 4; index++) {
            const gridY = drawY + index / 4 * drawH;
            const gridX = drawX + index / 4 * drawW;
            context.moveTo(drawX, gridY);
            context.lineTo(drawX + drawW, gridY);
            context.moveTo(gridX, drawY);
            context.lineTo(gridX, drawY + drawH);
        }
        context.stroke();

        if (this.customPoints.length) {
            const controls = this.controlPoints();
            context.strokeStyle = colors.guide;
            context.lineWidth = 1;
            context.setLineDash([4, 5]);
            context.beginPath();
            controls.forEach((point, index) => {
                const x = getX(point.x);
                const pointY = getY(point.y);
                if (index === 0) context.moveTo(x, pointY);
                else context.lineTo(x, pointY);
            });
            context.stroke();
            context.setLineDash([]);
        }

        context.fillStyle = colors.fill;
        context.beginPath();
        context.moveTo(getX(0), getY(minimum));
        points.forEach((value, index) => context.lineTo(getX(index / (points.length - 1)), getY(value)));
        context.lineTo(getX(1), getY(minimum));
        context.closePath();
        context.fill();

        context.strokeStyle = colors.line;
        context.lineWidth = 2;
        context.beginPath();
        points.forEach((value, index) => {
            const x = getX(index / (points.length - 1));
            const pointY = getY(value);
            if (index === 0) context.moveTo(x, pointY);
            else context.lineTo(x, pointY);
        });
        context.stroke();

        context.fillStyle = colors.line;
        const radius = points.length > 50 ? 1.5 : 3;
        points.forEach((value, index) => {
            context.beginPath();
            context.arc(getX(index / (points.length - 1)), getY(value), radius, 0, Math.PI * 2);
            context.fill();
        });

        this.customPoints.forEach((point, index) => {
            const x = getX(point.t);
            const pointY = getY(point.val);
            const size = index === this.hoveredPointIndex || index === this.draggedPointIndex ? 7 : 5;
            context.fillStyle = colors.control;
            context.strokeStyle = index === this.hoveredPointIndex ? colors.line : colors.text;
            context.lineWidth = 1.5;
            context.beginPath();
            context.moveTo(x, pointY - size);
            context.lineTo(x + size, pointY);
            context.lineTo(x, pointY + size);
            context.lineTo(x - size, pointY);
            context.closePath();
            context.fill();
            context.stroke();
        });

        if (this.manualEdited) {
            context.font = "10px sans-serif";
            context.textAlign = "right";
            context.fillStyle = colors.text;
            context.fillText("manual edit", drawX + drawW - 2, drawY - 6);
            context.textAlign = "left";
        }
        context.restore();
    };

    node.findGraphTarget = function (position, graph) {
        const endpoints = [
            { name: "start", x: graph.getX(0), y: graph.getY(graph.points[0]) },
            { name: "end", x: graph.getX(1), y: graph.getY(graph.points[graph.points.length - 1]) },
        ];
        for (const endpoint of endpoints) {
            if (Math.hypot(position[0] - endpoint.x, position[1] - endpoint.y) < 12) {
                return { type: "endpoint", value: endpoint.name };
            }
        }
        for (let index = 0; index < this.customPoints.length; index++) {
            const point = this.customPoints[index];
            if (Math.hypot(position[0] - graph.getX(point.t), position[1] - graph.getY(point.val)) < 13) {
                return { type: "point", value: index };
            }
        }
        return null;
    };

    node.onMouseDown = function (event, position, graphCanvas) {
        const graph = this.graphInfo();
        if (!graph) return originalMouseDown?.(...arguments) ?? false;
        const target = this.findGraphTarget(position, graph);
        if (target?.type === "point" && event.shiftKey) {
            this.customPoints.splice(target.value, 1);
            this.updateFromCustomPoints();
            return true;
        }
        if (target) {
            this.draggedPointIndex = target.type === "point" ? target.value : null;
            this.draggedEndpoint = target.type === "endpoint" ? target.value : null;
            this.captureInput?.(true);
            if (graphCanvas?.canvas) graphCanvas.canvas.style.cursor = "grabbing";
            return true;
        }
        const inside = position[0] >= graph.drawX && position[0] <= graph.drawX + graph.drawW
            && position[1] >= graph.drawY && position[1] <= graph.drawY + graph.drawH;
        if (inside && !event.shiftKey) {
            const t = Math.max(0.01, Math.min(0.99, graph.getT(position[0])));
            const start = Number(widgetOf(this, "sigma_start")?.value ?? 1);
            const end = Number(widgetOf(this, "sigma_end")?.value ?? 0);
            const value = Math.max(Math.min(start, end), Math.min(Math.max(start, end), graph.getValue(position[1])));
            this.customPoints.push({ t, val: value });
            this.customPoints.sort((left, right) => left.t - right.t);
            this.draggedPointIndex = this.customPoints.findIndex(
                (point) => point.t === t && point.val === value,
            );
            this.manualEdited = true;
            this.captureInput?.(true);
            if (graphCanvas?.canvas) graphCanvas.canvas.style.cursor = "grabbing";
            this.updateFromCustomPoints();
            return true;
        }
        return originalMouseDown?.(...arguments) ?? false;
    };

    node.onMouseMove = function (event, position, graphCanvas) {
        const graph = this.graphInfo();
        if (!graph) return originalMouseMove?.(...arguments) ?? false;
        if ((this.draggedPointIndex !== null || this.draggedEndpoint) && event.buttons === 0) {
            return this.onMouseUp(event, position, graphCanvas);
        }
        if (this.draggedEndpoint) {
            const value = Math.max(0, Math.min(100, graph.getValue(position[1])));
            this.changeEndpoint(this.draggedEndpoint, value);
            return true;
        }
        if (this.draggedPointIndex !== null) {
            const index = this.draggedPointIndex;
            const previous = this.customPoints[index - 1]?.t ?? 0;
            const next = this.customPoints[index + 1]?.t ?? 1;
            const t = Math.max(previous + 0.01, Math.min(next - 0.01, graph.getT(position[0])));
            const start = Number(widgetOf(this, "sigma_start")?.value ?? 1);
            const end = Number(widgetOf(this, "sigma_end")?.value ?? 0);
            const value = Math.max(Math.min(start, end), Math.min(Math.max(start, end), graph.getValue(position[1])));
            this.customPoints[index] = { t, val: value };
            this.updateFromCustomPoints();
            return true;
        }

        const target = this.findGraphTarget(position, graph);
        const pointIndex = target?.type === "point" ? target.value : -1;
        const endpoint = target?.type === "endpoint" ? target.value : null;
        if (pointIndex !== this.hoveredPointIndex || endpoint !== this.hoveredEndpoint) {
            this.hoveredPointIndex = pointIndex;
            this.hoveredEndpoint = endpoint;
            if (graphCanvas?.canvas) {
                graphCanvas.canvas.style.cursor = target
                    ? (event.shiftKey && target.type === "point" ? "pointer" : "grab")
                    : "default";
            }
            this.setDirtyCanvas?.(true, true);
        }
        if (target) return true;
        return originalMouseMove?.(...arguments) ?? false;
    };

    node.onMouseUp = function (event, position, graphCanvas) {
        if (this.draggedPointIndex !== null || this.draggedEndpoint) {
            this.draggedPointIndex = null;
            this.draggedEndpoint = null;
            this.captureInput?.(false);
            if (graphCanvas?.canvas) graphCanvas.canvas.style.cursor = "default";
            this.setDirtyCanvas?.(true, true);
            return true;
        }
        return originalMouseUp?.(...arguments) ?? false;
    };

    node.onMouseLeave = function (event, position, graphCanvas) {
        this.hoveredPointIndex = -1;
        this.hoveredEndpoint = null;
        if (graphCanvas?.canvas && this.draggedPointIndex === null && !this.draggedEndpoint) {
            graphCanvas.canvas.style.cursor = "default";
        }
        this.setDirtyCanvas?.(true, true);
        return originalMouseLeave?.(...arguments);
    };

    node.syncWidgets = function (preserveSize = true) {
        this.updateShiftAvailability();
        const options = this.scheduleOptions();
        this.endpointState = { start: options.sigmaStart, end: options.sigmaEnd };
        const expectedLength = options.steps + 1;
        let raw = finiteArray(this.rawStepData, expectedLength);
        if (!raw) raw = parseArray(stepDataWidget.value, expectedLength);
        if (raw) this.setRawSchedule(raw);
        else if (this.customPoints.length) this.updateFromCustomPoints();
        else this.generateCurve({ clearEdits: false });
        this.syncStepVisibility(preserveSize);
    };

    node.setupWidgets = function () {
        if (this._cozdx1SetupComplete || !widgetOf(this, "steps")) return false;
        this._cozdx1SetupComplete = true;

        bindWidget(this, "model_profile", (value) => this.selectProfile(String(value)));
        bindWidget(this, "scheduler", () => this.generateCurve());
        bindWidget(this, "shift", () => {
            const profile = String(widgetOf(this, "model_profile")?.value ?? "custom");
            if (PROFILE_DEFINITIONS[profile]?.defaultShift !== null) this.generateCurve();
        });
        bindWidget(this, "steps", () => {
            const length = this.getExpectedLength();
            if (this.customPoints.length) {
                this.updateFromCustomPoints();
            } else if (this.manualEdited && this.rawStepData.length >= 2) {
                const data = resampleValues(this.rawStepData, length);
                data[0] = Number(widgetOf(this, "sigma_start")?.value ?? data[0]);
                data[data.length - 1] = Number(widgetOf(this, "sigma_end")?.value ?? data[data.length - 1]);
                this.setRawSchedule(data);
                this.syncStepVisibility();
            } else {
                this.generateCurve();
            }
        });
        bindWidget(this, "sigma_start", (value) => this.changeEndpoint("start", Number(value)));
        bindWidget(this, "sigma_end", (value) => this.changeEndpoint("end", Number(value)));
        bindWidget(this, "curve_factor", () => this.generateCurve());
        bindWidget(this, "smooth_strength", () => {
            if (this.customPoints.length) this.updateFromCustomPoints();
            else this.setDirtyCanvas?.(true, true);
        });
        bindWidget(this, "show_steps", () => this.syncStepVisibility());
        bindWidget(this, "black_theme", () => this.setDirtyCanvas?.(true, true));

        this.updateShiftAvailability();
        if (!this.isRestored) {
            const minimum = this.computeSize();
            this.size = [minimum[0], minimum[1]];
            this.generateCurve();
        } else {
            this.syncWidgets(false);
        }
        return true;
    };

    let setupAttempts = 0;
    const setup = () => {
        if (!node.setupWidgets() && setupAttempts++ < 120) requestAnimationFrame(setup);
    };
    requestAnimationFrame(setup);
}

app.registerExtension({
    name: EXTENSION_NAME,
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;

        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = originalCreated?.apply(this, arguments);
            installDynamicScheduler(this);
            return result;
        };

        const originalSerialize = nodeType.prototype.onSerialize;
        nodeType.prototype.onSerialize = function (output) {
            originalSerialize?.apply(this, arguments);
            output.properties = { ...(output.properties || {}), [SCHEMA_KEY]: SCHEMA_VERSION };
            output.step_data_cache = this.getStepData?.() || [];
            output.raw_step_data_cache = finiteArray(this.rawStepData) || output.step_data_cache;
            output.custom_points_cache = (this.customPoints || []).map((point) => ({ ...point }));
            output.manual_edited_cache = Boolean(this.manualEdited);
        };

        const originalConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (info) {
            this.isRestored = true;
            const migratedLegacy = migrateLegacyInfo(info);
            originalConfigure?.apply(this, arguments);
            this.customPoints = (info.custom_points_cache || [])
                .map((point) => ({ t: Number(point.t), val: Number(point.val) }))
                .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.val));
            this.manualEdited = Boolean(info.manual_edited_cache || this.customPoints.length);
            this.rawStepData = finiteArray(info.raw_step_data_cache)
                || finiteArray(info.step_data_cache)
                || [];
            if (migratedLegacy && !this.customPoints.length && this.rawStepData.length) {
                try {
                    this.manualEdited = !arraysClose(
                        this.rawStepData,
                        buildSchedule(this.scheduleOptions()),
                    );
                } catch (_error) {
                    this.manualEdited = true;
                }
            }
            this.syncWidgets?.(false);
        };
    },
});
