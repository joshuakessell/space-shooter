// ─────────────────────────────────────────────────────────────
// Projectile System — Moves Lasers & Handles Wall Ricochets
// Pure system: deterministic trajectory calculation.
// ─────────────────────────────────────────────────────────────

import { GAME_WIDTH, GAME_HEIGHT, PROJECTILE_SPEED } from '@space-shooter/shared';
import type { World } from '../World.js';

/** Maximum bounces before a projectile expires */
const MAX_BOUNCES = 10;

/**
 * Moves all active projectiles in straight lines and bounces
 * them off the screen edges (ricochet mechanic).
 *
 * When a projectile exhausts its bounces, it is tagged for destruction.
 *
 * Deterministic: same state + delta → same result.
 */
export function projectileSystem(world: World, deltaSec: number): void {
  for (const [entityId, proj] of world.projectiles) {
    const pos = world.positions.get(entityId);
    if (!pos || world.pendingDestroy.has(entityId)) continue;

    const speed = PROJECTILE_SPEED;
    const dx = Math.cos(proj.angle) * speed * deltaSec;
    const dy = Math.sin(proj.angle) * speed * deltaSec;

    let newX = pos.x + dx;
    let newY = pos.y + dy;
    let angle = proj.angle;
    let bounced = false;

    // Wall bounce — left/right
    if (newX <= 0 || newX >= GAME_WIDTH) {
      angle = Math.PI - angle;
      newX = Math.max(0, Math.min(GAME_WIDTH, newX));
      bounced = true;
    }

    // Wall bounce — top/bottom
    if (newY <= 0 || newY >= GAME_HEIGHT) {
      angle = -angle;
      newY = Math.max(0, Math.min(GAME_HEIGHT, newY));
      bounced = true;
    }

    // Normalize angle to [0, 2π)
    angle = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

    pos.x = newX;
    pos.y = newY;
    proj.angle = angle;

    if (bounced) {
      proj.bouncesRemaining--;
      if (proj.bouncesRemaining <= 0) {
        world.pendingDestroy.set(entityId, { markedAtTick: world.currentTick });
      }
    }
  }
}
