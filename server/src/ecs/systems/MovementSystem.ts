// ─────────────────────────────────────────────────────────────
// Movement System — Curve-Based Deterministic Pathing
// ─────────────────────────────────────────────────────────────
// Advances space objects along Bézier/sine/linear paths using
// time-normalized evaluation (t = timeAlive / duration).
//
// PERFORMANCE: Single reusable scratch point — zero allocations
// per tick inside the hot loop.
// ─────────────────────────────────────────────────────────────

import type { World } from '../World.js';
import type { MutablePoint } from '../../spatial/PathMath.js';
import { evaluateBezier, evaluateSinePath } from '../../spatial/PathMath.js';

import type { IReservePoolProvider } from './SystemRunner.js';

/** Reusable scratch point — prevents GC pressure in the hot loop */
const scratch: MutablePoint = { x: 0, y: 0 };

/**
 * Advances all entities with a PathComponent along their curves.
 *
 * For each entity:
 * 1. Advance timeAlive by deltaMs
 * 2. Calculate t = timeAlive / duration (clamped to [0, 1])
 * 3. If t >= 1.0 → tag for PendingDestroy (path complete, no payout). Dumps absorbed credits into global reserve pool.
 * 4. Otherwise → evaluate path curve, add offset, write to PositionComponent
 *
 * Deterministic: same state + deltaMs → same output.
 */
export function movementSystem(world: World, deltaMs: number, reservePool: IReservePoolProvider): void {
  for (const [entityId, path] of world.paths) {
    if (world.pendingDestroy.has(entityId)) continue;

    const pos = world.positions.get(entityId);
    if (!pos) continue;

    // Advance time
    path.timeAlive += deltaMs;

    // Normalized progress [0, 1]
    const t = path.timeAlive / path.duration;

    if (t >= 1) {
      // Path complete — target survived and exited.
      // Recover any absorbed credits into the global reserve pool
      const so = world.spaceObjects.get(entityId);
      if (so && so.absorbedCredits > 0) {
        reservePool.globalReservePool += so.absorbedCredits;
        so.absorbedCredits = 0; // Clear it just in case
      }

      world.pendingDestroy.set(entityId, { markedAtTick: world.currentTick });
      continue;
    }

    // Evaluate curve position into scratch point
    switch (path.pathType) {
      case 'bezier':
      case 'linear':
        evaluateBezier(t, path.controlPoints, scratch);
        break;

      case 'sine':
        // Sine path: first and last control points are start/end,
        // amplitude and frequency drive the wave shape
        evaluateSinePath(
          t,
          path.controlPoints[0],
          path.controlPoints.at(-1)!,
          path.sineAmplitude,
          path.sineFrequency,
          scratch,
        );
        break;
    }

    // Apply formation offset + write to position
    pos.x = scratch.x + path.offset.x;
    pos.y = scratch.y + path.offset.y;
  }
}
