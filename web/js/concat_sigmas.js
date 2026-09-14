import { app } from "../../scripts/app.js";

const NODE_MIN_WIDTH = 220;

app.registerExtension({
    name: "cozdx1.ConcatSigmas",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "ConcatSigmas") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
                const node = this;

                node.updateInputs = function(isConfiguring) {
                    let action = () => {
                        const countWidget = node.widgets.find(w => w.name === "input_count");
                        if (!countWidget) return;
                        const count = countWidget.value;

                        for (let i = node.inputs ? node.inputs.length - 1 : -1; i >= 0; i--) {
                            const inp = node.inputs[i];
                            if (inp.name.startsWith("sigma_")) {
                                const idx = parseInt(inp.name.split("_")[1]);
                                if (!isNaN(idx) && idx > count) {
                                    node.removeInput(i);
                                }
                            }
                        }

                        for (let i = 1; i <= count; i++) {
                            let exists = false;
                            if (node.inputs) {
                                for (let j = 0; j < node.inputs.length; j++) {
                                    if (node.inputs[j].name === `sigma_${i}`) {
                                        exists = true;
                                        break;
                                    }
                                }
                            }
                            if (!exists) {
                                node.addInput(`sigma_${i}`, "SIGMAS");
                            }
                        }
                    };

                    if (isConfiguring) {
                        action();
                    } else {
                        action();
                        const minSize = node.computeSize();
                        node.size[0] = Math.max(node.size[0], minSize[0], NODE_MIN_WIDTH);
                        node.size[1] = minSize[1];
                    }
                };

                let setupAttempts = 0;
                const setupWidgets = () => {
                    const countWidget = node.widgets ? node.widgets.find(w => w.name === "input_count") : null;
                    if (!countWidget) {
                        if (setupAttempts++ < 120) requestAnimationFrame(setupWidgets);
                        return;
                    }

                    if (!node.isRestored && node.size) {
                        const minSize = node.computeSize();
                        node.size[0] = Math.max(minSize[0], NODE_MIN_WIDTH);
                        node.size[1] = minSize[1];
                    }
                    
                    node.updateInputs(false);
                    
                    const origCallback = countWidget.callback;
                    countWidget.callback = function(v) {
                        if (origCallback) origCallback.apply(this, arguments);
                        node.updateInputs(false);
                    };
                };

                requestAnimationFrame(setupWidgets);

                return r;
            };

            const onConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function (info) {
                this.isRestored = true;
                if (onConfigure) onConfigure.apply(this, arguments);
                if (this.updateInputs) this.updateInputs(true);
            };
        }
    }
});
