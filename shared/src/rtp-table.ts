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
 * Object radii scale with multiplier — rare targets are larger and
 * visually dominant, making them easy to aim at but hard to kill.
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
  // Feature targets (trigger hazard or buff on kill)
  [SpaceObjectType.BLACKHOLE_GEN, {
    type: SpaceObjectType.BLACKHOLE_GEN,
    multiplier: 25,
    destroyProbability: 0.0392,    // 3.92% → 25×0.0392 = 0.98
  }],
  [SpaceObjectType.QUANTUM_DRILL, {
    type: SpaceObjectType.QUANTUM_DRILL,
    multiplier: 20,
    destroyProbability: 0.049,     // 4.9% → 20×0.049 = 0.98
  }],
  [SpaceObjectType.EMP_RELAY, {
    type: SpaceObjectType.EMP_RELAY,
    multiplier: 15,
    destroyProbability: 0.0653,    // 6.53% → 15×0.0653 = 0.98
  }],
  [SpaceObjectType.ORBITAL_CORE, {
    type: SpaceObjectType.ORBITAL_CORE,
    multiplier: 30,
    destroyProbability: 0.0327,    // 3.27% → 30×0.0327 = 0.98
  }],
  [SpaceObjectType.COSMIC_VAULT, {
    type: SpaceObjectType.COSMIC_VAULT,
    multiplier: 20,
    destroyProbability: 0.049,     // 4.9% → 20×0.049 = 0.98
  }],
  [SpaceObjectType.SUPERNOVA_BOMB, {
    type: SpaceObjectType.SUPERNOVA_BOMB,
    multiplier: 20,
    destroyProbability: 0.049,     // 4.9% → 20×0.049 = 0.98 (AoE on kill)
  }],
]);

/**
 * Collision radius per object type (pixels).
 * Higher-value targets are LARGER — easy to hit, hard to kill.
 */
export const OBJECT_RADII: ReadonlyMap<SpaceObjectType, number> = new Map([
  [SpaceObjectType.ASTEROID,       36],
  [SpaceObjectType.ROCKET,         38],
  [SpaceObjectType.ALIEN_CRAFT,    42],
  [SpaceObjectType.SPACE_JELLY,    48],
  [SpaceObjectType.ALIEN_CREATURE, 55],
  [SpaceObjectType.METEOR_SHOWER,  62],
  [SpaceObjectType.NEBULA_BEAST,   80],
  [SpaceObjectType.COSMIC_WHALE,   100],
  [SpaceObjectType.SUPERNOVA_BOMB,  60],
  [SpaceObjectType.BLACKHOLE_GEN,   113],
  [SpaceObjectType.QUANTUM_DRILL,   100],
  [SpaceObjectType.EMP_RELAY,       106],
  [SpaceObjectType.ORBITAL_CORE,    125],
  [SpaceObjectType.COSMIC_VAULT,    119],
]);

/**
 * Spawn weight per object type.
 * Common objects spawn more frequently; rare ones appear infrequently.
 * Weights are relative (higher = more frequent).
 */
export const SPAWN_WEIGHTS: ReadonlyMap<SpaceObjectType, number> = new Map([
  [SpaceObjectType.ASTEROID,       24],
  [SpaceObjectType.ROCKET,         22],
  [SpaceObjectType.ALIEN_CRAFT,    18],
  [SpaceObjectType.SPACE_JELLY,    14],
  [SpaceObjectType.ALIEN_CREATURE, 10],
  [SpaceObjectType.METEOR_SHOWER,  7],
  [SpaceObjectType.NEBULA_BEAST,   4],
  [SpaceObjectType.COSMIC_WHALE,   3],
  [SpaceObjectType.SUPERNOVA_BOMB,  1.5],
  [SpaceObjectType.BLACKHOLE_GEN,   0.4],
  [SpaceObjectType.QUANTUM_DRILL,   0.5],
  [SpaceObjectType.EMP_RELAY,       0.5],
  [SpaceObjectType.ORBITAL_CORE,    0.3],
  [SpaceObjectType.COSMIC_VAULT,    0.3],
]);
