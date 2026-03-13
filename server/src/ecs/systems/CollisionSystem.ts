// ─────────────────────────────────────────────────────────────
// Collision System — Broad-Phase (Quadtree) + Narrow-Phase
// Detects projectile-vs-spaceObject collisions.
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
 * Collision detection using Quadtree broad-phase and
 * circle-circle narrow-phase.
 *
 * Returns a list of collision events for DestroySystem to process.
 * Each projectile can only collide with one target per tick
 * (first match wins).
 *
 * Deterministic: iterates in Map insertion order.
 */
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

  // ─── Query each projectile against the tree ───
  const candidates: QuadtreeEntry[] = [];

  for (const [projId, proj] of world.projectiles) {
    const projPos = world.positions.get(projId);
    if (!projPos || world.pendingDestroy.has(projId)) continue;

    candidates.length = 0;
    spaceObjectTree.query(
      { entityId: projId, x: projPos.x, y: projPos.y, radius: PROJECTILE_RADIUS },
      candidates,
    );

    // ─── Narrow phase: circle-circle intersection ───
    for (const candidate of candidates) {
      const dx = projPos.x - candidate.x;
      const dy = projPos.y - candidate.y;
      const distSq = dx * dx + dy * dy;
      const radiiSum = PROJECTILE_RADIUS + candidate.radius;

      if (distSq <= radiiSum * radiiSum) {
        collisions.push({
          projectileId: projId,
          objectId: candidate.entityId,
          projectileOwnerId: proj.ownerId,
          betAmount: proj.betAmount,
        });
        break; // One collision per projectile per tick
      }
    }
  }

  return collisions;
}
