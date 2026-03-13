// ─────────────────────────────────────────────────────────────
// RTP Probability Table
// Each object type: destroyProbability × multiplier ≈ 0.98
// This ensures ~98% RTP regardless of which targets a player shoots.
// ─────────────────────────────────────────────────────────────

import { SpaceObjectType } from './types.js';
import type { IRtpEntry } from './types.js';

/**
 * The RTP table maps each space object type to its payout multiplier
 * and single-shot destruction probability. The math ensures:
 *
 *   E[payout per $1 bet] = destroyProbability × multiplier ≈ 0.98
 *
 * Lower-probability targets have higher multipliers for medium volatility.
 *
 * Object radii also scale inversely with multiplier — rare targets are
 * smaller and harder to hit, adding a skill element on top of the RNG.
 */
export const RTP_TABLE: ReadonlyMap<SpaceObjectType, IRtpEntry> = new Map([
  [SpaceObjectType.ASTEROID, {
    type: SpaceObjectType.ASTEROID,
    multiplier: 2,
    destroyProbability: 0.49,      // 49.0% → 2×0.49 = 0.98
  }],
  [SpaceObjectType.ROCKET, {
    type: SpaceObjectType.ROCKET,
    multiplier: 3,
    destroyProbability: 0.3267,    // 32.67% → 3×0.3267 = 0.98
  }],
  [SpaceObjectType.ALIEN_CRAFT, {
    type: SpaceObjectType.ALIEN_CRAFT,
    multiplier: 5,
    destroyProbability: 0.196,     // 19.6% → 5×0.196 = 0.98
  }],
  [SpaceObjectType.SPACE_JELLY, {
    type: SpaceObjectType.SPACE_JELLY,
    multiplier: 8,
    destroyProbability: 0.1225,    // 12.25% → 8×0.1225 = 0.98
  }],
  [SpaceObjectType.ALIEN_CREATURE, {
    type: SpaceObjectType.ALIEN_CREATURE,
    multiplier: 15,
    destroyProbability: 0.0653,    // 6.53% → 15×0.0653 = 0.98
  }],
  [SpaceObjectType.METEOR_SHOWER, {
    type: SpaceObjectType.METEOR_SHOWER,
    multiplier: 25,
    destroyProbability: 0.0392,    // 3.92% → 25×0.0392 = 0.98
  }],
  [SpaceObjectType.NEBULA_BEAST, {
    type: SpaceObjectType.NEBULA_BEAST,
    multiplier: 50,
    destroyProbability: 0.0196,    // 1.96% → 50×0.0196 = 0.98
  }],
  [SpaceObjectType.COSMIC_WHALE, {
    type: SpaceObjectType.COSMIC_WHALE,
    multiplier: 100,
    destroyProbability: 0.0098,    // 0.98% → 100×0.0098 = 0.98
  }],
]);

/**
 * Collision radius per object type (pixels).
 * Rarer objects are smaller — a skill element layered on the RNG.
 */
export const OBJECT_RADII: ReadonlyMap<SpaceObjectType, number> = new Map([
  [SpaceObjectType.ASTEROID,       40],
  [SpaceObjectType.ROCKET,         35],
  [SpaceObjectType.ALIEN_CRAFT,    32],
  [SpaceObjectType.SPACE_JELLY,    30],
  [SpaceObjectType.ALIEN_CREATURE, 28],
  [SpaceObjectType.METEOR_SHOWER,  26],
  [SpaceObjectType.NEBULA_BEAST,   24],
  [SpaceObjectType.COSMIC_WHALE,   22],
]);

/**
 * Spawn weight per object type.
 * Common objects spawn more frequently; rare ones appear infrequently.
 * Weights are relative (higher = more frequent).
 */
export const SPAWN_WEIGHTS: ReadonlyMap<SpaceObjectType, number> = new Map([
  [SpaceObjectType.ASTEROID,       30],
  [SpaceObjectType.ROCKET,         25],
  [SpaceObjectType.ALIEN_CRAFT,    18],
  [SpaceObjectType.SPACE_JELLY,    12],
  [SpaceObjectType.ALIEN_CREATURE, 7],
  [SpaceObjectType.METEOR_SHOWER,  4],
  [SpaceObjectType.NEBULA_BEAST,   2.5],
  [SpaceObjectType.COSMIC_WHALE,   1.5],
]);
