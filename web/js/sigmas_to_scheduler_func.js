import { app } from "../../scripts/app.js";

const NODE_NAME = "Cozdx1SigmasToSchedulerFunc";
const NODE_MIN_WIDTH = 220;
const WIDTH_SCHEMA_KEY = "cozdx1CompactBridgeWidthSchema";
const WIDTH_SCHEMA_VERSION = 1;

function installCompactBridgeSize(node) {
    const originalComputeSize = node.computeSize?.bind(node);

    node.computeSize = function (out) {
        const base = originalComputeSize ? originalComputeSize([0, 0]) : [NODE_MIN_WIDTH, 0];
        const result = [NODE_MIN_WIDTH, Number(base?.[1] ?? 0)];

        if (out) {
            out[0] = result[0];
            out[1] = result[1];
            return out;
        }
        return result;
    };

    if (!node.isRestored && node.size) {
        const minimum = node.computeSize();
        node.size = [minimum[0], minimum[1]];
        node.properties = {
            ...(node.properties || {}),
            [WIDTH_SCHEMA_KEY]: WIDTH_SCHEMA_VERSION,
        };
    }
}

app.registerExtension({
    name: "cozdx1.SigmasToSchedulerFunc",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;

        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = originalCreated?.apply(this, arguments);
            installCompactBridgeSize(this);
            return result;
        };

        const originalConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (info) {
            this.isRestored = true;
            const savedSchema = Number(info?.properties?.[WIDTH_SCHEMA_KEY]);
            const result = originalConfigure?.apply(this, arguments);

            this.properties = {
                ...(this.properties || {}),
                [WIDTH_SCHEMA_KEY]: WIDTH_SCHEMA_VERSION,
            };

            if (!Number.isFinite(savedSchema) || savedSchema < WIDTH_SCHEMA_VERSION) {
                requestAnimationFrame(() => {
                    if (!this.size) return;
                    this.size[0] = this.computeSize()[0];
                    this.setDirtyCanvas?.(true, true);
                });
            }

            return result;
        };
    },
});
