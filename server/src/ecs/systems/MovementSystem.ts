// ─────────────────────────────────────────────────────────────
// Movement System — Moves Space Objects Along Paths
// Pure system: no side effects, no engine imports.
// ─────────────────────────────────────────────────────────────

import type { World } from '../World.js';

/**
 * Advances space objects along their predefined winding paths.
 * Each object has a path (array of waypoints) and a speed.
 * Objects move from waypoint to waypoint; when reaching the end,
 * they are tagged for destruction (exited the screen).
 *
 * Deterministic: same input state + delta → same output state.
 */
export function movementSystem(world: World, deltaSec: number): void {
  for (const [entityId, spaceObj] of world.spaceObjects) {
    const pos = world.positions.get(entityId);
    if (!pos || world.pendingDestroy.has(entityId)) continue;

    const path = spaceObj.path;
    if (path.length < 2) continue;

    // Calculate distance to travel this tick
    const distanceToTravel = spaceObj.speed * deltaSec;

    // Current segment
    const fromIdx = spaceObj.pathIndex;
    const toIdx = fromIdx + 1;

    if (toIdx >= path.length) {
      // Reached end of path — mark for removal
      world.pendingDestroy.set(entityId, { markedAtTick: world.currentTick });
      continue;
    }

    const from = path[fromIdx];
    const to = path[toIdx];

    // Segment length
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const segmentLength = Math.sqrt(dx * dx + dy * dy);

    if (segmentLength === 0) {
      // Degenerate segment — skip to next
      spaceObj.pathIndex++;
      continue;
    }

    // Advance progress
    const progressDelta = distanceToTravel / segmentLength;
    spaceObj.pathProgress += progressDelta;

    // Check if we've passed the current waypoint
    if (spaceObj.pathProgress >= 1) {
      spaceObj.pathIndex++;
      spaceObj.pathProgress = 0;

      if (spaceObj.pathIndex + 1 >= path.length) {
        // Reached end of path
        world.pendingDestroy.set(entityId, { markedAtTick: world.currentTick });
        continue;
      }

      // Snap to the waypoint
      const waypoint = path[spaceObj.pathIndex];
      pos.x = waypoint.x;
      pos.y = waypoint.y;
    } else {
      // Interpolate between waypoints
      pos.x = from.x + dx * spaceObj.pathProgress;
      pos.y = from.y + dy * spaceObj.pathProgress;
    }
  }
}
