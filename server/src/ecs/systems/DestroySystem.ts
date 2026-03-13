// ─────────────────────────────────────────────────────────────
// Destroy System — CSPRNG Roll + Payout Calculation
// Processes collision events from CollisionSystem.
// ─────────────────────────────────────────────────────────────

import type { IPayoutEvent } from '@space-shooter/shared';
import type { World } from '../World.js';
import type { CollisionEvent } from './CollisionSystem.js';
import type { RtpEngine } from '../../services/RtpEngine.js';
import type { WalletManager } from '../../services/WalletManager.js';

/**
 * For each collision event:
 * 1. Look up the space object type
 * 2. Roll the CSPRNG via RtpEngine
 * 3. If destroyed: award payout, tag object for removal
 * 4. Always: tag the projectile for removal (it hit something)
 *
 * Returns payout events for broadcasting to clients.
 */
export function destroySystem(
  world: World,
  collisions: readonly CollisionEvent[],
  rtpEngine: RtpEngine,
  wallet: WalletManager,
): IPayoutEvent[] {
  const payouts: IPayoutEvent[] = [];

  for (const collision of collisions) {
    const { projectileId, objectId, projectileOwnerId, betAmount } = collision;

    // Skip if either entity already pending destroy (double-hit same tick)
    if (world.pendingDestroy.has(projectileId) || world.pendingDestroy.has(objectId)) {
      continue;
    }

    // Look up the space object
    const spaceObj = world.spaceObjects.get(objectId);
    if (!spaceObj) continue;

    // Tag the projectile for removal (it has hit something)
    world.pendingDestroy.set(projectileId, { markedAtTick: world.currentTick });

    // Roll the CSPRNG
    const result = rtpEngine.rollDestruction(spaceObj.type, betAmount);

    if (result.destroyed) {
      // Tag the space object for removal
      world.pendingDestroy.set(objectId, { markedAtTick: world.currentTick });

      // Award payout to the player
      wallet.awardPayout(projectileOwnerId, result.payout);

      payouts.push({
        objectId: String(objectId),
        playerId: projectileOwnerId,
        objectType: spaceObj.type,
        betAmount,
        multiplier: spaceObj.multiplier,
        payout: result.payout,
      });
    }
  }

  return payouts;
}
