// ─────────────────────────────────────────────────────────────
// RTP Engine — Casino Math Core
// Determines if a shot destroys a target based on
// the probability matrix and CSPRNG.
// ─────────────────────────────────────────────────────────────

import type { SpaceObjectType, IDestroyResult } from '@space-shooter/shared';
import { RTP_TABLE } from '@space-shooter/shared';
import type { IRngService } from './CsprngService.js';

/**
 * The RTP Engine is the central casino math module.
 * Given a bet and a target type, it rolls the CSPRNG and determines
 * whether the target is destroyed and what the payout is.
 *
 * The math: E[payout] = destroyProbability × multiplier × betAmount ≈ 0.98 × betAmount
 */
export class RtpEngine {
  constructor(private readonly rng: IRngService) {}

  /**
   * Roll for destruction.
   * @param objectType The type of space object hit
   * @param betAmount The bet wagered on this shot
   * @returns { destroyed, payout }
   */
  rollDestruction(objectType: SpaceObjectType, betAmount: number): IDestroyResult {
    const entry = RTP_TABLE.get(objectType);
    if (!entry) {
      throw new Error(`Unknown SpaceObjectType: ${objectType}`);
    }

    const roll = this.rng.random(); // [0, 1)
    const destroyed = roll < entry.destroyProbability;

    return {
      destroyed,
      payout: destroyed ? betAmount * entry.multiplier : 0,
    };
  }

  /**
   * Get the multiplier for an object type (for UI display purposes).
   */
  getMultiplier(objectType: SpaceObjectType): number {
    const entry = RTP_TABLE.get(objectType);
    if (!entry) {
      throw new Error(`Unknown SpaceObjectType: ${objectType}`);
    }
    return entry.multiplier;
  }
}
