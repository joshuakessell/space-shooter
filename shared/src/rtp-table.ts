// ─────────────────────────────────────────────────────────────
// RTP Probability Table
// DEPRECATED: This map is superseded by GameBalanceConfig.objectTypes
// which is the authoritative source for multipliers, probabilities,
// radii, and spawn weights. This file is kept only for the shared
// OBJECT_RADII map used by the client for rendering hit detection.
// ─────────────────────────────────────────────────────────────

import { SpaceObjectType } from './types.js';
import type { IRtpEntry } from './types.js';

/**
 * @deprecated Use GAME_BALANCE_CONFIG.objectTypes instead.
 * This table is no longer the source of truth for multipliers or probabilities.
 * It remains exported for backward compatibility but should not be relied upon.
 *
 * Authoritative values are in: server/src/config/GameBalanceConfig.ts
 */
export const RTP_TABLE: ReadonlyMap<SpaceObjectType, IRtpEntry> = new Map([
  // Common (ammo sinks)
  [SpaceObjectType.ASTEROID,      { type: SpaceObjectType.ASTEROID,      multiplier: 2,   destroyProbability: 0.49   }],
  [SpaceObjectType.ROCKET,        { type: SpaceObjectType.ROCKET,        multiplier: 3,   destroyProbability: 0.3267 }],
  [SpaceObjectType.ALIEN_CRAFT,   { type: SpaceObjectType.ALIEN_CRAFT,   multiplier: 4,   destroyProbability: 0.245  }],
  // Mid-tier
  [SpaceObjectType.SPACE_JELLY,   { type: SpaceObjectType.SPACE_JELLY,   multiplier: 10,  destroyProbability: 0.098  }],
  [SpaceObjectType.ALIEN_CREATURE,{ type: SpaceObjectType.ALIEN_CREATURE,multiplier: 20,  destroyProbability: 0.049  }],
  [SpaceObjectType.METEOR_SHOWER, { type: SpaceObjectType.METEOR_SHOWER, multiplier: 40,  destroyProbability: 0.0245 }],
  // Boss jackpots
  [SpaceObjectType.NEBULA_BEAST,  { type: SpaceObjectType.NEBULA_BEAST,  multiplier: 80,  destroyProbability: 0.01225 }],
  [SpaceObjectType.COSMIC_WHALE,  { type: SpaceObjectType.COSMIC_WHALE,  multiplier: 200, destroyProbability: 0.0049  }],
  // Feature targets (trigger hazard/bonus on kill)
  [SpaceObjectType.SUPERNOVA_BOMB,{ type: SpaceObjectType.SUPERNOVA_BOMB,multiplier: 15,  destroyProbability: 0.0653 }],
  [SpaceObjectType.BLACKHOLE_GEN, { type: SpaceObjectType.BLACKHOLE_GEN, multiplier: 10,  destroyProbability: 0.098  }],
  [SpaceObjectType.QUANTUM_DRILL, { type: SpaceObjectType.QUANTUM_DRILL, multiplier: 10,  destroyProbability: 0.098  }],
  [SpaceObjectType.EMP_RELAY,     { type: SpaceObjectType.EMP_RELAY,     multiplier: 10,  destroyProbability: 0.098  }],
  [SpaceObjectType.ORBITAL_CORE,  { type: SpaceObjectType.ORBITAL_CORE,  multiplier: 15,  destroyProbability: 0.0653 }],
  [SpaceObjectType.COSMIC_VAULT,  { type: SpaceObjectType.COSMIC_VAULT,  multiplier: 10,  destroyProbability: 0.098  }],
]);

/**
 * Collision radius per object type (pixels).
 * Common fish are small; bosses are large and tanky;
 * feature targets are medium-sized (special, not bullet-magnets).
 */
export const OBJECT_RADII: ReadonlyMap<SpaceObjectType, number> = new Map([
  // Common (small, easy to hit, low value)
  [SpaceObjectType.ASTEROID,       30],
  [SpaceObjectType.ROCKET,         32],
  [SpaceObjectType.ALIEN_CRAFT,    35],
  // Mid-tier
  [SpaceObjectType.SPACE_JELLY,    40],
  [SpaceObjectType.ALIEN_CREATURE, 45],
  [SpaceObjectType.METEOR_SHOWER,  50],
  // Boss (large, tanky, jackpot payouts)
  [SpaceObjectType.NEBULA_BEAST,   65],
  [SpaceObjectType.COSMIC_WHALE,   80],
  // Feature targets (medium hitbox, trigger bonus rounds)
  [SpaceObjectType.SUPERNOVA_BOMB,  50],
  [SpaceObjectType.BLACKHOLE_GEN,   55],
  [SpaceObjectType.QUANTUM_DRILL,   55],
  [SpaceObjectType.EMP_RELAY,       50],
  [SpaceObjectType.ORBITAL_CORE,    55],
  [SpaceObjectType.COSMIC_VAULT,    55],
]);

/**
 * @deprecated Use GAME_BALANCE_CONFIG.objectTypes[type].spawnWeight instead.
 * Kept for backward compatibility. Authoritative values in GameBalanceConfig.
 */
export const SPAWN_WEIGHTS: ReadonlyMap<SpaceObjectType, number> = new Map([
  [SpaceObjectType.ASTEROID,       30],
  [SpaceObjectType.ROCKET,         25],
  [SpaceObjectType.ALIEN_CRAFT,    20],
  [SpaceObjectType.SPACE_JELLY,    12],
  [SpaceObjectType.ALIEN_CREATURE, 8],
  [SpaceObjectType.METEOR_SHOWER,  5],
  [SpaceObjectType.NEBULA_BEAST,   3],
  [SpaceObjectType.COSMIC_WHALE,   1.5],
  [SpaceObjectType.SUPERNOVA_BOMB,  0.8],
  [SpaceObjectType.BLACKHOLE_GEN,   0.5],
  [SpaceObjectType.QUANTUM_DRILL,   0.5],
  [SpaceObjectType.EMP_RELAY,       0.6],
  [SpaceObjectType.ORBITAL_CORE,    0.3],
  [SpaceObjectType.COSMIC_VAULT,    0.4],
]);
