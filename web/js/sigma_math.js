// Pure frontend math for Dynamic Sigma Scheduler. Keep this module aligned
// with nodes/sigma_math.py; tests compare representative results.

export const PROFILE_DEFINITIONS = Object.freeze({
    "illustrious / sdxl": Object.freeze({
        family: "sdxl_discrete",
        defaultShift: null,
        defaultSigmaStart: 15.0,
        defaultSigmaEnd: 0.0,
    }),
    anima: Object.freeze({
        family: "discrete_flow",
        defaultShift: 3.0,
        defaultSigmaStart: 1.0,
        defaultSigmaEnd: 0.0,
    }),
    wan: Object.freeze({
        family: "discrete_flow",
        defaultShift: 8.0,
        defaultSigmaStart: 1.0,
        defaultSigmaEnd: 0.0,
    }),
    ltxv: Object.freeze({
        family: "flux",
        defaultShift: 2.37,
        defaultSigmaStart: 1.0,
        defaultSigmaEnd: 0.0,
    }),
    "z-image": Object.freeze({
        family: "discrete_flow",
        defaultShift: 3.0,
        defaultSigmaStart: 1.0,
        defaultSigmaEnd: 0.0,
    }),
    "qwen-image": Object.freeze({
        family: "flux",
        defaultShift: 1.15,
        defaultSigmaStart: 1.0,
        defaultSigmaEnd: 0.0,
    }),
    flux2: Object.freeze({
        family: "flux",
        defaultShift: 2.02,
        defaultSigmaStart: 1.0,
        defaultSigmaEnd: 0.0,
    }),
    krea2: Object.freeze({
        family: "flux",
        defaultShift: 1.15,
        defaultSigmaStart: 1.0,
        defaultSigmaEnd: 0.0,
    }),
    custom: Object.freeze({
        family: "custom",
        defaultShift: null,
        defaultSigmaStart: 1.0,
        defaultSigmaEnd: 0.0,
    }),
});

const PROFILE_ALIASES = Object.freeze({
    "flux2 / klein": "flux2",
});

export const SCHEDULER_NAMES = Object.freeze([
    "simple",
    "sgm_uniform",
    "karras",
    "exponential",
    "ddim_uniform",
    "beta",
    "beta57",
    "normal",
    "linear_quadratic",
    "kl_optimal",
    "bong_tangent",
]);

const tableCache = new Map();

function linspace(start, end, count) {
    if (count <= 0) return [];
    if (count === 1) return [Number(start)];
    const span = end - start;
    return Array.from({ length: count }, (_, index) => start + span * index / (count - 1));
}

function timeSnrShift(shift, value) {
    return shift * value / (1 + (shift - 1) * value);
}

function fluxTimeShift(shift, value) {
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    const expShift = Math.exp(shift);
    return expShift / (expShift + (1 / value - 1));
}

function sdxlSigmaTable() {
    const key = "sdxl_discrete";
    if (tableCache.has(key)) return tableCache.get(key);
    const count = 1000;
    const startRoot = Math.sqrt(0.00085);
    const endRoot = Math.sqrt(0.012);
    let alphaProduct = 1;
    const values = [];
    for (let index = 0; index < count; index++) {
        const ratio = index / (count - 1);
        const beta = (startRoot + (endRoot - startRoot) * ratio) ** 2;
        alphaProduct *= 1 - beta;
        values.push(Math.fround(Math.sqrt((1 - alphaProduct) / alphaProduct)));
    }
    tableCache.set(key, values);
    return values;
}

function sigmaTable(family, shift) {
    if (family === "sdxl_discrete") return sdxlSigmaTable();
    const key = `${family}:${shift}`;
    if (tableCache.has(key)) return tableCache.get(key);
    const count = family === "flux" ? 10000 : 1000;
    const values = [];
    for (let index = 0; index < count; index++) {
        let value = (index + 1) / count;
        if (family === "discrete_flow") value = timeSnrShift(shift, value);
        else if (family === "flux") value = fluxTimeShift(shift, value);
        values.push(Math.fround(value));
    }
    tableCache.set(key, values);
    return values;
}

function sampleTable(table, position, logarithmic = false) {
    const bounded = Math.max(0, Math.min(table.length - 1, Number(position)));
    const low = Math.floor(bounded);
    const high = Math.ceil(bounded);
    if (low === high) return Number(table[low]);
    const weight = bounded - low;
    if (logarithmic) {
        const lowValue = Math.log(Math.max(Number(table[low]), 1e-30));
        const highValue = Math.log(Math.max(Number(table[high]), 1e-30));
        return Math.exp(lowValue * (1 - weight) + highValue * weight);
    }
    return Number(table[low]) * (1 - weight) + Number(table[high]) * weight;
}

function sigmaFromTimestep(family, shift, table, timestep) {
    if (family === "sdxl_discrete") return sampleTable(table, timestep, true);
    if (family === "discrete_flow") return timeSnrShift(shift, timestep / 1000);
    if (family === "flux") return fluxTimeShift(shift, timestep);
    return timestep / 1000;
}

function timestepFromSigma(family, table, sigma) {
    if (family === "sdxl_discrete") {
        const target = Math.log(Math.max(Number(sigma), 1e-30));
        let bestIndex = 0;
        let bestDistance = Infinity;
        for (let index = 0; index < table.length; index++) {
            const distance = Math.abs(Math.log(Math.max(Number(table[index]), 1e-30)) - target);
            if (distance < bestDistance) {
                bestDistance = distance;
                bestIndex = index;
            }
        }
        return bestIndex;
    }
    if (family === "flux") return Number(sigma);
    return Number(sigma) * 1000;
}

// Lanczos log-gamma. Used only by the beta scheduler's deterministic preview.
function logGamma(value) {
    const coefficients = [
        0.99999999999980993,
        676.5203681218851,
        -1259.1392167224028,
        771.32342877765313,
        -176.61502916214059,
        12.507343278686905,
        -0.13857109526572012,
        9.9843695780195716e-6,
        1.5056327351493116e-7,
    ];
    if (value < 0.5) {
        return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
    }
    const z = value - 1;
    let sum = coefficients[0];
    for (let index = 1; index < coefficients.length; index++) {
        sum += coefficients[index] / (z + index);
    }
    const t = z + 7.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(sum);
}

function regularizedBeta(value, alpha, beta) {
    if (value <= 0) return 0;
    if (value >= 1) return 1;

    const continuedFraction = (a, b, x) => {
        const qab = a + b;
        const qap = a + 1;
        const qam = a - 1;
        const tiny = 1e-300;
        let c = 1;
        let d = 1 - qab * x / qap;
        if (Math.abs(d) < tiny) d = tiny;
        d = 1 / d;
        let result = d;
        for (let iteration = 1; iteration <= 200; iteration++) {
            const doubled = 2 * iteration;
            let term = iteration * (b - iteration) * x / ((qam + doubled) * (a + doubled));
            d = 1 + term * d;
            if (Math.abs(d) < tiny) d = tiny;
            c = 1 + term / c;
            if (Math.abs(c) < tiny) c = tiny;
            d = 1 / d;
            result *= d * c;

            term = -(a + iteration) * (qab + iteration) * x
                / ((a + doubled) * (qap + doubled));
            d = 1 + term * d;
            if (Math.abs(d) < tiny) d = tiny;
            c = 1 + term / c;
            if (Math.abs(c) < tiny) c = tiny;
            d = 1 / d;
            const delta = d * c;
            result *= delta;
            if (Math.abs(delta - 1) <= 3e-14) break;
        }
        return result;
    };

    const logTerm = logGamma(alpha + beta) - logGamma(alpha) - logGamma(beta)
        + alpha * Math.log(value) + beta * Math.log1p(-value);
    const factor = Math.exp(logTerm);
    if (value < (alpha + 1) / (alpha + beta + 2)) {
        return factor * continuedFraction(alpha, beta, value) / alpha;
    }
    return 1 - factor * continuedFraction(beta, alpha, 1 - value) / beta;
}

function inverseRegularizedBeta(probability, alpha, beta) {
    if (probability <= 0) return 0;
    if (probability >= 1) return 1;
    let low = 0;
    let high = 1;
    for (let iteration = 0; iteration < 64; iteration++) {
        const middle = (low + high) * 0.5;
        if (regularizedBeta(middle, alpha, beta) < probability) low = middle;
        else high = middle;
    }
    return (low + high) * 0.5;
}

function simpleSchedule(table, steps) {
    const stride = table.length / steps;
    const values = Array.from(
        { length: steps },
        (_, index) => table[table.length - 1 - Math.trunc(index * stride)],
    );
    return [...values, 0];
}

function normalSchedule(family, shift, table, steps, sgm) {
    const start = timestepFromSigma(family, table, table[table.length - 1]);
    const end = timestepFromSigma(family, table, table[0]);
    const count = sgm ? steps + 1 : steps;
    let timesteps = linspace(start, end, count);
    if (sgm) timesteps = timesteps.slice(0, -1);
    return [...timesteps.map((value) => sigmaFromTimestep(family, shift, table, value)), 0];
}

function ddimSchedule(table, steps) {
    const stride = Math.max(Math.trunc(table.length / steps), 1);
    const indices = Array.from(
        { length: steps },
        (_, index) => Math.min(1 + index * stride, table.length - 1),
    );
    return [...indices.reverse().map((index) => Number(table[index])), 0];
}

function roundToEven(value) {
    const floor = Math.floor(value);
    const fraction = value - floor;
    if (fraction < 0.5) return floor;
    if (fraction > 0.5) return floor + 1;
    return floor % 2 === 0 ? floor : floor + 1;
}

function betaSchedule(table, steps, alpha, beta) {
    const lastIndex = table.length - 1;
    const values = [];
    for (let index = 0; index < steps; index++) {
        const probability = 1 - index / steps;
        const position = roundToEven(
            inverseRegularizedBeta(probability, alpha, beta) * lastIndex,
        );
        values.push(Number(table[position]));
    }
    return [...values, 0];
}

function karrasSchedule(sigmaMin, sigmaMax, steps) {
    const rho = 7;
    const minimum = sigmaMin ** (1 / rho);
    const maximum = sigmaMax ** (1 / rho);
    const values = Array.from({ length: steps }, (_, index) => (
        maximum + index / Math.max(steps - 1, 1) * (minimum - maximum)
    ) ** rho);
    return [...values, 0];
}

function exponentialSchedule(sigmaMin, sigmaMax, steps) {
    const values = Array.from({ length: steps }, (_, index) => Math.exp(
        Math.log(sigmaMax)
        + index / Math.max(steps - 1, 1) * (Math.log(sigmaMin) - Math.log(sigmaMax)),
    ));
    return [...values, 0];
}

function linearQuadraticSchedule(sigmaMax, steps) {
    if (steps === 1) return [sigmaMax, 0];
    const linearSteps = Math.floor(steps / 2);
    const threshold = 0.025;
    const linear = Array.from(
        { length: linearSteps },
        (_, index) => index * threshold / linearSteps,
    );
    const difference = linearSteps - threshold * steps;
    const quadraticSteps = steps - linearSteps;
    const quadraticCoefficient = difference / (linearSteps * quadraticSteps ** 2);
    const linearCoefficient = threshold / linearSteps - 2 * difference / quadraticSteps ** 2;
    const constant = quadraticCoefficient * linearSteps ** 2;
    const quadratic = [];
    for (let index = linearSteps; index < steps; index++) {
        quadratic.push(quadraticCoefficient * index ** 2 + linearCoefficient * index + constant);
    }
    return [...linear, ...quadratic, 1].map((value) => (1 - value) * sigmaMax);
}

function klOptimalSchedule(sigmaMin, sigmaMax, steps) {
    if (steps === 1) return [sigmaMax, 0];
    const values = Array.from({ length: steps }, (_, index) => {
        const ratio = index / (steps - 1);
        return Math.tan(ratio * Math.atan(sigmaMin) + (1 - ratio) * Math.atan(sigmaMax));
    });
    return [...values, 0];
}

function normalizedArctangent(count, slope, center, high, low) {
    if (count <= 1) return [high];
    const raw = Array.from(
        { length: count },
        (_, index) => Math.atan(slope * (center - index)),
    );
    const rawHigh = raw[0];
    const rawLow = raw[raw.length - 1];
    const range = rawHigh - rawLow;
    return raw.map((value) => low + (value - rawLow) / range * (high - low));
}

function bongTangentSchedule(steps) {
    if (steps === 1) return [1, 0];
    const workingCount = steps + 2;
    const split = Math.trunc(workingCount * 0.6);
    const scaledSlope = 0.2 * 40 / workingCount;
    const center = Math.trunc(workingCount * 0.6);
    const first = normalizedArctangent(split, scaledSlope, center, 1, 0.5);
    const second = normalizedArctangent(
        workingCount - split,
        scaledSlope,
        center - split,
        0.5,
        0,
    );
    return [...first.slice(0, -1), ...second];
}

function baseSchedule(profile, scheduler, steps, shift) {
    const definition = PROFILE_DEFINITIONS[profile] ?? PROFILE_DEFINITIONS.custom;
    const family = definition.family;
    const effectiveShift = ["custom", "sdxl_discrete"].includes(family) ? 1 : Number(shift);
    const table = sigmaTable(family, effectiveShift);
    const sigmaMin = Number(table[0]);
    const sigmaMax = Number(table[table.length - 1]);

    switch (scheduler) {
        case "simple": return simpleSchedule(table, steps);
        case "sgm_uniform": return normalSchedule(family, effectiveShift, table, steps, true);
        case "normal": return normalSchedule(family, effectiveShift, table, steps, false);
        case "ddim_uniform": return ddimSchedule(table, steps);
        case "beta": return betaSchedule(table, steps, 0.6, 0.6);
        case "beta57": return betaSchedule(table, steps, 0.5, 0.7);
        case "karras": return karrasSchedule(sigmaMin, sigmaMax, steps);
        case "exponential": return exponentialSchedule(sigmaMin, sigmaMax, steps);
        case "linear_quadratic": return linearQuadraticSchedule(sigmaMax, steps);
        case "kl_optimal": return klOptimalSchedule(sigmaMin, sigmaMax, steps);
        case "bong_tangent": return bongTangentSchedule(steps);
        default: return simpleSchedule(table, steps);
    }
}

export function rescaleSchedule(values, start, end) {
    const oldStart = Number(values[0]);
    const oldEnd = Number(values[values.length - 1]);
    const range = oldStart - oldEnd;
    if (Math.abs(range) <= 1e-12) return linspace(start, end, values.length);
    const output = values.map((value) => end + ((Number(value) - oldEnd) / range) * (start - end));
    output[0] = Number(start);
    output[output.length - 1] = Number(end);
    return output;
}

function sampleUniformCurve(values, position) {
    return sampleTable(values, Math.max(0, Math.min(1, position)) * (values.length - 1));
}

export function applyCurveFactor(values, curveFactor) {
    if (!values.length || Math.abs(curveFactor) <= 1e-12) return values.map(Number);
    const last = values.length - 1;
    const output = values.map((_, index) => {
        const position = index / Math.max(last, 1);
        const warped = curveFactor > 0
            ? position ** (1 + curveFactor)
            : 1 - (1 - position) ** (1 - curveFactor);
        return sampleUniformCurve(values, warped);
    });
    output[0] = Number(values[0]);
    output[output.length - 1] = Number(values[values.length - 1]);
    return output;
}

export function buildSchedule({
    profile = "custom",
    scheduler = "simple",
    steps = 20,
    shift = 1,
    sigmaStart = 1,
    sigmaEnd = 0,
    curveFactor = 0,
} = {}) {
    const count = Math.max(1, Math.trunc(steps));
    profile = PROFILE_ALIASES[profile] ?? profile;
    const safeProfile = PROFILE_DEFINITIONS[profile] ? profile : "custom";
    const safeScheduler = SCHEDULER_NAMES.includes(scheduler) ? scheduler : "simple";
    const numericInputs = [shift, sigmaStart, sigmaEnd, curveFactor].map(Number);
    if (!numericInputs.every(Number.isFinite)) throw new Error("Schedule inputs must be finite numbers");
    const family = PROFILE_DEFINITIONS[safeProfile].family;
    if (!["custom", "sdxl_discrete"].includes(family) && Number(shift) <= 0) {
        throw new Error("shift must be greater than zero for flow profiles");
    }
    const base = baseSchedule(safeProfile, safeScheduler, count, shift);
    const scaled = rescaleSchedule(base, Number(sigmaStart), Number(sigmaEnd));
    const output = applyCurveFactor(scaled, Number(curveFactor));
    if (output.length !== count + 1) throw new Error("Schedule must contain steps + 1 values");
    return output;
}

function pchipSlopes(points) {
    const count = points.length;
    if (count === 2) {
        const slope = (points[1].y - points[0].y) / (points[1].x - points[0].x);
        return [slope, slope];
    }
    const intervals = [];
    const deltas = [];
    for (let index = 0; index < count - 1; index++) {
        const interval = points[index + 1].x - points[index].x;
        intervals.push(interval);
        deltas.push((points[index + 1].y - points[index].y) / interval);
    }
    const slopes = new Array(count).fill(0);
    for (let index = 1; index < count - 1; index++) {
        const before = deltas[index - 1];
        const after = deltas[index];
        if (before === 0 || after === 0 || before * after <= 0) {
            slopes[index] = 0;
        } else {
            const weight1 = 2 * intervals[index] + intervals[index - 1];
            const weight2 = intervals[index] + 2 * intervals[index - 1];
            slopes[index] = (weight1 + weight2) / (weight1 / before + weight2 / after);
        }
    }
    const endpointSlope = (hFirst, hSecond, dFirst, dSecond) => {
        const slope = ((2 * hFirst + hSecond) * dFirst - hFirst * dSecond)
            / (hFirst + hSecond);
        if (slope * dFirst <= 0) return 0;
        if (dFirst * dSecond < 0 && Math.abs(slope) > Math.abs(3 * dFirst)) return 3 * dFirst;
        return slope;
    };
    slopes[0] = endpointSlope(intervals[0], intervals[1], deltas[0], deltas[1]);
    slopes[count - 1] = endpointSlope(
        intervals[intervals.length - 1],
        intervals[intervals.length - 2],
        deltas[deltas.length - 1],
        deltas[deltas.length - 2],
    );
    return slopes;
}

export function interpolateControlPoints(points, steps, smoothStrength) {
    const ordered = points
        .map((point) => ({ x: Number(point.x ?? point.t), y: Number(point.y ?? point.val) }))
        .sort((left, right) => left.x - right.x);
    if (ordered.length < 2) throw new Error("At least two control points are required");
    for (let index = 0; index < ordered.length - 1; index++) {
        if (ordered[index].x >= ordered[index + 1].x) {
            throw new Error("Control point positions must be strictly increasing");
        }
    }
    const strength = Math.max(0, Math.min(1, Number(smoothStrength)));
    const slopes = pchipSlopes(ordered);
    const output = [];
    let segment = 0;
    for (let index = 0; index <= steps; index++) {
        const target = index / Math.max(steps, 1);
        while (segment < ordered.length - 2 && target > ordered[segment + 1].x) segment++;
        const first = ordered[segment];
        const second = ordered[segment + 1];
        const width = second.x - first.x;
        const ratio = Math.max(0, Math.min(1, (target - first.x) / width));
        const linear = first.y + ratio * (second.y - first.y);
        const ratio2 = ratio * ratio;
        const ratio3 = ratio2 * ratio;
        const cubic = (2 * ratio3 - 3 * ratio2 + 1) * first.y
            + (ratio3 - 2 * ratio2 + ratio) * width * slopes[segment]
            + (-2 * ratio3 + 3 * ratio2) * second.y
            + (ratio3 - ratio2) * width * slopes[segment + 1];
        output.push(linear * (1 - strength) + cubic * strength);
    }
    output[0] = ordered[0].y;
    output[output.length - 1] = ordered[ordered.length - 1].y;
    return output;
}
