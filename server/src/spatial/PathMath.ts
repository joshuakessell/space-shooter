// ─────────────────────────────────────────────────────────────
// PathMath — Zero-Allocation Curve Evaluation Utilities
// ─────────────────────────────────────────────────────────────
// PERFORMANCE: All evaluation functions write results to a
// pre-allocated `out` object. No `new` instantiation inside
// the hot MovementSystem loop — prevents GC pressure spikes.
// ─────────────────────────────────────────────────────────────

/** Minimal 2D point for evaluation output */
export interface MutablePoint {
  x: number;
  y: number;
}

/** Readonly input point */
export interface ReadonlyPoint {
  readonly x: number;
  readonly y: number;
}

// ─── Bézier Curves ───

/**
 * Evaluate a linear interpolation (2 control points).
 * B(t) = (1-t)·P0 + t·P1
 */
export function evaluateLinear(
  t: number,
  p0: ReadonlyPoint,
  p1: ReadonlyPoint,
  out: MutablePoint,
): MutablePoint {
  const u = 1 - t;
  out.x = u * p0.x + t * p1.x;
  out.y = u * p0.y + t * p1.y;
  return out;
}

/**
 * Evaluate a quadratic Bézier curve (3 control points).
 * B(t) = (1-t)²·P0 + 2(1-t)t·P1 + t²·P2
 */
export function evaluateQuadraticBezier(
  t: number,
  p0: ReadonlyPoint,
  p1: ReadonlyPoint,
  p2: ReadonlyPoint,
  out: MutablePoint,
): MutablePoint {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  const ut2 = 2 * u * t;

  out.x = uu * p0.x + ut2 * p1.x + tt * p2.x;
  out.y = uu * p0.y + ut2 * p1.y + tt * p2.y;
  return out;
}

/**
 * Evaluate a cubic Bézier curve (4 control points).
 * B(t) = (1-t)³·P0 + 3(1-t)²t·P1 + 3(1-t)t²·P2 + t³·P3
 */
export function evaluateCubicBezier(
  t: number,
  p0: ReadonlyPoint,
  p1: ReadonlyPoint,
  p2: ReadonlyPoint,
  p3: ReadonlyPoint,
  out: MutablePoint,
): MutablePoint {
  const u = 1 - t;
  const uu = u * u;
  const uuu = uu * u;
  const tt = t * t;
  const ttt = tt * t;
  const uut3 = 3 * uu * t;
  const utt3 = 3 * u * tt;

  out.x = uuu * p0.x + uut3 * p1.x + utt3 * p2.x + ttt * p3.x;
  out.y = uuu * p0.y + uut3 * p1.y + utt3 * p2.y + ttt * p3.y;
  return out;
}

/**
 * Auto-dispatch Bézier evaluation based on control point count.
 * - 2 points → linear
 * - 3 points → quadratic
 * - 4 points → cubic
 *
 * Throws for unsupported point counts.
 */
export function evaluateBezier(
  t: number,
  points: readonly ReadonlyPoint[],
  out: MutablePoint,
): MutablePoint {
  switch (points.length) {
    case 2:
      return evaluateLinear(t, points[0], points[1], out);
    case 3:
      return evaluateQuadraticBezier(t, points[0], points[1], points[2], out);
    case 4:
      return evaluateCubicBezier(t, points[0], points[1], points[2], points[3], out);
    default:
      throw new Error(`Unsupported Bézier point count: ${points.length}. Expected 2, 3, or 4.`);
  }
}

// ─── Sine Wave Path ───

/**
 * Evaluate a sine-wave path between two endpoints.
 *
 * The base trajectory is a straight line from `start` to `end`.
 * A sine wave is applied perpendicular to this line:
 *   offset = sin(t × frequency × 2π) × amplitude
 *
 * This creates a "snake" motion along the path.
 */
export function evaluateSinePath(
  t: number,
  start: ReadonlyPoint,
  end: ReadonlyPoint,
  amplitude: number,
  frequency: number,
  out: MutablePoint,
): MutablePoint {
  // Base linear position
  const u = 1 - t;
  const baseX = u * start.x + t * end.x;
  const baseY = u * start.y + t * end.y;

  // Direction vector (start → end)
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);

  if (len === 0) {
    out.x = baseX;
    out.y = baseY;
    return out;
  }

  // Perpendicular unit vector (rotated 90° CCW)
  const perpX = -dy / len;
  const perpY = dx / len;

  // Sine displacement along perpendicular
  const sineOffset = Math.sin(t * frequency * 2 * Math.PI) * amplitude;

  out.x = baseX + perpX * sineOffset;
  out.y = baseY + perpY * sineOffset;
  return out;
}
