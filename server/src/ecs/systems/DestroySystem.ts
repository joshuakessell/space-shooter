// ─────────────────────────────────────────────────────────────
// Destroy System — 4-Layer RTP Roll + Piñata + First-Kill Mutex
// Processes collision events from CollisionSystem.
// ─────────────────────────────────────────────────────────────
// SECURITY: Uses first-kill mutex (isDead) to prevent double-payout
// when multiple projectiles hit the same target in the same tick.
// AUDIT: Returns IHitEvaluation with full modifier breakdown.
// CONFIG-DRIVEN: All math flows through RtpEngine → GameBalanceConfig.
// ─────────────────────────────────────────────────────────────

import type { IPayoutEvent } from '@space-shooter/shared';
import type { World } from '../World.js';
import type { CollisionEvent } from './CollisionSystem.js';
import type { RtpEngine, IHitEvaluation } from '../../services/RtpEngine.js';
import type { WalletManager } from '../../services/WalletManager.js';
import type { RoomEconomyManager } from '../../services/RoomEconomyManager.js';

/** Extended payout event with audit data */
export interface IAuditedPayoutEvent extends IPayoutEvent {
  readonly hitEvaluation: IHitEvaluation;
}

/** Result of a single collision resolution (hit or miss) */
export interface ICollisionResolution {
  readonly playerId: string;
  readonly targetEntityId: number;
  readonly betAmount: number;
  readonly hitEvaluation: IHitEvaluation;
}

/**
 * For each collision event:
 * 1. Check isDead mutex — skip if target already dead this tick
 * 2. Evaluate hit via 4-layer RtpEngine
 * 3. If miss: absorb betAmount into target's piñata counter
 * 4. If kill: award payout, set isDead=true, tag for removal
 * 5. Always: tag the projectile for removal (it hit something)
 *
 * Returns:
 * - payouts: for broadcasting to clients
 * - allResolutions: every collision result for audit logging
 */
export function destroySystem(
  world: World,
  collisions: readonly CollisionEvent[],
  rtpEngine: RtpEngine,
  wallet: WalletManager,
  economy: RoomEconomyManager,
): { payouts: IPayoutEvent[]; resolutions: ICollisionResolution[] } {
  const payouts: IPayoutEvent[] = [];
  const resolutions: ICollisionResolution[] = [];

  for (const collision of collisions) {
    const { projectileId, objectId, projectileOwnerId, betAmount } = collision;

    // Skip if projectile already consumed this tick
    if (world.pendingDestroy.has(projectileId)) {
      continue;
    }

    // Look up the space object
    const spaceObj = world.spaceObjects.get(objectId);
    if (!spaceObj) continue;

    // ─── FIRST-KILL MUTEX ───
    // If another projectile already killed this target this tick,
    // the bullet passes through. No payout, no piñata absorption.
    if (spaceObj.isDead) {
      // Projectile still consumed (it hit the corpse)
      world.pendingDestroy.set(projectileId, { markedAtTick: world.currentTick });
      continue;
    }

    // Skip if target pending destroy from previous tick
    if (world.pendingDestroy.has(objectId)) {
      world.pendingDestroy.set(projectileId, { markedAtTick: world.currentTick });
      continue;
    }

    // Tag the projectile for removal (it has hit something)
    world.pendingDestroy.set(projectileId, { markedAtTick: world.currentTick });

    // ─── 4-LAYER RTP EVALUATION ───
    const hitEval = rtpEngine.evaluateHit(
      spaceObj.type,
      betAmount,
      projectileOwnerId,
      objectId,
      spaceObj.absorbedCredits,
    );

    // Record resolution for audit logging
    resolutions.push({
      playerId: projectileOwnerId,
      targetEntityId: objectId,
      betAmount,
      hitEvaluation: hitEval,
    });

    if (hitEval.destroyed) {
      // ─── KILL ───
      // Set isDead immediately (first-kill mutex within same tick)
      spaceObj.isDead = true;

      // Tag for deferred cleanup
      world.pendingDestroy.set(objectId, { markedAtTick: world.currentTick });

      // Award payout to the player
      wallet.awardPayout(projectileOwnerId, hitEval.payout);

      // Track in room economy
      economy.recordPayout(hitEval.payout);

      payouts.push({
        objectId: String(objectId),
        playerId: projectileOwnerId,
        objectType: spaceObj.type,
        betAmount,
        multiplier: hitEval.multiplier,
        payout: hitEval.payout,
      });
    } else {
      // ─── MISS (Piñata Absorption) ───
      // Failed RNG roll: absorb the bet into the target's hidden counter.
      // This increases future kill chance via PiñataModifier.
      // SECURITY: absorbedCredits stays in server memory only.
      spaceObj.absorbedCredits += betAmount;
    }
  }

  return { payouts, resolutions };
}
