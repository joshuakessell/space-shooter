// ─────────────────────────────────────────────────────────────
// Cleanup System — Purge Entities Tagged for Destruction
// Runs at the end of each tick per deferred-destroy pattern.
// ─────────────────────────────────────────────────────────────

import type { EntityId } from '@space-shooter/shared';
import type { World } from '../World.js';

/**
 * Purges all entities tagged with PendingDestroy.
 * Returns the list of destroyed entity IDs for delta-state broadcasting.
 *
 * Must run LAST in the system pipeline to avoid corrupting
 * iterators in other systems.
 */
export function cleanupSystem(world: World): EntityId[] {
  return world.purgeDestroyed();
}
