"""Pure sigma schedule math shared by the Dynamic Sigma Scheduler backend.

The frontend has a matching implementation in ``web/js/sigma_math.js``. Keep
the public constants and calculation order in sync and cover changes with the
cross-runtime golden tests.
"""

from __future__ import annotations

from functools import lru_cache
import math
from typing import Iterable, Sequence

import torch


PROFILE_DEFINITIONS = {
    "illustrious / sdxl": {
        "family": "sdxl_discrete",
        "default_shift": None,
        "default_sigma_start": 15.0,
        "default_sigma_end": 0.0,
    },
    "anima": {
        "family": "discrete_flow",
        "default_shift": 3.0,
        "default_sigma_start": 1.0,
        "default_sigma_end": 0.0,
    },
    "wan": {
        "family": "discrete_flow",
        "default_shift": 8.0,
        "default_sigma_start": 1.0,
        "default_sigma_end": 0.0,
    },
    "ltxv": {
        "family": "flux",
        "default_shift": 2.37,
        "default_sigma_start": 1.0,
        "default_sigma_end": 0.0,
    },
    "z-image": {
        "family": "discrete_flow",
        "default_shift": 3.0,
        "default_sigma_start": 1.0,
        "default_sigma_end": 0.0,
    },
    "qwen-image": {
        "family": "flux",
        "default_shift": 1.15,
        "default_sigma_start": 1.0,
        "default_sigma_end": 0.0,
    },
    "flux2": {
        "family": "flux",
        "default_shift": 2.02,
        "default_sigma_start": 1.0,
        "default_sigma_end": 0.0,
    },
    "krea2": {
        "family": "flux",
        "default_shift": 1.15,
        "default_sigma_start": 1.0,
        "default_sigma_end": 0.0,
    },
    "custom": {
        "family": "custom",
        "default_shift": None,
        "default_sigma_start": 1.0,
        "default_sigma_end": 0.0,
    },
}

PROFILE_ALIASES = {
    "flux2 / klein": "flux2",
}
PROFILE_NAMES = tuple(PROFILE_DEFINITIONS)
SCHEDULER_NAMES = (
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
)
def _linspace(start: float, end: float, count: int) -> list[float]:
    if count <= 0:
        return []
    if count == 1:
        return [float(start)]
    span = end - start
    return [start + span * index / (count - 1) for index in range(count)]


def _time_snr_shift(shift: float, value: float) -> float:
    return shift * value / (1.0 + (shift - 1.0) * value)


def _flux_time_shift(shift: float, value: float) -> float:
    if value <= 0.0:
        return 0.0
    if value >= 1.0:
        return 1.0
    exp_shift = math.exp(shift)
    return exp_shift / (exp_shift + (1.0 / value - 1.0))


@lru_cache(maxsize=1)
def _sdxl_sigma_table() -> tuple[float, ...]:
    count = 1000
    start_root = math.sqrt(0.00085)
    end_root = math.sqrt(0.012)
    alpha_product = 1.0
    values = []
    for index in range(count):
        ratio = index / (count - 1)
        beta = (start_root + (end_root - start_root) * ratio) ** 2
        alpha_product *= 1.0 - beta
        sigma = math.sqrt((1.0 - alpha_product) / alpha_product)
        values.append(float(torch.tensor(sigma, dtype=torch.float32)))
    return tuple(values)


@lru_cache(maxsize=64)
def _sigma_table(family: str, shift: float) -> tuple[float, ...]:
    if family == "sdxl_discrete":
        return _sdxl_sigma_table()

    count = 10000 if family == "flux" else 1000
    values = []
    for index in range(count):
        value = (index + 1) / count
        if family == "discrete_flow":
            value = _time_snr_shift(shift, value)
        elif family == "flux":
            value = _flux_time_shift(shift, value)
        values.append(float(torch.tensor(value, dtype=torch.float32)))
    return tuple(values)


def _sample_table(table: Sequence[float], position: float, *, logarithmic: bool) -> float:
    position = max(0.0, min(float(len(table) - 1), float(position)))
    low = int(math.floor(position))
    high = int(math.ceil(position))
    if low == high:
        return float(table[low])
    weight = position - low
    if logarithmic:
        low_value = math.log(max(float(table[low]), 1e-30))
        high_value = math.log(max(float(table[high]), 1e-30))
        return math.exp(low_value * (1.0 - weight) + high_value * weight)
    return float(table[low]) * (1.0 - weight) + float(table[high]) * weight


def _sigma_from_timestep(
    family: str,
    shift: float,
    table: Sequence[float],
    timestep: float,
) -> float:
    if family == "sdxl_discrete":
        return _sample_table(table, timestep, logarithmic=True)
    if family == "discrete_flow":
        return _time_snr_shift(shift, timestep / 1000.0)
    if family == "flux":
        return _flux_time_shift(shift, timestep)
    return timestep / 1000.0


def _timestep_from_sigma(family: str, table: Sequence[float], sigma: float) -> float:
    if family == "sdxl_discrete":
        target = math.log(max(float(sigma), 1e-30))
        return float(
            min(
                range(len(table)),
                key=lambda index: abs(math.log(max(float(table[index]), 1e-30)) - target),
            )
        )
    if family == "flux":
        return float(sigma)
    return float(sigma) * 1000.0


def _regularized_beta(value: float, alpha: float, beta: float) -> float:
    """Regularized incomplete beta using a stable continued fraction."""
    if value <= 0.0:
        return 0.0
    if value >= 1.0:
        return 1.0

    def continued_fraction(a: float, b: float, x: float) -> float:
        qab = a + b
        qap = a + 1.0
        qam = a - 1.0
        c = 1.0
        d = 1.0 - qab * x / qap
        tiny = 1e-300
        if abs(d) < tiny:
            d = tiny
        d = 1.0 / d
        result = d
        for iteration in range(1, 201):
            doubled = 2 * iteration
            term = iteration * (b - iteration) * x / (
                (qam + doubled) * (a + doubled)
            )
            d = 1.0 + term * d
            if abs(d) < tiny:
                d = tiny
            c = 1.0 + term / c
            if abs(c) < tiny:
                c = tiny
            d = 1.0 / d
            result *= d * c

            term = -(
                (a + iteration)
                * (qab + iteration)
                * x
                / ((a + doubled) * (qap + doubled))
            )
            d = 1.0 + term * d
            if abs(d) < tiny:
                d = tiny
            c = 1.0 + term / c
            if abs(c) < tiny:
                c = tiny
            d = 1.0 / d
            delta = d * c
            result *= delta
            if abs(delta - 1.0) <= 3e-14:
                break
        return result

    log_term = (
        math.lgamma(alpha + beta)
        - math.lgamma(alpha)
        - math.lgamma(beta)
        + alpha * math.log(value)
        + beta * math.log1p(-value)
    )
    factor = math.exp(log_term)
    if value < (alpha + 1.0) / (alpha + beta + 2.0):
        return factor * continued_fraction(alpha, beta, value) / alpha
    return 1.0 - factor * continued_fraction(beta, alpha, 1.0 - value) / beta


def _inverse_regularized_beta(probability: float, alpha: float, beta: float) -> float:
    if probability <= 0.0:
        return 0.0
    if probability >= 1.0:
        return 1.0
    low = 0.0
    high = 1.0
    for _ in range(64):
        middle = (low + high) * 0.5
        if _regularized_beta(middle, alpha, beta) < probability:
            low = middle
        else:
            high = middle
    return (low + high) * 0.5


def _simple_schedule(table: Sequence[float], steps: int) -> list[float]:
    stride = len(table) / steps
    values = [table[len(table) - 1 - int(index * stride)] for index in range(steps)]
    return [*values, 0.0]


def _normal_schedule(
    family: str,
    shift: float,
    table: Sequence[float],
    steps: int,
    *,
    sgm: bool,
) -> list[float]:
    start = _timestep_from_sigma(family, table, table[-1])
    end = _timestep_from_sigma(family, table, table[0])
    count = steps + 1 if sgm else steps
    timesteps = _linspace(start, end, count)
    if sgm:
        timesteps = timesteps[:-1]
    values = [_sigma_from_timestep(family, shift, table, value) for value in timesteps]
    return [*values, 0.0]


def _ddim_schedule(table: Sequence[float], steps: int) -> list[float]:
    # ComfyUI DDIM starts at table index 1 and advances by an integer stride.
    # Taking exactly `steps` positions keeps that shape while honoring this
    # node's invariant that every schedule contains steps + 1 values.
    stride = max(len(table) // steps, 1)
    indices = [min(1 + index * stride, len(table) - 1) for index in range(steps)]
    return [float(table[index]) for index in reversed(indices)] + [0.0]


def _beta_schedule(
    table: Sequence[float],
    steps: int,
    alpha: float,
    beta: float,
) -> list[float]:
    last_index = len(table) - 1
    values = []
    for index in range(steps):
        probability = 1.0 - index / steps
        # ComfyUI rounds beta-distributed positions to model timestep indices.
        # Keep repeated positions instead of dropping them so the schedule
        # always contains steps + 1 values.
        position = round(_inverse_regularized_beta(probability, alpha, beta) * last_index)
        values.append(float(table[position]))
    return [*values, 0.0]


def _karras_schedule(sigma_min: float, sigma_max: float, steps: int) -> list[float]:
    rho = 7.0
    minimum = sigma_min ** (1.0 / rho)
    maximum = sigma_max ** (1.0 / rho)
    values = [
        (maximum + index / max(steps - 1, 1) * (minimum - maximum)) ** rho
        for index in range(steps)
    ]
    return [*values, 0.0]


def _exponential_schedule(sigma_min: float, sigma_max: float, steps: int) -> list[float]:
    values = [
        math.exp(
            math.log(sigma_max)
            + index / max(steps - 1, 1) * (math.log(sigma_min) - math.log(sigma_max))
        )
        for index in range(steps)
    ]
    return [*values, 0.0]


def _linear_quadratic_schedule(sigma_max: float, steps: int) -> list[float]:
    if steps == 1:
        return [sigma_max, 0.0]
    linear_steps = steps // 2
    threshold = 0.025
    linear = [index * threshold / linear_steps for index in range(linear_steps)]
    difference = linear_steps - threshold * steps
    quadratic_steps = steps - linear_steps
    quadratic_coefficient = difference / (linear_steps * quadratic_steps**2)
    linear_coefficient = threshold / linear_steps - 2 * difference / quadratic_steps**2
    constant = quadratic_coefficient * linear_steps**2
    quadratic = [
        quadratic_coefficient * index**2 + linear_coefficient * index + constant
        for index in range(linear_steps, steps)
    ]
    return [(1.0 - value) * sigma_max for value in [*linear, *quadratic, 1.0]]


def _kl_optimal_schedule(sigma_min: float, sigma_max: float, steps: int) -> list[float]:
    if steps == 1:
        return [sigma_max, 0.0]
    values = []
    for index in range(steps):
        ratio = index / (steps - 1)
        values.append(
            math.tan(ratio * math.atan(sigma_min) + (1.0 - ratio) * math.atan(sigma_max))
        )
    return [*values, 0.0]


def _normalized_arctangent(
    count: int,
    slope: float,
    center: float,
    high: float,
    low: float,
) -> list[float]:
    """Map a descending arctangent segment exactly onto two endpoint values."""
    if count <= 1:
        return [high]
    raw = [math.atan(slope * (center - index)) for index in range(count)]
    raw_high = raw[0]
    raw_low = raw[-1]
    raw_range = raw_high - raw_low
    return [
        low + (value - raw_low) / raw_range * (high - low)
        for value in raw
    ]


def _bong_tangent_schedule(steps: int) -> list[float]:
    """Independent two-stage arctangent compatibility implementation."""
    if steps == 1:
        return [1.0, 0.0]
    working_count = steps + 2
    split = int(working_count * 0.6)
    scaled_slope = 0.2 * 40.0 / working_count
    center = int(working_count * 0.6)
    first = _normalized_arctangent(split, scaled_slope, center, 1.0, 0.5)
    second = _normalized_arctangent(
        working_count - split,
        scaled_slope,
        center - split,
        0.5,
        0.0,
    )
    return [*first[:-1], *second]


def _base_schedule(profile: str, scheduler: str, steps: int, shift: float) -> list[float]:
    definition = PROFILE_DEFINITIONS.get(profile, PROFILE_DEFINITIONS["custom"])
    family = definition["family"]
    effective_shift = float(shift) if family not in ("custom", "sdxl_discrete") else 1.0
    table = _sigma_table(family, effective_shift)
    sigma_min = float(table[0])
    sigma_max = float(table[-1])

    if scheduler == "simple":
        return _simple_schedule(table, steps)
    if scheduler == "sgm_uniform":
        return _normal_schedule(family, effective_shift, table, steps, sgm=True)
    if scheduler == "normal":
        return _normal_schedule(family, effective_shift, table, steps, sgm=False)
    if scheduler == "ddim_uniform":
        return _ddim_schedule(table, steps)
    if scheduler == "beta":
        return _beta_schedule(table, steps, 0.6, 0.6)
    if scheduler == "beta57":
        return _beta_schedule(table, steps, 0.5, 0.7)
    if scheduler == "karras":
        return _karras_schedule(sigma_min, sigma_max, steps)
    if scheduler == "exponential":
        return _exponential_schedule(sigma_min, sigma_max, steps)
    if scheduler == "linear_quadratic":
        return _linear_quadratic_schedule(sigma_max, steps)
    if scheduler == "kl_optimal":
        return _kl_optimal_schedule(sigma_min, sigma_max, steps)
    if scheduler == "bong_tangent":
        return _bong_tangent_schedule(steps)
    raise ValueError(f"Unsupported scheduler: {scheduler}")


def rescale_schedule(values: Sequence[float], start: float, end: float) -> list[float]:
    old_start = float(values[0])
    old_end = float(values[-1])
    value_range = old_start - old_end
    if math.isclose(value_range, 0.0, abs_tol=1e-12):
        return _linspace(start, end, len(values))
    output = [end + ((float(value) - old_end) / value_range) * (start - end) for value in values]
    output[0] = float(start)
    output[-1] = float(end)
    return output


def _sample_uniform_curve(values: Sequence[float], position: float) -> float:
    scaled = max(0.0, min(1.0, position)) * (len(values) - 1)
    return _sample_table(values, scaled, logarithmic=False)


def apply_curve_factor(values: Sequence[float], curve_factor: float) -> list[float]:
    if not values or math.isclose(curve_factor, 0.0, abs_tol=1e-12):
        return [float(value) for value in values]
    last = len(values) - 1
    output = []
    for index in range(len(values)):
        position = index / max(last, 1)
        if curve_factor > 0.0:
            warped = position ** (1.0 + curve_factor)
        else:
            warped = 1.0 - (1.0 - position) ** (1.0 - curve_factor)
        output.append(_sample_uniform_curve(values, warped))
    output[0] = float(values[0])
    output[-1] = float(values[-1])
    return output


def build_schedule(
    profile: str,
    scheduler: str,
    steps: int,
    shift: float,
    sigma_start: float,
    sigma_end: float,
    curve_factor: float = 0.0,
) -> list[float]:
    steps = max(1, int(steps))
    profile = PROFILE_ALIASES.get(profile, profile)
    if profile not in PROFILE_DEFINITIONS:
        profile = "custom"
    if scheduler not in SCHEDULER_NAMES:
        scheduler = "simple"
    numeric_inputs = (float(shift), float(sigma_start), float(sigma_end), float(curve_factor))
    if not all(math.isfinite(value) for value in numeric_inputs):
        raise ValueError("Schedule inputs must be finite numbers")
    family = PROFILE_DEFINITIONS[profile]["family"]
    if family not in ("custom", "sdxl_discrete") and float(shift) <= 0.0:
        raise ValueError("shift must be greater than zero for flow profiles")
    base = _base_schedule(profile, scheduler, steps, shift)
    scaled = rescale_schedule(base, float(sigma_start), float(sigma_end))
    output = apply_curve_factor(scaled, float(curve_factor))
    if len(output) != steps + 1:
        raise RuntimeError("Schedule generation did not honor the steps + 1 contract")
    return output


def _pchip_slopes(points: Sequence[tuple[float, float]]) -> list[float]:
    count = len(points)
    if count == 2:
        slope = (points[1][1] - points[0][1]) / (points[1][0] - points[0][0])
        return [slope, slope]

    intervals = [points[index + 1][0] - points[index][0] for index in range(count - 1)]
    deltas = [
        (points[index + 1][1] - points[index][1]) / intervals[index]
        for index in range(count - 1)
    ]
    slopes = [0.0] * count

    for index in range(1, count - 1):
        before = deltas[index - 1]
        after = deltas[index]
        if before == 0.0 or after == 0.0 or before * after <= 0.0:
            slopes[index] = 0.0
        else:
            weight_1 = 2.0 * intervals[index] + intervals[index - 1]
            weight_2 = intervals[index] + 2.0 * intervals[index - 1]
            slopes[index] = (weight_1 + weight_2) / (
                weight_1 / before + weight_2 / after
            )

    def endpoint_slope(h_first: float, h_second: float, d_first: float, d_second: float) -> float:
        slope = ((2.0 * h_first + h_second) * d_first - h_first * d_second) / (
            h_first + h_second
        )
        if slope * d_first <= 0.0:
            return 0.0
        if d_first * d_second < 0.0 and abs(slope) > abs(3.0 * d_first):
            return 3.0 * d_first
        return slope

    slopes[0] = endpoint_slope(intervals[0], intervals[1], deltas[0], deltas[1])
    slopes[-1] = endpoint_slope(
        intervals[-1], intervals[-2], deltas[-1], deltas[-2]
    )
    return slopes


def interpolate_control_points(
    points: Iterable[tuple[float, float]],
    steps: int,
    smooth_strength: float,
) -> list[float]:
    ordered = sorted((float(x), float(y)) for x, y in points)
    if len(ordered) < 2:
        raise ValueError("At least two control points are required")
    if any(ordered[index][0] >= ordered[index + 1][0] for index in range(len(ordered) - 1)):
        raise ValueError("Control point positions must be strictly increasing")

    strength = max(0.0, min(1.0, float(smooth_strength)))
    slopes = _pchip_slopes(ordered)
    output = []
    segment = 0
    for index in range(steps + 1):
        target = index / max(steps, 1)
        while segment < len(ordered) - 2 and target > ordered[segment + 1][0]:
            segment += 1
        x0, y0 = ordered[segment]
        x1, y1 = ordered[segment + 1]
        width = x1 - x0
        ratio = max(0.0, min(1.0, (target - x0) / width))
        linear = y0 + ratio * (y1 - y0)
        ratio_2 = ratio * ratio
        ratio_3 = ratio_2 * ratio
        cubic = (
            (2.0 * ratio_3 - 3.0 * ratio_2 + 1.0) * y0
            + (ratio_3 - 2.0 * ratio_2 + ratio) * width * slopes[segment]
            + (-2.0 * ratio_3 + 3.0 * ratio_2) * y1
            + (ratio_3 - ratio_2) * width * slopes[segment + 1]
        )
        output.append(linear * (1.0 - strength) + cubic * strength)
    output[0] = ordered[0][1]
    output[-1] = ordered[-1][1]
    return output
