// ─────────────────────────────────────────────────────────────
// Collision System — Broad-Phase (Quadtree) + Narrow-Phase
// Detects projectile-vs-spaceObject collisions.
//
// LOCK-ON PIERCING: If a projectile has a lockedTargetId,
// it bypasses the quadtree entirely and only checks collision
// against the locked target. This prevents locked missiles
// from accidentally hitting other targets.
// ─────────────────────────────────────────────────────────────

import { GAME_WIDTH, GAME_HEIGHT, PROJECTILE_RADIUS } from '@space-shooter/shared';
import type { EntityId } from '@space-shooter/shared';
import type { World } from '../World.js';
import { Quadtree } from '../../spatial/Quadtree.js';
import type { QuadtreeEntry } from '../../spatial/Quadtree.js';

/** A detected collision between a projectile and a space object */
export interface CollisionEvent {
  readonly projectileId: EntityId;
  readonly objectId: EntityId;
  readonly projectileOwnerId: string;
  readonly betAmount: number;
}

// Reusable quadtree instance (cleared each tick)
const spaceObjectTree = new Quadtree({ x: 0, y: 0, width: GAME_WIDTH, height: GAME_HEIGHT });

/**
 * Collision detection with lock-on piercing support.
 *
 * For standard projectiles: Quadtree broad-phase + circle-circle narrow-phase.
 * For locked projectiles: Direct collision check against locked target only.
 *
 * Each projectile can only collide with one target per tick (first match wins).
 *
 * Deterministic: iterates in Map insertion order.
 */
/**
 * Check collision for a locked-on projectile against its single
 * locked target. Returns a CollisionEvent or null.
 */
function checkLockedTargetCollision(
  projId: EntityId,
  proj: { readonly ownerId: string; readonly betAmount: number; readonly lockedTargetId: number },
  projPos: { x: number; y: number },
  world: World,
): CollisionEvent | null {
  const targetPos = world.positions.get(proj.lockedTargetId);
  const targetBound = world.bounds.get(proj.lockedTargetId);

  if (!targetPos || !targetBound || world.pendingDestroy.has(proj.lockedTargetId)) {
    return null;
  }
  if (!world.spaceObjects.has(proj.lockedTargetId)) {
    return null;
  }

  const dx = projPos.x - targetPos.x;
  const dy = projPos.y - targetPos.y;
  const distSq = dx * dx + dy * dy;
  const radiiSum = PROJECTILE_RADIUS + targetBound.radius;

  if (distSq <= radiiSum * radiiSum) {
    return {
      projectileId: projId,
      objectId: proj.lockedTargetId,
      projectileOwnerId: proj.ownerId,
      betAmount: proj.betAmount,
    };
  }

  return null;
}

/**
 * Collision detection with lock-on piercing support.
 *
 * For standard projectiles: Quadtree broad-phase + circle-circle narrow-phase.
 * For locked projectiles: Direct collision check against locked target only.
 *
 * Each projectile can only collide with one target per tick (first match wins).
 *
 * Deterministic: iterates in Map insertion order.
 */

/**
 * Circle-circle narrow-phase against quadtree candidates.
 * Returns the first hit or null.
 */
function findFirstNarrowPhaseHit(
  projId: EntityId,
  proj: { readonly ownerId: string; readonly betAmount: number },
  projPos: { x: number; y: number },
  candidates: readonly QuadtreeEntry[],
): CollisionEvent | null {
  for (const candidate of candidates) {
    const dx = projPos.x - candidate.x;
    const dy = projPos.y - candidate.y;
    const distSq = dx * dx + dy * dy;
    const radiiSum = PROJECTILE_RADIUS + candidate.radius;

    if (distSq <= radiiSum * radiiSum) {
      return {
        projectileId: projId,
        objectId: candidate.entityId,
        projectileOwnerId: proj.ownerId,
        betAmount: proj.betAmount,
      };
    }
  }
  return null;
}
export function collisionSystem(world: World): CollisionEvent[] {
  const collisions: CollisionEvent[] = [];

  // ─── Broad Phase: populate quadtree with space objects ───
  spaceObjectTree.clear();

  for (const [entityId, _spaceObj] of world.spaceObjects) {
    const pos = world.positions.get(entityId);
    const bound = world.bounds.get(entityId);
    if (!pos || !bound || world.pendingDestroy.has(entityId)) continue;

    spaceObjectTree.insert({
      entityId,
      x: pos.x,
      y: pos.y,
      radius: bound.radius,
    });
  }

  // ─── Query each projectile ───
  const candidates: QuadtreeEntry[] = [];

  for (const [projId, proj] of world.projectiles) {
    const projPos = world.positions.get(projId);
    if (!projPos || world.pendingDestroy.has(projId)) continue;

    // ─── Lock-on piercing: only check locked target ───
    if (proj.lockedTargetId !== undefined) {
      const lockedHit = checkLockedTargetCollision(
        projId, { ownerId: proj.ownerId, betAmount: proj.betAmount, lockedTargetId: proj.lockedTargetId }, projPos, world,
      );
      if (lockedHit) collisions.push(lockedHit);
      continue; // Locked projectile ignores all other targets
    }

    // ─── Standard: quadtree broad-phase + narrow-phase ───
    candidates.length = 0;
    spaceObjectTree.query(
      { entityId: projId, x: projPos.x, y: projPos.y, radius: PROJECTILE_RADIUS },
      candidates,
    );

    const stdHit = findFirstNarrowPhaseHit(projId, proj, projPos, candidates);
    if (stdHit) collisions.push(stdHit);
  }

  return collisions;
}
