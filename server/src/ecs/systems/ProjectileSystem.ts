// ─────────────────────────────────────────────────────────────
// Projectile System — Moves Lasers, Handles Ricochets & Homing
// ─────────────────────────────────────────────────────────────
// PERFORMANCE: Homing uses vector lerp (normalized direction
// interpolation), NOT atan2, to avoid expensive trig on
// thousands of bullets per tick.
// ─────────────────────────────────────────────────────────────

import { GAME_WIDTH, GAME_HEIGHT, PROJECTILE_SPEED, HOMING_TURN_RATE } from '@space-shooter/shared';
import type { World } from '../World.js';
import type { ProjectileComponent } from '../components.js';

/**
 * Steer a homing projectile toward its locked target.
 * Uses direction vector lerp — no expensive atan2.
 * Returns true if homing was applied, false if target is lost.
 */
function applyHomingSteering(
  proj: ProjectileComponent,
  pos: { x: number; y: number },
  world: World,
  speed: number,
  deltaSec: number,
): boolean {
  if (proj.lockedTargetId === undefined) return false;

  const targetPos = world.positions.get(proj.lockedTargetId);
  const targetAlive = targetPos !== undefined
    && !world.pendingDestroy.has(proj.lockedTargetId)
    && world.spaceObjects.has(proj.lockedTargetId);

  if (!targetAlive) {
    // Target lost — clear lock, caller will use standard mode
    delete proj.lockedTargetId;
    return false;
  }

  // Current direction from angle
  const curDirX = Math.cos(proj.angle);
  const curDirY = Math.sin(proj.angle);

  // Desired direction (projectile → target), normalized
  const toTargetX = targetPos.x - pos.x;
  const toTargetY = targetPos.y - pos.y;
  const dist = Math.hypot(toTargetX, toTargetY);

  if (dist > 1) {
    const desiredDirX = toTargetX / dist;
    const desiredDirY = toTargetY / dist;

    // Lerp direction toward target
    let newDirX = curDirX + (desiredDirX - curDirX) * HOMING_TURN_RATE;
    let newDirY = curDirY + (desiredDirY - curDirY) * HOMING_TURN_RATE;

    // Re-normalize
    const newLen = Math.hypot(newDirX, newDirY);
    if (newLen > 0.001) {
      newDirX /= newLen;
      newDirY /= newLen;
    }

    proj.angle = Math.atan2(newDirY, newDirX);
  }

  // Move in new direction (no bounce while homing)
  pos.x += Math.cos(proj.angle) * speed * deltaSec;
  pos.y += Math.sin(proj.angle) * speed * deltaSec;

  // Clamp to screen bounds
  pos.x = Math.max(0, Math.min(GAME_WIDTH, pos.x));
  pos.y = Math.max(0, Math.min(GAME_HEIGHT, pos.y));

  return true;
}

import type { IReservePoolProvider } from './SystemRunner.js';

/**
 * Moves all active projectiles. Two modes:
 *
 * 1. **Standard:** Straight-line + wall bounce (ricochet mechanic).
 * 2. **Homing:** If `lockedTargetId` is set and target exists,
 *    steers toward target using direction vector lerp.
 *
 * Deterministic: same state + delta → same result.
 */
export function projectileSystem(world: World, deltaSec: number, reservePool: IReservePoolProvider): void {
  const speed = PROJECTILE_SPEED;

  for (const [entityId, proj] of world.projectiles) {
    const pos = world.positions.get(entityId);
    if (!pos || world.pendingDestroy.has(entityId)) continue;

    // Try homing mode first
    if (applyHomingSteering(proj, pos, world, speed, deltaSec)) {
      continue;
    }

    // ─── Standard mode (straight-line + ricochet) ───
    const dx = Math.cos(proj.angle) * speed * deltaSec;
    const dy = Math.sin(proj.angle) * speed * deltaSec;

    let newX = pos.x + dx;
    let newY = pos.y + dy;
    let angle = proj.angle;
    let bounced = false;

    if (newX <= 0 || newX >= GAME_WIDTH) {
      angle = Math.PI - angle;
      newX = Math.max(0, Math.min(GAME_WIDTH, newX));
      bounced = true;
    }

    if (newY <= 0 || newY >= GAME_HEIGHT) {
      angle = -angle;
      newY = Math.max(0, Math.min(GAME_HEIGHT, newY));
      bounced = true;
    }

    angle = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

    pos.x = newX;
    pos.y = newY;
    proj.angle = angle;

    if (bounced) {
      proj.bouncesRemaining--;
      if (proj.bouncesRemaining <= 0) {
        reservePool.globalReservePool += proj.betAmount;
        world.pendingDestroy.set(entityId, { markedAtTick: world.currentTick });
      }
    }
  }
}
